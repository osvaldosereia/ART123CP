import { CONFIG } from './config.js';
import { loadJSON, loadList } from './loader.js';
import { buildIndex, buscar, suggestions } from './search.js';
import { partesDoArtigo } from './parser.js';
import { renderChips, renderFicha, buildRemissoesGroups, sumRemissoes } from './renderer.js';

const topbar = document.getElementById('topbar');
const chipbar = document.getElementById('chipbar');
const content = document.getElementById('content');
const q = document.getElementById('q');
const ac = document.getElementById('ac');
const btnBuscar = document.getElementById('btnBuscar');
const btnCategoria = document.getElementById('btnCategoria');
const catSheet = document.getElementById('catSheet');

const mobileBar = document.getElementById('mobileBar');
const btnPrev = document.getElementById('btnPrev');
const btnRem = document.getElementById('btnRem');
const btnFerr = document.getElementById('btnFerr');
const btnNext = document.getElementById('btnNext');

const desktopPod = document.getElementById('desktopPod');
const dPrev = document.getElementById('dPrev');
const dRem = document.getElementById('dRem');
const dFerr = document.getElementById('dFerr');
const dNext = document.getElementById('dNext');

let DB = { artigos:[], idx:null, glossario:[], videos:[], artigosTxt:[], livros:[] };
let current = { fonte:'CP', artigo:null };
let lastScrollY = 0;
let lockLeftChips = false;

async function boot(){
  await carregarFonte('CP');
  wireEvents();
  setupCategorias();
  const last = localStorage.getItem('meujus:last');
  if(last){ q.value = last; onBuscar(); }
  else if(DB.artigos.length){ q.value = DB.artigos[0].artigo; onBuscar(); }
}
boot();

function setupCategorias(){
  catSheet.innerHTML = '';
  ['CP'].forEach(sigla=>{
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = sigla;
    b.addEventListener('click', async ()=>{
      btnCategoria.textContent = sigla + ' ▾';
      catSheet.hidden = true;
      await carregarFonte(sigla);
      chipbar.innerHTML=''; content.innerHTML=''; q.value='';
      current.artigo = null;
      showBars(false);
      q.focus();
    });
    catSheet.appendChild(b);
  });
}

function wireEvents(){
  btnBuscar.addEventListener('click', onBuscar);
  q.addEventListener('keydown', e=>{ if(e.key==='Enter') onBuscar(); });

  let timer=null;
  q.addEventListener('input', ()=>{
    if(timer) clearTimeout(timer);
    timer = setTimeout(()=>{
      const s = suggestions(q.value, DB.artigos, DB.idx, 8);
      if(!s.length){ ac.style.display='none'; return; }
      ac.innerHTML = s.map(x=>`<div class="item" role="option">${x}</div>`).join('');
      ac.style.display='block';
      [...ac.children].forEach(it=> it.addEventListener('click', ()=>{ q.value = it.textContent; ac.style.display='none'; onBuscar(); }));
    }, CONFIG.debounceMs);
  });
  document.addEventListener('click', (e)=>{ if(!document.getElementById('searchWrap').contains(e.target)) ac.style.display='none'; });

  btnCategoria.addEventListener('click', ()=>{
    const open = catSheet.hidden;
    catSheet.hidden = !open;
    btnCategoria.setAttribute('aria-expanded', String(open));
    if(open){
      const rect = topbar.getBoundingClientRect();
      catSheet.style.left = rect.left + 8 + 'px';
      catSheet.style.top = rect.bottom + 6 + 'px';
    }
  });
  document.addEventListener('click', (e)=>{ if(!btnCategoria.contains(e.target) && !catSheet.contains(e.target)) catSheet.hidden = true; });

  window.addEventListener('scroll', onScroll, {passive:true});

  btnPrev.addEventListener('click', ()=> navStep(-1));
  btnNext.addEventListener('click', ()=> navStep(1));
  btnRem.addEventListener('click', ()=> openRemissoes());
  btnFerr.addEventListener('click', (e)=> openFerramentas(e.currentTarget));

  dPrev.addEventListener('click', ()=> navStep(-1));
  dNext.addEventListener('click', ()=> navStep(1));
  dRem.addEventListener('click', ()=> openRemissoes());
  dFerr.addEventListener('click', (e)=> openFerramentas(e.currentTarget));

  chipbar.addEventListener('scroll', ()=>{
    if(chipbar.scrollLeft > 0){ chipbar.classList.remove('is-centered'); lockLeftChips = true; }
  });
  window.addEventListener('resize', ensureCenteredState);
}

function onScroll(){
  const y = window.scrollY;
  const goingDown = y > lastScrollY;
  topbar.style.transform = (goingDown && y>40) ? 'translateY(-100%)' : 'translateY(0)';
  lastScrollY = y;

  const mb = document.getElementById('mobileBar');
  if(window.innerWidth < 1024){
    mb.classList.toggle('mobile-hide', goingDown && y>40);
    const nearTop = y < CONFIG.topThreshold;
    document.getElementById('btnPrev').style.display = nearTop ? '' : 'none';
    document.getElementById('btnNext').style.display = nearTop ? '' : 'none';
  }
}

async function carregarFonte(sigla){
  current.fonte = sigla;
  DB.artigos = await loadJSON(`data/codigoseleis/${sigla}.json`);
  DB.artigos.forEach(a=> a.partes = partesDoArtigo(a));
  DB.idx = buildIndex(DB.artigos);
  DB.glossario = await loadList('data/glossario.txt');
  DB.videos = await loadList('data/videos.txt');
  DB.artigosTxt = await loadList('data/artigos.txt');
  DB.livros = await loadJSON('data/livros.json');
}

function ensureCenteredState(){
  if(lockLeftChips){ chipbar.classList.remove('is-centered'); return; }
  const isOverflow = chipbar.scrollWidth > chipbar.clientWidth + 2;
  chipbar.classList.toggle('is-centered', !isOverflow);
}

async function onBuscar(){
  const termo = q.value;
  localStorage.setItem('meujus:last', termo);
  const results = buscar(termo, DB.artigos, DB.idx).slice(0, 32);
  if(!results.length){ chipbar.innerHTML=''; content.innerHTML='<p class="small">Nenhum resultado.</p>'; showBars(false); return; }
  lockLeftChips = false;
  renderChips(chipbar, results, onSelect, ensureCenteredState);
  onSelect(results[0], {fromChips:true});
  content.focus();
  showBars(true);
}

function onSelect(artigo, {fromChips}={}){
  current.artigo = artigo;
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

  renderFicha(content, artigo, extras);
  updateBarsState();
  updateChipsSelection(artigo, {fromChips});
}

function updateChipsSelection(artigo, {fromChips}={}){
  const chips = [...chipbar.querySelectorAll('.chip')];
  const match = chips.find(c=> c.textContent.trim() === `Art. ${artigo.artigo}`);
  if(match){
    chips.forEach(c=>c.setAttribute('aria-selected','false'));
    match.setAttribute('aria-selected','true');
    match.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
  }else{
    const b=document.createElement('button');
    b.className='chip'; b.textContent=`Art. ${artigo.artigo}`; b.setAttribute('aria-selected','true');
    b.addEventListener('click',()=> onSelect(artigo, {fromChips:true}));
    chipbar.prepend(b);
    [...chipbar.children].forEach((c,i)=>{ if(i>0) c.setAttribute('aria-selected','false'); });
    ensureCenteredState();
  }
}

function showBars(show){
  const hasArticle = show && !!current.artigo;
  mobileBar.hidden = !hasArticle;
  desktopPod.hidden = !(hasArticle && window.innerWidth>=1024);
}

function updateBarsState(){
  const totalRem = sumRemissoes(current.artigo);
  btnRem.textContent = `Remissões (${totalRem})`;
  dRem.textContent = `Remissões (${totalRem})`;

  const idx = DB.artigos.findIndex(a=>a.artigo===current.artigo.artigo);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < DB.artigos.length-1;

  [btnPrev, dPrev].forEach(b=>{ b.disabled = !hasPrev; b.style.opacity = hasPrev? '1' : '.5'; });
  [btnNext, dNext].forEach(b=>{ b.disabled = !hasNext; b.style.opacity = hasNext? '1' : '.5'; });
}

function navStep(delta){
  const idx = DB.artigos.findIndex(a=>a.artigo===current.artigo.artigo);
  if(idx<0) return;
  let j = idx + delta;
  if(j<0 || j>=DB.artigos.length) return;
  const next = DB.artigos[j];
  onSelect(next, {fromChips:false});
  window.scrollTo({top:0, behavior:'smooth'});
}

function openFerramentas(anchor){
  closeMenus();
  const tpl = document.getElementById('ia-menu');
  const menu = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(menu);

  const box = menu.querySelector('.ia-partes');
  const partes = [{id:'artigo', label:'Artigo inteiro', texto: coletarTextoArtigo()}];
  current.artigo.partes.forEach(p=> partes.push({id:p.id, label:p.id, texto:p.texto}));
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
  function onDoc(e){ if(!menu.contains(e.target) && !anchor.contains(e.target)) menu.remove(); }
}

function closeMenus(){ document.querySelectorAll('.ia-menu').forEach(m=>m.remove()); }
function coletarTextoArtigo(){ const el=document.getElementById('content'); return el? el.innerText.slice(0,6000):''; }

function openRemissoes(){
  closeRemissoes();
  const tpl = document.getElementById('modal-remissoes');
  const modal = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(modal);
  const body = modal.querySelector('#remissoesBody');
  modal.querySelector('[data-close]').addEventListener('click', closeRemissoes);
  const groups = buildRemissoesGroups(current.artigo);
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

function onRelatedSearch(txt){
  q.value = txt.replace(/^Vide\s+/i,'').trim();
  onBuscar();
}

window.addEventListener('load', ensureCenteredState);
window.addEventListener('resize', ensureCenteredState);
