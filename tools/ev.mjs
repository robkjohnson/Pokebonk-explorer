// Lazy evaluator for module-level declarations across the PokeBonk Vite chunks.
import * as acorn from 'acorn'; import fs from 'fs'; import vm from 'vm'; import path from 'path';
export function load(dir, enFile){
  const enSrc=fs.readFileSync(path.join(dir,enFile),'utf8').replace(/export\s*\{[^}]*\};?\s*$/,'');
  const EN=vm.runInNewContext(enSrc+';e');
  const tr=(k,p)=>{ if(typeof k!=='string') return k; let n=EN[k]||k; return p? n.replace(/\{(\w+)\}/g,(m,x)=>x in p?String(p[x]):m):n;};
  const stub=new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>'<?>':(k==='toString'?()=>'<?>':stub),apply:()=>stub,construct:()=>stub});
  const missing=new Set(); const mods=new Map();
  const special={Math,JSON,Object,Array,Set,Map,Number,String,Boolean,Symbol,Infinity,NaN,undefined,isFinite,parseInt,parseFloat,RegExp,Date,Error,console,Promise,WeakMap,WeakSet,Reflect,Proxy,Float32Array,Uint8Array,Int32Array,Uint16Array};
  const i18nExports={u:tr,d:(k)=>tr(k),i:(n)=>String(n),o:()=>'en',s:()=>'en-US'};
  function mod(file){
    if(mods.has(file)) return mods.get(file);
    const src=fs.readFileSync(path.join(dir,file),'utf8');
    const ast=acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'});
    const decls=new Map(), imports=new Map(), exports=new Map();
    for(const st of ast.body){
      if(st.type==='VariableDeclaration') for(const d of st.declarations){ if(d.id.type==='Identifier') decls.set(d.id.name,{kind:'var',src:d.init?src.slice(d.init.start,d.init.end):'undefined',pos:d.start}); }
      else if((st.type==='FunctionDeclaration'||st.type==='ClassDeclaration')&&st.id) decls.set(st.id.name,{kind:st.type,src:src.slice(st.start,st.end),pos:st.start});
      else if(st.type==='ImportDeclaration'){ for(const s of st.specifiers) imports.set(s.local.name,[st.source.value.replace('./',''),s.imported?s.imported.name:'default']); }
      else if(st.type==='ExportNamedDeclaration'){ for(const s of st.specifiers) exports.set(s.exported.name,s.local.name); }
    }
    const cache=new Map(), busy=new Set();
    const M={file,src,ast,decls,imports,exports,cache};
    const scope=new Proxy({}, {has:(t,k)=>typeof k==='string', get:(t,k)=>{
      if(k===Symbol.unscopables) return undefined;
      if(cache.has(k)) return cache.get(k);
      const d=decls.get(k);
      if(!d){ const im=imports.get(k);
        if(im){ let v; if(im[0].startsWith('i18n')) v=i18nExports[im[1]]??stub; else if(im[0].startsWith('three')) v=stub; else { const T=mod(im[0]); v=T.get(T.exports.get(im[1])); } cache.set(k,v); return v; }
        if(k in special) return special[k]; if(k in globalThis) return globalThis[k];
        missing.add(file.slice(0,8)+':'+k); return stub; }
      if(busy.has(k)){ missing.add('cycle:'+k); return stub; }
      busy.add(k); let v;
      try{ v = d.kind==='FunctionDeclaration'? run(d.src+';return '+k) : run('return ('+d.src+')'); }
      catch(e){ v=stub; missing.add(k+'!'+e.message.slice(0,80)); }
      busy.delete(k); cache.set(k,v); return v; }});
    const ctx=vm.createContext({__s:scope});
    const run=(body)=>vm.runInContext('(function(){with(__s){'+body+'}})()',ctx);
    M.get=(n)=>scope[n]; M.run=run; mods.set(file,M); return M;
  }
  return {mod,tr,EN,missing,stub};
}
export const ser=(v,n=2000)=>{ const seen=new WeakSet(); return JSON.stringify(v,(k,x)=>{ if(typeof x==='function') return 'ƒ'; if(x instanceof Map) return Object.fromEntries(x); if(x instanceof Set) return [...x]; if(x&&typeof x==='object'){ if(seen.has(x)) return '[circ]'; seen.add(x);} return x;}).slice(0,n); };
