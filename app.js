// app.js — MeuJus (HTML seguro, chips de origem, histórico global, deep link #q=n)

const CONFIG = {
  useGitHubIndexer: true,
  owner: 'osvaldosereia',
  repo: 'ART123CP',
  branch: 'main',
  dataDir: 'data'
};
const AUTO_RESUME = false;

/* ===== util ===== */
const getToastWrap = ()=> {
  let w = document.querySelector('.toast-wrap');
  if(!w){ w=document.createElement('div'); w.className='toast-wrap'; document.body.appendChild(w); }
  return w;
};
function toast(msg, type='info', ms=2000){
  const wrap=getToastWrap();
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.textContent=msg;
  wrap.appendChild(el);
  const close=()=>{ if(!el.isConnected) return; el.style.opacity='0'; el.style.transform='translateY(6px)'; setTimeout(()=> el.remove(),180); };
  el.addEventListener('click', close);
  setTimeout(close, ms);
}
const show = (node, flag) => node && node.classList.toggle('hide', !flag);
function lsGet(k, def=null){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch{ return def; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function htmlEscape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function normalizeText(str) {
  if (!str) return '';
  return String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ç/g, 'c');
}
function decodeHTMLEntities(s){
  if(!s) return '';
  const d=new DOMParser().parseFromString(s,'text/html');
  return d.documentElement.textContent||'';
}
function slug(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function rqIdle(cb, timeout=60){ return (window.requestIdleCallback||((f)=>setTimeout(()=>f({didTimeout:false,timeRemaining:()=>0}),0)))(cb,{timeout}); }

/* pretty names */
const SPECIAL_NAMES = new Map([
  ['direito-civil','Direito Civil'],
  ['contratos','Contratos'],
  ['mutuo','Mútuo'],
  ['concurso','Concurso de Pessoas']
]);
function prettyName(id){
  const key = String(id||'').toLowerCase();
  if(SPECIAL_NAMES.has(key)) return SPECIAL_NAMES.get(key);
  return key.split(/[-_\s]+/).map(s=> s? s[0].toUpperCase()+s.slice(1) : '').join(' ');
}

/* ===== helpers p/ “temas irmãos” ===== */
function getCurrentContext(){
  const first = Array.isArray(KEY?.path) ? KEY.path[0] : KEY?.path;
  if(!first || typeof first!=='string') return null;
  const parts = first.split('/'); // data / disciplina / materia / arquivo
  if(parts.length < 4) return null;
  const disciplinaId = parts[1];
  const materiaId    = parts[2];
  const file         = parts[3];
  const baseId       = file.replace(/\.(txt|html?|json)$/i,'').replace(/\d+$/,'');
  return {disciplinaId, materiaId, baseId};
}
function listSiblingThemes(){
  const ctx = getCurrentContext(); 
  if(!ctx || !MANIFEST) return [];
  const cat = (MANIFEST.categories||[]).find(c => c.id === ctx.disciplinaId);
  if(!cat) return [];
  const sameMateria = (cat.themes||[]).filter(t => t.id.startsWith(ctx.materiaId + '-'));
  return sameMateria.filter(t => !t.id.endsWith('-' + ctx.baseId));
}
function shortThemeName(theme){
  const n = String(theme.name||'');
  const parts = n.split('·').map(s=>s.trim());
  return parts.length>1 ? parts[1] : n;
}
function renderSiblingTags(){
  const tagsArea = document.getElementById('tagsBar');
  if(!tagsArea) return;
  tagsArea.innerHTML = '';
  const siblings = listSiblingThemes();
  tagsArea.style.display = siblings.length ? 'flex' : 'none';
  siblings.forEach(t => {
    const a = document.createElement('a');
    a.href = '#tema:' + encodeURIComponent(t.id);
    a.textContent = shortThemeName(t);
    a.className = 'tag';
    a.addEventListener('click', ev => {
      ev.preventDefault();
      loadQuiz(t.path, true);
    });
    tagsArea.appendChild(a);
  });
}

/* ===== DOM ===== */
const selCategory = document.getElementById('selCategory');
const selTheme    = document.getElementById('selTheme');
const selSubject  = document.getElementById('selSubject'); // <- NOVO

const btnStart = document.getElementById('btnStart');
const btnResume = document.getElementById('btnResume');
const txtGlobal = document.getElementById('txtGlobal');
const btnGlobal = document.getElementById('btnGlobal');

const screenIntro = document.getElementById('screenIntro');
const screenQuiz = document.getElementById('screenQuiz');
const screenResult = document.getElementById('screenResult');

const appTitle = document.getElementById('appTitle');
const state = document.getElementById('state');

const questionEl = document.getElementById('question');
const optionsEl = document.getElementById('options');
const bar = document.getElementById('bar');
const explainEl = document.getElementById('explanation');
const btnGoHome = document.getElementById('btnGoHome');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
let btnAI = document.getElementById('btnAI');

const resultTitle = document.getElementById('resultTitle');
const resultScore = document.getElementById('resultScore');
const resultMsg = document.getElementById('resultMsg');
const btnRetry = document.getElementById('btnRetry');
const btnHome = document.getElementById('btnHome');

const footLeft = document.getElementById('footLeft');
const footRight = document.getElementById('footRight');

const txtSearch = document.getElementById('txtSearch');
const btnSearch = document.getElementById('btnSearch');
const btnClearSearch = document.getElementById('btnClearSearch');


/* TAGS host */
let tagsBarEl = document.getElementById('tagsBar');
(function ensureTagsBar(){
  if(tagsBarEl) return;
  const host = btnSearch ? btnSearch.parentElement : null;
  const row = host && host.parentElement ? host.parentElement : document.querySelector('.controls') || document.body;
  const wrap = document.createElement('div');
  wrap.id = 'tagsBar';
  wrap.className = 'tagsbar';
  row.parentElement ? row.parentElement.insertBefore(wrap, row.nextSibling) : document.body.appendChild(wrap);
  tagsBarEl = wrap;
})();
/* ===== Custom Select (progressive enhancement) ===== */
function enhanceSelect(selectEl, { size='sm' } = {}){
  if(!selectEl || selectEl.dataset.enhanced) return;
  const wrap = document.createElement('div');
  wrap.className = 'custom-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `select-trigger ${size}`;
  trigger.setAttribute('aria-haspopup','listbox');
  trigger.setAttribute('aria-expanded','false');

  const labelText = ()=> {
    const opt = selectEl.options[selectEl.selectedIndex];
    return opt ? opt.textContent : '—';
  };
  trigger.innerHTML = `<span class="sel-text">${labelText()}</span>
    <span class="chev" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </span>`;

  const list = document.createElement('div');
  list.className = 'select-list';
  list.role = 'listbox';

  function buildList(){
    list.innerHTML = '';
    if(selectEl.options.length === 0){
      const empty = document.createElement('div');
      empty.className = 'select-empty';
      empty.textContent = 'Sem opções';
      list.appendChild(empty);
      return;
    }
    [...selectEl.options].forEach((o, idx)=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'select-option';
      b.role = 'option';
      b.setAttribute('data-value', o.value);
      b.setAttribute('aria-selected', String(idx === selectEl.selectedIndex));
      b.textContent = o.textContent;
      b.addEventListener('click', ()=>{
        selectEl.selectedIndex = idx;
        selectEl.dispatchEvent(new Event('change', {bubbles:true}));
        trigger.querySelector('.sel-text').textContent = o.textContent;
        close();
      });
      list.appendChild(b);
    });
  }

  function open(){
    wrap.classList.add('is-open');
    trigger.setAttribute('aria-expanded','true');
    document.addEventListener('click', onDocClick, { once:true });
  }
  function close(){
    wrap.classList.remove('is-open');
    trigger.setAttribute('aria-expanded','false');
  }
  function onDocClick(e){
    if(!wrap.contains(e.target)) close();
  }

  trigger.addEventListener('click', ()=>{
    if(wrap.classList.contains('is-open')) close();
    else { buildList(); open(); }
  });

  // esconder select nativo
  selectEl.classList.add('select-hidden');
  selectEl.parentElement.insertBefore(wrap, selectEl);
  wrap.appendChild(trigger);
  wrap.appendChild(list);
  selectEl.dataset.enhanced = '1';

  // sincronizar quando app troca as opções
  const mo = new MutationObserver(()=> {
    trigger.querySelector('.sel-text').textContent = labelText();
    buildList();
  });
  mo.observe(selectEl, { childList:true, subtree:false, attributes:true, attributeFilter:['value'] });

  selectEl.addEventListener('change', ()=>{
    trigger.querySelector('.sel-text').textContent = labelText();
    buildList();
  });
}

function applyCustomSelects(){
  enhanceSelect(selCategory, {size:'sm'});
  enhanceSelect(selTheme,    {size:'sm'});
  if (selSubject) enhanceSelect(selSubject, {size:'sm'});
}


/* ===== labels ===== */
const DEFAULT_LABELS = { start:'Começar', next:'Próximo', prev:'Anterior', retry:'Refazer', home:'Início', category:'Disciplina', theme:'Tema', result:'Resultado' };
let LABELS = { ...DEFAULT_LABELS };

/* ===== estado ===== */
let MANIFEST = null, QUIZ = null, ORDER = [], CHOSEN = [], I = 0, KEY = null;
let FILTER = null;
let TAG_FILTER = null;
let TAG_INDEX = new Map();
let TAG_READY = false;
let ROUTED = false;
let LOADING = false;

/* ===== fetch ===== */
function readEmbedded(path){ const t=document.querySelector(`script[type="application/json"][data-path="${path}"]`); if(!t) return null; try{ return JSON.parse(t.textContent);}catch{ return null; } }
function mustUseEmbedded(){ return new URLSearchParams(location.search).get('embedded')==='1'; }
async function fetchText(path){
  if(!mustUseEmbedded()){
    try{ const res = await fetch(path, {cache:'no-store'}); if(res.ok) return await res.text(); }catch{}
  }
  return '';
}
async function loadJSON(path, fallback=undefined){
  if(!mustUseEmbedded()){
    try{ const res=await fetch(path,{cache:'no-store'}); if(res.ok) return res.json(); }catch{}
  }
  const emb=readEmbedded(path); if(emb!=null) return emb; if(fallback!==undefined) return fallback; return null;
}

/* ===== regras ===== */
function isCorrectQuestion(q, pick){
  if(!q) return false;
  const t=q.type||'multiple';
  if(t==='vf') return (pick===!!q.answer);
  return (typeof pick==='number' && pick===q.answer);
}
function guessOwnerRepo(){
  if(CONFIG.owner && CONFIG.repo) return {owner:CONFIG.owner, repo:CONFIG.repo};
  const host = location.hostname;
  const path = location.pathname;
  if(host.endsWith('.github.io')){
    const owner = host.split('.github.io')[0];
    const parts = path.split('/').filter(Boolean);
    const repo = parts.length ? parts[0] : owner;
    return {owner, repo};
  }
  return {owner: CONFIG.owner, repo: CONFIG.repo};
}
function formatParagraphs(s){
  const clean = String(s||'').replace(/\r\n?/g,'\n').replace(/[\u00A0\t]+/g,' ').replace(/\s+$/gm,'').trim();
  const parts = clean.split(/\n{2,}/).map(t=>t.trim()).filter(Boolean);
  return parts.map(p=>`<p>${htmlEscape(p)}</p>`).join('');
}

/* ===== TAG helpers ===== */
function buildTagIndex(items){
  TAG_INDEX.clear();
  for(let i=0;i<items.length;i++){
    const q=items[i];
    (q.tags||[]).forEach(t=>{
      if(!t) return;
      if(!TAG_INDEX.has(t)) TAG_INDEX.set(t, []);
      TAG_INDEX.get(t).push(i);
    });
  }
  TAG_READY = true;
}

/* ===== sanitização básica de HTML ===== */
function sanitizeBasicHTML(html){
  if(!html) return '';
  let s = String(html);
  s = s.replace(/<(script|style|iframe|object|embed|meta|link)[\s\S]*?>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(script|style|iframe|object|embed|meta|link)[^>]*?>/gi, '');
  const allowed = ['b','strong','i','em','u','sup','sub','br','p','ul','ol','li','mark'];
  s = s.replace(/<([a-z0-9:-]+)(\s[^>]*)?>/gi, (m, tag)=>{
    tag = tag.toLowerCase();
    return allowed.includes(tag) ? `<${tag}>` : '';
  });
  s = s.replace(/<\/([a-z0-9:-]+)>/gi, (m, tag)=>{
    tag = tag.toLowerCase();
    return allowed.includes(tag) ? `</${tag}>` : '';
  });
  return s.replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

/* ===== parser TXT ===== */
function parseTxtQuestions(raw) {
  const text = String(raw || '').replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n-{5,}\n/g).map(b => b.trim()).filter(Boolean);
  const qs = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let enunciado = [], opcoes = [], gabarito = null, tags = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\*\s(?!\*)/.test(trimmed)) { enunciado.push(trimmed.replace(/^\*\s*/, '')); continue; }
      if (/^\*\*\s*\(?[A-E]\)/i.test(trimmed)) { const m = trimmed.match(/^\*\*\s*\(?([A-E])\)\s*(.+)$/i); if (m) opcoes.push(m[2].trim()); continue; }
      if (/^\*\*\*\s*Gabarito\s*:/i.test(trimmed)) { const g = trimmed.match(/^\*\*\*\s*Gabarito\s*:\s*([A-E])/i); if (g) gabarito = g[1].toUpperCase(); continue; }
      if (/^\*\*\*\*/.test(trimmed)) { const tagLine = trimmed.replace(/^\*\*\*\*\s*/, ''); tags = tagLine.split(',').map(t => t.trim().toLowerCase()).filter(Boolean); continue; }
    }
    if (enunciado.length === 0 || opcoes.length === 0) continue;
    const map = {A:0,B:1,C:2,D:3,E:4};
    const qObj = {
      type:'multiple',
      q: formatParagraphs(enunciado.join('\n')),
      options: opcoes,
      answer: gabarito && map[gabarito]!=null ? map[gabarito] : null,
      explanation:'',
      tags
    };
    qs.push(qObj);
  }
  return qs;
}

/* ===== parser HTML Inertia (QConcursos) ===== */
async function fetchInertiaFromHtml(url){
  const res = await fetch(url, { cache:'no-store', credentials:'include' });
  if(!res.ok) throw new Error(`HTTP ${res.status} ao carregar ${url}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const attr = doc.querySelector('#app')?.getAttribute('data-page');
  if(!attr) return null;
  const decoded = decodeHTMLEntITIES(attr);
  try{ return JSON.parse(decoded); }catch{ return null; }
}
function decodeHTMLEntITIES(s){ // evita sombreamento
  return decodeHTMLEntities(s);
}
function plainText(html){
  if(!html) return '';
  let s = String(html)
    .replace(/\r\n?/g,'\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*p[^>]*>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeHTMLEntities(s);
  return s.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function yearFrom(text){ const m=String(text||'').match(/\b(19|20)\d{2}\b/); return m?m[0]:null; }

function normalizeQCQuestion(q){
  const letters = Object.keys(q.alternatives||{}).sort();
  const options = letters.map(L => sanitizeBasicHTML(q.alternatives[L]));
  const letter = String(q.correct_answer||'').trim().toUpperCase();
  const answer = Math.max(0, letters.indexOf(letter));

  const tags = [];
  const board = q.examining_board?.acronym || q.examining_board?.name;
  const inst  = q.institute?.acronym      || q.institute?.name;
  const pos   = q.position;
  const examName = (q.exams&&q.exams[0]?.name)||q.title||'';
  const yr = q.year || yearFrom(examName) || yearFrom(q.title);

  if(board) tags.push(slug(board));
  if(inst)  tags.push(slug(inst));
  if(pos)   tags.push(slug(pos));
  if(yr)    tags.push(String(yr));

  // ✅ agora inclui o associated_text antes do statement
  const fullStatement = sanitizeBasicHTML(
    (q.associated_text ? q.associated_text + "<br><br>" : "") + q.statement
  );

  return {
    type: 'multiple',
    q: fullStatement,
    options,
    answer: answer >= 0 ? answer : null,
    explanation: '',
    tags,
    source: {
      boardAcr: q.examining_board?.acronym||null,
      board: q.examining_board?.name||null,
      instituteAcr: q.institute?.acronym||null,
      institute: q.institute?.name||null,
      position: q.position||null,
      year: yr,
      exam: examName||null,
      questionId: q.question_id||null
    }
  };
}


async function loadHtmlAsQuiz(url){
  const data = await fetchInertiaFromHtml(url);
  if(!data){ return { meta:{title:'HTML',category:'HTML',theme:'HTML',shuffle:{questions:false,options:true},persist:true,outroMessage:''}, questions:[] }; }
  const qs = (data?.props?.data?.questions || []).map(normalizeQCQuestion);
  const meta = data?.props?.meta || {};
  const title = data?.component || 'QConcursos';
  return {
    meta:{
      title,
      category: 'QConcursos',
      theme: `Página ${meta.current_page||1}/${meta.total_pages||1}`,
      shuffle:{questions:false, options:true},
      persist:true,
      outroMessage:''
    },
    questions: qs
  };
}

/* ===== carregamento TXT rápido + cache ===== */
function quizMetaFromPath(path){
  const parts = String(path||'').split('/');
  const category = parts[1] || 'Geral';
  const file = (parts.at(-1)||'Quiz.txt').replace(/\.(txt|html?|json)$/i,'');
  return {title:file,category,theme:file,shuffle:{questions:false,options:true},persist:true,outroMessage:''};
}
function cacheKey(p){ return 'quiz:cache:' + (typeof p==='string'?p:JSON.stringify(p)); }
function saveQuizCache(p,q){ try{ lsSet(cacheKey(p), {t:Date.now(),q}); }catch{} }
function readQuizCache(p,maxAgeMs=7*24*3600e3){ const c=lsGet(cacheKey(p)); return c && Date.now()-c.t<maxAgeMs ? c.q : null; }

async function loadTxtAsQuizFast(path){
  const raw = await fetchText(path);
  const allBlocks = String(raw||'').replace(/\r\n?/g,'\n').split(/\n-{5,}\n/g).map(b=>b.trim()).filter(Boolean);
  const meta = quizMetaFromPath(path);
  const questions = [];

  // lote inicial
  const firstN = Math.min(10, allBlocks.length);
  for(let i=0;i<firstN;i++){
    questions.push(...parseTxtQuestions(allBlocks[i]));
  }
  // entrega parcial
  await loadVirtualQuiz({meta,questions:[...questions]}, path, true);

  // continuar em lotes
  for(let i=firstN;i<allBlocks.length;i+=25){
    await new Promise(r=>rqIdle(r));
    for(let j=i;j<Math.min(i+25,allBlocks.length);j++){
      questions.push(...parseTxtQuestions(allBlocks[j]));
    }
    QUIZ.questions = questions;
    if(!TAG_READY) rqIdle(()=>buildTagIndex(QUIZ.questions));
    render();
  }

  const full = {meta,questions};
  saveQuizCache(path, full);
  return full;
}

/* ===== init ===== */
init();
async function init() {
  show(screenIntro, true);
  show(screenQuiz,  false);
  show(screenResult,false);

  MANIFEST = await buildManifestFromGitHub();
  if (!MANIFEST) {
    MANIFEST = {
      title: 'MeuJus',
      categories: [{
        id: 'QConcursos',
        name: 'QConcursos',
        themes: [
          { id: 'Exemplo HTML', name: 'Exemplo HTML',
            path: 'https://app.qconcursos.com/simulados/tentativas/2256819/gabarito?page=2&per_page=20' }
        ]
      }],
      shuffleDefault: { questions: false, options: true },
      persistDefault: true,
      outro: { message: 'Obrigado por participar.' }
    };
  }

  const stateEl = document.getElementById('state');
  if(stateEl) stateEl.classList.add('hide');

  appTitle.textContent = MANIFEST?.title || 'MeuJus';
  applyLabels();

  selCategory.innerHTML = '';
  (MANIFEST?.categories || []).forEach((c, idx) => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name || c.id;
    if (idx === 0) o.selected = true;
    selCategory.appendChild(o);
  });
  updateThemes();
  applyCustomSelects(); // <— ENTRA


  selCategory.addEventListener('change', updateThemes);
  selTheme.addEventListener('change', updateSubjects); // <- ENTRA AQUI

  btnStart.addEventListener('click', startQuizFromSelection);
  btnPrev.addEventListener('click', prev);
  btnNext.addEventListener('click', next);

  btnGlobal.addEventListener('click', () => globalSearchAndOpen(txtGlobal.value || ''));
  txtGlobal.addEventListener('keydown', e=>{ if(e.key==='Enter') btnGlobal.click(); });

  btnSearch.addEventListener('click', ()=> applyFilter(txtSearch.value||''));
  btnClearSearch.addEventListener('click', clearFilter);
  txtSearch.addEventListener('keydown', e=>{ if(e.key==='Enter') btnSearch.click(); });

  const goHome = ()=>{ resetState(); show(screenIntro,true); show(screenQuiz,false); show(screenResult,false); };
  btnGoHome.addEventListener('click', goHome);
  btnHome.addEventListener('click', goHome);
  appTitle.addEventListener('click', goHome);

  btnRetry.addEventListener('click', ()=>{ loadQuiz(KEY?.path,true); toast('Quiz reiniciado','info'); });

  ensureAIMenu();
  loadHistory();
  setupHeaderActions();

  window.addEventListener('offline', ()=>toast('Sem conexão. Usando cache local','warn',3000));
  window.addEventListener('online', ()=>toast('Conexão restabelecida','success',1800));

  // auto-resume
  const last = lsGet('quiz:last');
  if (AUTO_RESUME && last?.path && !ROUTED) {
    ROUTED = true;
    KEY = last;
    await loadQuiz(last.path, false, true);
  }

  // deep link #q=n
  if (ROUTED) {
    try{
      const m = String(location.hash||'').match(/#q=(\d+)/i);
      if(m){
        const n = Math.max(1, parseInt(m[1],10));
        I = Math.min(Math.max(0, n-1), (ORDER.length||1)-1);
        render();
      }
    }catch{}
  }

  if (!ROUTED) show(screenIntro, true);
}

/* ===== IA ===== */
function ensureAIMenu(){
  let aiMenu = document.getElementById('aiMenu');
  let aiDropdown = document.getElementById('aiDropdown');

  if (!btnAI) btnAI = document.getElementById('btnAI');

  if (btnAI) {
    btnAI.innerHTML =
      'Pergunte ao <span class="google-word">' +
      '<span class="g1">G</span><span class="g2">o</span><span class="g3">o</span>' +
      '<span class="g4">g</span><span class="g5">l</span><span class="g6">e</span>' +
      '</span> Modo I.A.';
  }

  if(!aiMenu){
    const container = document.createElement('div');
    container.id = 'aiMenu';
    container.className = 'ai-menu hide';

    if(!btnAI){
      btnAI = document.createElement('button');
      btnAI.id = 'btnAI';
      btnAI.className = 'btn ghost';
      btnAI.type = 'button';
      btnAI.innerHTML =
        'Pergunte ao <span class="google-word">' +
        '<span class="g1">G</span><span class="g2">o</span><span class="g3">o</span>' +
        '<span class="g4">g</span><span class="g5">l</span><span class="g6">e</span>' +
        '</span> Modo I.A.';
    }
    container.appendChild(btnAI);

    const dd = document.createElement('div');
    dd.id = 'aiDropdown';
    dd.className = 'ai-dropdown';
    dd.innerHTML = `
      <button type="button" data-mode="gabarito"  class="btn ghost sm">Gabarito</button>
      <button type="button" data-mode="glossario" class="btn ghost sm">Glossário</button>
      <button type="button" data-mode="video"     class="btn ghost sm">Vídeo-aula</button>
    `;
    container.appendChild(dd);

    (btnNext?.parentElement || document.querySelector('.actions'))?.appendChild(container);

    aiMenu = container;
    aiDropdown = dd;
  }

  if (btnAI && !btnAI.dataset.bound){
    btnAI.addEventListener('click', (e)=>{ e.stopPropagation(); aiMenu.classList.toggle('open'); });
    document.addEventListener('click', (e)=>{ if(!aiMenu.contains(e.target)) aiMenu.classList.remove('open'); });
    aiDropdown?.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', ()=>{ aiMenu.classList.remove('open'); openGoogleAIMode(b.dataset.mode); });
    });
    btnAI.dataset.bound='1';
  }
}
function openGoogleAIMode(mode) {
  const q = current(); if (!q) return;
  let prompt = '';
  if (mode === 'gabarito') {
    prompt = 'Explique por que esta é a alternativa correta e por que as demais estão incorretas. Enunciado: ' +
      String(q.q).replace(/<[^>]+>/g,'') +
      ' | Opções: ' + (q.type==='vf' ? 'Verdadeiro | Falso' : q.options.join(' | ')) +
      (typeof q.answer==='number' ? ' | Alternativa correta: ' + (q.options[q.answer]||'') : '');
  } else if (mode === 'glossario') {
    prompt = 'Liste e defina os principais conceitos jurídicos do enunciado a seguir: ' +
      String(q.q).replace(/<[^>]+>/g,'');
  } else if (mode === 'video') {
    prompt = 'Indique uma videoaula no YouTube que explique o tema desta questão: ' +
      String(q.q).replace(/<[^>]+>/g,'');
  } else {
    prompt = 'Explique detalhadamente a questão a seguir. Enunciado: ' +
      String(q.q).replace(/<[^>]+>/g,'');
  }
  const url = 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(prompt);
  window.open(url, '_blank', 'noopener');
}

/* ===== seleção ===== */
function applyLabels(){
  const cat=document.querySelector('label[for="selCategory"]');
  const th=document.querySelector('label[for="selTheme"]');
  if(cat) cat.textContent = LABELS.category||'Disciplina';
  if(th) th.textContent = LABELS.theme||'Tema';
  btnStart.textContent = LABELS.start||'Começar';
  btnPrev.textContent = LABELS.prev||'Anterior';
  btnNext.textContent = LABELS.next||'Próximo';
  const r=document.getElementById('resultTitle'); if(r) r.textContent = LABELS.result||'Resultado';
  btnRetry.textContent = LABELS.retry||'Refazer';
  btnHome.textContent = LABELS.home||'Início';
  const h=document.getElementById('btnGoHome'); if(h) h.textContent=LABELS.home||'Início';
}

/* ===== helper: extrai matéria a partir do theme.id (antes do primeiro "-") ===== */
function materiaFromThemeId(themeId){
  const s = String(themeId||'');
  const i = s.indexOf('-');
  return i > 0 ? s.slice(0, i) : s;
}

/* helper: base do arquivo sem número final e sem extensão (USAR ANTES DE updateThemes) */
function baseKeyFromPath(p){
  const file = String(p||'').split('/').pop() || '';
  return file.replace(/\.(txt|html?|json)$/i,'').replace(/\d+$/,'');
}

function updateThemes(){
  const catId = selCategory.value;
  const cat = (MANIFEST?.categories||[]).find(c=>c.id===catId) || {themes:[]};

  // matérias únicas extraídas de theme.id antes do primeiro "-"
  const materias = [...new Set((cat.themes||[]).map(t=>{
    const s = String(t.id||''); const i = s.indexOf('-'); return i>0 ? s.slice(0,i) : s;
  }))].sort((a,b)=> prettyName(a).localeCompare(prettyName(b), 'pt-BR'));

  selTheme.innerHTML = '';
  materias.forEach((m, idx)=>{
    const o = document.createElement('option');
    o.value = m;                                // agora guarda SÓ a matéria
   o.textContent = materiaLabel(cat, m).toUpperCase();
    if(idx===0) o.selected = true;
    selTheme.appendChild(o);
  });

  applyCustomSelects();
  updateSubjects(); // repovoa o 2º dropdown com os assuntos da matéria escolhida
}


function updateSubjects(){
  if(!selSubject) return;

  const catId = selCategory.value;
  const materiaId = selTheme.value;
  const cat = (MANIFEST?.categories||[]).find(c=>c.id===catId);

  // coletar todos os paths da matéria
  const themesDaMateria = (cat?.themes||[]).filter(t=> t.id.startsWith(materiaId + '-'));
  const allPaths = [];
  themesDaMateria.forEach(t=>{
    if(Array.isArray(t.path)) allPaths.push(...t.path);
    else if(t.path) allPaths.push(t.path);
  });

  // agrupar por base (Participacao, Nocoes-Gerais, etc.)
  const group = new Map(); // base -> paths[]
  allPaths.forEach(p=>{
    const base = baseKeyFromPath(p);
    if(!group.has(base)) group.set(base, []);
    group.get(base).push(p);
  });

  selSubject.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = 'Selecione um assunto';
  selSubject.appendChild(opt0);

  const entries = [...group.entries()].sort((a,b)=> prettyName(a[0]).localeCompare(prettyName(b[0]), 'pt-BR'));

  if(entries.length === 0){
    selSubject.parentElement?.classList?.add('hide');
  } else {
    selSubject.parentElement?.classList?.remove('hide');
    entries.forEach(([base, paths])=>{
      const o = document.createElement('option');
      // value carrega TODOS os paths daquele assunto em JSON
      o.value = JSON.stringify(paths);
      o.textContent = prettyName(base);
      selSubject.appendChild(o);
    });
  }

  applyCustomSelects();
}



function selectedPath(){
  const v = selSubject?.value || '';

  // assunto escolhido
  if (v) {
    try{
      const arr = JSON.parse(v);
      if (Array.isArray(arr) && arr.length) return arr; // vários arquivos unidos
    }catch{
      return v; // valor simples
    }
  }

  // sem assunto, impedir início
  toast('Selecione um assunto primeiro', 'warn', 2200);
  return null;
}



async function startQuizFromSelection(){ const path=selectedPath(); if(!path) return; await loadQuiz(path,true); }

function resetState(){
  QUIZ=null; ORDER=[]; CHOSEN=[]; I=0; KEY=null;
  FILTER=null; TAG_FILTER=null; TAG_READY=false;
  explainEl.classList.add('hide'); btnClearSearch.classList.add('hide'); txtSearch.value='';
  tagsBarEl&&(tagsBarEl.innerHTML='');
  TAG_INDEX.clear();
}

/* ===== loadQuiz ===== */
async function loadQuiz(path,fresh=false,tryRestore=false){
  if (LOADING) return;
  LOADING = true;
  try{
    // cache
    const cached = readQuizCache(path);
    if(cached){
      await loadVirtualQuiz(cached, path, false);
      LOADING = false;
      return;
    }

    let qz=null;

    if(Array.isArray(path)){
      const quizzes = [];
      for(const p of path){
        try{
          if(/\.txt$/i.test(p)) quizzes.push(await loadTxtAsQuizFast(p));
          else if(/\.json$/i.test(p)) quizzes.push(await loadJSON(p));
          else if(/\.html?/i.test(p) || /^https?:\/\//i.test(p)) quizzes.push(await loadHtmlAsQuiz(p));
        }catch{}
      }
      const all = quizzes.filter(q=>q && Array.isArray(q.questions));
      const questions = all.flatMap(q=>q.questions);

      let disciplina='Geral', materia='Geral', tema='Tema';
      if(path.length>0){
        const parts = String(path[0]).split('/');
        if(parts.length>=4){
          disciplina = prettyName(parts[1]);
          materia    = prettyName(parts[2]);
          const base = String(parts[3]).replace(/\.(txt|html?|json)$/i,'').replace(/\d+$/,'');
          tema       = prettyName(base);
        }
      }
      qz = {
        meta:{
          title: `${materia} · ${tema}`,
          category: disciplina,
          theme: `${materia}`,
          shuffle:{questions:false, options:true},
          persist:true,
          outroMessage:''
        },
        questions
      };
      await loadVirtualQuiz(qz, path, fresh);
      saveQuizCache(path, qz);
    } else {
      if(/\.txt$/i.test(path)){
        qz = await loadTxtAsQuizFast(path); // entrega parcial dentro
      } else if(/\.json$/i.test(path)){
        qz = await loadJSON(path);
        if(qz && Array.isArray(qz.questions)){ await loadVirtualQuiz(qz, path, fresh); saveQuizCache(path,qz); }
      } else if(/\.html?/i.test(path) || /^https?:\/\//i.test(path)){
        qz = await loadHtmlAsQuiz(path);
        if(qz && Array.isArray(qz.questions)){ await loadVirtualQuiz(qz, path, fresh); saveQuizCache(path,qz); }
      }
    }

    if(!qz||!Array.isArray(qz.questions)){
      toast('Falha ao carregar o quiz','error',3000);
      show(screenIntro,true); show(screenQuiz,false); show(screenResult,false);
      return;
    }
  } finally {
    LOADING = false;
  }
}
async function loadVirtualQuiz(quizObj, synthKey, fresh){
  QUIZ = quizObj;
  KEY  = { path: synthKey, key: `quiz:${JSON.stringify(synthKey)}` };

  // índice de tags lazily
  TAG_READY = false;
  rqIdle(()=>buildTagIndex(QUIZ.questions));

  const total = QUIZ.questions.length;
  ORDER  = [...Array(total).keys()];
  CHOSEN = new Array(total).fill(null);
  I = 0; FILTER = null; TAG_FILTER = null;

  btnClearSearch?.classList.add('hide');
  show(screenIntro, false);
  show(screenQuiz,  true);
  show(screenResult,false);

  // duplo RAF para pintar antes de trabalho pesado
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  render();
}

/* ===== render ===== */
function render(){
  if(!QUIZ || !Array.isArray(QUIZ.questions) || QUIZ.questions.length===0) return;
  if(!bar || !footLeft || !footRight || !questionEl || !optionsEl || !explainEl) return;

  const total = QUIZ.questions.length;
  const answered = ORDER.filter(idx => CHOSEN[idx] !== null).length;
  const denom = ORDER.length || total;
  const progBase = Math.max(1, denom - 1);
  const filterBadge = TAG_FILTER ? ` · tag: ${TAG_FILTER}` : '';

  bar.style.width = Math.round(I / progBase * 100) + '%';
  footLeft.textContent = `Pergunta ${I + 1}/${denom}`;
  footRight.textContent = FILTER
    ? `${answered} respondidas · filtro: "${FILTER.term}"${filterBadge}`
    : `${answered} respondidas${filterBadge}`;

  const q = current();
  const categoryText = QUIZ?.meta?.category || 'Geral';
  const themeText    = QUIZ?.meta?.title    || 'Quiz';

  renderSiblingTags();

  questionEl.innerHTML = `
    <div class="muted">
      ${htmlEscape(categoryText)} | ${htmlEscape(themeText)}
    </div>
    <hr>
    ${q.q}
  `;

  optionsEl.innerHTML = '';
  explainEl.classList.add('hide');
  const aiMenu = document.getElementById('aiMenu');
  show(aiMenu, false);

  const type = q.type || 'multiple';
  if (type === 'vf') {
    renderOptions(['Verdadeiro', 'Falso'], idx => select(idx === 0), [0, 1]);
  } else {
    const opts = (q.options||[]).map((t, i) => ({ t, i }));
    renderOptions(opts.map(o => o.t), idx => select(opts[idx].i), opts.map(o => o.i));
  }

  btnPrev.disabled = I === 0;
  btnNext.textContent = I < denom - 1 ? (LABELS.next || 'Próximo') : 'Finalizar';

  if (CHOSEN[ORDER[I]] !== null) markLocked();
  persist();
}

/* ===== opções ===== */
function renderOptions(texts, onPick, origIdxs = null) {
  const labels = ['A','B','C','D','E','F','G'];
  texts.forEach((txt, idx) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.dataset.idx = idx;
    if (origIdxs) b.dataset.origIdx = String(origIdxs[idx]);
    const label = labels[idx] ? `<strong>${labels[idx]})</strong> ` : '';
    const safe = String(txt||'');
    b.innerHTML = `${label}${safe}`;
    b.addEventListener('click', () => onPick(idx));
    optionsEl.appendChild(b);
  });
}

/* ===== seleção e gabarito ===== */
function select(value) {
  if (isLocked()) return;
  CHOSEN[ORDER[I]] = value;
  lockAndExplain(value);
  persist();
  render();
}
function isLocked() {
  return optionsEl.querySelector('.correct, .wrong') != null;
}
function lockAndExplain(value) {
  const q = current();
  const type = q.type || 'multiple';
  const buttons = Array.from(optionsEl.querySelectorAll('.opt'));
  buttons.forEach(b => (b.disabled = true));

  if (q.annulled || q.answer == null) {
    explainEl.textContent = q.explanation || 'Questão anulada.';
    explainEl.classList.remove('hide');
    return;
  }

  let answerIdx = null;

  if (type === 'vf') {
    answerIdx = q.answer ? 0 : 1;
    buttons[q.answer ? 0 : 1].classList.add('correct');
    const chosenIdx = value ? 0 : 1;
    if (chosenIdx !== answerIdx) buttons[chosenIdx]?.classList.add('wrong');
    upsertHistoryItem({
      idx: ORDER[I],
      chosenIdx,
      correctIdx: answerIdx,
      quizTitle: QUIZ?.meta?.title || 'Geral',
      path: KEY?.path,
      preview: plainText(q.q).slice(0, 80)
    });
  } else {
    answerIdx = q.answer;
    buttons.forEach(b => {
      const origIdx = parseInt(b.dataset.origIdx ?? '-1', 10);
      if (origIdx === answerIdx) b.classList.add('correct');
    });
    const chosenIdx = (typeof value==='number') ? value : null;
    const chosenBtn = buttons.find(b => parseInt(b.dataset.origIdx ?? '-1', 10) === chosenIdx);
    if (chosenBtn && chosenIdx !== answerIdx) chosenBtn.classList.add('wrong');
    upsertHistoryItem({
      idx: ORDER[I],
      chosenIdx,
      correctIdx: answerIdx,
      quizTitle: QUIZ?.meta?.title || 'Geral',
      path: KEY?.path,
      preview: plainText(q.q).slice(0, 80)
    });
  }

  const gLetter = ['A','B','C','D','E','F','G'][q.answer] || '?';
  const gText = (q.options||[])[q.answer] || '';
  explainEl.innerHTML = `<div class="explain"><strong>Gabarito: ${gLetter})</strong> ${gText}</div>`;

  const aiMenu = document.getElementById('aiMenu');
  show(aiMenu, true);
  try{ history.replaceState(null,'',`#q=${I+1}`); }catch{}
}

/* ===== voltar mantendo bloqueio ===== */
function markLocked() {
  const q = current();
  const type = q.type || 'multiple';
  const val = CHOSEN[ORDER[I]];
  if (val === null) return;
  optionsEl.innerHTML = '';
  if (type === 'vf') {
    renderOptions(['Verdadeiro', 'Falso'], () => {}, [0, 1]);
    lockAndExplain( val ? true : false );
    return;
  } else {
    const opts = (q.options||[]).map((t, i) => ({ t, i }));
    renderOptions(opts.map(o => o.t), () => {}, opts.map(o => o.i));
  }
  lockAndExplain(val);
}

/* ===== util de estado ===== */
function current(){ return QUIZ.questions[ ORDER[I] ]; }
function persist(){
  const persistFlag = QUIZ?.meta?.persist ?? MANIFEST?.persistDefault ?? true;
  if(!persistFlag || !KEY) return;
  lsSet(KEY.key, {
    i:I,
    chosen:CHOSEN,
    order:ORDER,
    filter:FILTER,
    tag:TAG_FILTER,
    quizLen: QUIZ.questions.length,
    path: KEY.path
  });
  lsSet('quiz:last', KEY);
}

/* ===== placar ===== */
function score(){
  let ok=0; let total=0;
  for(let k=0;k<QUIZ.questions.length;k++){
    const q=QUIZ.questions[k]; const v=CHOSEN[k];
    if(q.annulled || q.answer==null) continue;
    total++;
    if((q.type||'multiple')==='vf'){ if((v ? 0 : 1)===(q.answer ? 0 : 1)) ok++; }
    else if(typeof v==='number' && v===q.answer) ok++;
  }
  return {ok,total};
}
function finish(){
  const {ok,total}=score();
  const pct = total>0 ? Math.round(ok/total*100) : 0;
  resultScore.textContent=`${pct}% (${ok}/${total})`;
  resultMsg.textContent=QUIZ.meta?.outroMessage || MANIFEST?.outro?.message || '';
  show(screenQuiz,false); show(screenResult,true);
  toast('Você concluiu o quiz','success',2500);
}

/* ===== navegação ===== */
function next(){ if(I < ORDER.length - 1){ I++; render(); } else { finish(); } }
function prev(){ if(I > 0){ I--; render(); } }

/* ===== filtros ===== */
function getVisibleQuestions(){
  const baseIdx = [...Array(QUIZ.questions.length).keys()];
  let idxs = baseIdx;

  if(TAG_FILTER){
    const tagSet = new Set(TAG_INDEX.get(TAG_FILTER)||[]);
    idxs = idxs.filter(i=>tagSet.has(i));
  }
  if(FILTER && FILTER.term){
    const terms = normalizeText(FILTER.term).split(/\s+/).filter(Boolean);
    idxs = idxs.filter(i=>{
      const q = QUIZ.questions[i];
      const nq = normalizeText(String(q.q||'').replace(/<[^>]+>/g,'')); 
      const no = (q.options||[]).map(o=>normalizeText(String(o||'')));
      return terms.every(st=>{
        const re = new RegExp('\\b'+st+'\\b');
        return re.test(nq) || no.some(t=>re.test(t));
      });
    });
  }
  return idxs.map(i=>QUIZ.questions[i]);
}
function applyFilter(termRaw){
  if(!QUIZ){ toast('Carregue um tema antes','warn'); return; }
  const term = String(termRaw||'').trim();
  if(!term){ toast('Informe um termo','warn'); return; }
  if(!TAG_READY) buildTagIndex(QUIZ.questions);
  FILTER = { term };
  btnClearSearch.classList.remove('hide');
  recalcOrderFromFilters();
  toast(`Filtro aplicado (${ORDER.length})`,'info');
  render();
}
function clearFilter(){
  if(!QUIZ) return;
  FILTER = null;
  btnClearSearch.classList.add('hide');
  recalcOrderFromFilters();
  toast('Filtro removido','info');
  render();
}
function clearTagFilter(){
  TAG_FILTER = null;
  recalcOrderFromFilters();
  render();
}
function recalcOrderFromFilters(){
  const idxs = getVisibleQuestions().map(q=>QUIZ.questions.indexOf(q));
  ORDER = idxs;
  I = 0;
  persist();
}

/* ===== busca global ===== */
async function globalSearchAndOpen(termRaw){
  const term = String(termRaw||'').trim();
  if(!term){ toast('Informe um termo para busca global','warn'); return; }

  let rawTerms = normalizeText(term).split(/\s+/).filter(Boolean);
  const stopWords = new Set([
    'de','do','da','dos','das','para','pra','por','com','como','em','no','na',
    'nos','nas','ao','aos','às','as','os','um','uma','uns','umas','foi','era',
    'ser','se','que','e','ou','a','o','ao','à','às','todo','toda','todos','todas'
  ]);
  const searchTerms = rawTerms.filter(w => {
    if (/^\d+$/.test(w)) return true;
    if (w.length < 3) return false;
    if (stopWords.has(w)) return false;
    return true;
  });
  if (searchTerms.length === 0) return;

  function termsAreNear(text, terms, maxDistance = 3) {
    const words = text.split(/\s+/);
    const positions = terms.map(t => {
      const re = new RegExp(`\\b${t}\\b`, 'i');
      return words.map((w, i) => re.test(w) ? i : -1).filter(i => i >= 0);
    });
    if (positions.some(arr => arr.length === 0)) return false;
    for (const i of positions[0]) {
      let ok = true;
      for (let k = 1; k < positions.length; k++) {
        const found = positions[k].some(j => Math.abs(j - i) <= maxDistance);
        if (!found) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  const allPaths=[];
  (MANIFEST?.categories||[]).forEach(c=>{
    (c.themes||[]).forEach(t=> allPaths.push(t.path));
  });
  if(allPaths.length===0){ toast('Nenhum tema disponível para busca','error'); return; }

  let results=[];

  for(const p of allPaths){
    try{
      const paths = Array.isArray(p) ? p : [p];
      for(const single of paths){
        let quizObj = null;
        if(/\.txt$/i.test(single)) quizObj = await loadTxtAsQuizFast(single);
        else if(/\.json$/i.test(single)) quizObj = await loadJSON(single);
        else if(/\.html?/i.test(single) || /^https?:\/\//i.test(single)) quizObj = await loadHtmlAsQuiz(single);
        if(!quizObj || !Array.isArray(quizObj.questions)) continue;

        quizObj.questions.forEach((q)=>{
          const normalizedQ   = normalizeText(String(q.q||'').replace(/<[^>]+>/g,'')); 
          const normalizedOpts= (q.options||[]).map(o => normalizeText(String(o || '')));
          const normalizedTags= (q.tags    || []).map(t => normalizeText(String(t || '')));

          const allTermsFound = searchTerms.every(st => {
            const re = /^\d+$/.test(st)
              ? new RegExp(`\\b${st}\\b`, 'g')
              : new RegExp(`\\b${st}\\b`, 'gi');
            const inQ   = re.test(normalizedQ);
            const inOpt = normalizedOpts.some(optText => re.test(optText));
            const inTag = normalizedTags.some(tagText => re.test(tagText));
            return inQ || inOpt || inTag;
          });

          let nearEnough = true;
          if (searchTerms.length > 1) {
            const textBlob = [normalizedQ, ...normalizedOpts, ...normalizedTags].join(' ');
            nearEnough = termsAreNear(textBlob, searchTerms, 3);
          }

          if(allTermsFound && nearEnough){
            const clone = JSON.parse(JSON.stringify(q));
            clone.__origin = { path:single };
            searchTerms.forEach(st => {
              const re = new RegExp('(' + st.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
              clone.q = String(clone.q).replace(re, '<mark class="hl">$1</mark>');
              clone.options = (clone.options || []).map(o => String(o).replace(re, '<mark class="hl">$1</mark>'));
            });
            results.push(clone);
          }
        });
      }
    }catch{}
  }

  if(results.length===0){
    toast('Nada encontrado na busca global','warn',2400);
    return;
  }

  const virtual = {
    meta: {
      title: `Busca global: "${term}"`,
      category: 'busca',
      theme: 'global',
      shuffle: {questions:false, options:true},
      persist: true,
      outroMessage: `${results.length} resultados encontrados na busca global.`
    },
    questions: results
  };
  const synth = `search://global?term=${encodeURIComponent(term)}`;
  await loadVirtualQuiz(virtual, synth, true);
  toast(`Busca global: ${results.length} questões`, 'info', 2200);
}

/* ===== GitHub manifest index ===== */
async function buildManifestFromGitHub(){
  if(!CONFIG.useGitHubIndexer) return null;
  const {owner, repo} = guessOwnerRepo();
  if(!owner || !repo) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(CONFIG.branch)}?recursive=1`;
  try{
    const r = await fetch(url, {headers:{'Accept':'application/vnd.github+json'}});
    if(!r.ok) return null;
    const data = await r.json();
    if(!data || !Array.isArray(data.tree)) return null;
    const root = (CONFIG.dataDir + '/').toLowerCase();
    const nodes = data.tree.filter(n =>
      n.type==='blob' &&
      n.path.toLowerCase().startsWith(root) &&
      (/\.(txt|html?|json)$/i).test(n.path)
    );

    const catMap = new Map();
    const groupMap = new Map();

    for (const node of nodes) {
      const parts = node.path.split('/'); // data / disciplina / materia / arquivo
      if (parts.length < 4) continue;
      const disciplinaId = parts[1];
      const materiaId    = parts[2];
      const file = parts[3];
      const themeIdRaw = file.replace(/\.(txt|html?|json)$/i, '');
      const baseId = themeIdRaw.replace(/\d+$/,'');

      const catId = disciplinaId;
      const cat = catMap.get(catId) || { id: catId, name: prettyName(catId), themes: [] };
      catMap.set(catId, cat);

      const key = `${materiaId}/${baseId}`;
      const byCat = groupMap.get(catId) || new Map();
      const arr = byCat.get(key) || [];
      arr.push(node.path);
      byCat.set(key, arr);
      groupMap.set(catId, byCat);
    }

    for(const [catId, byCat] of groupMap.entries()){
      const cat = catMap.get(catId);
      for(const [key, paths] of byCat.entries()){
        const [materiaId, baseId] = key.split('/');
        const id = `${materiaId}-${baseId}`;
        const name = `${prettyName(materiaId)} · ${prettyName(baseId)}`;
        cat.themes.push({ id, name, path: paths.sort((a,b)=> a.localeCompare(b,'pt-BR')) });
      }
      cat.themes.sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'));
    }

    const categories = Array.from(catMap.values())
      .sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'));

    if(categories.length===0) return null;
    return {
      title: 'MeuJus',
      labels: 'labels/pt-BR.json',
      shuffleDefault: {questions:false, options:true},
      persistDefault: true,
      outro: { message: 'Obrigado por participar.' },
      categories
    };
  }catch{
    return null;
  }
}

/* ===== atalhos ===== */
window.addEventListener('keydown',(e)=>{
  if(screenQuiz.classList.contains('hide')) return;
  if(e.key>='1'&&e.key<='9'){
    const idx=parseInt(e.key,10)-1; const btn=optionsEl.querySelectorAll('.opt')[idx]; if(btn) btn.click();
  } else if(e.key==='Enter'||e.key==='ArrowRight'){
    if(I===ORDER.length-1) finish(); else next();
  } else if(e.key==='ArrowLeft'){ prev(); }
});
window.addEventListener('beforeunload', persist);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') persist(); });

/* ===== HISTÓRICO GLOBAL ===== */
const LETTERS = ['A','B','C','D','E','F','G'];
const GLOBAL_HIST_KEY = 'meujus:hist';
let HISTORY = [];

function histKey(){ return GLOBAL_HIST_KEY; }
function loadHistory(){ HISTORY = lsGet(histKey(), []); }
function saveHistory(){ lsSet(histKey(), HISTORY); }
function pathKey(p){ return typeof p==='string' ? p : JSON.stringify(p||''); }

function upsertHistoryItem({ idx, chosenIdx, correctIdx, quizTitle, path, preview }){
  const number = idx + 1;
  const chosenLetter  = typeof chosenIdx  === 'number' ? LETTERS[chosenIdx]  || '?' : '∅';
  const correctLetter = typeof correctIdx === 'number' ? LETTERS[correctIdx] || '?' : '∅';
  const isCorrect = (typeof chosenIdx==='number' && chosenIdx===correctIdx);
  const key = pathKey(path) + '::' + idx;

  const rec = { key, path, idx, number, chosenIdx, chosenLetter, correctIdx, correctLetter, isCorrect, quizTitle, preview };
  const pos = HISTORY.findIndex(h => h.key === key);
  if(pos>=0) HISTORY[pos] = { ...HISTORY[pos], ...rec };
  else {
    HISTORY.push(rec);
    if(HISTORY.length>100) HISTORY = HISTORY.slice(-100);
  }
  saveHistory();
  if(PANEL_OPEN) renderSideHistory(false);
}

/* ===== PAINEL LATERAL ===== */
let PANEL_OPEN = false;
let panelEl = null, backdropEl = null;
let SP_HIST_PAGE = 1;

function setupHeaderActions(){
  const brand = document.querySelector('.brand') || document.getElementById('appTitle');

  let gear = document.getElementById('btnGear');
  if(!gear){
    gear = document.createElement('button');
    gear.id = 'btnGear';
    gear.type = 'button';
    gear.className = 'btn icon gear-btn';
    gear.setAttribute('aria-label','Abrir painel');
    gear.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
           fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/>
        <path d="M19.8 13.5a8 8 0 0 0 0-3l2-1.2-2-3.3-2.3.5a8 8 0 0 0-2.1-1.2l-.4-2.3H9l-.4 2.3a8 8 0 0 0-2.1 1.2L4.2 6 2.2 9.3l2 1.2a8 8 0 0 0 0 3l-2 1.2 2 3.3 2.3-.5a8 8 0 0 0 2.1 1.2l2.3.5 2-3.3-2-1.2Z"/>
      </svg>`;
    const header = document.querySelector('header.site') || brand?.parentElement;
    if(header){
      header.style.display='flex';
      header.style.alignItems='center';
      header.style.justifyContent='space-between';
      header.appendChild(gear);
    }
  }
  gear.onclick = ()=> toggleSidePanel(true);
}

function ensureSidePanel(){
  if(panelEl) return panelEl;
  backdropEl = document.createElement('div');
  backdropEl.id = 'sidepanel-backdrop';
  backdropEl.className = 'sidepanel-backdrop hide';
  backdropEl.addEventListener('click', ()=> toggleSidePanel(false));

  panelEl = document.createElement('aside');
  panelEl.id = 'sidepanel';
  panelEl.className = 'sidepanel hide';
  panelEl.innerHTML = `
    <div class="sp-head">
      <strong>Menu</strong>
      <button type="button" class="sp-close" aria-label="Fechar">×</button>
    </div>
    <nav class="sp-sections">
      <a class="sp-icon" href="https://instagram.com/" target="_blank" rel="noopener" aria-label="Instagram">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm5 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm6-1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>
        <span>@seuPerfil</span>
      </a>
      <a class="sp-icon" href="mailto:contato@exemplo.com" aria-label="Email">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M2 6h20v12H2z"/><path d="m2 6 10 7L22 6"/></svg>
        <span>contato@exemplo.com</span>
      </a>

      <button class="sp-accordion" data-target="#sp-books">Dicas de Livros</button>
      <div id="sp-books" class="sp-panel">
        <ul class="sp-list">
          <li><a href="https://exemplo.com/livro1" target="_blank" rel="noopener">Livro 1</a></li>
          <li><a href="https://exemplo.com/livro2" target="_blank" rel="noopener">Livro 2</a></li>
        </ul>
      </div>

      <button class="sp-accordion" data-target="#sp-about">Sobre</button>
      <div id="sp-about" class="sp-panel">
        <p>MeuJus organiza questões, histórico e filtros para estudo eficiente.</p>
      </div>

      <button class="sp-accordion" data-target="#sp-history">Histórico</button>
      <div id="sp-history" class="sp-panel">
        <div id="sp-hist-summary" class="sp-hist-summary"></div>
        <div id="sp-hist-cards" class="sp-hist-cards"></div>
        <button id="sp-hist-more" class="btn ghost sm" style="width:100%;margin-top:8px;">Carregar mais</button>
      </div>
    </nav>
  `;
  document.body.appendChild(backdropEl);
  document.body.appendChild(panelEl);

  panelEl.querySelector('.sp-close').onclick = ()=> toggleSidePanel(false);
  panelEl.addEventListener('click', e=>{
    const acc = e.target.closest('.sp-accordion');
    if(acc){
      const sel = acc.getAttribute('data-target');
      const tgt = sel && panelEl.querySelector(sel);
      if(tgt){ tgt.classList.toggle('open'); }
      return;
    }
    const link = e.target.closest('a[href]');
    if(link){ toggleSidePanel(false); }
  });

  document.addEventListener('keydown', (e)=>{ if(PANEL_OPEN && e.key==='Escape') toggleSidePanel(false); });

  const moreBtn = panelEl.querySelector('#sp-hist-more');
  moreBtn.onclick = ()=> renderSideHistory(true);

  return panelEl;
}
function toggleSidePanel(open){
  ensureSidePanel();
  PANEL_OPEN = open;
  panelEl.classList.toggle('hide', !open);
  backdropEl.classList.toggle('hide', !open);
  if(open){ renderSideHistory(false); }
}

function histSlice(){
  const items = HISTORY.slice(-100);
  const perPage = 10;
  return items.slice(0, SP_HIST_PAGE * perPage);
}
function renderSideHistory(loadMore){
  if(loadMore) SP_HIST_PAGE = Math.min(SP_HIST_PAGE + 1, 10);
  else SP_HIST_PAGE = 1;

  const sumEl = panelEl.querySelector('#sp-hist-summary');
  const cardsEl = panelEl.querySelector('#sp-hist-cards');
  const moreBtn = panelEl.querySelector('#sp-hist-more');

  const list = HISTORY.slice(-100);
  const total = list.length;
  const certas = list.filter(h=>h.isCorrect).length;
  const erradas = total - certas;

  sumEl.textContent = total ? `${total} questões · ${certas} certas · ${erradas} erradas` : 'Sem histórico';

  const rows = histSlice();
  cardsEl.innerHTML = '';
  let lastTitle = '';
  rows.forEach(h=>{
    if(h.quizTitle !== lastTitle){
      const sep = document.createElement('div');
      sep.className = 'sp-line';
      sep.innerHTML = `<div class="sp-group-title">${h.quizTitle}</div>`;
      cardsEl.appendChild(sep);
      lastTitle = h.quizTitle;
    }
    const line = document.createElement('button');
    line.type='button';
    line.className='sp-item';
    const status = h.isCorrect ? `✓ ${h.chosenLetter}` : `✖ ${h.chosenLetter} → ${h.correctLetter}`;
    const pv = (h.preview||'').replace(/\s+/g,' ').trim();
    line.innerHTML = `
      <span class="sp-left">#${h.number}</span>
      <span class="sp-mid">${htmlEscape(pv)}</span>
      <span class="sp-right">${status}</span>
    `;
    line.onclick = ()=> openHistoryItem(h);
    cardsEl.appendChild(line);

    const hr = document.createElement('div');
    hr.className='sp-sep';
    cardsEl.appendChild(hr);
  });

  const shown = histSlice().length;
  moreBtn.style.display = (shown < Math.min(100, HISTORY.length)) ? 'block' : 'none';
}
async function openHistoryItem(h){
  const targetPath = h.path;
  const currentPathKey = pathKey(KEY?.path);
  if(pathKey(targetPath) !== currentPathKey){
    await loadQuiz(targetPath,false,false);
  }
  const pos = ORDER.indexOf(h.idx);
  if(pos>=0){ I = pos; render(); }
  try{ history.replaceState(null,'',`#q=${(pos>=0?pos+1:1)}`); }catch{}
  toggleSidePanel(false);
}
