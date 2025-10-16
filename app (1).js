/* app.js — com suporte a TAGS clicáveis que filtram como busca */

const CONFIG = {
  useGitHubIndexer: true,
  owner: null,
  repo: null,
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

/* ===== TAGS: barra logo abaixo dos botões ===== */
let tagsBarEl = document.getElementById('tagsBar');
(function ensureTagsBar(){
  if(tagsBarEl) return;
  const host = btnNext ? btnNext.parentElement : null;
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
let FILTER = null;          // filtro de texto
let TAG_FILTER = null;      // filtro de tag
let TAG_INDEX = new Map();  // tag -> [idx]

/* ===== fetch/embedded ===== */
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
function toTitleCaseKeep(str){
  return String(str||'').replace(/\.txt$/i,'').replace(/_/g,'_').trim();
}
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
    for(const node of nodes){
      const parts = node.path.split('/');
      if(parts.length < 3) continue;
      const catId = parts[1];
      const file = parts[parts.length-1];
      const themeId = file.replace(/\.txt$/i,'');
      const cat = catMap.get(catId) || { id: catId, name: catId, themes: [] };
      cat.themes.push({ id: themeId, name: themeId, path: node.path });
      catMap.set(catId, cat);
    }
    const categories = Array.from(catMap.values()).map(c => ({...c, themes: c.themes.sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'))})).sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'));
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
function formatParagraphs(s){
  const clean = String(s||'').replace(/\r\n?/g,'\n').replace(/[\u00A0\t]+/g,' ').replace(/\s+$/gm,'').trim();
  const parts = clean.split(/\n{2,}/).map(t=>t.trim()).filter(Boolean);
  return parts.map(p=>`<p>${htmlEscape(p)}</p>`).join('');
}

/* ===== TAGS helpers ===== */
function normTag(t){ return t.trim().replace(/^#+/,'').toLowerCase(); }
function parseTagLine(line){
  const str = String(line||'').trim();
  if(!str.startsWith('#')) return [];
  // aceita "#t1, #t2" ou "#t1 #t2"
  return str
    .split(/[,\s]+/)
    .map(x=>x.trim())
    .filter(x=>x.startsWith('#'))
    .map(x=>normTag(x))
    .filter(Boolean);
}
function tagChip(t){
  const a = document.createElement('a');
  a.href = '#tag:'+encodeURIComponent(t);
  a.className = 'tag';
  a.dataset.tag = t;
  a.textContent = '#'+t;
  a.addEventListener('click', (ev)=>{ ev.preventDefault(); onTagClick(t); });
  return a;
}
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

/* ===== parser TXT com tags ===== */
function parseTxtQuestions(raw){
  const text = String(raw||'').replace(/\uFEFF/g,'').replace(/\r\n?/g,'\n');
  const blocks = text.split(/\n-{3,}\n/g).map(b=>b.trim()).filter(Boolean);
  const qs = [];
  for(const blockRaw of blocks){
    let block = blockRaw.replace(/\[cite_start\]/gi,'').replace(/\[cite:[^\]]*\]/gi,'');
    // coleta tags: LINHA LOGO ABAIXO do Gabarito, separadas por vírgula, sem identificação
    const lines = block.split('\n');
    let tags = [];
    // acha índice do gabarito
    let gabIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*--\s*Gabarito\s*:/i.test(lines[i])) { gabIdx = i; break; }
    }
    // se existir, lê a próxima linha como lista de tags "a, b, c"
    if (gabIdx >= 0 && gabIdx + 1 < lines.length) {
      const tagLine = String(lines[gabIdx + 1] || '').trim();
      // ignora se parecer uma opção (- A) ou outro marcador (-- XXX)
      if (tagLine && !/^\s*-\s*\(?[A-E]\)/i.test(tagLine) && !/^\s*--\s*\w+/i.test(tagLine)) {
        tags = tagLine.split(',').map(s => s.trim()).filter(Boolean).map(s => normTag(s.replace(/^#+/, '')));
        // remove a linha das tags do bloco
        lines.splice(gabIdx + 1, 1);
      }
    }
    block = lines.join('\n');

    const gabLine = block.match(/--\s*Gabarito\s*:\s*([^\n]+)/i);
    let gabTxt = gabLine ? gabLine[1].trim() : '';
    let annulled = /\*/.test(gabTxt) || /anulad[oa]/i.test(gabTxt);
    const gabLetter = (gabTxt.match(/[A-E]/i)||[])[0]?.toUpperCase() || null;

    const optRegex = /^\s*-\s*\(?([A-E])\)\s*/m;
    const firstOptIdx = block.search(optRegex);
    if(firstOptIdx<0) continue;

    // enunciado: tudo antes da primeira opção
    const head = block.slice(0, firstOptIdx).replace(/^#\s*/,'').trim();
    if(!head) continue;

    function grabOpt(letter){
      const reStart = new RegExp(`^\\s*-\\s*\\(?${letter}\\)\\s*`, 'm');
      const m = reStart.exec(block); if(!m) return '';
      const start = m.index + m[0].length;
      const nextAnchors = ['A','B','C','D','E'].filter(l=>l!==letter).map(l=>{
        const r = new RegExp(`^\\s*-\\s*\\(?${l}\\)\\s*`, 'm');
        const x = r.exec(block); return x?x.index:null;
      }).filter(x=>x!=null).sort((a,b)=>a-b);
      const g = block.search(/\n\s*--\s*Gabarito\b/m);
      if(g>=0) nextAnchors.push(g);
      const end = nextAnchors.find(n=>n>start) ?? block.length;
      return block.slice(start, end).trim();
    }
    const A = grabOpt('A'), B = grabOpt('B'), C = grabOpt('C'), D = grabOpt('D'), E = grabOpt('E');
    const options = [A,B,C,D,E].filter(x=>x!=='').map(t=>t.replace(/\n{2,}/g,'\n\n'));
    if(options.length===0) continue;

    const answerMap = {A:0,B:1,C:2,D:3,E:4};
    const hasAnswer = !annulled && gabLetter && answerMap[gabLetter] != null;
    const qObj = {
      type:'multiple',
      q: formatParagraphs(head),
      options,
      answer: hasAnswer ? answerMap[gabLetter] : null,
      explanation: annulled ? 'Questão anulada.' : '',
      tags
    };
    if(annulled) qObj.annulled = true;
    qs.push(qObj);
  }
  return qs;
}

/* ===== carregamento de TXT/JSON ===== */
async function loadTxtAsQuiz(path){
  const raw = await fetchText(path);
  const questions = parseTxtQuestions(raw);
  const parts = path.split('/');
  const category = parts[1] || 'Geral';
  const file = (parts[parts.length-1]||'Quiz.txt').replace(/\.txt$/i,'');
  return {
    meta: {
      title: file,
      category: category,
      theme: file,
      shuffle: {questions:false, options:true},
      persist: true,
      outroMessage: ''
    },
    questions
  };
}

/* ===== init ===== */
init();
async function init(){
  if(CONFIG.useGitHubIndexer){
    const dyn = await buildManifestFromGitHub();
    if(dyn) MANIFEST = dyn;
  }
  if(!MANIFEST){
    const manifestFallback={
      title:'MeuJus',
      categories:[{id:'intro',name:'Introdução',themes:[{id:'basico',name:'Básico',path:'data/intro/basico.txt'}]}],
      shuffleDefault:{questions:false,options:true},
      persistDefault:true,
      outro:{message:'Obrigado por participar.'}
    };
    MANIFEST = await loadJSON('data/manifest.json', manifestFallback);
  }

  state.textContent='pronto';
  appTitle.textContent = MANIFEST?.title || 'MeuJus';
  try{ if(MANIFEST?.labels) LABELS={...DEFAULT_LABELS, ...(await loadJSON(MANIFEST.labels))}; }catch{}
  applyLabels();

  selCategory.innerHTML='';
  (MANIFEST?.categories||[]).forEach((c,idx)=>{
    const o=document.createElement('option');
    o.value=c.id;
    o.textContent=c.name||c.id;
    if(idx===0) o.selected=true;
    selCategory.appendChild(o);
  });
  updateThemes();

  selCategory.addEventListener('change', updateThemes);
  btnStart.addEventListener('click', startQuizFromSelection);
  btnPrev.addEventListener('click', prev);
  btnNext.addEventListener('click', next);
  btnAI.addEventListener('click', openGoogleAI);

  btnGlobal.addEventListener('click', ()=> globalSearchAndOpen(txtGlobal.value||''));
  txtGlobal.addEventListener('keydown', (e)=>{ if(e.key==='Enter') btnGlobal.click(); });

  btnSearch.addEventListener('click', ()=> applyFilter(txtSearch.value||''));
  btnClearSearch.addEventListener('click', clearFilter);
  txtSearch.addEventListener('keydown', (e)=>{ if(e.key==='Enter') btnSearch.click(); });

  const goHome = ()=>{ resetState(); show(screenIntro,true); show(screenQuiz,false); show(screenResult,false); state.textContent='pronto'; };
  btnGoHome.addEventListener('click', goHome);
  btnHome.addEventListener('click', goHome);
  appTitle.addEventListener('click', goHome);
  appTitle.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' ') goHome(); });

  btnRetry.addEventListener('click', ()=> { loadQuiz(KEY?.path, true); toast('Quiz reiniciado','info'); });

  const last = lsGet('quiz:last');
  if (last && last.path) {
    btnResume.classList.remove('hide');
    btnResume.addEventListener('click', async ()=>{ KEY = last; await loadQuiz(last.path, false, true); });
    if (AUTO_RESUME) { KEY = last; await loadQuiz(last.path, false, true); return; }
  }

  window.addEventListener('offline', ()=>toast('Sem conexão. Usando cache local','warn',3000));
  window.addEventListener('online',  ()=>toast('Conexão restabelecida','success',1800));
}

/* ===== labels ===== */
function applyLabels(){
  document.querySelector('label[for="selCategory"]').textContent = LABELS.category||'Categoria';
  document.querySelector('label[for="selTheme"]').textContent = LABELS.theme||'Tema';
  btnStart.textContent = LABELS.start||'Começar';
  btnPrev.textContent = LABELS.prev||'Anterior';
  btnNext.textContent = LABELS.next||'Próximo';
  document.getElementById('resultTitle').textContent = LABELS.result||'Resultado';
  btnRetry.textContent = LABELS.retry||'Refazer';
  btnHome.textContent = LABELS.home||'Início';
  const h = document.getElementById('btnGoHome'); if(h) h.textContent = LABELS.home||'Início';
}

/* ===== seleção ===== */
function updateThemes(){
  const catId = selCategory.value;
  const cat = (MANIFEST?.categories||[]).find(c=>c.id===catId) || {themes:[]};
  selTheme.innerHTML='';
  (cat.themes||[]).forEach((t,idx)=>{
    const o=document.createElement('option');
    o.value=t.id;
    o.textContent=(t.name||t.id).toLocaleUpperCase('pt-BR');
    if(idx===0) o.selected=true;
    selTheme.appendChild(o);
  });
}
function selectedPath(){
  const catId=selCategory.value;
  const cat=(MANIFEST?.categories||[]).find(c=>c.id===catId);
  const themeId=selTheme.value;
  const theme=(cat?.themes||[]).find(t=>t.id===themeId);
  return theme?.path || (catId&&themeId ? `data/${catId}/${themeId}.txt`: null);
}
async function startQuizFromSelection(){ const path=selectedPath(); if(!path) return; await loadQuiz(path, true); }

/* ===== reset/load ===== */
function resetState(){
  QUIZ=null; ORDER=[]; CHOSEN=[]; I=0; KEY=null;
  FILTER=null; TAG_FILTER=null;
  explainEl.classList.add('hide'); btnClearSearch.classList.add('hide'); txtSearch.value='';
  tagsBarEl && (tagsBarEl.innerHTML='');
  TAG_INDEX.clear();
}
async function loadQuiz(path, fresh=false, tryRestore=false){
  state.textContent='carregando';
  let qz=null;
  if(/\.txt$/i.test(path)) qz = await loadTxtAsQuiz(path);
  else if(/\.json$/i.test(path)) qz = await loadJSON(path);

  if(!qz || !Array.isArray(qz.questions)){
    alert('Quiz não encontrado: '+path);
    state.textContent='erro';
    toast('Falha ao carregar o quiz','error',3000);
    return;
  }
  QUIZ=qz; KEY={path, key:`quiz:${path}`};

  try{ if(qz.labels){ LABELS={...LABELS, ...(await loadJSON(qz.labels))}; applyLabels(); } }catch{}

  const total=(qz.questions||[]).length;
  let saved = tryRestore ? lsGet(KEY.key) : null;

  ORDER=[...Array(total).keys()];
  CHOSEN=new Array(total).fill(null);
  I=0;
  FILTER=null; TAG_FILTER=null; btnClearSearch.classList.add('hide');

  if(!fresh && saved && saved.quizLen===total){
    if(Array.isArray(saved.order) && saved.order.length>0) ORDER = saved.order;
    if(Array.isArray(saved.chosen)) CHOSEN = saved.chosen;
    I = clamp(saved.i,0,Math.max(0,ORDER.length-1));
    FILTER = saved.filter || null;
    TAG_FILTER = saved.tag || null;
    if(FILTER) btnClearSearch.classList.remove('hide');
  }

  buildTagIndex(QUIZ.questions);
  renderTagBar();

  state.textContent='respondendo';
  show(screenIntro,false); show(screenQuiz,true); show(screenResult,false);
  toast('Quiz carregado','info');
  if(!fresh && saved) toast(`Progresso restaurado na questão ${I+1}/${ORDER.length||total}`,'success',2200);
  render();
}
async function loadVirtualQuiz(quizObj, syntheticPath, fresh=true){
  state.textContent='carregando';
  QUIZ = quizObj;
  KEY = { path: syntheticPath, key: `quiz:${syntheticPath}` };

  const total = QUIZ.questions.length;
  let saved = lsGet(KEY.key);

  ORDER = [...Array(total).keys()];
  CHOSEN = new Array(total).fill(null);
  I = 0;
  FILTER = null; TAG_FILTER = null; btnClearSearch.classList.add('hide');

  if(!fresh && saved && saved.quizLen===total){
    if(Array.isArray(saved.order) && saved.order.length>0) ORDER = saved.order;
    if(Array.isArray(saved.chosen)) CHOSEN = saved.chosen;
    I = clamp(saved.i,0,Math.max(0,ORDER.length-1));
    FILTER = saved.filter || null;
    TAG_FILTER = saved.tag || null;
    if(FILTER) btnClearSearch.classList.remove('hide');
  }

  buildTagIndex(QUIZ.questions);
  renderTagBar();

  state.textContent='respondendo';
  show(screenIntro,false); show(screenQuiz,true); show(screenResult,false);
  render();
}

/* ===== persist ===== */
function current(){ return QUIZ.questions[ ORDER[I] ]; }
function persist(){
  const persistFlag=QUIZ?.meta?.persist ?? MANIFEST?.persistDefault ?? true;
  if(!persistFlag||!KEY) return;
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

/* ===== render ===== */
function render(){
  const total=QUIZ.questions.length;
  const answered=ORDER.filter(idx => CHOSEN[idx]!==null).length;
  const denom = ORDER.length || total;
  const progBase = Math.max(1, denom-1);
  bar.style.width = Math.round((I)/progBase*100) + '%';
  footLeft.textContent = `Pergunta ${I+1}/${denom}`;
  const filterBadge = TAG_FILTER ? ` · tag: #${TAG_FILTER}` : '';
  footRight.textContent = FILTER
    ? `${answered}/${denom} respondidas · filtro: "${FILTER.term}" (${denom})${filterBadge}`
    : `${answered}/${denom} respondidas${filterBadge}`;

  const q=current();
  const categoryText = QUIZ?.meta?.category || 'Geral';
  const themeText = QUIZ?.meta?.title || 'Quiz';
  questionEl.innerHTML = `
    <div style="font-size: 12px; font-weight: 400; color: var(--muted); text-transform: none; letter-spacing: .2px;">
      ${htmlEscape(categoryText)} | ${htmlEscape(themeText)}
    </div>
    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 10px 0;">
    ${q.q}
  `;

  // tags inline logo abaixo do enunciado (links simples, sem chips)
  (function renderInlineTags(){
    const qcur = q;
    const has = Array.isArray(qcur.tags) && qcur.tags.length > 0;
    if(!has) return;
    const wrap = document.createElement('div');
    wrap.className = 'tags-inline';
    wrap.setAttribute('aria-label','Tags');
    wrap.style.marginTop = '6px';
    wrap.style.fontSize = '12px';
    wrap.style.color = 'var(--muted)';
    wrap.innerHTML = qcur.tags.map(t => `<a href="#tag:${encodeURIComponent(t)}" data-tag="${t}" class="tag-inline" style="text-decoration: underline;">${htmlEscape(t)}</a>`).join(', ');
    questionEl.appendChild(wrap);
    wrap.querySelectorAll('a[data-tag]').forEach(a => {
      a.addEventListener('click', (ev)=>{ ev.preventDefault(); onTagClick(a.dataset.tag); });
    });
  })();

  optionsEl.innerHTML='';
  explainEl.classList.add('hide');
  show(btnAI, false);

  const type=q.type||'multiple';
  if(type==='vf'){
    renderOptions(['Verdadeiro','Falso'], (idx)=> select(idx===0), [0,1]);
  } else {
    const opts=q.options.map((t,i)=>({t:i!=null?String(t):'',i}));
    const shOpts = opts;
    renderOptions(shOpts.map(o=>o.t), (idx)=> select(shOpts[idx].i), shOpts.map(o=>o.i));
  }

  btnPrev.disabled = I===0;
  btnNext.textContent = I < denom-1 ? (LABELS.next||'Próximo') : 'Finalizar';

  if (CHOSEN[ ORDER[I] ] !== null) markLocked();

  renderTagBar(getVisibleQuestions());
  persist();
}
function renderOptions(texts, onPick, origIdxs=null){
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  texts.forEach((txt, idx)=>{
    const b=document.createElement('button');
    b.className='opt';
    b.dataset.idx=idx;
    if(origIdxs) b.dataset.origIdx=String(origIdxs[idx]);
    const label = labels[idx] ? `<strong>${labels[idx]})</strong> ` : '';
    const safe = htmlEscape(String(txt||'')).replace(/\n{2,}/g,'\n\n').split(/\n{2,}/).map(p=>`<p style="margin:0">${p.replace(/\n/g,'<br>')}</p>`).join('');
    b.innerHTML = `${label}${safe}`;
    b.addEventListener('click', ()=> onPick(idx));
    optionsEl.appendChild(b);
  });
}
function isLocked(){ return optionsEl.querySelector('.correct, .wrong') != null; }
function select(value){
  if(isLocked()) return;
  CHOSEN[ ORDER[I] ] = value;
  toast('Resposta salva','info',1200);
  lockAndExplain(value);
  persist();
}
function lockAndExplain(value){
  const q=current(); const type=q.type||'multiple';
  const buttons=Array.from(optionsEl.querySelectorAll('.opt')); buttons.forEach(b=>b.disabled=true);

  if(q.annulled || q.answer==null){
    state.textContent = 'anulada';
    explainEl.textContent = q.explanation || 'Questão anulada.';
    explainEl.classList.remove('hide');
    return;
  }

  let correct=false;
  if(type==='vf'){
    correct = (value === !!q.answer);
    buttons[q.answer ? 0:1].classList.add('correct');
    const chosenIdx=value?0:1; if(!correct) buttons[chosenIdx]?.classList.add('wrong');
  } else {
    const answerIdx=q.answer;
    buttons.forEach(b=>{ const origIdx=parseInt(b.dataset.origIdx??'-1',10); if(origIdx===answerIdx) b.classList.add('correct'); });
    const chosenBtn=buttons.find(b=>parseInt(b.dataset.origIdx??'-1',10)===value);
    correct=(typeof value==='number' && value===answerIdx);
    if(!correct && chosenBtn) chosenBtn.classList.add('wrong');
  }
  state.textContent = correct? 'correto' : 'incorreto';
  toast(correct?'Correto':'Incorreto', correct?'success':'warn',1500);
  explainEl.textContent = q.explanation || '';
  explainEl.classList.toggle('hide', !q.explanation);
  show(btnAI, true);
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
function markLocked(){
  const q=current(); const type=q.type||'multiple'; const val=CHOSEN[ ORDER[I] ]; if(val===null) return;
  if(type==='vf'){
    renderOptions(['Verdadeiro','Falso'],()=>{},[0,1]);
  } else {
    const opts=q.options.map((t,i)=>({t,i}));
    const shOpts = opts;
    renderOptions(shOpts.map(o=>o.t), ()=>{}, shOpts.map(o=>o.i));
  }
  lockAndExplain(val);
}
function next(){ if(I < ORDER.length - 1){ I++; render(); } else { finish(); } }
function prev(){ if(I > 0){ I--; render(); } }

/* ===== AI ===== */
function openGoogleAI(){
  const q=current(); if(!q) return;
  const prompt = 'VProfessor, por favor fundamente a alternativa correta e as incorretas. Enunciado: ' + String((q && q.q) || '') + ' | Opções: ' + (q && q.type === 'vf' ? 'Verdadeiro | Falso' : (Array.isArray(q && q.options) ? q.options.map(function(t,i){ return (i+1)+') '+t; }).join(' | ') : '')) + ' | Alternativa correta: ' + (q && q.type === 'vf' ? (q && q.answer ? 'Verdadeiro' : 'Falso') : (Array.isArray(q && q.options) && typeof q.answer === 'number' ? q.options[q.answer] : ''));
  const url = 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(prompt.replace(/<[^>]+>/g,''));
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
      const nq = normalizeText(q.q.replace(/<[^>]+>/g,'') || '');
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
function renderTagBar(currentList=null){
  // desativado: tags agora aparecem inline sob o enunciado
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
