// Publishes the builder site to a GitHub Pages repo clone (configured in tools/config.json).
// config.json: { "repoDir": "C:/.../pokebonk-builder", "branch": "main" }
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { buildSite } from './build-ui.mjs';

const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim(), missing: !!r.error }; };

export function publishSite(here, latestDir, log) {
  const cfgFile = path.join(here, 'config.json');
  if (!fs.existsSync(cfgFile)) return 'not configured';
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const repo = path.resolve(here, cfg.repoDir);
  if (!fs.existsSync(path.join(repo, '.git'))) throw Error(`repoDir is not a git clone: ${repo}`);
  const branch = cfg.branch || 'main';
  const pull = git(repo, 'pull', '--ff-only', 'origin', branch);
  if (pull.missing) throw Error('git is not installed (winget install Git.Git)');
  buildSite(latestDir, repo);
  const meta = JSON.parse(fs.readFileSync(path.join(latestDir, 'meta.json'), 'utf8'));
  git(repo, 'add', 'index.html', 'data.json', '.nojekyll');
  if (git(repo, 'diff', '--cached', '--quiet').ok) return 'site already current';
  const id = git(repo, 'config', 'user.email').out ? [] : ['-c', 'user.name=PokeBonk updater', '-c', 'user.email=pokebonk-updater@users.noreply.github.com'];
  const c = git(repo, ...id, 'commit', '-m', `Game data v${meta.version} (${meta.build})`);
  if (!c.ok) throw Error('git commit failed: ' + c.out.slice(-300));
  const p = git(repo, 'push', 'origin', 'HEAD:' + branch);
  if (!p.ok) throw Error('git push failed: ' + p.out.slice(-300));
  return `published v${meta.version} to GitHub`;
}
