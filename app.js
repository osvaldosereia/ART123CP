/* app.js — com suporte a TAGS clicáveis e formato com * ** *** **** ----- */

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
const show = (node, flag) => node.classList.toggle('hide', !flag);
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
function lsGet(k, def=null){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch{ return def; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function htmlEscape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function normalizeText(str) {
  if (!str) return '';
  return String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ç/g, 'c');
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
const btnAI = document.getElementById('btnAI');

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

/* ===== TAGS: área logo abaixo da busca ===== */
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
const DEFAULT_LABELS = { start:'Começar', next:'Próximo', prev:'Anterior', retry:'Refazer', home:'Início', category:'Categoria', theme:'Tema', result:'Resultado' };
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
}

/* ===== parser TXT novo formato * ** *** **** ----- ===== */
function parseTxtQuestions(raw) {
  const text = String(raw || '').replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n-{5,}\n/g).map(b => b.trim()).filter(Boolean);
  const qs = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    let enunciado = [];
    let opcoes = [];
    let gabarito = null;
    let tags = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^\*\s(?!\*)/.test(trimmed)) { // * enunciado
        enunciado.push(trimmed.replace(/^\*\s*/, ''));
        continue;
      }
      if (/^\*\*\s*\(?[A-E]\)/i.test(trimmed)) { // ** alternativas
        const optMatch = trimmed.match(/^\*\*\s*\(?([A-E])\)\s*(.+)$/i);
        if (optMatch) opcoes.push(optMatch[2].trim());
        continue;
      }
      if (/^\*\*\*\s*Gabarito\s*:/i.test(trimmed)) { // *** gabarito
        const gMatch = trimmed.match(/^\*\*\*\s*Gabarito\s*:\s*([A-E])/i);
        if (gMatch) gabarito = gMatch[1].toUpperCase();
        continue;
      }
      if (/^\*\*\*\*/.test(trimmed)) { // **** tags
        const tagLine = trimmed.replace(/^\*\*\*\*\s*/, '');
        tags = tagLine.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        continue;
      }
    }

    if (enunciado.length === 0 || opcoes.length === 0) continue;
    const answerMap = {A:0,B:1,C:2,D:3,E:4};
    const hasAnswer = gabarito && answerMap[gabarito]!=null;

    const qObj = {
      type:'multiple',
      q: formatParagraphs(enunciado.join('\n')),
      options: opcoes,
      answer: hasAnswer ? answerMap[gabarito] : null,
      explanation:'',
      tags
    };
    qs.push(qObj);
  }
  return qs;
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
  // tenta usar o indexador GitHub
  MANIFEST = await buildManifestFromGitHub();

  // se falhar, usa o fallback local fixo
  if (!MANIFEST) {
    MANIFEST = {
      title: 'MeuJus',
      categories: [{
        id: 'OAB-2023',
        name: 'OAB-2023',
        themes: [
          {
            id: 'FGV - Exame da Ordem Unificado XXXVIII',
            name: 'FGV - Exame da Ordem Unificado XXXVIII',
            path: 'data/OAB-2023/FGV - Exame da Ordem Unificado XXXVIII.TXT'
          }
        ]
      }],
      shuffleDefault: { questions: false, options: true },
      persistDefault: true,
      outro: { message: 'Obrigado por participar.' }
    };
  }

  /* ===== interface ===== */
  state.textContent = 'pronto';
  appTitle.textContent = MANIFEST?.title || 'MeuJus';
  applyLabels();

  selCategory.innerHTML = '';
  (MANIFEST?.categories || []).forEach((c, idx) => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name || c.id;
    if (idx === 0) o.selected = true;
    selCategory.appendChild(o);
  });
  updateThemes();

  /* ===== eventos ===== */
  selCategory.addEventListener('change', updateThemes);
  btnStart.addEventListener('click', startQuizFromSelection);
  btnPrev.addEventListener('click', prev);
  btnNext.addEventListener('click', next);
  btnAI.addEventListener('click', openGoogleAI);

  btnGlobal.addEventListener('click', () => globalSearchAndOpen(txtGlobal.value || ''));
  txtGlobal.addEventListener('keydown', e => { if (e.key === 'Enter') btnGlobal.click(); });

  btnSearch.addEventListener('click', () => applyFilter(txtSearch.value || ''));
  btnClearSearch.addEventListener('click', clearFilter);
  txtSearch.addEventListener('keydown', e => { if (e.key === 'Enter') btnSearch.click(); });

  const goHome = () => {
    resetState();
    show(screenIntro, true);
    show(screenQuiz, false);
    show(screenResult, false);
    state.textContent = 'pronto';
  };
  btnGoHome.addEventListener('click', goHome);
  btnHome.addEventListener('click', goHome);
  appTitle.addEventListener('click', goHome);

  btnRetry.addEventListener('click', () => { loadQuiz(KEY?.path, true); toast('Quiz reiniciado', 'info'); });

  const last = lsGet('quiz:last');
  if (last && last.path) {
    btnResume.classList.remove('hide');
    btnResume.addEventListener('click', async () => { KEY = last; await loadQuiz(last.path, false, true); });
    if (AUTO_RESUME) { KEY = last; await loadQuiz(last.path, false, true); return; }
  }

  window.addEventListener('offline', () => toast('Sem conexão. Usando cache local', 'warn', 3000));
  window.addEventListener('online', () => toast('Conexão restabelecida', 'success', 1800));
}




/* ===== seleção ===== */
function applyLabels(){
  document.querySelector('label[for="selCategory"]').textContent = LABELS.category||'Categoria';
  document.querySelector('label[for="selTheme"]').textContent = LABELS.theme||'Tema';
  btnStart.textContent = LABELS.start||'Começar';
  btnPrev.textContent = LABELS.prev||'Anterior';
  btnNext.textContent = LABELS.next||'Próximo';
  document.getElementById('resultTitle').textContent = LABELS.result||'Resultado';
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

/* ===== loadQuiz ===== */
async function loadQuiz(path,fresh=false,tryRestore=false){
  state.textContent='carregando';
  let qz=null;
  if(/\.txt$/i.test(path)) qz=await loadTxtAsQuiz(path);
  else if(/\.json$/i.test(path)) qz=await loadJSON(path);
  if(!qz||!Array.isArray(qz.questions)){
    toast('Falha ao carregar o quiz','error',3000); state.textContent='erro'; return;
  }
  QUIZ=qz; KEY={path,key:`quiz:${path}`};
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
  bar.style.width = Math.round((I) / progBase * 100) + '%';
  footLeft.textContent = `Pergunta ${I + 1}/${denom}`;
  const filterBadge = TAG_FILTER ? ` · tag: #${TAG_FILTER}` : '';
  footRight.textContent = FILTER
    ? `${answered}/${denom} respondidas · filtro: "${FILTER.term}" (${denom})${filterBadge}`
    : `${answered}/${denom} respondidas${filterBadge}`;

  const q = current();
  const categoryText = QUIZ?.meta?.category || 'Geral';
  const themeText = QUIZ?.meta?.title || 'Quiz';

  /* ===== palavras-chave (tags) logo abaixo da busca ===== */
  const tagsArea = document.getElementById('tagsBar');
  if (tagsArea) {
    tagsArea.innerHTML = '';
    if (Array.isArray(q.tags) && q.tags.length > 0) {
      q.tags.forEach(t => {
        const a = document.createElement('a');
        a.href = '#tag:' + encodeURIComponent(t);
        a.textContent = '#' + t;
        a.className = 'tag';
        a.addEventListener('click', ev => { ev.preventDefault(); onTagClick(t); });
        tagsArea.appendChild(a);
      });
    }
  }

  /* ===== enunciado ===== */
  questionEl.innerHTML = `
    <div style="font-size:12px;font-weight:400;color:var(--muted);letter-spacing:.2px;">
      ${htmlEscape(categoryText)} | ${htmlEscape(themeText)}
    </div>
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:10px 0;">
    ${q.q}
  `;

  optionsEl.innerHTML = '';
  explainEl.classList.add('hide');
  show(btnAI, false);

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

/* ===== renderização das opções ===== */
function renderOptions(texts, onPick, origIdxs = null) {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  texts.forEach((txt, idx) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.dataset.idx = idx;
    if (origIdxs) b.dataset.origIdx = String(origIdxs[idx]);
    const label = labels[idx] ? `<strong>${labels[idx]})</strong> ` : '';
    const safe = htmlEscape(String(txt || ''))
      .replace(/\n{2,}/g, '\n\n')
      .split(/\n{2,}/)
      .map(p => `<p style="margin:0">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
    b.innerHTML = `${label}${safe}`;
    b.addEventListener('click', () => onPick(idx));
    optionsEl.appendChild(b);
  });
}

/* ===== seleção e exibição do gabarito ===== */
function select(value) {
  if (isLocked()) return;
  CHOSEN[ORDER[I]] = value;
  lockAndExplain(value);
  persist();
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
    const chosenBtn = buttons.find(
      b => parseInt(b.dataset.origIdx ?? '-1', 10) === value
    );
    correct = typeof value === 'number' && value === answerIdx;
    if (!correct && chosenBtn) chosenBtn.classList.add('wrong');
  }

  // Mostrar gabarito sempre
  // Mostrar gabarito sempre
const gLetter = ['A','B','C','D','E'][q.answer] || '?';
const gText = q.options[q.answer] || '';
explainEl.innerHTML = `<div style="font-size:14px"><strong>Gabarito: ${gLetter})</strong> ${htmlEscape(gText)}</div>`;
explainEl.classList.remove('hide');

// ↓ mostre o botão IA após responder
show(btnAI, true);

}

/* ===== corrigido: não duplicar opções ao voltar ===== */
function markLocked() {
  const q = current();
  const type = q.type || 'multiple';
  const val = CHOSEN[ORDER[I]];
  if (val === null) return;
  optionsEl.innerHTML = ''; // limpa antes de recriar
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

/* ===== AI ===== */
function openGoogleAI(){
  const q=current(); if(!q) return;
  const prompt = 'VProfessor, por favor fundamente a alternativa correta e as incorretas. Enunciado: '
    + String((q && q.q) || '').replace(/<[^>]+>/g,'')
    + ' | Opções: '
    + (q && q.type === 'vf'
        ? 'Verdadeiro | Falso'
        : (Array.isArray(q && q.options) ? q.options.map((t,i)=> (i+1)+') '+t).join(' | ') : '')
      )
    + ' | Alternativa correta: '
    + (q && q.type === 'vf'
        ? (q && q.answer ? 'Verdadeiro' : 'Falso')
        : (Array.isArray(q && q.options) && typeof q.answer === 'number' ? q.options[q.answer] : '')
      );
  const url = 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(prompt);
  window.open(url, '_blank', 'noopener');
}

/* ===== filtros: texto + tag ===== */
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
function onTagClick(tag){
  TAG_FILTER = (TAG_FILTER === tag) ? null : tag;
  recalcOrderFromFilters();
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

/* ===== barra de tags ===== */
function renderTagBar(){
  if(tagsBarEl) tagsBarEl.innerHTML = '';
}

/* ===== busca global ===== */
async function globalSearchAndOpen(termRaw){
  const term = String(termRaw||'').trim();
  if(!term){ toast('Informe um termo para busca global','warn'); return; }

  const searchTerms = normalizeText(term).split(/\s+/).filter(Boolean);
  if (searchTerms.length === 0) return;

  const allPaths=[];
  (MANIFEST?.categories||[]).forEach(c=>{ (c.themes||[]).forEach(t=> allPaths.push(t.path)); });
  if(allPaths.length===0){ toast('Nenhum tema disponível para busca','error'); return; }

  state.textContent='buscando';
  let results=[];
  for(const p of allPaths){
    try{
      let quizObj = null;
      if(/\.txt$/i.test(p)) quizObj = await loadTxtAsQuiz(p);
      else if(/\.json$/i.test(p)) quizObj = await loadJSON(p);
      if(!quizObj || !Array.isArray(quizObj.questions)) continue;
      quizObj.questions.forEach((q)=>{
        const normalizedQ = normalizeText(String(q.q||'').replace(/<[^>]+>/g,''));
        const normalizedOpts = (q.options || []).map(o => normalizeText(String(o || '')));
        const allTermsFound = searchTerms.every(st => {
          const regex = new RegExp('\\b' + st + '\\b');
          const inQ = regex.test(normalizedQ);
          const inOpt = normalizedOpts.some(optText => regex.test(optText));
          return inQ || inOpt;
        });
        if(allTermsFound){
          const clone = JSON.parse(JSON.stringify(q));
          clone.__origin = { path:p };
          results.push(clone);
        }
      });
    }catch{}
  }

  if(results.length===0){ state.textContent='pronto'; toast('Nada encontrado na busca global','warn',2400); return; }

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
  const {owner, repo} = guessOwnerRepo();
  if(!owner || !repo) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(CONFIG.branch)}?recursive=1`;
  try{
    const r = await fetch(url, {headers:{'Accept':'application/vnd.github+json'}});
    if(!r.ok) return null;
    const data = await r.json();
    if(!data || !Array.isArray(data.tree)) return null;
    const nodes = data.tree.filter(n => n.type==='blob' && n.path.startsWith(CONFIG.dataDir+'/') && n.path.endsWith('.txt'));
    const catMap = new Map();
    for (const node of nodes) {
  const parts = node.path.split('/');
  if (parts.length < 2) continue;
  const catId = parts.slice(1, -1).join('/') || 'Geral';
  const file = parts[parts.length - 1];
  const themeId = file.replace(/\.txt$/i, '');
  const cat = catMap.get(catId) || { id: catId, name: catId, themes: [] };
  cat.themes.push({ id: themeId, name: themeId, path: node.path });
  catMap.set(catId, cat);
}

    const categories = Array.from(catMap.values())
      .map(c => ({...c, themes: c.themes.sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'))}))
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
