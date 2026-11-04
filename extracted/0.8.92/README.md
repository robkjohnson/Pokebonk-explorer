# PokeBonk data

Version and build: see `meta.json`. Row counts in the table below are as of 0.8.91.

Pulled from the game's own client files (JS chunks + runtime JSON), not from fan wikis.
English text comes from the game's own `en` translation file.

## Folders
- `json/` — one file per table (full detail, nested fields kept)
- `csv/` — flattened copies of the main tables for Excel / Power BI
- `pokebonk-data.json` — everything in one file (for the build tool / userscript)
- `meta.json` — version, row counts, extraction warnings
- `CHANGES.md` — what changed vs the previous version (game patch notes + changed rows), when there is one

## Tables
| File | Rows | What it is |
|---|---|---|
| species | 151 | Kanto Pokémon: base stats, types, in-run evolutions (target + level), learnset, computed in-run stats at stage 0 |
| partners | 79 | League roster: role, rank, passive, 4-move kit, unlock challenge |
| partner_kit_unlock_levels | 4 | Player level at which kit moves 1–4 can be offered (0, 2, 4, 7) |
| passives | 161 | Partner passives (name, desc, stat mods, special fields like lowHp, dmgTaken) |
| ultimates | 79 | Ultimate per partner: names/descs per evolution stage, type, class, duration |
| moves | 710 | Every move the game can use, with in-game stats computed by the game's own move builder: archetype, dmg, cooldown, count, area, pierce, status + chance, drain, crit bonus |
| archetypes | 26 | Attack shapes (strike, bolt, orb, cone, nova…) with base dmg/cd/count/area and which stats upgrades can roll |
| fusions | 106 | Bill's Machine: 79 signature (member + 2 specific moves), 18 type (two moves of same type), 8 reaction (type pair), 1 glitch fallback. cd/power are final in-game values |
| fusion_parts | 106 | How each fusion's sub-parts scale with area/duration/count |
| vitamins | 26 | Stat, per-level value, add vs multiply |
| items | 126 | Rarity (0 Common … 4 Legendary), max stacks, static mods, tags (e.g. type:fire), desc |
| item_live_text | 62 | Source of the in-run tooltip functions (useful for conditional item math) |
| type_items | 18 | Which item boosts which type |
| lab | 24 | Permanent upgrades with the Stardust cost of every level |
| rarity_multipliers | 5 | Upgrade-card strength by rarity: 1, 1.2, 1.45, 1.75, 2.1 |
| type_set_bonuses / type_set_needs | 18 / 17 | Type synergy bonuses and how many of a type are needed |
| stat_shrines | 12 | Shrine gain/loss pairs |
| weather, biomes, map_events, terrain_hazards, unown_altars, pacts, mutators, difficulty_scaling, boss_moves | — | Run environment tables |
| shop, run_boosters, shiny_bonuses, quests | — | Meta progression |
| types | — | Type list, names, chart + the game's softened effectiveness rule |
| formulas_source | 12 | Exact source code of the key formulas (see below) |
| changelog | 117 | The game's built-in patch notes back to the first beta |

## Key mechanics (read from the code)
- **In-run base stats** (`run_stats_from_species`): each base stat becomes a share `s = stat / BST × 6` (1.0 = average).
  maxHp = round((70 + 45·s_hp) × g), regen = 0.25 + 0.25·s_hp, armor = 6·s_def + 3·s_spd, evasion = 0.02 + 0.02·s_spe,
  moveSpeed = 0.92 + 0.12·s_spe, physical = 0.82 + 0.2·s_atk, special = 0.82 + 0.2·s_spa, damage = g,
  where g = 1 + 0.12 × (evolution stage + growth). Crit 5%, crit damage ×1.75.
- **Stacking** (`apply_stat_mods`): all flat `add` bonuses first; then, within a group, multipliers above 1 are **summed** (×1.1 and ×1.2 → ×1.3); penalties below 1 multiply one by one. Separate groups multiply together.
- **Move stats** (`move_from_pokemon_move`): archetype base dmg × clamp(0.72 + power/260, 0.85, 1.3); cooldown × clamp(0.88 + (power−60)/500, 0.85, 1.15), ×0.85 for priority moves.
- **Move upgrades**: each level +8% damage plus 2 random rolls (3 at Epic or Legendary) from the archetype's stat list: dmg +22%·r, cd −8%·r (max 25%), area/speed +15%·r, dur +20%·r, crit +5%·r, status +25%·r, count +1 (+2 at Epic+), pierce/bounce +round(r). r = rarity multiplier. Cap Lv 8 (10 with TM Case); fusions 5 stars (6).
- **Damage on hit** (`damage_on_hit`): base × damage × (physical|special) → STAB ×1.25 (×1.5625 Adaptability) → typeBoost → effectiveness (×1.35 per weak type, clamped 0.4–1.8) and superEffective stat → weather (×1.3 / ×0.75) → item multipliers → elite/boss damage → crit, then status-state bonuses (asleep ×1.8, frozen ×1.2…).
- **Upgrade rarity** (`rarity_roll`): weights shift with level, luck and stage — the formula is in the file.

## Caveats
- The game changes almost daily. `tools/update.cmd` (or the scheduled task) keeps this current.
- Tables are found by their shape, not by minified names, so the extractor should survive rebuilds; check `meta.json` warnings after each run.
- Conditional item/passive effects live in code (`$fn` entries and `item_live_text`), not in the static `mods`.
