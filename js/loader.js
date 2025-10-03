export async function loadJSON(path){ const r = await fetch(path); return r.json(); }
export async function loadList(path){ const r = await fetch(path); const t = await r.text(); return t.split('-----').map(s=>s.trim()).filter(Boolean); }
export function splitTokens(s){ return (s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
