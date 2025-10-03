import { CONFIG } from './config.js';
import { loadJSON, loadList } from './loader.js';
import { buscar } from './search.js';
import { partesDoArtigo } from './parser.js';
import { renderChips, renderFicha } from './renderer.js';

const topbar = document.getElementById('topbar');
const chipbar = document.getElementById('chipbar');
const content = document.getElementById('content');
const q = document.getElementById('q');
const fonteSel = document.getElementById('fonte');
const btnBuscar = document.getElementById('btnBuscar');

let lastY = 0;
window.addEventListener('scroll', ()=>{
  const y = window.scrollY;
  topbar.style.transform = (y>lastY && y>40) ? 'translateY(-100%)' : 'translateY(0)';
  lastY = y;
});

let DB = { artigos:[], glossario:[], videos:[], artigosTxt:[], livros:[] };

async function boot(){
  await carregarFonte(fonteSel.value);
  btnBuscar.addEventListener('click', onBuscar);
  q.addEventListener('keydown', e=>{ if(e.key==='Enter') onBuscar(); });
  fonteSel.addEventListener('change', async ()=>{
    await carregarFonte(fonteSel.value);
    content.innerHTML=''; chipbar.innerHTML='';
    q.focus();
  });
}
boot();

async function carregarFonte(sigla){
  DB.artigos = await loadJSON(`data/codigoseleis/${sigla}.json`);
  DB.glossario = await loadList('data/glossario.txt');
  DB.videos = await loadList('data/videos.txt');
  DB.artigosTxt = await loadList('data/artigos.txt');
  DB.livros = await loadJSON('data/livros.json');
}

async function onBuscar(){
  const termo = q.value;
  const results = buscar(termo, DB.artigos).slice(0, CONFIG.maxChips);
  if(!results.length){ chipbar.innerHTML=''; content.innerHTML='<p class="small">Nenhum resultado.</p>'; return; }
  results.forEach(a=>a.partes = partesDoArtigo(a));
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

  const hasTerm = t => termos.includes(t.toLowerCase());

  const extras = {
    glossario: DB.glossario.filter(hasTerm).slice(0,12),
    artigos: DB.artigosTxt.filter(hasTerm).slice(0,12),
    videos: DB.videos.filter(hasTerm).slice(0,12),
    livros: DB.livros.filter(l => hasTerm(l.titulo)).slice(0,8)
  };

  renderFicha(content, artigo, extras, openIAMenu);
}

function openIAMenu(anchor, ctx){
  closeMenus();
  const tpl = document.getElementById('ia-menu');
  const menu = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + window.scrollY + 6}px`;

  const partes = [
    {id:'artigo', label:'Artigo inteiro', checked:true},
    {id:ctx.id, label:ctx.label, checked:false}
  ];
  const box = menu.querySelector('.ia-partes');
  partes.forEach(p=>{
    const el = document.createElement('label'); el.className='part-chip';
    el.innerHTML = `<input type="checkbox" ${p.checked?'checked':''} data-id="${p.id}"/> ${p.label}`;
    box.appendChild(el);
  });

  const getTexto = ()=>{
    const sels = [...box.querySelectorAll('input:checked')].map(i=>i.dataset.id);
    if(sels.includes('artigo')) return coletarArtigoCompleto();
    if(sels.includes(ctx.id)) return ctx.texto;
    return ctx.texto;
  };

  menu.querySelector('[data-action="estudar"]').addEventListener('click',()=>{
    const u = makeIA('estudar', getTexto()); window.open(u,'_blank','noopener');
  });
  menu.querySelector('[data-action="questoes"]').addEventListener('click',()=>{
    const u = makeIA('questoes', getTexto()); window.open(u,'_blank','noopener');
  });
  menu.querySelector('[data-action="juris"]').addEventListener('click',()=>{
    const u = makeJuris(getTexto()); window.open(u,'_blank','noopener');
  });

  function makeIA(tipo, texto){ return (tipo==='questoes')
    ? `https://www.google.com/search?udm=50&q=${encodeURIComponent(CONFIG.promptQuestoes + texto)}`
    : `https://www.google.com/search?udm=50&q=${encodeURIComponent(CONFIG.promptEstudar + texto)}`; }
  function makeJuris(texto){ return `https://www.jusbrasil.com.br/busca?q=${encodeURIComponent(texto)}`; }

  setTimeout(()=>document.addEventListener('click', onDoc, {once:true}));
  function onDoc(e){ if(!menu.contains(e.target)) menu.remove(); }
}
function closeMenus(){ document.querySelectorAll('.ia-menu').forEach(m=>m.remove()); }

function coletarArtigoCompleto(){
  const card = content.querySelector('.card');
  return card ? card.innerText.slice(0, 6000) : '';
}
