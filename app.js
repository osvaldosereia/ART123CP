/* app.js — quiz com TAGS, parser * ** *** **** -----, busca global, suporte a HTML Inertia (QConcursos)
   + agregação automática de múltiplos arquivos do mesmo tema (ex.: mutuo.html, mutuo1.html, mutuo2.html)
   + TAGS = “temas irmãos” da mesma matéria (exibe e troca de tema dentro da mesma pasta) */

const CONFIG = {
  useGitHubIndexer: true,
  owner: 'osvaldosereia',
  repo: 'ART123CP',
  branch: 'main',
  dataDir: 'data'
};
const AUTO_RESUME = true;

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

/* pretty names */
const SPECIAL_NAMES = new Map([
  ['direito-civil','Direito Civil'],
  ['contratos','Contratos'],
  ['mutuo','Mútuo']
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

  // mostra/oculta a barra conforme houver irmãos
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
const selTheme = document.getElementById('selTheme');
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

/* ===== labels ===== */
const DEFAULT_LABELS = { start:'Começar', next:'Próximo', prev:'Anterior', retry:'Refazer', home:'Início', category:'Disciplina', theme:'Tema', result:'Resultado' };
let LABELS = { ...DEFAULT_LABELS };

/* ===== estado ===== */
let MANIFEST = null, QUIZ = null, ORDER = [], CHOSEN = [], I = 0, KEY = null;
let FILTER = null;
let TAG_FILTER = null;
let TAG_INDEX = new Map();

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

/* ===== TAG helpers (internas por questão — mantido para busca global) ===== */
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
}

/* ===== sanitização básica de HTML ===== */
function sanitizeBasicHTML(html){
  if(!html) return '';
  let s = String(html);

  // remove blocos perigosos
  s = s.replace(/<(script|style|iframe|object|embed|meta|link)[\s\S]*?>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(script|style|iframe|object|embed|meta|link)[^>]*?>/gi, '');

  // permite tags básicas; remove atributos
  const allowed = ['b','strong','i','em','u','sup','sub','br','p','ul','ol','li','mark'];
  s = s.replace(/<([a-z0-9:-]+)(\s[^>]*)?>/gi, (m, tag)=>{
    tag = tag.toLowerCase();
    return allowed.includes(tag) ? `<${tag}>` : '';
  });
  s = s.replace(/<\/([a-z0-9:-]+)>/gi, (m, tag)=>{
    tag = tag.toLowerCase();
    return allowed.includes(tag) ? `</${tag}>` : '';
  });

  // normaliza quebras simples
  return s.replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

/* ===== parser TXT (* ** *** **** -----) ===== */
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
  const decoded = decodeHTMLEntities(attr);
  try{ return JSON.parse(decoded); }catch{ return null; }
}
// transforma HTML em texto simples preservando quebras
function plainText(html){
  if(!html) return '';
  let s = String(html)
    .replace(/\r\n?/g,'\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*p[^>]*>/gi, '');
  s = s.replace(/<[^>]+>/g, ''); // strip tags
  s = decodeHTMLEntities(s);
  return s.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function normalizeQCQuestion(q){
  const letters = Object.keys(q.alternatives||{}).sort(); // A..E
  const options = letters.map(L => sanitizeBasicHTML(q.alternatives[L])); // mantém HTML básico
  const letter = String(q.correct_answer||'').trim().toUpperCase();
  const answer = Math.max(0, letters.indexOf(letter));
  const metaTags = [];
  if(q.examining_board?.acronym) metaTags.push(q.examining_board.acronym.toLowerCase());
  if(q.institute?.acronym) metaTags.push(q.institute.acronym.toLowerCase());
  if(q.position) metaTags.push(String(q.position).toLowerCase());
  return {
    type: 'multiple',
    q: sanitizeBasicHTML(q.statement),     // mantém HTML básico
    options,
    answer: answer >= 0 ? answer : null,
    explanation: '',
    tags: metaTags
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

/* ===== carregamento ===== */
async function loadTxtAsQuiz(path){
  const raw = await fetchText(path);
  const questions = parseTxtQuestions(raw);
  const parts = path.split('/');
  const category = parts[1] || 'Geral';
  const file = (parts[parts.length-1]||'Quiz.txt').replace(/\.txt$/i,'');
  return {
    meta:{title:file,category,theme:file,shuffle:{questions:false,options:true},persist:true,outroMessage:''},
    questions
  };
}

/* ===== init ===== */
init();
async function init() {
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

  state.textContent = 'pronto';
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

  /* eventos */
  selCategory.addEventListener('change', updateThemes);
  btnStart.addEventListener('click', startQuizFromSelection);
  btnPrev.addEventListener('click', prev);
  btnNext.addEventListener('click', next);

  btnGlobal.addEventListener('click', () => globalSearchAndOpen(txtGlobal.value || ''));
  txtGlobal.addEventListener('keydown', e=>{ if(e.key==='Enter') btnGlobal.click(); });

  btnSearch.addEventListener('click', ()=> applyFilter(txtSearch.value||''));
  btnClearSearch.addEventListener('click', clearFilter);
  txtSearch.addEventListener('keydown', e=>{ if(e.key==='Enter') btnSearch.click(); });

  const goHome = ()=>{ resetState(); show(screenIntro,true); show(screenQuiz,false); show(screenResult,false); state.textContent='pronto'; };
  btnGoHome.addEventListener('click', goHome);
  btnHome.addEventListener('click', goHome);
  appTitle.addEventListener('click', goHome);

  btnRetry.addEventListener('click', ()=>{ loadQuiz(KEY?.path,true); toast('Quiz reiniciado','info'); });

  ensureAIMenu();

  const last=lsGet('quiz:last');
  if(last&&last.path){
    btnResume.classList.remove('hide');
    btnResume.addEventListener('click', async()=>{ KEY=last; await loadQuiz(last.path,false,true); });
    if(AUTO_RESUME){ KEY=last; await loadQuiz(last.path,false,true); return; }
  }

  window.addEventListener('offline', ()=>toast('Sem conexão. Usando cache local','warn',3000));
  window.addEventListener('online', ()=>toast('Conexão restabelecida','success',1800));
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
    prompt = 'Explique e fundamente a todas as alternativas do Enunciado: ' +
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
function updateThemes(){
  const catId=selCategory.value;
  const cat=(MANIFEST?.categories||[]).find(c=>c.id===catId)||{themes:[]};
  selTheme.innerHTML='';
  (cat.themes||[]).forEach((t,idx)=>{
    const o=document.createElement('option');
    o.value=t.id; o.textContent=(t.name||t.id).toUpperCase();
    if(idx===0) o.selected=true;
    selTheme.appendChild(o);
  });
}
function selectedPath(){
  const catId=selCategory.value;
  const cat=(MANIFEST?.categories||[]).find(c=>c.id===catId);
  const themeId=selTheme.value;
  const theme=(cat?.themes||[]).find(t=>t.id===themeId);
  return theme?.path||(catId&&themeId?`data/${catId}/${themeId}.txt`:null);
}
async function startQuizFromSelection(){ const path=selectedPath(); if(!path) return; await loadQuiz(path,true); }

function resetState(){
  QUIZ=null; ORDER=[]; CHOSEN=[]; I=0; KEY=null;
  FILTER=null; TAG_FILTER=null;
  explainEl.classList.add('hide'); btnClearSearch.classList.add('hide'); txtSearch.value='';
  tagsBarEl&&(tagsBarEl.innerHTML='');
  TAG_INDEX.clear();
}

/* ===== loadQuiz e loadVirtualQuiz ===== */
async function loadQuiz(path,fresh=false,tryRestore=false){
  state.textContent='carregando';
  let qz=null;

  // aceitar lista de caminhos e agregar
  if(Array.isArray(path)){
    const quizzes = [];
    for(const p of path){
      try{
        if(/\.txt$/i.test(p)) quizzes.push(await loadTxtAsQuiz(p));
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
  } else {
    if(/\.txt$/i.test(path)) qz=await loadTxtAsQuiz(path);
    else if(/\.json$/i.test(path)) qz=await loadJSON(path);
    else if(/\.html?/i.test(path) || /^https?:\/\//i.test(path)) qz=await loadHtmlAsQuiz(path);
  }

  if(!qz||!Array.isArray(qz.questions)){
    toast('Falha ao carregar o quiz','error',3000); state.textContent='erro'; return;
  }
  await loadVirtualQuiz(qz, path, fresh);
}
async function loadVirtualQuiz(quizObj, synthKey, fresh){
  QUIZ=quizObj; KEY={path:synthKey, key:`quiz:${JSON.stringify(synthKey)}`};
  buildTagIndex(QUIZ.questions);
  const total=QUIZ.questions.length;
  ORDER=[...Array(total).keys()];
  CHOSEN=new Array(total).fill(null);
  I=0; FILTER=null; TAG_FILTER=null;
  btnClearSearch.classList.add('hide');
  state.textContent='respondendo';
  show(screenIntro,false); show(screenQuiz,true); show(screenResult,false);
  render();
}

/* ===== render ===== */
function render(){
  const total = QUIZ.questions.length;
  const answered = ORDER.filter(idx => CHOSEN[idx] !== null).length;
  const denom = ORDER.length || total;
  const progBase = Math.max(1, denom - 1);
  const filterBadge = TAG_FILTER ? ` · tag: ${TAG_FILTER}` : '';

  bar.style.width = Math.round((I) / progBase * 100) + '%';
  footLeft.textContent = `Pergunta ${I + 1}/${denom}`;
  footRight.textContent = FILTER
    ? `${answered}/${denom} respondidas · filtro: "${FILTER.term}" (${denom})${filterBadge}`
    : `${answered}/${denom} respondidas${filterBadge}`;

  const q = current();
  const categoryText = QUIZ?.meta?.category || 'Geral';
  const themeText = QUIZ?.meta?.title || 'Quiz';

  /* TAGS = temas irmãos da mesma matéria */
  renderSiblingTags();

  /* enunciado */
  questionEl.innerHTML = `
    <div style="font-size:12px;font-weight:400;color:var(--muted);letter-spacing:.2px;">
      ${htmlEscape(categoryText)} | ${htmlEscape(themeText)}
    </div>
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:10px 0;">
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
    const opts = q.options.map((t, i) => ({ t, i }));
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
    const safe = String(txt||''); // já sanitizado quando vem do QConcursos

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

  let correct = false;
  if (type === 'vf') {
    correct = value === !!q.answer;
    buttons[q.answer ? 0 : 1].classList.add('correct');
    const chosenIdx = value ? 0 : 1;
    if (!correct) buttons[chosenIdx]?.classList.add('wrong');
  } else {
    const answerIdx = q.answer;
    buttons.forEach(b => {
      const origIdx = parseInt(b.dataset.origIdx ?? '-1', 10);
      if (origIdx === answerIdx) b.classList.add('correct');
    });
    const chosenBtn = buttons.find(b => parseInt(b.dataset.origIdx ?? '-1', 10) === value);
    correct = typeof value === 'number' && value === answerIdx;
    if (!correct && chosenBtn) chosenBtn.classList.add('wrong');
  }

  const gLetter = ['A','B','C','D','E','F','G'][q.answer] || '?';
  const gText = q.options[q.answer] || '';
  explainEl.innerHTML = `<div style="font-size:14px"><strong>Gabarito: ${gLetter})</strong> ${gText}</div>`;

  const aiMenu = document.getElementById('aiMenu');
  show(aiMenu, true);
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
  } else {
    const opts = q.options.map((t, i) => ({ t, i }));
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
    path: KEY.path,
    ts: Date.now()
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
    if((q.type||'multiple')==='vf'){ if(v===!!q.answer) ok++; }
    else if(typeof v==='number' && v===q.answer) ok++;
  }
  return {ok,total};
}
function finish(){
  const {ok,total}=score();
  const pct = total>0 ? Math.round(ok/total*100) : 0;
  resultScore.textContent=`${pct}% (${ok}/${total})`;
  resultMsg.textContent=QUIZ.meta?.outroMessage || MANIFEST?.outro?.message || '';
  state.textContent='concluído';
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

/* ===== barra de tags (placeholder) ===== */
function renderTagBar(){
  if(tagsBarEl) tagsBarEl.innerHTML = '';
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

  state.textContent='buscando';
  let results=[];

  for(const p of allPaths){
    try{
      const paths = Array.isArray(p) ? p : [p];
      for(const single of paths){
        let quizObj = null;
        if(/\.txt$/i.test(single)) quizObj = await loadTxtAsQuiz(single);
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
    state.textContent='pronto';
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

/* ===== GitHub manifest index (agregação de temas com sufixo numérico) ===== */
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
    const root = (CONFIG.dataDir + '/').toLowerCase(); // aceita Data/ ou data/
    const nodes = data.tree.filter(n =>
      n.type==='blob' &&
      n.path.toLowerCase().startsWith(root) &&
      (/\.(txt|html?|json)$/i).test(n.path)
    );

    const catMap = new Map(); // id => { id, name, themes: [] }
    const groupMap = new Map(); // catId => Map< materia/baseId , paths[] >

    for (const node of nodes) {
      const parts = node.path.split('/'); // data / disciplina / materia / arquivo
      if (parts.length < 4) continue;
      const disciplinaId = parts[1];
      const materiaId    = parts[2];
      const file = parts[3];
      const themeIdRaw = file.replace(/\.(txt|html?|json)$/i, '');
      const baseId = themeIdRaw.replace(/\d+$/,''); // remove sufixo numérico

      const catId = disciplinaId;
      const cat = catMap.get(catId) || { id: catId, name: prettyName(catId), themes: [] };
      catMap.set(catId, cat);

      const key = `${materiaId}/${baseId}`; // unicidade por matéria+tema
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

/* ===== atalhos e persistência ===== */
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
