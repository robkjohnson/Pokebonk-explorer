// Compare two extracted versions and write CHANGES.md into the newer one.
// Usage: node diff.mjs <old extracted folder> <new extracted folder>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// tables to compare, and the field that identifies a row
const TABLES = {
  partners: 'id', species: 'id', moves: 'key', fusions: 'key', items: 'key', vitamins: 'key', lab: 'id',
  passives: null, ultimates: null, archetypes: null, type_items: null, stat_shrines: 'stat', pacts: 'id',
  mutators: 'id', biomes: 'id', weather: null, difficulty_scaling: null, rarity_multipliers: null,
  type_set_bonuses: null, unown_altars: null, shop: 'key', quests: 'id', partner_kit_unlock_levels: null,
};
const IGNORE = new Set(['$fn', 'learnset', 'flavor']); // code bodies & noisy fields

function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) if (!IGNORE.has(k)) o[k] = norm(v[k]); return o; }
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  return v;
}
function rows(v, key) {
  if (Array.isArray(v)) return new Map(v.map((r, i) => [String(key ? r[key] : i), r]));
  if (v && typeof v === 'object') return new Map(Object.entries(v));
  return new Map([['value', v]]);
}
function fieldDiff(a, b, prefix = '') {
  const out = [];
  const A = norm(a), B = norm(b);
  if (JSON.stringify(A) === JSON.stringify(B)) return out;
  if (A && B && typeof A === 'object' && typeof B === 'object' && !Array.isArray(A) && !Array.isArray(B)) {
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) out.push(...fieldDiff(A[k], B[k], prefix ? `${prefix}.${k}` : k));
    return out;
  }
  const s = (x) => x === undefined ? '∅' : JSON.stringify(x).slice(0, 140);
  out.push(`${prefix || 'value'}: ${s(A)} → ${s(B)}`);
  return out;
}
const label = (r, k) => r && typeof r === 'object' && r.name && r.name !== k ? `${k} (${r.name})` : k;

export function diffVersions(oldDir, newDir) {
  const lines = []; const counts = [];
  const metaO = JSON.parse(fs.readFileSync(path.join(oldDir, 'meta.json'), 'utf8'));
  const metaN = JSON.parse(fs.readFileSync(path.join(newDir, 'meta.json'), 'utf8'));
  lines.push(`# Changes ${metaO.version} (${metaO.build}) → ${metaN.version} (${metaN.build})`, '');
  // game's own patch notes for the new versions
  try {
    const cl = JSON.parse(fs.readFileSync(path.join(newDir, 'json', 'changelog.json'), 'utf8'));
    const notes = cl.filter((c) => c.build !== metaO.build && !JSON.parse(fs.readFileSync(path.join(oldDir, 'json', 'changelog.json'), 'utf8')).some((o) => o.build === c.build));
    if (notes.length) {
      lines.push('## Patch notes (from the game)', '');
      for (const n of notes) { lines.push(`**${n.version}** (${n.date}) — ${n.title ?? ''}`); for (const x of n.notes ?? []) lines.push(`- [${x.kind}] ${x.text}`); lines.push(''); }
    }
  } catch {}
  lines.push('## Data changes', '');
  for (const [t, key] of Object.entries(TABLES)) {
    const f = (d) => path.join(d, 'json', t + '.json');
    if (!fs.existsSync(f(oldDir)) || !fs.existsSync(f(newDir))) continue;
    const O = rows(JSON.parse(fs.readFileSync(f(oldDir), 'utf8')), key), N = rows(JSON.parse(fs.readFileSync(f(newDir), 'utf8')), key);
    const added = [...N.keys()].filter((k) => !O.has(k)), removed = [...O.keys()].filter((k) => !N.has(k));
    const changed = [...N.keys()].filter((k) => O.has(k)).map((k) => [k, fieldDiff(O.get(k), N.get(k))]).filter(([, d]) => d.length);
    if (!added.length && !removed.length && !changed.length) continue;
    counts.push(`${t} +${added.length}/-${removed.length}/~${changed.length}`);
    lines.push(`### ${t}`);
    for (const k of added) lines.push(`- **added** ${label(N.get(k), k)}`);
    for (const k of removed) lines.push(`- **removed** ${label(O.get(k), k)}`);
    for (const [k, d] of changed) { lines.push(`- **changed** ${label(N.get(k), k)}`); for (const x of d.slice(0, 12)) lines.push(`  - ${x}`); if (d.length > 12) lines.push(`  - …${d.length - 12} more`); }
    lines.push('');
  }
  if (!counts.length) lines.push('No data changes in the compared tables.');
  fs.writeFileSync(path.join(newDir, 'CHANGES.md'), lines.join('\n') + '\n');
  return counts.length ? counts.join(', ') : 'no data changes';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) console.log(diffVersions(process.argv[2], process.argv[3]));
