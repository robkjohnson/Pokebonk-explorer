// Flattened CSV copies of the main tables (for Excel / Power BI).
// Usage: node csv.mjs <extracted/<version> folder>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const cell = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) v = v.join('|');
  else if (typeof v === 'object') v = JSON.stringify(v);
  else if (typeof v === 'boolean') v = v ? 'True' : 'False';
  v = String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

export function writeCsvs(base) {
  const L = (n) => JSON.parse(fs.readFileSync(path.join(base, 'json', n + '.json'), 'utf8'));
  fs.mkdirSync(path.join(base, 'csv'), { recursive: true });
  const w = (name, rows, cols) => fs.writeFileSync(path.join(base, 'csv', name + '.csv'),
    '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n');

  const species = L('species').map((s) => {
    const r = { ...s, type1: s.types[0], type2: s.types[1] ?? '' };
    for (const [k, v] of Object.entries(s.stats)) r['base_' + k] = v;
    const rs = s.run_stats_lv1 ?? {};
    for (const k of ['maxHp', 'regen', 'armor', 'evasion', 'moveSpeed', 'physical', 'special']) r['run_' + k] = Math.round((rs[k] ?? 0) * 1e4) / 1e4;
    r.evolves_to = (s.run_evolutions ?? []).map((e) => e.to); r.evolves_at = (s.run_evolutions ?? []).map((e) => e.level);
    return r;
  });
  w('species', species, ['id', 'key', 'name', 'type1', 'type2', 'base_hp', 'base_atk', 'base_def', 'base_spa', 'base_spd', 'base_spe', 'bst', 'legendary', 'mythical', 'evoFrom', 'evolves_to', 'evolves_at', 'family', 'run_maxHp', 'run_regen', 'run_armor', 'run_evasion', 'run_moveSpeed', 'run_physical', 'run_special']);

  const pas = L('passives'), kl = L('partner_kit_unlock_levels');
  const ch = (c) => Array.isArray(c) ? c.map((x) => x.desc).join(' / ') : c?.desc ?? '';
  w('partners', L('partners').map((p) => {
    const r = { ...p, passive_name: pas[p.passive]?.name, passive_desc: pas[p.passive]?.desc, challenge: ch(p.challenge) };
    p.kit.forEach((m, i) => { r[`kit${i + 1}`] = m; r[`kit${i + 1}_level`] = kl[i] ?? ''; });
    return r;
  }), ['id', 'name', 'start', 'role', 'rank', 'passive', 'passive_name', 'passive_desc', 'kit1', 'kit1_level', 'kit2', 'kit2_level', 'kit3', 'kit3_level', 'kit4', 'kit4_level', 'evoLevels', 'challenge']);

  w('moves', L('moves'), ['id', 'key', 'name', 'type', 'cls', 'arch', 'power', 'dmg', 'cd', 'count', 'area', 'speed', 'dur', 'pierce', 'status', 'statusChance', 'drain', 'critBonus', 'flinch', 'weather', 'buff', 'pulses', 'spread', 'accuracy', 'priority', 'desc']);
  w('archetypes', Object.entries(L('archetypes')).map(([k, v]) => ({ k, ...v })), ['k', 'label', 'dmg', 'cd', 'count', 'area', 'speed', 'dur', 'pierce', 'stats', 'desc']);
  w('vitamins', L('vitamins'), ['key', 'name', 'stat', 'kind', 'per', 'desc', 'note']);
  const rn = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
  w('items', L('items').map((i) => ({ ...i, rarity_name: rn[i.rarity] ?? i.rarity, mods_text: (i.mods ?? []).map((m) => `${m.stat} ${'add' in m ? '+' + m.add : 'x' + m.mul}`).join('; ') })),
    ['key', 'name', 'rarity', 'rarity_name', 'max', 'desc', 'mods_text', 'tags']);
  w('lab', L('lab'), ['id', 'name', 'desc', 'max', 'costs', 'stat', 'per']);
  w('fusions', L('fusions').map((f) => ({ ...f, move1: f.moves?.[0] ?? '', move2: f.moves?.[1] ?? '', pair_types: f.pair ? JSON.stringify(f.pair) : '' })),
    ['key', 'kind', 'member', 'member_name', 'move1', 'move2', 'pair_types', 'name', 'type', 'type2', 'cls', 'cd', 'power', 'hits', 'range', 'status', 'repeats', 'desc']);
  w('passives', Object.entries(pas).map(([key, v]) => ({ key, ...v })), ['key', 'name', 'desc', 'mods']);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) { writeCsvs(process.argv[2]); console.log('csv written'); }
