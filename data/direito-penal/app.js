/* ========= CONFIG ========= */
const CONFIG = {
  // Repositório GitHub com a pasta /data
  owner: 'osvaldosereia',
  repo:  'ART123CP',
  branch:'main',
  dataDir: 'data',         // case-insensitive
  pageSize: 3              // questões por lote
};

/* ========= UTIL ========= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function toast(msg){ 
  const wrap = $('.toast-wrap');
  const el = document.createElement('div'); el.className='toast'; el.textContent=msg;
  wrap.appendChild(el); setTimeout(()=>{ el.remove(); }, 2400);
}
function htmlEscape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function decodeHTMLEntities(s){ if(!s) return ''; const d=new DOMParser().parseFromString(s,'text/html'); return d.documentElement.textContent||''; }
function slug(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
/* sanitização simples: mantém apenas <p>, <br>, <mark> */
function stripHtmlAllowPBrMark(html){
  if(!html) return '';
  const s = decodeHTMLEntities(String(html));
  return s.replace(/<(?!\/?(?:p|br|mark)\b)[^>]+>/gi, '');
}
function toParasKeepMark(s){
  const raw = stripHtmlAllowPBrMark(s);
  return raw.replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n')
    .split(/\n{2,}/).map(p=>`<p>${htmlEscape(p).replace(/&lt;mark&gt;|&lt;\/mark&gt;/g,'').replace(/\n/g,'<br>')}</p>`).join('');
}

/* ========= PARSER TXT BRUTO (QConcursos) ========= */
// parseTxtDump(txt) -> { meta, questions[] }
function parseTxtDump(txt){
  if(!txt) return { meta:{}, questions:[] };

  // 1) gabarito no bloco final "Respostas  1: A  2: C ..."
  const answersMap = new Map();
  const tail = txt.replace(/\r\n?/g,'\n').split('\n').slice(-400).join('\n');
  for (const m of tail.matchAll(/\b(\d+)\s*:\s*([A-E])\b/gi)) answersMap.set(parseInt(m[1],10), m[2].toUpperCase());

  // 2) separar por cabeçalho "NN  Qddddddd ..."
  const lines = txt.replace(/\r\n?/g,'\n').split('\n');
  const heads = [];
  for(let i=0;i<lines.length;i++) if(/^\s*\d+\s+Q\d+\b/.test(lines[i])) heads.push(i);
  const blocks = heads.map((start, k)=> lines.slice(start, heads[k+1] ?? lines.length).join('\n').trim());

  const QUESTIONS = [];
  const mapLetter = {A:0,B:1,C:2,D:3,E:4};
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');

  blocks.forEach((block, idx0)=>{
    // cabeçalho: "Qxxxxx  Categoria > Tema A, Tema B"
    const head = block.split('\n',1)[0] || '';
    let category='Geral', themes=[];
    const mHead = head.match(/Q\d+\s+(.+?)>(.+)$/);
    if(mHead){ category = mHead[1].trim().replace(/\s+/g,' '); themes = mHead[2].split(',').map(s=>s.trim()).filter(Boolean); }

    // corpo
    const body = block.split('\n').slice(1);
    const altRe = /^\s*(?:\(?([A-E])\)?[)\.\-:]?)\s+(.*)$/i;
    const alts=[]; let cur=null;
    body.forEach(line=>{
      const m = line.match(altRe);
      if(m){ cur={L:m[1].toUpperCase(), txt:m[2].trim()}; alts.push(cur.txt); }
      else if(cur && line.trim() && !/^\s*\d+\s*:\s*[A-E]\b/i.test(line)){ cur.txt+='\n'+line.trim(); alts[alts.length-1]=cur.txt; }
    });

    const firstAltIdx = body.findIndex(l=>altRe.test(l));
    let question = firstAltIdx>=0 ? body.slice(0, firstAltIdx).join('\n').trim() : body.join('\n').trim();
    question = question.replace(/^\s*(Ano|Banca|Órgão)\s*:.+$/gmi,'').replace(/^\s*Treinador.*$/gmi,'').trim();

    let type='multiple';
    if(alts.length===2){
      const n0=norm(alts[0]), n1=norm(alts[1]);
      const isVF = (n0==='verdadeiro'&&n1==='falso')||(n0==='falso'&&n1==='verdadeiro');
      const isCE = (n0==='certo'&&n1==='errado')||(n0==='errado'&&n1==='certo');
      if(isVF||isCE) type='vf';
    }

    const pos = idx0+1;
    const gLetter = answersMap.get(pos) || null;

    let qObj = { category, themes, type, q: question, explanation:'' };
    if(type==='multiple'){
      qObj.options = alts;
      qObj.answer  = (gLetter && mapLetter[gLetter]!=null) ? mapLetter[gLetter] : null;
    }else{
      if(gLetter==='A'||gLetter==='B'){
        const first = norm(alts[0]); const firstTrue = (first==='verdadeiro'||first==='certo');
        qObj.answerBool = (gLetter==='A') ? firstTrue : !firstTrue;
      }
    }
    QUESTIONS.push(qObj);
  });

  return { meta:{}, questions: QUESTIONS };
}

/* ========= INDEXAÇÃO DE ARQUIVOS ========= */
async function listRepoDataFiles(){
  const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${encodeURIComponent(CONFIG.branch)}?recursive=1`;
  const res = await fetch(url, {headers:{'Accept':'application/vnd.github+json'}});
  if(!res.ok) throw new Error('Falha ao listar repositório');
  const data = await res.json();
  const root = (CONFIG.dataDir + '/').toLowerCase();
  const files = (data.tree||[])
    .filter(n => n.type==='blob' && n.path.toLowerCase().startsWith(root) && /\.txt$/i.test(n.path))
    .map(n => n.path);
  return files; // ex.: ["data/direito-penal/arquivo.txt", ...]
}

async function fetchText(path){
  // Arquivos estáticos servidos pelo GitHub Pages: use URL bruta
  const raw = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path}`;
  const r = await fetch(raw, {cache:'no-store'});
  if(!r.ok) throw new Error('Falha ao baixar '+path);
  return await r.text();
}

/* ========= CATÁLOGO DINÂMICO ========= */
const Catalog = {
  categories: new Map(),  // slugCat -> {id,name, themes: Map<slugTema, {name, files:[]}>}
  filesMeta: new Map(),   // path -> {category, themes[]}
};

async function buildCatalog(){
  Catalog.categories.clear();
  Catalog.filesMeta.clear();

  const files = await listRepoDataFiles();
  for(const path of files){
    const txt = await fetchText(path);
    const parsed = parseTxtDump(txt);
    // heurística: categoria/temas por primeira questão válida
    const first = (parsed.questions||[]).find(q => q.category && (q.themes||[]).length);
    if(!first) continue;

    const catName = first.category;
    const catId = slug(catName);
    if(!Catalog.categories.has(catId)) Catalog.categories.set(catId, {id:catId, name:catName, themes:new Map()});

    // registrar todos os temas encontrados no arquivo
    const themeSet = new Set();
    parsed.questions.forEach(q => (q.themes||[]).forEach(t => themeSet.add(t)));
    const cat = Catalog.categories.get(catId);

    themeSet.forEach(tName=>{
      const tId = slug(tName);
      if(!cat.themes.has(tId)) cat.themes.set(tId, {id:tId, name:tName, files:[]});
      cat.themes.get(tId).files.push(path);
    });

    Catalog.filesMeta.set(path, {category:catName, themes:[...themeSet]});
  }
}

/* ========= UI INICIAL ========= */
const screenIntro = $('#screenIntro');
const screenQuiz  = $('#screenQuiz');
const btnHome     = $('#btnHome');
const catSelect   = $('#catSelect');
const catToggle   = $('#catToggle');
const catMenu     = $('#catMenu');
const themesGrid  = $('#themesGrid');
const btnSearch   = $('#btnSearch');
const pathInfo    = $('#pathInfo');
const quizList    = $('#quizList');
const sentinel    = $('#sentinel');

let CURRENT = {
  catId: null,
  catName: null,
  selectedThemes: new Map(), // tId -> {id,name}
  pool: [],      // questões agregadas
  cursor: 0      // quantas já renderizadas
};

function showIntro(){ screenIntro.classList.remove('hide'); screenQuiz.classList.add('hide'); }
function showQuiz(){  screenIntro.classList.add('hide'); screenQuiz.classList.remove('hide');  }

function renderCatDropdown(){
  catMenu.innerHTML = '';
  const cats = Array.from(Catalog.categories.values()).sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'));
  cats.forEach(c=>{
    const item = document.createElement('div');
    item.className = 'select-item';
    item.textContent = c.name;
    item.addEventListener('click', ()=>{
      CURRENT.catId = c.id; CURRENT.catName = c.name;
      catToggle.textContent = c.name;
      catSelect.classList.remove('open');
      renderThemes(c);
      btnSearch.disabled = CURRENT.selectedThemes.size===0;
    });
    catMenu.appendChild(item);
  });
  catToggle.addEventListener('click', ()=> catSelect.classList.toggle('open'));
  document.addEventListener('click', e=>{ if(!catSelect.contains(e.target)) catSelect.classList.remove('open'); });
}

function renderThemes(cat){
  themesGrid.innerHTML = '';
  CURRENT.selectedThemes.clear();
  const list = Array.from(cat.themes.values()).sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'));
  list.forEach(t=>{
    const row = document.createElement('div');
    row.className = 'chip';
    row.innerHTML = `<span>${t.name}</span><input type="checkbox" aria-label="Selecionar tema">`;
    const ck = row.querySelector('input');
    ck.addEventListener('change', ()=>{
      if(ck.checked) CURRENT.selectedThemes.set(t.id, {id:t.id, name:t.name});
      else CURRENT.selectedThemes.delete(t.id);
      btnSearch.disabled = CURRENT.selectedThemes.size===0;
    });
    themesGrid.appendChild(row);
  });
}

/* ========= COLETA E RENDER DO QUIZ ========= */
async function collectQuestions(catId, themeIds){
  const cat = Catalog.categories.get(catId);
  if(!cat) return [];
  // arquivos que cobrem os temas escolhidos
  const fileSet = new Set();
  themeIds.forEach(tid=>{
    const t = cat.themes.get(tid);
    if(t) t.files.forEach(p=>fileSet.add(p));
  });

  const pool = [];
  for(const path of fileSet){
    const txt = await fetchText(path);
    const parsed = parseTxtDump(txt);
    parsed.questions.forEach(q=>{
      // mantém apenas questões que intersectam os temas selecionados
      const hit = q.themes && q.themes.some(t => themeIds.includes(slug(t)));
      if(hit){
        pool.push({
          category: q.category,
          themes: q.themes,
          type: q.type,
          q: q.q,
          options: q.options || [],
          answer: q.answer,
          answerBool: q.answerBool
        });
      }
    });
  }
  return pool;
}

function clearQuizUI(){
  quizList.innerHTML = '';
  CURRENT.cursor = 0;
}

function renderNextBatch(){
  const start = CURRENT.cursor;
  const end = Math.min(start + CONFIG.pageSize, CURRENT.pool.length);
  for(let i=start;i<end;i++) quizList.appendChild(renderQuestionCard(CURRENT.pool[i]));
  CURRENT.cursor = end;
  if(CURRENT.cursor >= CURRENT.pool.length) observer.disconnect();
}

function renderQuestionCard(q){
  const tpl = $('#tplQuestion').content.cloneNode(true);
  const root = tpl.querySelector('.question');
  const head = tpl.querySelector('.q-head');
  const body = tpl.querySelector('.q-body');
  const opts = tpl.querySelector('.q-options');
  const fb   = tpl.querySelector('.q-feedback');
  const iaBtn  = tpl.querySelector('.ia-btn');
  const iaMenu = tpl.querySelector('.ia-menu');

  head.querySelector('.q-cat').textContent = q.category;
  head.querySelector('.q-themes').textContent = (q.themes||[]).join(' • ');
  body.innerHTML = toParasKeepMark(q.q);

  // opções
  opts.innerHTML = '';
  if(q.type === 'vf'){
    const arr = ['Verdadeiro','Falso'];
    arr.forEach((t, idx)=>{
      const b = document.createElement('button'); b.className='option'; b.type='button';
      b.innerHTML = `<strong>${idx===0?'V':'F'})</strong> ${htmlEscape(t)}`;
      b.addEventListener('click', ()=>handlePickVF(b, idx===0, q, fb, iaBtn));
      opts.appendChild(b);
    });
  } else {
    const labels = ['A','B','C','D','E'];
    q.options.forEach((t, i)=>{
      const b = document.createElement('button'); b.className='option'; b.type='button';
      const safe = toParasKeepMark(String(t||''));
      b.innerHTML = `<strong>${labels[i]})</strong> ${safe}`;
      b.addEventListener('click', ()=>handlePickABCD(b, i, q, opts, fb, iaBtn));
      opts.appendChild(b);
    });
  }

  // IA flyout
  iaBtn.addEventListener('click', (e)=>{ e.stopPropagation(); iaMenu.classList.toggle('hide'); });
  iaMenu.addEventListener('click', e=>e.stopPropagation());
  document.addEventListener('click', ()=> iaMenu.classList.add('hide'));
  iaMenu.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', ()=>{
      const mode = b.dataset.mode;
      openGoogleIA(mode, q);
      iaMenu.classList.add('hide');
    });
  });

  return root;
}

function handlePickABCD(btn, idx, q, optsEl, fb, iaBtn){
  if(optsEl.querySelector('.correct, .wrong')) return;
  const nodes = Array.from(optsEl.querySelectorAll('.option'));
  const correct = (typeof q.answer==='number' && idx===q.answer);
  nodes[q.answer]?.classList.add('correct');
  btn.classList.add(correct?'correct':'wrong');
  fb.classList.remove('hide');
  fb.classList.toggle('ok', correct);
  fb.classList.toggle('bad', !correct);
  fb.textContent = correct ? 'Parabéns! Resposta correta.' : 'Resposta incorreta. Acima está a alternativa correta.';
  iaBtn.classList.remove('hide');
}

function handlePickVF(btn, pickedTrue, q, fb, iaBtn){
  if(btn.parentElement.querySelector('.correct, .wrong')) return;
  const nodes = Array.from(btn.parentElement.querySelectorAll('.option'));
  const isTrueRight = !!q.answerBool;
  const correct = (pickedTrue === isTrueRight);
  nodes[pickedTrue?0:1].classList.add(correct?'correct':'wrong');
  nodes[isTrueRight?0:1].classList.add('correct');
  fb.classList.remove('hide');
  fb.classList.toggle('ok', correct);
  fb.classList.toggle('bad', !correct);
  fb.textContent = correct ? 'Parabéns! Resposta correta.' : 'Resposta incorreta. Acima está a alternativa correta.';
  iaBtn.classList.remove('hide');
}

function openGoogleIA(mode, q){
  let prompt='';
  if(mode==='explicacao'){
    const base = `${q.q}\nOpções: ${q.type==='vf' ? 'Verdadeiro | Falso' : (q.options||[]).map((o,i)=>String.fromCharCode(65+i)+') '+o).join(' | ')}`;
    prompt = `Explique detalhadamente a questão de Direito, por que a correta está certa e as demais erradas: ${base}`;
  }else if(mode==='glossario'){
    prompt = `Liste e defina os principais conceitos jurídicos presentes no enunciado: ${q.q}`;
  }else{
    prompt = `Indique videoaulas no YouTube que expliquem o tema desta questão de Direito: ${q.q}`;
  }
  const url = 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(prompt);
  window.open(url, '_blank', 'noopener');
}

/* ========= ROLAGEM INFINITA ========= */
const observer = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting) renderNextBatch();
  });
});

/* ========= BOOT ========= */
async function start(){
  try{
    await buildCatalog();
    renderCatDropdown();
    toast('Catálogo pronto');
  }catch(e){
    console.error(e);
    toast('Erro ao montar catálogo');
 
