import { CONFIG } from './config.js';
import { loadJSON, loadList } from './loader.js';
import { buildIndex, buscar, suggestions } from './search.js';
import { partesDoArtigo } from './parser.js';
import { renderChips, renderFicha, buildRemissoesGroups } from './renderer.js';

const topbar = document.getElementById('topbar');
const chipbar = document.getElementById('chipbar');
const content = document.getElementById('content');
const q = document.getElementById('q');
const ac = document.getElementById('ac');
const fonteSel = document.getElementById('fonte');
const btnBuscar = document.getElementById('btnBuscar');
const drawer = document.getElementById('drawer');
const scrim = document.getElementById('scrim');
const btnMenu = document.getElementById('btnMenu');
const btnCloseDrawer = document.getElementById('btnCloseDrawer');

let lastY = 0;
window.addEventListener('scroll', ()=>{
  const y = window.scrollY;
  topbar.style.transform = (y>lastY && y>40) ? 'translateY(-100%)' : 'translateY(0)';
  lastY = y;
});

let DB = { artigos:[], idx:null, glossario:[], videos:[], artigosTxt:[], livros:[] };

async function boot(){
  await carregarFonte(fonteSel.value);
  wireEvents();
  const last = localStorage.getItem('meujus:last');
  if(last){ q.value = last; onBuscar(); }
  else if(DB.artigos.length){ q.value = DB.artigos[0].artigo; onBuscar(); }
}
boot();

function wireEvents(){
  btnBuscar.addEventListener('click', onBuscar);
  q.addEventListener('keydown', e=>{ if(e.key==='Enter') onBuscar(); });
  fonteSel.addEventListener('change', async ()=>{
    await carregarFonte(fonteSel.value);
    content.innerHTML=''; chipbar.innerHTML=''; q.value=''; ac.style.display='none'; q.focus();
  });
  let timer=null;
  q.addEventListener('input', ()=>{
    if(timer) clearTimeout(timer);
    timer = setTimeout(()=>{
      const s = suggestions(q.value, DB.artigos, DB.idx, 8);
      if(!s.length){ ac.style.display='none'; return; }
      ac.innerHTML = s.map(x=>`<div class="item" role="option">${x}</div>`).join('');
      ac.style.display='block';
      [...ac.children].forEach(it=> it.addEventListener('click', ()=>{ q.value = it.textContent; ac.style.display='none'; onBuscar(); }));
    }, 200);
  });
  document.addEventListener('click', (e)=>{ if(!document.getElementById('controls').contains(e.target)) ac.style.display='none'; });
  btnMenu.addEventListener('click', ()=>{ drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false'); scrim.hidden=false; });
  btnCloseDrawer.addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
}
function closeDrawer(){ drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); scrim.hidden=true; }

async function carregarFonte(sigla){
  DB.artigos = await loadJSON(`data/codigoseleis/${sigla}.json`);
  DB.artigos.forEach(a=> a.partes = partesDoArtigo(a));
  DB.idx = buildIndex(DB.artigos);
  DB.glossario = await loadList('data/glossario.txt');
  DB.videos = await loadList('data/videos.txt');
  DB.artigosTxt = await loadList('data/artigos.txt');
  DB.livros = await loadJSON('data/livros.json');
}

async function onBuscar(){
  const termo = q.value;
  localStorage.setItem('meujus:last', termo);
  const results = buscar(termo, DB.artigos, DB.idx).slice(0, 32);
  if(!results.length){ chipbar.innerHTML=''; content.innerHTML='<p class="small">Nenhum resultado.</p>'; return; }
  renderChips(chipbar, results, onSelect);
  onSelect(results[0]);
  content.focus();
}

function onSelect(artigo){
  const termos = [
    artigo.texto?.caput || '',
    ...artigo.partes.map(p=>p.texto),
    ...(artigo.partes.flatMap(p=>p.rel?.map(r=> (r.texto||r)))||[])
  ].join(' ').toLowerCase();
  const hasTerm = t => (t.titulo||t).toLowerCase && termos.includes((t.titulo||t).toLowerCase());

  const extras = {
    glossario: DB.glossario.filter(hasTerm).slice(0,12),
    artigos: DB.artigosTxt.filter(hasTerm).slice(0,12),
    videos: DB.videos.filter(hasTerm).slice(0,12),
    livros: DB.livros.filter(l => hasTerm(l)).slice(0,8)
  };

  renderFicha(content, artigo, extras, openFerramentas, onRelatedSearch, ()=>openCodigoModal(artigo), openRemissoes);
}

function onRelatedSearch(txt){
  q.value = txt.replace(/^Vide\s+/i,'').trim();
  onBuscar();
}

/* ---------------- Ferramentas ---------------- */
function openFerramentas(anchor, artigo){
  closeMenus();
  const tpl = document.getElementById('ia-menu');
  const menu = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${r.left + window.scrollX - 8}px`;
  menu.style.top = `${r.bottom + window.scrollY + 6}px`;

  const box = menu.querySelector('.ia-partes');
  const partes = [{id:'artigo', label:'Artigo inteiro', texto: coletarTextoArtigo()}];
  artigo.partes.forEach(p=> partes.push({id:p.id, label:p.id, texto:p.texto}));
  partes.forEach(p=>{
    const el = document.createElement('label'); el.className='part-chip';
    el.innerHTML = `<input type="checkbox" checked data-id="${p.id}"/> ${p.label}`;
    box.appendChild(el);
  });
  const getTexto = ()=>{
    const sels = [...box.querySelectorAll('input:checked')].map(i=>i.dataset.id);
    if(sels.includes('artigo')) return coletarTextoArtigo();
    const byId = new Map(partes.map(p=>[p.id,p.texto]));
    return sels.map(id=>byId.get(id)).join('\n');
  };
  menu.querySelector('[data-action="estudar"]').addEventListener('click',()=>{
    const u = `https://www.google.com/search?udm=50&q=${encodeURIComponent('Você é professor de Direito. Analise o dispositivo abaixo. Traga: (1) conceito e finalidade; (2) elementos/pressupostos; (3) debates doutrinários; (4) jurisprudência dominante e súmulas; (5) exemplos e pegadinhas; (6) observações práticas.\n\n' + getTexto())}`;
    window.open(u,'_blank','noopener');
  });
  menu.querySelector('[data-action="questoes"]').addEventListener('click',()=>{
    const u = `https://www.google.com/search?udm=50&q=${encodeURIComponent('Crie 10 questões objetivas (A-E) sobre o texto abaixo, com gabarito e breve justificativa. Varie o nível e inclua pegadinhas.\n\n' + getTexto())}`;
    window.open(u,'_blank','noopener');
  });
  menu.querySelector('[data-action="juris"]').addEventListener('click',()=>{
    const u = `https://www.jusbrasil.com.br/busca?q=${encodeURIComponent(getTexto())}`;
    window.open(u,'_blank','noopener');
  });
  setTimeout(()=>document.addEventListener('click', onDoc, {once:true}));
  function onDoc(e){ if(!menu.contains(e.target)) menu.remove(); }
}

function closeMenus(){ document.querySelectorAll('.ia-menu').forEach(m=>m.remove()); }
function coletarTextoArtigo(){ const el=document.getElementById('content'); return el? el.innerText.slice(0,6000):''; }

/* ---------------- Remissões Modal ---------------- */
function openRemissoes(artigo){
  closeRemissoes();
  const tpl = document.getElementById('modal-remissoes');
  const modal = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(modal);
  const body = modal.querySelector('#remissoesBody');
  modal.querySelector('[data-close]').addEventListener('click', closeRemissoes);
  const groups = buildRemissoesGroups(artigo);
  if(!groups.size){ body.innerHTML='<p class="small">Nenhuma remissão.</p>'; return; }
  groups.forEach((arr, key)=>{
    const g = document.createElement('div'); g.className='remissoes-group';
    const h = document.createElement('h4'); h.textContent = key; g.appendChild(h);
    const list = document.createElement('div'); list.className='remissoes-list';
    arr.forEach(txt=>{
      const a = document.createElement('a'); a.href='#'; a.textContent = txt;
      a.addEventListener('click', (e)=>{ e.preventDefault(); closeRemissoes(); onRelatedSearch(txt); });
      list.appendChild(a);
    });
    g.appendChild(list);
    body.appendChild(g);
  });
}
function closeRemissoes(){ document.querySelectorAll('.modal').forEach(m=>m.remove()); }

/* ---------------- Modal Código Inteiro ---------------- */
function openCodigoModal(artigoAtual){
  closeRemissoes();
  const tpl = document.getElementById('modal-codigo');
  const modal = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(modal);
  const body = modal.querySelector('.modal-body');
  modal.querySelector('[data-close]').addEventListener('click', closeRemissoes);
  const idx = DB.artigos.findIndex(a=>a.artigo===artigoAtual.artigo);
  let start = Math.max(0, idx - 20);
  let end = Math.min(DB.artigos.length, idx + 21);
  function renderRange(s,e, scrollToCurrent=false){
    for(let i=s;i<e;i++){
      if(body.querySelector(`[data-art="${DB.artigos[i].artigo}"]`)) continue;
      const a = DB.artigos[i];
      const div = document.createElement('div');
      div.className='modal-article'; div.dataset.art = a.artigo;
      div.innerHTML = `<strong>Art. ${a.artigo}</strong><div class="small">${a.texto?.caput||''}</div>`;
      body.appendChild(div);
    }
    if(scrollToCurrent){
      const cur = body.querySelector(`[data-art="${artigoAtual.artigo}"]`);
      if(cur){ cur.scrollIntoView({block:'center'}); }
    }
  }
  renderRange(start, end, true);
  const io = new IntersectionObserver((entries)=>{
    for(const ent of entries){
      if(!ent.isIntersecting) continue;
      const atBottom = ent.target.id === 'sentinel-bottom';
      if(atBottom && end < DB.artigos.length){
        const ne = Math.min(DB.artigos.length, end + 20);
        renderRange(end, ne); end = ne;
      }else if(!atBottom && start > 0){
        const ns = Math.max(0, start - 20);
        const frag = document.createDocumentFragment();
        for(let i=ns;i<start;i++){
          const a = DB.artigos[i];
          const div = document.createElement('div');
          div.className='modal-article'; div.dataset.art = a.artigo;
          div.innerHTML = `<strong>Art. ${a.artigo}</strong><div class="small">${a.texto?.caput||''}</div>`;
          frag.appendChild(div);
        }
        body.prepend(frag); start = ns;
      }
    }
  }, {root: body, rootMargin: '200px'});
  const topSent = document.createElement('div'); topSent.id='sentinel-top'; body.prepend(topSent);
  const botSent = document.createElement('div'); botSent.id='sentinel-bottom'; body.appendChild(botSent);
  io.observe(topSent); io.observe(botSent);
}
