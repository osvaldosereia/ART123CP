import { splitTokens } from './loader.js';
export function isNumero(v){ return /^\d+[A-Za-z]*$/.test((v||'').trim()); }
export function buildIndex(artigos){
  const porNumero = new Map();
  const inv = new Map();
  artigos.forEach((a,idx)=>{
    porNumero.set(a.artigo.toLowerCase(), idx);
    const blob = [a.texto?.caput||'', ...(a.texto?.paragrafos||[]).map(p=>p.texto), ...(a.texto?.incisos||[]).map(i=>i.texto), ...(a.aliases||[])].join(' ');
    splitTokens(blob).forEach(tok=>{ if(!inv.has(tok)) inv.set(tok,new Set()); inv.get(tok).add(idx); });
  });
  return { porNumero, inv };
}
export function buscar(termo, artigos, idx){
  const q = (termo||'').trim();
  if(!q) return [];
  if(isNumero(q.toLowerCase())){
    const i = idx.porNumero.get(q.toLowerCase());
    return (i!=null)? [artigos[i]]: [];
  }
  const toks = splitTokens(q); if(!toks.length) return [];
  const sets = toks.map(t=> idx.inv.get(t) || new Set());
  let res = null; sets.forEach(s=>{ res = res? new Set([...res].filter(x=>s.has(x))) : new Set(s); });
  if(!res || !res.size) return [];
  return [...res].slice(0,512).map(i=>artigos[i]);
}
export function suggestions(prefix, artigos, idx, limit=8){
  const p = splitTokens(prefix).pop(); if(!p) return [];
  const matches = [];
  idx.inv.forEach((set,tok)=>{ if(tok.startsWith(p)) matches.push(tok); });
  return matches.slice(0, limit);
}
