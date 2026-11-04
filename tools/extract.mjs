// PokeBonk data extractor.
// Usage: node extract.mjs <rawDir> <outDir>
// rawDir must contain the game's JS chunks (main-*.js, defineProperty-*.js, en-*.js, i18n-*.js)
// and the runtime JSON (pokemon, moves, learnsets, abilities, types, items, en, version).
import { load } from './ev.mjs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import fs from 'fs';
import path from 'path';

const [rawDir, outRoot] = process.argv.slice(2);
const files = fs.readdirSync(rawDir);
const pick = (re) => { const f = files.find((x) => re.test(x)); if (!f) throw Error('missing ' + re); return f; };
// main game chunk = the largest main-*.js
const mainF = files.filter((f) => /^main-.*\.js$/.test(f)).sort((a, b) => fs.statSync(path.join(rawDir, b)).size - fs.statSync(path.join(rawDir, a)).size)[0];
// shared data chunk = the biggest chunk the main game chunk imports (other than i18n / three.js)
const mainImports = [...fs.readFileSync(path.join(rawDir, mainF), 'utf8').slice(0, 20000).matchAll(/from"\.\/([^"]+\.js)"/g)].map((m) => m[1]);
const dpF = mainImports.filter((f) => !/^(i18n|three)[-.]/.test(f) && files.includes(f))
  .sort((a, b) => fs.statSync(path.join(rawDir, b)).size - fs.statSync(path.join(rawDir, a)).size)[0] ?? pick(/^defineProperty-.*\.js$/);
const enF = pick(/^en-.*\.js$/);
const J = (n) => JSON.parse(fs.readFileSync(path.join(rawDir, n), 'utf8'));
const version = J('version.json');
const SAFE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,40}$/;
if (!SAFE.test(String(version.version)) || String(version.version).includes('..') || !SAFE.test(String(version.build))) throw Error('unexpected version.json: ' + JSON.stringify(version).slice(0, 100));
const outDir = path.join(outRoot, version.version);
fs.mkdirSync(outDir, { recursive: true });

const L = load(rawDir, enF);
const M = L.mod(mainF), D = L.mod(dpF);
const warn = [];

// ---------- resolve names via export maps so minified names can change between builds ----------
// We locate tables by *shape* rather than by minified name, so the script survives rebuilds.
function findDecl(mod, test) {
  const hits = [];
  for (const [k, d] of mod.decls) {
    if (d.kind !== 'var' || !/^[\[{]/.test(d.src)) continue;
    if (!test.src(d.src)) continue;
    let v; try { v = mod.get(k); } catch { continue; }
    if (test.val(v)) hits.push(k);
  }
  return hits;
}
const has = (o, ...ks) => o && typeof o === 'object' && ks.every((k) => k in o);
const first = (v) => Array.isArray(v) ? v[0] : v && typeof v === 'object' ? v[Object.keys(v)[0]] : undefined;
function one(mod, label, test) {
  const h = findDecl(mod, test);
  if (h.length !== 1) warn.push(`${label}: ${h.length} candidates ${h.join(',')}`);
  return h[0];
}
function all(mod, test) { return findDecl(mod, test); }

// ---------- 1. localise the runtime store (English) BEFORE evaluating text tables ----------
const en = J('en.json');
const pokemon = J('pokemon.json'), moves = J('moves.json'), learnsets = J('learnsets.json'),
  abilities = J('abilities.json'), types = J('types.json'), itemsJ = J('items.json');
for (const p of pokemon) { if (en.pokemon[p.id]) p.name = en.pokemon[p.id]; if (en.flavor?.[p.id]) p.flavor = en.flavor[p.id]; }
for (const m of moves) if (en.moves[m.id]) m.name = en.moves[m.id];
for (const [k, a] of Object.entries(abilities)) { const r = en.abilities[k]; if (r?.name) { a.name = r.name; a.desc = r.desc || a.desc; } }
for (const [k, it] of Object.entries(itemsJ)) { const r = en.items[k]; if (r?.name) { it.name = r.name; it.desc = r.desc || it.desc; } }
for (const t of Object.keys(types.names)) if (en.types[t]) types.names[t] = en.types[t];

// The store object `j` in main: a `new class{...}` whose constructor sets pokemon/byId/moves/movesByKey.
const storeName = [...M.decls].find(([k, d]) => /^new class\{constructor\(\)\{A\(this,`pokemon`/.test(d.src))?.[0];
if (!storeName) throw Error('data store not found');
const store = M.get(storeName);
// game code only ever sees copies made inside its own context
const pokemonC = M.fromJSON(pokemon), movesC = M.fromJSON(moves);
store.all = pokemonC; store.learnsets = M.fromJSON(learnsets); store.abilities = M.fromJSON(abilities); store.types = M.fromJSON(types); store.items = M.fromJSON(itemsJ);
for (const m of movesC) { store.moves.set(m.id, m); store.movesByKey.set(m.key, m); }
for (const p of pokemonC) store.byId.set(p.id, p);
types.types.forEach((t, i) => store.typeIndex.set(t, i));
// type-name map used inside item descriptions (an object keyed by type with string values, referenced by localize())
const localizeSrc = M.decls.get(storeName).src;
const tnName = /for\(let t of Object\.keys\((\w+)\)\)e\.types\[t\]/.exec(localizeSrc)?.[1];
if (tnName) { const tn = M.get(tnName); for (const t of Object.keys(tn)) if (en.types[t]) tn[t] = en.types[t]; }
// also the dp copies of type names (two O18 string maps)
for (const k of all(D, { src: (s) => s.startsWith('{normal:') && s.length < 600, val: (v) => typeof v?.normal === 'string' && typeof v?.fighting === 'string' }))
  { const tn = D.get(k); for (const t of Object.keys(tn)) if (en.types[t] && /^[A-ZÁ-Úa-zá-ú ]+$/.test(tn[t]) && !tn[t].startsWith('#')) tn[t] = en.types[t]; }

// species filter (which of the 1025 are in-game) — function referenced in store.load as this.all.filter(e=>XX(e.id))
const vnName = /this\.pokemon=this\.all\.filter\(e=>(\w+)\(e\.id\)\)/.exec(localizeSrc)?.[1];
const inGame = M.get(vnName);
store.pokemon = pokemonC.filter((p) => inGame(p.id));
for (const e of store.pokemon) if (e.evoFrom != null && inGame(e.evoFrom)) { let t = store.evolutions.get(e.evoFrom); t || store.evolutions.set(e.evoFrom, t = []); t.push(e); }

// ---------- 2. run the top-level statements that mutate data tables ----------
function runStatements(mod, filter) {
  const ast = acorn.parse(mod.src, { ecmaVersion: 'latest', sourceType: 'module' });
  for (const st of ast.body) {
    if (!['ExpressionStatement', 'ForOfStatement', 'BlockStatement'].includes(st.type)) continue;
    const s = mod.src.slice(st.start, st.end);
    if (!filter(s)) continue;
    try { mod.run(s); } catch (e) { warn.push(`stmt@${st.start}: ${e.message.slice(0, 80)}`); }
  }
}
runStatements(D, (s) => /\.push\(\.\.\.\w+,\.\.\.\w+/.test(s) || /^\{let e=\w+\.find\(e=>e\.id===151\)/.test(s));
runStatements(M, (s) => /^\w+\[\d+\]=\{names:/.test(s) || /OVERRIDES\)/.test(s) || /^Object\.assign\(\w+,\w+,\w+,\w+,\w+,\w+\);?$/.test(s) && !/Eg|Ml/.test(s) || /^\w+\.forEach\(\(e,t\)=>\{let n=\w+\+t;if\(e\.power=/.test(s));

// ---------- helpers for serialisation ----------
const VFX = new Set(['cast', 'sfx', 'preload', 'tint', 'look', 'trail', 'hit', 'strike', 'sky', 'fog', 'fogNear', 'fogFar', 'light', 'sun', 'ground', 'cloud', 'clouds', 'water', 'hemi', 'amb']);
function clean(v, keepFn = true, depth = 0, seen = new WeakSet()) {
  if (typeof v === 'function') return keepFn ? { $fn: v.toString() } : undefined;
  const tag = Object.prototype.toString.call(v);
  if (tag === '[object Map]') return clean(Object.fromEntries(v), keepFn, depth, seen);
  if (tag === '[object Set]') return [...v];
  if (v && typeof v === 'object') {
    if (seen.has(v)) return '[circular]'; seen.add(v);
    if (depth > 12) return '[deep]';
    if (Array.isArray(v)) return v.map((x) => clean(x, keepFn, depth + 1, seen));
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (VFX.has(k) && (typeof x === 'function' || (x && typeof x === 'object' && !Array.isArray(x) && Object.values(x).some((y) => typeof y === 'function')))) continue; const c = clean(x, keepFn, depth + 1, seen); if (c !== undefined) o[k] = c; }
    return o;
  }
  return v;
}
const out = {};
const put = (name, v, keepFn = true) => { out[name] = clean(v, keepFn); };
const S = (s) => (src) => src.includes(s);

// ---------- 3. tables ----------
// changelog
const changelogN = one(D, 'changelog', { src: (s) => s.startsWith('[{version:`'), val: (v) => has(v?.[0], 'version', 'build', 'date', 'notes') });
const changelog = D.get(changelogN).map((r) => ({ version: r.version, build: r.build, date: r.date, title: typeof r.title === 'function' ? r.title() : r.title, notes: (typeof r.notes === 'function' ? r.notes() : r.notes)?.map(([k, t]) => ({ kind: k, text: t })) }));

// vitamins
const vitN = one(D, 'vitamins', { src: S('stat:`physical`'), val: (v) => Array.isArray(v) && has(v[0], 'key', 'stat', 'per', 'kind') });
put('vitamins', D.get(vitN));

// items (in-run)
const itemN = one(D, 'items', { src: S('rarity:'), val: (v) => Array.isArray(v) && v.length > 50 && has(v[0], 'key', 'rarity', 'mods') });
const items = D.get(itemN).map((it) => ({ ...it, name: itemsJ[it.key]?.name ?? it.key, max: it.max ?? 10 }));
put('items', items);
const typeItemN = one(D, 'typeItems', { src: S('charcoal:`fire`'), val: (v) => v?.charcoal === 'fire' });
put('type_items', D.get(typeItemN));
const shopN = one(D, 'shop', { src: (s) => /^\[\w+\(`[a-z-]+`,\d+\)/.test(s), val: (v) => Array.isArray(v) && has(v[0], 'key', 'price') && !has(v[0], 'id') });
put('shop', D.get(shopN));
const liveItemN = one(M, 'itemLive', { src: S('"shell-bell":'), val: (v) => typeof v?.['shell-bell'] === 'function' });
put('item_live_text', M.get(liveItemN));

// Lab
const labN = one(D, 'lab', { src: S('`slot-move`'), val: (v) => Array.isArray(v) && has(v[0], 'id', 'max', 'cost') });
put('lab', D.get(labN).map((u) => ({ ...u, costs: Array.from({ length: u.max }, (_, i) => { try { return u.cost(i); } catch { return null; } }), cost: u.cost })));

// partners (League roster)
const rosterN = one(D, 'roster', { src: S('passive:'), val: (v) => Array.isArray(v) && v.length > 60 && has(v[0], 'id', 'role', 'passive', 'kit') });
const roster = D.get(rosterN).map((r) => ({ ...r, name: store.byId.get(r.id)?.name }));
// move pool per partner and per evolution stage, computed by the game's own build-plan function
const swName = [...M.decls].find(([k, d]) => d.kind === 'FunctionDeclaration' && d.src.includes('passive===`mew`)s=[...') && d.src.includes('shared:'))?.[0];
if (swName) {
  const sw = M.get(swName);
  const keyOf = (id) => store.moves.get(id)?.key;
  const lineOf = (id) => { const out = [id]; for (let i = 0; i < out.length; i++) for (const e of store.evolutionsOf(out[i])) out.push(e.id); return out; };
  const rosterLive = D.get(rosterN);
  const alwaysOpen = M.fn('() => true');
  for (const r of roster) {
    const live = rosterLive.find((x) => x.id === r.id);
    r.pools = {};
    for (const sid of lineOf(r.id)) {
      try {
        const sp = store.byId.get(sid); const p = sw(sid, live, sp.types, alwaysOpen);
        r.pools[sid] = { species: sp.name, types: sp.types,
          kit: p.kit.map((m) => ({ move: keyOf(m.id), level: m.level })),
          line: p.line.map((m) => ({ move: keyOf(m.id), level: m.level })),
          shared: p.shared.map((m) => ({ move: keyOf(m.id), level: m.level, from: m.from })),
          any: p.any ? p.any.map((m) => keyOf(m.id)) : null };
      } catch (e) { warn.push('pool ' + sid + ' ' + e.message.slice(0, 60)); }
    }
  }
} else warn.push('move pool function not found');
put('partners', roster);

// difficulty scaling per tier
const diffN = one(D, 'difficulty', { src: S('alphaCap1'), val: (v) => Array.isArray(v?.hp) });
put('difficulty_scaling', D.get(diffN));
const mutN = one(D, 'mutators', { src: S('swap:'), val: (v) => Array.isArray(v) && has(v[0], 'tier', 'swap', 'enemy') });
put('mutators', D.get(mutN));
const biomeN = one(D, 'biomes', { src: S('residents:'), val: (v) => Array.isArray(v) && has(v[0], 'id', 'name', 'residents') });
put('biomes', D.get(biomeN));
const weatherN = one(D, 'weather', { src: S('boost:'), val: (v) => has(v?.rain, 'boost', 'nerf') });
put('weather', D.get(weatherN));
const permN = one(D, 'permBonuses', { src: S('charm:!0'), val: (v) => Array.isArray(v) && has(v[0], 'n', 'name', 'desc') });
if (permN) put('shiny_bonuses', D.get(permN));
const consN = one(D, 'consumables', { src: S('`rare-candy`'), val: (v) => Array.isArray(v) && v.length < 12 && has(v[0], 'id', 'name', 'desc') && v[0].id === 'rare-candy' });
if (consN) put('run_boosters', D.get(consN));
const synN = one(D, 'typeNeeds', { src: S('need:'), val: (v) => Array.isArray(v) && has(v[0], 'type', 'need') });
put('type_set_needs', D.get(synN));
const questN = one(D, 'quests', { src: S('reward:'), val: (v) => Array.isArray(v) && has(v[0], 'id', 'counter', 'goal', 'reward') });
put('quests', D.get(questN));

// archetypes, moves
const archN = one(M, 'archetypes', { src: S('bolt:{dmg:'), val: (v) => has(v?.bolt, 'dmg', 'cd', 'count', 'stats') });
put('archetypes', M.get(archN));
const arch = M.get(archN);
// move builder function: function XX(e){let t=..get(e);if(t)return t;if(..has(e))...let r=YY(n)...nb[r]
const mbName = [...M.decls].find(([k, d]) => d.kind === 'FunctionDeclaration' && d.src.includes('critBonus:n.crit>=1') )?.[0];
const pbName = [...M.decls].find(([k, d]) => d.kind === 'FunctionDeclaration' && d.src.includes('return`strike`;if(e.drain>0)return`drain`'))?.[0];
const mb = M.get(mbName);
const gameMoves = [];
for (const m of moves) { let d; try { d = mb(m.id); } catch (e) { warn.push('mb ' + m.key + ' ' + e.message.slice(0, 60)); } if (d) gameMoves.push({ ...d, accuracy: m.accuracy, priority: m.priority, pp: m.pp }); }
put('moves', gameMoves);
const rarN = one(D, 'rarityMult', { src: (s) => s.length < 40, val: (v) => Array.isArray(v) && v.length === 5 && v[0] === 1 && v[1] === 1.2 });
put('rarity_multipliers', { values: D.get(rarN), names: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] });

// passives / abilities (League passives merged)
const passN = one(M, 'passives', { src: S('photosynthesis:'), val: (v) => has(v?.photosynthesis, 'name', 'desc') });
put('passives', M.get(passN));
const auraN = one(M, 'passiveAuras', { src: S('every:'), val: (v) => v && Object.values(v)[0] && has(Object.values(v)[0], 'status', 'chance', 'life') });
if (auraN) put('passive_trails', M.get(auraN));

// ultimates: objects keyed by dex id with names/descs/type/cls/dur
const ultNames = all(M, { src: S('names:['), val: (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).length && has(Object.values(v)[0], 'names', 'descs', 'type', 'cls') });
const ultimates = {};
for (const n of ultNames) Object.assign(ultimates, M.get(n));
put('ultimates', Object.fromEntries(Object.entries(ultimates).map(([k, v]) => [k, { ...v, species: /^\d+$/.test(k) ? store.byId.get(+k)?.name : undefined }])), false);

// fusions: the merged array (contains signature/type/reaction/glitch kinds)
const fusN = one(M, 'fusions', { src: (s) => /^\[\.\.\.\w+,\.\.\.\w+,\.\.\.\w+/.test(s), val: (v) => Array.isArray(v) && v.length > 80 && has(v[0], 'key', 'kind', 'cd', 'power') });
const fusions = M.get(fusN);
put('fusions', fusions.map((f) => ({ ...f, member_name: f.member ? store.byId.get(f.member)?.name : undefined })));
// fusion "stat parts" maps (fu-1:{parts,area,dur,count,fixed})
const partNames = all(M, { src: S('parts:['), val: (v) => v && !Array.isArray(v) && Object.values(v)[0] && has(Object.values(v)[0], 'parts') });
const parts = {}; for (const n of partNames) Object.assign(parts, M.get(n));
put('fusion_parts', parts);

// stat labels / defaults
const statLblN = one(M, 'statLabels', { src: S('maxHp:['), val: (v) => Array.isArray(v?.maxHp) && v.maxHp.length === 2 });
put('stat_labels', M.get(statLblN));
const typeBonusN = one(M, 'typeBonus', { src: S('label:'), val: (v) => has(v?.normal, 'label', 'mods') });
put('type_set_bonuses', M.get(typeBonusN));
const ampN = one(M, 'amplifiers', { src: S('gain:'), val: (v) => Array.isArray(v) && has(v[0], 'stat', 'gain', 'loss') });
put('stat_shrines', M.get(ampN));
const bossN = one(M, 'bossNames', { src: S('kind:`cross`'), val: (v) => v && has(Object.values(v)[0], 'kind', 'name', 'color') });
put('boss_moves', M.get(bossN));
const pactN = all(M, { src: S('boon:'), val: (v) => Array.isArray(v) && has(v[0], 'id', 'boon', 'bane') });
put('pacts', pactN.flatMap((n) => M.get(n)));
const evN = one(M, 'events', { src: S('eclipse:'), val: (v) => has(v?.fog, 'name', 'dur', 'pool') });
put('map_events', M.get(evN));
const hazN = one(M, 'hazards', { src: S('quicksand:'), val: (v) => has(v?.mud, 'slow') });
put('terrain_hazards', M.get(hazN));
const altarN = one(M, 'altars', { src: S('unown:'), val: (v) => Array.isArray(v) && has(v[0], 'unown', 'offers', 'picks') });
put('unown_altars', M.get(altarN));

// type chart (+ in-game effectiveness rule)
put('types', { ...types, effectiveness_rule: 'per defending type: chart>=2 -> x1.35, chart==0 -> x0.5, chart<=0.5 -> x0.8, else x1; product clamped to [0.4, 1.8]' });

// species (in-game), with learnsets by key and computed in-run base stats
const statFnName = [...M.decls].find(([k, d]) => d.kind === 'FunctionDeclaration' && d.src.includes('maxHp:Math.round((70+45*'))?.[0];
const statFn = M.get(statFnName);
const species = store.pokemon.map((p) => ({
  id: p.id, key: p.key, name: p.name, types: p.types, stats: p.stats, bst: p.bst, legendary: p.legendary, mythical: p.mythical,
  evoFrom: p.evoFrom, evoLevel: p.evoLevel, evoStage: p.evoStage, family: p.family, captureRate: p.captureRate,
  abilities: p.abilities.map((a) => abilities[a]?.key ?? a), hidden: abilities[p.hidden]?.key ?? p.hidden,
  run_evolutions: store.evolutionsOf(p.id).map((t) => { const r = store.runEvolution(p.id, t); return { to: t.id, name: t.name, level: r.level }; }),
  run_stats_lv1: (() => { try { return JSON.parse(JSON.stringify(statFn(p, 0, M.fromJSON({})))); } catch { return null; } })(),
  learnset: (learnsets[p.id] ?? []).map(([mid, lv]) => ({ move: store.moves.get(mid)?.key, level: lv })),
}));
put('species', species);

// ---------- 4. formula source code (readable reference for the model) ----------
const fnSrc = {};
const addFn = (label, name) => { const d = M.decls.get(name); if (d) fnSrc[label] = d.src; else warn.push('fn ' + label); };
addFn('run_stats_from_species', statFnName);
addFn('move_from_pokemon_move', mbName);
addFn('move_archetype_choice', pbName);
const byInc = (s) => [...M.decls].find(([k, d]) => d.kind === 'FunctionDeclaration' && d.src.includes(s))?.[0];
addFn('apply_stat_mods', byInc('n.add&&(e[n.stat]+=n.add)'));
addFn('move_upgrade_roll', byInc('case`dmg`:a=.22*t'));
addFn('move_upgrade_apply', byInc('e.mods.dmg+=.08'));
addFn('rarity_roll', byInc('70/(1+a),24*(1+.5*a)'));
addFn('levelup_offers', byInc('kind:`upMove`'));
addFn('fusion_pick', byInc('n.kind===`reaction`&&(r(n,e.type,t.type)'));
// class methods: damage pipeline
const ast = acorn.parse(M.src, { ecmaVersion: 'latest', sourceType: 'module' });
walk.simple(ast, { MethodDefinition(n) {
  const s = M.src.slice(n.start, n.end);
  if (n.key.name === 'strike' && s.includes('a.critChance+a.megaCrit')) fnSrc.damage_on_hit = s;
  if (n.key.name === 'recompute' && s.length > 500 && !fnSrc.player_recompute) fnSrc.player_recompute = s;
} });
fnSrc.type_effectiveness = /effectiveness\(e,t\)\{[^]*?\}evolutionsOf/.exec(localizeSrc)?.[0];
put('formulas_source', fnSrc);
{ const lv = /,l=(\w+);c&&c\.kit\.forEach/.exec(fnSrc.levelup_offers ?? '')?.[1]; if (lv) put('partner_kit_unlock_levels', M.get(lv)); else warn.push('kit levels'); }

// ---------- 5. write ----------
const meta = { game: 'PokeBonk (pokebonk.com, by Charcher)', version: version.version, build: version.build, extracted_at: new Date().toISOString(), source_files: [mainF, dpF, enF, 'pokemon.json', 'moves.json', 'learnsets.json', 'abilities.json', 'types.json', 'items.json', 'en.json'], counts: {}, warnings: warn };
for (const [k, v] of Object.entries(out)) meta.counts[k] = v == null ? null : Array.isArray(v) ? v.length : Object.keys(v).length;
out.changelog = changelog;
meta.counts.changelog = changelog.length;
fs.mkdirSync(path.join(outDir, 'json'), { recursive: true });
for (const [k, v] of Object.entries(out)) if (v != null) fs.writeFileSync(path.join(outDir, 'json', k + '.json'), JSON.stringify(v, null, 1));
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
fs.writeFileSync(path.join(outDir, 'pokebonk-data.json'), JSON.stringify({ meta, ...out }));
console.log(JSON.stringify(meta.counts, null, 0));
console.log('warnings:', warn.length ? warn.join('\n  ') : 'none');
