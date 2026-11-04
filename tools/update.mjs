#!/usr/bin/env node
// PokeBonk data updater.
// Checks pokebonk.com/version.json; when there is a new build it downloads the game's
// scripts + data JSON into raw/<version>/, runs the extractor, writes CSVs, writes a
// CHANGES.md diff against the previous version, and refreshes extracted/latest/.
//
// Usage (from the tools folder, or anywhere):
//   node update.mjs            check and update if needed
//   node update.mjs --force    re-download and re-extract even if up to date
//   node update.mjs --check    only report whether an update exists (exit code 10 if yes)
//   node update.mjs --reextract <version>   re-run extraction on an existing raw/<version>
// Options: --base https://pokebonk.com/   --root <data folder>   --quiet
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { writeCsvs } from './csv.mjs';
import { diffVersions } from './diff.mjs';
import { buildUi } from './build-ui.mjs';
import { publishSite } from './publish.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const BASE = opt('--base', 'https://pokebonk.com/').replace(/\/?$/, '/');
const ROOT = path.resolve(opt('--root', path.join(here, '..')));
const RAW = path.join(ROOT, 'raw'), OUT = path.join(ROOT, 'extracted');
const QUIET = flag('--quiet');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SKIP_JS = /^(three|modulepreload-polyfill)[-.]|^(es|pt|fr|ja|zh|zht|ko|ru)-/; // not needed for extraction
const SKIP_DATA = /^i18n\/(?!en\.json)|^sprites\.json$/;               // other languages, sprite atlas map

const logFile = path.join(ROOT, 'update.log');
function log(...m) {
  const line = `[${new Date().toISOString()}] ${m.join(' ')}`;
  if (!QUIET || /ERROR|NEW|updated/.test(line)) console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

async function get(url, as = 'text') {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' } });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      return as === 'buf' ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      if (attempt >= 3) throw Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
}

const local = () => fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((d) => fs.existsSync(path.join(RAW, d, 'version.json')))
  .map((d) => ({ dir: d, ...JSON.parse(fs.readFileSync(path.join(RAW, d, 'version.json'), 'utf8')), mtime: fs.statSync(path.join(RAW, d)).mtimeMs })) : [];
const cmpVer = (a, b) => { const pa = a.split(/[._-]/).map((x) => +x || 0), pb = b.split(/[._-]/).map((x) => +x || 0); for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); return 0; };

async function download(remote) {
  const have = local().find((l) => l.version === remote.version);
  const dirName = have && have.build !== remote.build ? `${remote.version}_${remote.build}` : remote.version;
  const tmp = path.join(RAW, `.${dirName}.partial`), dest = path.join(RAW, dirName);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });

  // 1. index page -> entry scripts
  const html = await get(BASE + '?t=' + Date.now());
  fs.writeFileSync(path.join(tmp, 'index.html'), html);
  const queue = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel=["']?modulepreload["']?[^>]*\shref)=["']([^"']+\.js)["']/gi)].map((m) => new URL(m[1], BASE).href);
  if (!queue.length) throw Error('no <script src> found in index.html');

  // 2. crawl JS chunks via "./name.js" references
  const seen = new Set(), js = [];
  while (queue.length) {
    const url = queue.shift(); const name = path.basename(new URL(url).pathname);
    if (seen.has(name)) continue; seen.add(name);
    if (SKIP_JS.test(name)) continue;
    const src = await get(url); fs.writeFileSync(path.join(tmp, name), src); js.push(name);
    for (const m of src.matchAll(/["'`](\.{1,2}\/[\w./-]+?\.js)["'`]/g)) queue.push(new URL(m[1], url).href);
  }
  log(`downloaded ${js.length} scripts: ${js.join(', ')}`);

  // 3. data JSON referenced as "data/<name>.json"
  const dataFiles = new Set();
  for (const f of js) for (const m of fs.readFileSync(path.join(tmp, f), 'utf8').matchAll(/data\/([\w/-]+\.json)/g)) if (!SKIP_DATA.test(m[1])) dataFiles.add(m[1]);
  for (const need of ['pokemon.json', 'moves.json', 'learnsets.json', 'abilities.json', 'types.json', 'items.json', 'i18n/en.json']) dataFiles.add(need);
  for (const d of dataFiles) fs.writeFileSync(path.join(tmp, path.basename(d)), await get(`${BASE}data/${d}?v=${remote.build}`, 'buf'));
  log(`downloaded ${dataFiles.size} data files`);
  fs.writeFileSync(path.join(tmp, 'version.json'), JSON.stringify(remote));

  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  return dirName;
}

function extract(dirName, version) {
  const outName = dirName; // extracted/<dirName>
  const tmpOut = path.join(OUT, '.tmp'); fs.rmSync(tmpOut, { recursive: true, force: true });
  const r = spawnSync(process.execPath, [path.join(here, 'extract.mjs'), path.join(RAW, dirName), tmpOut], { encoding: 'utf8' });
  if (r.status !== 0) throw Error('extractor failed:\n' + (r.stderr || r.stdout).slice(-2000));
  const produced = path.join(tmpOut, version);
  const meta = JSON.parse(fs.readFileSync(path.join(produced, 'meta.json'), 'utf8'));
  const dest = path.join(OUT, outName);
  fs.rmSync(dest, { recursive: true, force: true }); fs.renameSync(produced, dest); fs.rmSync(tmpOut, { recursive: true, force: true });
  const readme = path.join(here, 'DATA_README.md');
  if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(dest, 'README.md'));
  writeCsvs(dest);
  return { dest, meta };
}

function previousExtracted(exclude) {
  if (!fs.existsSync(OUT)) return null;
  const dirs = fs.readdirSync(OUT).filter((d) => d !== exclude && !d.startsWith('.') && d !== 'latest' && fs.existsSync(path.join(OUT, d, 'meta.json')));
  dirs.sort((a, b) => fs.statSync(path.join(OUT, a, 'meta.json')).mtimeMs - fs.statSync(path.join(OUT, b, 'meta.json')).mtimeMs);
  return dirs.at(-1) ?? null;
}

const UI_FILE = path.join(ROOT, 'PokeBonk Builder.html');
function publish() {
  try { const r = publishSite(here, path.join(OUT, 'latest'), log); if (r !== 'not configured') log('site: ' + r); } catch (e) { log('ERROR: site publish: ' + e.message); }
}
function ensureUi(force = false) {
  const latestMeta = path.join(OUT, 'latest', 'meta.json');
  if (!fs.existsSync(latestMeta)) return;
  if (force || flag('--publish')) publish();
  if (force || !fs.existsSync(UI_FILE) || fs.statSync(UI_FILE).mtimeMs < fs.statSync(latestMeta).mtimeMs || fs.statSync(UI_FILE).mtimeMs < fs.statSync(path.join(here, 'builder.template.html')).mtimeMs) {
    try { buildUi(path.join(OUT, 'latest'), UI_FILE); log('builder page refreshed: ' + UI_FILE); } catch (e) { log('ERROR: builder page: ' + e.message); }
  }
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  const re = opt('--reextract');
  let dirName, remote;
  if (re) {
    dirName = re; remote = JSON.parse(fs.readFileSync(path.join(RAW, re, 'version.json'), 'utf8'));
  } else {
    remote = JSON.parse(await get(`${BASE}version.json?t=${Date.now()}`));
    const have = local().find((l) => l.build === remote.build);
    if (have && !flag('--force')) {
      if (fs.existsSync(path.join(OUT, 'latest', 'meta.json'))) { ensureUi(); log(`up to date: ${remote.version} (${remote.build})`); return 0; }
      log(`up to date: ${remote.version} (${remote.build}) — building extracted/latest`); dirName = have.dir;
    }
    if (!dirName) {
      if (flag('--check')) { log(`NEW build available: ${remote.version} (${remote.build})`); return 10; }
      log(`NEW build ${remote.version} (${remote.build}) — downloading`);
      dirName = await download(remote);
    }
  }
  const prev = previousExtracted(dirName);
  const { dest, meta } = extract(dirName, remote.version);
  const warnings = meta.warnings ?? [];
  let summary = '';
  if (prev) { summary = diffVersions(path.join(OUT, prev), dest); }
  // only promote to "latest" when every table was found
  if (warnings.length) {
    log(`ERROR: extraction finished with ${warnings.length} warning(s); extracted/latest NOT updated. See ${path.join(dest, 'meta.json')}`);
    for (const w of warnings) log('  - ' + w);
    return 2;
  }
  const latest = path.join(OUT, 'latest');
  fs.rmSync(latest, { recursive: true, force: true });
  fs.cpSync(dest, latest, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'latest.txt'), `${remote.version}\n${remote.build}\n${dirName}\n`);
  ensureUi(true);
  log(`updated: ${dirName} → extracted/latest${prev ? ` (changes vs ${prev}: ${summary})` : ''}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { log('ERROR: ' + e.message); process.exit(1); });
