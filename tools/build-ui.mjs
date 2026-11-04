// Builds "PokeBonk Builder.html": the builder page with the extracted data embedded.
// Usage: node build-ui.mjs <extracted/<version> folder> <output.html>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function slimData(dir) {
  const L = (n) => JSON.parse(fs.readFileSync(path.join(dir, 'json', n + '.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const noFn = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && '$fn' in v ? undefined : v)));
  const species = L('species').map((s) => ({
    id: s.id, key: s.key, name: s.name, types: s.types, stats: s.stats, bst: s.bst, legendary: s.legendary, mythical: s.mythical,
    evoFrom: s.evoFrom, evoStage: s.evoStage, family: s.family, evos: s.run_evolutions,
    learnset: s.learnset.filter((l) => l.move).map((l) => [l.move, l.level]),
  }));
  const partners = L('partners').map((p) => ({
    id: p.id, name: p.name, start: !!p.start, role: p.role, rank: p.rank, passive: p.passive, kit: p.kit,
    challenge: Array.isArray(p.challenge) ? p.challenge.map((c) => c.desc) : p.challenge ? [p.challenge.desc] : [],
    pools: p.pools,
  }));
  const used = new Set();
  for (const s of species) for (const [m] of s.learnset) used.add(m);
  for (const p of partners) { p.kit.forEach((m) => used.add(m)); for (const pl of Object.values(p.pools ?? {})) { for (const g of ['kit', 'line', 'shared']) pl[g].forEach((x) => used.add(x.move)); (pl.any ?? []).forEach((m) => used.add(m)); } }
  const fusions = L('fusions').map((f) => ({ key: f.key, kind: f.kind, member: f.member, moves: f.moves, pair: f.pair, name: f.name, desc: f.desc, type: f.type, type2: f.type2, cls: f.cls, cd: f.cd, power: f.power, hits: f.hits, range: f.range, status: f.status }));
  for (const f of fusions) (f.moves ?? []).forEach((m) => used.add(m));
  const moves = L('moves').filter((m) => used.has(m.key)).map((m) => {
    const o = {}; for (const k of ['key', 'name', 'type', 'cls', 'arch', 'power', 'dmg', 'cd', 'count', 'area', 'speed', 'dur', 'pierce', 'status', 'statusChance', 'drain', 'critBonus', 'flinch', 'weather', 'buff', 'pulses', 'spread', 'desc']) if (m[k] != null && m[k] !== '') o[k] = m[k];
    return o;
  });
  const passives = Object.fromEntries(Object.entries(noFn(L('passives'))).map(([k, v]) => [k, v]));
  const ultimates = L('ultimates');
  for (const u of Object.values(ultimates)) delete u.$fn;
  const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] != null).map((k) => [k, o[k]]));
  return {
    meta: { version: meta.version, build: meta.build, extracted_at: meta.extracted_at },
    species, partners, moves, passives, ultimates: noFn(ultimates), fusions,
    archetypes: Object.fromEntries(Object.entries(L('archetypes')).map(([k, v]) => [k, pick(v, ['label', 'desc', 'dmg', 'cd', 'count', 'area', 'speed', 'dur', 'pierce', 'stats'])])),
    vitamins: L('vitamins'), items: noFn(L('items')).map((i) => pick(i, ['key', 'name', 'rarity', 'max', 'desc', 'mods', 'tags'])),
    typeItems: L('type_items'), lab: L('lab').map((u) => pick(u, ['id', 'name', 'desc', 'max', 'costs', 'stat', 'per'])),
    rarity: L('rarity_multipliers').values, kitLevels: L('partner_kit_unlock_levels'),
    types: { list: L('types').types, names: L('types').names, chart: L('types').chart },
    statLabels: L('stat_labels'),
  };
}

export function buildUi(dir, outFile) {
  const tpl = fs.readFileSync(path.join(here, 'builder.template.html'), 'utf8');
  const data = JSON.stringify(slimData(dir)).replace(/</g, '\\u003c');
  fs.writeFileSync(outFile, tpl.replace('/*__POKEBONK_DATA__*/null', data));
  return outFile;
}

export function buildSite(dir, siteDir) {
  fs.mkdirSync(siteDir, { recursive: true });
  buildUi(dir, path.join(siteDir, 'index.html'));
  fs.writeFileSync(path.join(siteDir, 'data.json'), JSON.stringify(slimData(dir)));
  fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');
  return siteDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [dir, out] = process.argv.slice(2);
  if (out.endsWith('.json')) { fs.writeFileSync(out, JSON.stringify(slimData(dir))); console.log('wrote', out); }
  else console.log('wrote', buildUi(dir, out));
}
