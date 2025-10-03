export function partesDoArtigo(a){
  const partes = [];
  if(a.texto?.caput){
    partes.push({tipo:'caput', id:'caput', texto:a.texto.caput, rel:a.texto.relacionados_inline?.filter(r=>r.local==='caput')||[]});
  }
  (a.texto?.paragrafos||[]).forEach(p=>{
    partes.push({tipo:'paragrafo', id:p.id, texto:p.texto, rel:p.relacionados_inline||[]});
  });
  (a.texto?.incisos||[]).forEach(i=>{
    partes.push({tipo:'inciso', id:i.id, texto:i.texto, rel:i.relacionados_inline||[]});
  });
  (a.texto?.alineas||[]).forEach(al=>{
    partes.push({tipo:'alinea', id:al.id, texto:al.texto, rel:al.relacionados_inline||[]});
  });
  return partes;
}