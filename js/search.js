export function isNumero(v){ return /^\d+[A-Za-z]*$/.test((v||'').trim()); }

export function buscar(termo, artigos){
  const q = (termo||'').toLowerCase().trim();
  if(!q) return [];
  if(isNumero(q)) return artigos.filter(a => a.artigo.toLowerCase()===q);
  // textual: caput + parágrafos + incisos + aliases (se houver)
  return artigos.filter(a => {
    const caps = [
      a.texto?.caput||'',
      ...(a.texto?.paragrafos||[]).map(p=>p.texto),
      ...(a.texto?.incisos||[]).map(i=>i.texto),
      ...(a.aliases||[])
    ].join(' ').toLowerCase();
    return caps.includes(q);
  });
}