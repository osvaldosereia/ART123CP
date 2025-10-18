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
function toast(msg,type='info',ms=2000){
  const w = getToastWrap();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300); }, ms);
}
function htmlEscape(s){
  return String(s||'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
function plainText(html){
  const d = new DOMParser().parseFromString(`<div>${html}</div>`,'text/html');
  return d.body.textContent || '';
}
function show(el, on){ if(!el) return; el.classList.toggle('hide', !on); }
function download(filename, text){
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'})); a.download=filename; a.click();
}
function shuffleInPlace(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()* (i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
function debounce(fn,wait=200){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),wait); }; }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function pick(arr){ return arr[(Math.random()*arr.length)|0]; }
function slugChars(str){
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
  ['direito-constitucional','Direito Constitucional'],
  ['direito-penal','Direito Penal'],
  ['direito-administrativo','Direito Administrativo'],
  ['direito-processual-penal','Proc. Penal'],
  ['direito-processual-civil','Proc. Civil'],
]);
function prettyName(s){
  const k=slug(s||'');
  if(SPECIAL_NAMES.has(k)) return SPECIAL_NAMES.get(k);
  return String(s||'')
    .replace(/[-_]/g,' ')
    .replace(/\b([a-zÀ-ÿ])(\w*)/gi,(m,a,b)=>a.toUpperCase()+b);
}

/* ===== state ===== */
let QUIZ = null;      // {meta,questions[]}
let ORDER = [];       // ordem das questões
let CHOSEN = [];      // respostas escolhidas
let I = 0;            // índice atual em ORDER
let FILTER = null;    // texto do filtro
let TAG_FILTER = null;// tag
let KEY = null;       // {path,key}
let HISTORY = [];     // histórico global de tentativas
let LOADING = false;  // lock
let TAG_READY = false;// índice de tags

/* ===== cache ===== */
function pathKey(p){ return `quiz:${JSON.stringify(p)}`; }
function readQuizCache(p){ try{ return JSON.parse(localStorage.getItem(pathKey(p))||'null'); }catch{ return null; } }
function saveQuizCache(p,q){ try{ localStorage.setItem(pathKey(p), JSON.stringify(q)); }catch{} }

/* ===== elements ===== */
const screenIntro  = document.getElementById('screenIntro');
const screenQuiz   = document.getElementById('screenQuiz');
const screenResult = document.getElementById('screenResult');
const listCats     = document.getElementById('listCats');
const listThemes   = document.getElementById('listThemes');
const btnBackIntro = document.getElementById('btnBackIntro');
const btnClearSearch = document.getElementById('btnClearSearch');
const searchInput  = document.getElementById('search');
const tagInput     = document.getElementById('tag');
const questionEl   = document.getElementById('question');
const optionsEl    = document.getElementById('options');
const explainEl    = document.getElementById('explain');
const progressEl   = document.getElementById('progress');
const btnPrev      = document.getElementById('btnPrev');
const btnNext      = document.getElementById('btnNext');
const btnSkip      = document.getElementById('btnSkip');
const btnReveal    = document.getElementById('btnReveal');
const btnAI        = document.getElementById('btnAI');
const aiMenuBtn    = document.getElementById('aiMenuBtn');

/* ===== manifest ===== */
let MANIFEST = {
  title: 'MeuJus',
  categories: [],
  shuffleDefault: {questions:false, options:true},
  persistDefault: true,
  outro: {message:''}
};

/* ===== data access ===== */
async function githubList(dir){
  const api = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${dir}?ref=${CONFIG.branch}`;
  const res = await fetch(api); if(!res.ok) throw new Error('github list');
  return await res.json();
}
async function githubRaw(path){
  const raw = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path}`;
  const res = await fetch(raw); if(!res.ok) throw new Error('github raw');
  return await res.text();
}

/* ===== HTML parser ===== */
function sanitizeBasicHTML(html){
  return String(html||'')
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/on[a-z]+\s*=\s*"[^"]*"/gi,'')
    .replace(/on[a-z]+\s*=\s*'[^']*'/gi,'')
    .replace(/javascript:/gi,'')
    .replace(/<img[^>]*>/gi,'')
    .replace(/style\s*=\s*"[^"]*"/gi,'')
    .replace(/style\s*=\s*'[^']*'/gi,'');
}

async function loadJSON(path){
  const res = await fetch(path); if(!res.ok) throw new Error('fetch json');
  return await res.json();
}

async function loadTxtAsQuizFast(path){
  const text = await (await fetch(path)).text();
  const lines = text.split(/\r?\n/);
  const questions = [];
  let cur = null;
  for(const line of lines){
    const m = line.match(/^\s*(Q|A|B|C|D|E|ANS)\s*:\s*(.*)$/);
    if(!m) continue;
    const tag = m[1]; const val = m[2];
    if(tag==='Q'){ cur = {type:'multiple', q: htmlEscape(val), options:[], answer:null, explanation:'', tags:[]}; questions.push(cur); }
    else if('ABCDE'.includes(tag)){ cur?.options.push(htmlEscape(val)); }
    else if(tag==='ANS'){ cur.answer = parseInt(val,10); }
  }
  const quiz = { meta:{title:'TXT', category:'Geral', theme:'TXT', shuffle:{questions:false,options:true}, persist:true, outroMessage:''}, questions };
  await loadVirtualQuiz(quiz, path, true);
  saveQuizCache(path, quiz);
  return quiz;
}

async function loadHtmlAsQuiz(path){
  const html = await (await fetch(path)).text();
  const doc = new DOMParser().parseFromString(html,'text/html');
  // Heurística: pergunta em .question, alternativas em li[data-alt]
  const nodes = [...doc.querySelectorAll('[data-question-id], .question')];
  const questions = [];
  for(const n of nodes){
    const enun = n.querySelector('.enunciado, .stem, h2, h3, p')?.innerHTML || n.innerHTML;
    const opts = [...n.querySelectorAll('li, .alternativa, [data-alt]')].map(li=>sanitizeBasicHTML(li.innerHTML)).filter(Boolean);
    if(opts.length>=2) questions.push({type:'multiple', q: sanitizeBasicHTML(enun), options: opts, answer:null, explanation:'', tags:[]});
  }
  const quiz = { meta:{title: doc.title||'HTML', category:'Geral', theme:'HTML', shuffle:{questions:false,options:true}, persist:true, outroMessage:''}, questions };
  return quiz;
}

/* ===== quiz UI ===== */
function buildTagIndex(list){
  const map = new Map();
  for(const q of list){
    for(const t of (q.tags||[])){
      const k=String(t).trim(); if(!k) continue;
      if(!map.has(k)) map.set(k,[]);
      map.get(k).push(q);
    }
  }
  TAG_READY = true;
}

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
          const base = String(parts[3]).replace(/\.(txt|json|html?)$/i,'');
          tema       = prettyName(base);
        }
      }

      const qzMerged = { meta:{ title:`${materia} · Misto`, category: disciplina, theme: tema, shuffle:{questions:false,options:true}, persist:true, outroMessage:'' }, questions };
      await loadVirtualQuiz(qzMerged, path, fresh);
      saveQuizCache(path, qzMerged);
      LOADING = false;
      return;

    } else {
      if(/\.txt$/i.test(path)){
        qz = await loadTxtAsQuizFast(path); // entrega parcial dentro
      } else if(/\.json$/i.test(path)){
        qz = await loadJSON(path);
        if(qz && Array.isArray(qz.questions)){ await loadVirtualQuiz(qz, path, fresh); saveQuizCache(path,qz); }
      } else if(/\.html?/i.test(path) || /^https?:\/\//i.test(path)){
        qz = await loadHtmlAsQuiz(path);
        if(qz && Array.isArray(qz.questions)){ await loadVirtualQuiz(qz, path, fresh); saveQuizCache(path,qz); }
      } else if(/\.pdf$/i.test(path)){
        qz = await loadPdfAsQuiz(path);
      }
    }

    if(!qz||!Array.isArray(qz.questions)){
      toast('Falha ao carregar o quiz','error',3000);
      show(screenIntro,true); show(screenQuiz,false); show(screenResult,false);
      return;
    }

  }catch(err){
    console.error(err);
    toast('Erro ao carregar', 'error', 3000);
    show(screenIntro,true); show(screenQuiz,false); show(screenResult:false);
  }finally{
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

/* ===== PDF support ===== */
async function ensurePdfJs(){
  if(window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej)=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.js';
    s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });
  try{
    // Worker for performance
    if(window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions){
      window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.js';
    }
  }catch{}
  return window.pdfjsLib;
}

async function extractPdfText(input){
  const pdfjs = await ensurePdfJs();
  const doc = pdfjs.getDocument(typeof input==='string' ? input : {data: input});
  const pdf = await doc.promise;
  let out = [];
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const txt = content.items.map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
    out.push(txt);
  }
  return out.join('\n\n');
}

function parsePdfToQuiz(raw){
  const text = String(raw||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();

  // Gabarito ao final: "Respostas 1: D 2: C ..."
  const gabMatch = text.match(/Respostas\s+([\s\S]+?)\s+(?:www\.qconcursos|https?:\/\/www\.qconcursos|$)/i);
  const gabMap = new Map();
  if(gabMatch){
    const all = gabMatch[1];
    const rx = /(\d+)\s*:\s*([A-E])/gi;
    let m; while((m=rx.exec(all))) gabMap.set(Number(m[1]), m[2].toUpperCase());
  }

  // Parte das questões antes do bloco "Respostas"
  const head = text.split(/Respostas\b/i)[0];

  // Cortes por cabeçalhos padronizados que se repetem entre questões do QC
  const chunks = head
    .split(/\bAno:\s*20\d{2}[^A]*?OAB\b/i)
    .map(s=>s.trim()).filter(Boolean);

  const mapLetter = {A:0,B:1,C:2,D:3,E:4};
  const questions = [];
  let idx=0;

  for(const ch of chunks){
    // agrupa alternativas A–E
    const altRx = /\b([A-E])\s+([^A-E]+?)(?=\s+[A-E]\s+|$)/gi;
    let m, opts=[];
    while((m=altRx.exec(ch))){
      const L = m[1].toUpperCase();
      const val = m[2].trim();
      opts[mapLetter[L]] = sanitizeBasicHTML(val);
    }
    if(!opts.length) continue;

    const firstA = ch.search(/\bA\s+/);
    const enun = firstA>0 ? ch.slice(0, firstA).trim() : ch.trim();

    idx += 1;
    const gabLetter = gabMap.get(idx) || null;
    questions.push({
      type:'multiple',
      q: sanitizeBasicHTML(enun),
      options: opts,
      answer: gabLetter ? (mapLetter[gabLetter] ?? null) : null,
      explanation:'',
      tags: []
    });
  }

  return {
    meta:{
      title:'PDF QConcursos',
      category:'QConcursos',
      theme:'PDF',
      shuffle:{questions:false, options:true},
      persist:true,
      outroMessage:''
    },
    questions
  };
}

async function loadPdfAsQuiz(path){
  const raw = await extractPdfText(path);
  const quiz = parsePdfToQuiz(raw);
  if(quiz && Array.isArray(quiz.questions)){
    await loadVirtualQuiz(quiz, path, true);
    saveQuizCache(path, quiz);
  }
  return quiz;
}

/* ===== render ===== */
function render(){
  const total = ORDER.length;
  const pos = clamp(I+1,1,total);
  progressEl.textContent = `${pos}/${total}`;

  const idx = ORDER[I];
  const q = QUIZ.questions[idx];

  const categoryText = `${QUIZ.meta?.category||'Geral'} » ${QUIZ.meta?.title||'Quiz'}`;
  const themeText    = `${QUIZ.meta?.theme||''}`;
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
    renderOptions(['Verdadeiro', 'Falso'], idx => select(idx===0));
  } else {
    renderOptions(q.options, idx => select(idx));
  }

  btnPrev.disabled = I<=0;
  btnNext.disabled = I>=ORDER.length-1;
}

function renderOptions(list, onChoose){
  for(let i=0;i<list.length;i++){
    const btn = document.createElement('button');
    btn.className='option';
    btn.innerHTML=list[i];
    btn.onclick=()=>onChoose(i);
    optionsEl.appendChild(btn);
  }
}

function select(value){
  const idx = ORDER[I];
  const q = QUIZ.questions[idx];
  const type = q.type || 'multiple';
  const buttons = [...optionsEl.querySelectorAll('button.option')];

  if (type === 'vf') {
    const answerIdx = q.answer ? 0 : 1;
    buttons[answerIdx]?.classList.add('correct');
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
    const correctIdx = (q.answer ?? -1);
    if (correctIdx>=0) buttons[correctIdx]?.classList.add('correct');
    if (value!==correctIdx) buttons[value]?.classList.add('wrong');
    upsertHistoryItem({
      idx: ORDER[I],
      chosenIdx: value,
      correctIdx,
      quizTitle: QUIZ?.meta?.title || 'Geral',
      path: KEY?.path,
      preview: plainText(q.q).slice(0, 80)
    });
  }

  explainEl.innerHTML = q.explanation||'';
  explainEl.classList.toggle('hide', !q.explanation);
}

/* ===== history ===== */
function loadHistory(){ try{ HISTORY = JSON.parse(localStorage.getItem('history')||'[]'); }catch{ HISTORY=[]; } }
function saveHistory(){ try{ localStorage.setItem('history', JSON.stringify(HISTORY.slice(-200))); }catch{} }
function upsertHistoryItem(item){
  const k = `${pathKey(KEY?.path)}:${item.idx}`;
  const pos = HISTORY.findIndex(h=>h.k===k);
  const now = Date.now();
  const rec = {...item, k, t:now};
  if(pos>=0) HISTORY[pos]=rec; else HISTORY.push(rec);
  saveHistory();
}
function histSlice(){ return HISTORY.slice().sort((a,b)=>b.t-a.t).slice(0,100); }

/* ===== events ===== */
btnPrev.onclick = ()=>{ if(I>0){ I--; render(); } };
btnNext.onclick = ()=>{ if(I<ORDER.length-1){ I++; render(); } };
btnSkip.onclick = ()=>{ if(I<ORDER.length-1){ I++; render(); } };
btnReveal.onclick = ()=>{
  const idx = ORDER[I];
  const q = QUIZ.questions[idx];
  const type = q.type || 'multiple';
  if(type==='vf') select(q.answer);
  else if(Number.isInteger(q.answer)) select(q.answer);
};
aiMenuBtn.onclick = ()=>{
  const aiMenu = document.getElementById('aiMenu');
  show(aiMenu, !aiMenu || aiMenu.classList.contains('hide'));
};

searchInput.oninput = debounce(()=>{
  FILTER = String(searchInput.value||'').trim();
  render();
}, 200);

btnClearSearch.onclick = ()=>{ searchInput.value=''; FILTER=null; render(); };

tagInput.oninput = debounce(()=>{ TAG_FILTER = String(tagInput.value||'').trim(); render(); }, 200);

/* ===== boot ===== */
async function init(){
  loadHistory();
  const url = new URL(location.href);
  const p = url.searchParams.get('path');
  if(p){ await loadQuiz(p, true, AUTO_RESUME); return; }

  // monta menu a partir do GitHub
  try{
    const cats = await githubList(CONFIG.dataDir);
    MANIFEST.categories = [];
    for(const c of cats){ if(c.type!=='dir') continue; const catId = c.name;
      const cat = { id: catId, name: prettyName(catId), themes: [] };
      const mats = await githubList(`${CONFIG.dataDir}/${catId}`);
      for(const m of mats){ if(m.type!=='dir') continue; const matId=m.name;
        const files = await githubList(`${CONFIG.dataDir}/${catId}/${matId}`);
        for(const f of files){
          if(/\.(txt|json|html?|pdf)$/i.test(f.name)){
            cat.themes.push({ id: slug(f.name), name: prettyName(f.name.replace(/\.[^.]+$/,'')), path: `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.dataDir}/${catId}/${matId}/${f.name}` });
          }
        }
      }
      MANIFEST.categories.push(cat);
    }
  }catch(e){ console.warn('manifest build failed', e); }

  renderHome();
}

function renderHome(){
  listCats.innerHTML='';
  for(const cat of MANIFEST.categories){
    const div=document.createElement('div');
    div.className='cat';
    div.innerHTML=`<h3>${htmlEscape(cat.name)}</h3>`;
    const ul=document.createElement('ul');
    for(const th of cat.themes){
      const li=document.createElement('li');
      li.innerHTML=`<a href="#" data-path="${th.path}">${htmlEscape(th.name)}</a>`;
      li.querySelector('a').onclick=(e)=>{ e.preventDefault(); loadQuiz(th.path,true,false); };
      ul.appendChild(li);
    }
    div.appendChild(ul);
    listCats.appendChild(div);
  }
  show(screenIntro,true); show(screenQuiz,false); show(screenResult,false);
}

// start
init();
