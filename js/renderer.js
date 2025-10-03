import { linkIA, linkYT } from './ia.js';

export function renderChips(container, lista, onSelect, ensureCenteredState){
  container.innerHTML='';
  lista.forEach((a,idx)=>{
    const b=document.createElement('button');
    b.className='chip'; b.textContent=`Art. ${a.artigo}`;
    b.setAttribute('aria-selected', idx===0?'true':'false');
    b.addEventListener('click',()=>{
      [...container.children].forEach(c=>c.setAttribute('aria-selected','false'));
      b.setAttribute('aria-selected','true'); onSelect(a);
    });
    container.appendChild(b);
  });
  ensureCenteredState();
}

export function renderFicha(el, artigo, extras){
  el.innerHTML='';
  const title = document.createElement('h1'); title.className='article-title'; title.textContent = `Art. ${artigo.artigo}`; el.appendChild(title);
  const wrap = document.createElement('div'); el.appendChild(wrap);

  if(artigo.partes.some(p=>p.tipo==='caput')){
    const cap = artigo.partes.find(p=>p.tipo==='caput');
    wrap.appendChild(sectionPart('Caput', cap.texto));
  }
  artigo.partes.filter(p=>p.tipo!=='caput').forEach(p=>{
    wrap.appendChild(sectionPart(`${p.id}`, p.texto));
  });

  const { glossario, artigos:arts, videos, livros } = extras || {};
  addSimpleList(el, 'Glossário', glossario, (t)=>linkIA(t,'estudar'));
  addSimpleList(el, 'Artigos', arts, (t)=>linkIA(t,'estudar'));
  addSimpleList(el, 'Vídeos', videos, (t)=>linkYT(t), true);
  if(livros?.length){
    const s=document.createElement('section'); s.className='section'; s.innerHTML='<h2>Livros</h2>';
    livros.forEach(l=>{ const a=document.createElement('a'); a.className='link-ext'; a.href=l.link; a.target='_blank'; a.textContent=l.titulo; s.appendChild(a); s.append(' '); });
    el.appendChild(s);
  }

  function sectionPart(label, texto){
    const cont = document.createElement('section'); cont.className='section';
    const head = document.createElement('div'); head.className='acc-head'; head.textContent = label;
    const body = document.createElement('div'); body.className='acc-body'; body.textContent = texto;
    cont.append(head, body);
    return cont;
  }
}

function addSimpleList(root, label, arr, linkFn, isExt=false){
  if(!arr?.length) return;
  const s = document.createElement('section'); s.className='section';
  s.innerHTML = `<h2>${label}</h2>`;
  arr.forEach(t=>{
    const a = document.createElement('a'); a.className= isExt? 'link-ext':'link-ia'; a.href=linkFn(t); a.target='_blank'; a.textContent=t.titulo||t;
    s.appendChild(a); s.append(' ');
  });
  root.appendChild(s);
}

export function sumRemissoes(artigo){
  return artigo.partes.reduce((acc,p)=> acc + (p.rel?.length||0), 0);
}

export function buildRemissoesGroups(artigo){
  const groups = new Map();
  artigo.partes.forEach(p=>{
    if(!p.rel?.length) return;
    const key = p.id || p.tipo || 'Parte';
    if(!groups.has(key)) groups.set(key, []);
    p.rel.forEach(r=> groups.get(key).push(r.texto || r));
  });
  return groups;
}
