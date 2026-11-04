// Lazy evaluator for module-level declarations across the PokeBonk Vite chunks.
//
// Safety: this evaluates parts of the game's own JavaScript. Two layers keep it contained:
//  1. update.mjs runs extract.mjs under Node's permission model (no child processes, file
//     reads limited to tools/ + the raw folder, writes limited to the output folder).
//  2. Inside this process, game code runs in a vm context that never receives host-realm
//     objects: builtins, the translation helper, the "unknown name" stub and the scope
//     object are all created inside the context, so prototype chains can't reach the host's
//     Function constructor. Data passed in from outside goes through ctx JSON copies
//     (see M.fromJSON / M.fn in extract.mjs).
import * as acorn from 'acorn'; import fs from 'fs'; import vm from 'vm'; import path from 'path';

const BUILTINS = ['Math','JSON','Object','Array','Set','Map','Number','String','Boolean','Symbol','Infinity','NaN','undefined','isFinite','parseInt','parseFloat','RegExp','Date','Error','TypeError','RangeError','Promise','WeakMap','WeakSet','Reflect','Proxy','Float32Array','Float64Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','ArrayBuffer','DataView','BigInt','structuredClone'];

export function load(dir, enFile) {
  const enSrc = fs.readFileSync(path.join(dir, enFile), 'utf8').replace(/export\s*\{[^}]*\};?\s*$/, '');
  const enJson = JSON.stringify(vm.runInNewContext(enSrc + ';e', Object.create(null), { timeout: 5000 }));
  const missing = new Set(); const mods = new Map();
  const tr = (k) => { const e = JSON.parse(enJson); return typeof k === 'string' ? (e[k] || k) : k; }; // host-side helper for extract.mjs only

  function mod(file) {
    if (mods.has(file)) return mods.get(file);
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    const decls = new Map(), imports = new Map(), exports = new Map();
    for (const st of ast.body) {
      if (st.type === 'VariableDeclaration') for (const d of st.declarations) { if (d.id.type === 'Identifier') decls.set(d.id.name, { kind: 'var', src: d.init ? src.slice(d.init.start, d.init.end) : 'undefined', pos: d.start }); }
      else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) decls.set(st.id.name, { kind: st.type, src: src.slice(st.start, st.end), pos: st.start });
      else if (st.type === 'ImportDeclaration') { for (const s of st.specifiers) imports.set(s.local.name, [st.source.value.replace('./', ''), s.imported ? s.imported.name : 'default']); }
      else if (st.type === 'ExportNamedDeclaration') { for (const s of st.specifiers) exports.set(s.exported.name, s.local.name); }
    }
    // a fresh context; everything the game code can touch is created inside it
    const ctx = vm.createContext(undefined, { codeGeneration: { strings: false, wasm: false } });
    const inCtx = (code) => vm.runInContext(code, ctx, { timeout: 20000 });
    const builtins = inCtx(`(() => { const o = Object.create(null); for (const k of ${JSON.stringify(BUILTINS)}) { try { o[k] = globalThis[k]; } catch {} } return o; })()`);
    const stub = inCtx(`(() => { const f = function(){}; let p; p = new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => '<?>' : (k === 'toString' ? () => '<?>' : p), apply: () => p, construct: () => p, getPrototypeOf: () => null }); return p; })()`);
    const i18n = inCtx(`(() => { const EN = JSON.parse(${JSON.stringify(enJson)}); const tr = (k, p) => { if (typeof k !== 'string') return k; let n = EN[k] || k; return p ? n.replace(/\\{(\\w+)\\}/g, (m, x) => x in p ? String(p[x]) : m) : n; }; return { u: tr, d: (k) => tr(k), i: (n) => String(n), o: () => 'en', s: () => 'en-US' }; })()`);
    const cache = new Map(), busy = new Set();
    const M = { file, src, ast, decls, imports, exports, cache };
    const target = inCtx('Object.create(null)');
    const scope = new Proxy(target, {
      has: (t, k) => typeof k === 'string',
      getPrototypeOf: () => null,
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (cache.has(k)) return cache.get(k);
        const d = decls.get(k);
        if (!d) {
          const im = imports.get(k);
          if (im) {
            let v;
            if (im[0].startsWith('i18n')) v = i18n[im[1]] ?? stub;
            else if (im[0].startsWith('three')) v = stub;
            else { try { const T = mod(im[0]); v = T.get(T.exports.get(im[1])); } catch { missing.add('import:' + im[0]); v = stub; } } // never hand host errors to game code
            cache.set(k, v); return v;
          }
          if (typeof k === 'string' && k in builtins) return builtins[k];
          missing.add(file.slice(0, 8) + ':' + String(k)); return stub;
        }
        if (busy.has(k)) { missing.add('cycle:' + k); return stub; }
        busy.add(k); let v;
        try { v = d.kind === 'FunctionDeclaration' ? run(d.src + ';return ' + k) : run('return (' + d.src + ')'); }
        catch (e) { v = stub; missing.add(k + '!' + String(e && e.message).slice(0, 80)); }
        busy.delete(k); cache.set(k, v); return v;
      },
    });
    ctx.__s = scope;
    // the context's global object is created by the host realm; cut its prototype chain so
    // sloppy-mode `this` (which is that global) can't walk up to the host's Function
    // (the host-side context object backs global lookups, so its chain is cut too)
    Object.setPrototypeOf(ctx, null);
    inCtx('Object.setPrototypeOf(globalThis, null)');
    const run = (body) => inCtx('(function(){with(__s){' + body + '}})()');
    M.get = (n) => scope[n];
    M.run = run;
    // copy host data into this context (plain JSON only) so game code never holds host objects
    M.fromJSON = (obj) => inCtx('JSON.parse(' + JSON.stringify(JSON.stringify(obj)) + ')');
    // make a small function inside the context (for callbacks handed to game code)
    M.fn = (code) => inCtx('(' + code + ')');
    mods.set(file, M); return M;
  }
  return { mod, tr, missing };
}
export const ser = (v, n = 2000) => { const seen = new WeakSet(); return JSON.stringify(v, (k, x) => { if (typeof x === 'function') return 'ƒ'; const tg = Object.prototype.toString.call(x); if (tg === '[object Map]') return Object.fromEntries(x); if (tg === '[object Set]') return [...x]; if (x && typeof x === 'object') { if (seen.has(x)) return '[circ]'; seen.add(x); } return x; }).slice(0, n); };
