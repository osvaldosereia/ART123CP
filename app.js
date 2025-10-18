/* Quiz Jurídico — aceita TXT bruto do QConcursos em /data/<categoria>/*.txt
   - Indexa categorias pelo diretório
   - Lê temas do conteúdo dos TXT
   - Monta quiz com rolagem infinita (3 por lote)
   - Marca correto/errado e exibe menu “Pergunte ao Google Modo I.A.”
*/

const CONFIG = {
  owner: 'osvaldosereia',   // ajuste se necessário
  repo:  'ART123CP',        // ajuste se necessário
  branch:'main',
  dataDir:'data',
  pageSize: 3
};

/* ===== util ===== */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function toast(msg, ms=2200){
  const wrap = $('.toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(6px)'; setTimeout(()=>el.remove(),180); }, ms);
}
function decodeHTMLEntities(s){
  if(!s) return '';
  const d = new DOMParser().parseFromString(s,'text/html');
  return d.documentElement.textContent || '';
}
function slug(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function stripHtmlAllowPBrMark(html){
  if(!html) return '';
  const s = decodeHTMLEntities(String(html));
  return s.replace(/<(?!\/?(?:p|br|mark)\b)[^>]+>/gi, '');
}
function toParasKeepMark(s){
  const raw = stripHtmlAllowPBrMark(s);
  return raw
    .replace(/\r\n?/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0">${p.replace(/\n/g,'<br>')}</p>`)
    .join('');
}
function htmlEscape(x){return String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ===== GitHub tree loader ===== */
async function listDataFiles(){
  const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${encodeURIComponent(CONFIG.branch)}?recursive=1`;
  const r = await fetch(url, {headers:{'Accept':'application/vnd.github+json'}});
  if(!r.ok) throw new Error('Falha ao listar o repositório');
  const data = await r.json();
  const root = (CONFIG.dataDir + '/').toLowerCase();
  const files = (data.tree||[])
    .filter(n => n.type==='blob' && n.path.toLowerCase().startsWith(root) && n.path.toLowerCase().endsWith('.txt'))
    .map(n => n.path);
  return files;
}
async function fetchText(path){
  const url = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path}`;
  const r = await fetch(url, {cache:'no-store'});
  if(!r.ok) throw new Error('Falha ao baixar ' + path);
  return await r.text();
}

/* ===== parser TXT bruto QConcursos + formato nativo (* ** *** -----) ===== */
function parseTxtQuestions(raw){ // formato nativo do seu app
  const text = String(raw||'').replace(/\uFEFF/g,'').replace(/\r\n?/g,'\n');
  const blocks = text.split(/\n-{5,}\n/g).map(b=>b.trim()).filter(Boolean);
  const map = {A:0,B:1,C:2,D:3,E:4};
  const qs = [];
  for(const block of blocks){
    const lines = block.split('\n');
    let enun=[], opts=[], gab=null;
    for(const line of lines){
      const t = line.trim();
      if(/^\*\s(?!\*)/.test(t)){ enun.push(t.replace(/^\*\s*/,'')); continue; }
      if(/^\*\*\s*\(?[A-E]\)/i.test(t)){ const m=t.match(/^\*\*\s*\(?([A-E])\)\s*(.+)$/i); if(m) opts.push(m[2].trim()); continue; }
      if(/^\*\*\*\s*Gabarito\s*:/i.test(t)){ const g=t.match(/^\*\*\*\s*Gabarito\s*:\s*([A-E])/i); if(g) gab=g[1].toUpperCase(); continue; }
    }
    if(enun.length && opts.length){
      qs.push({category:'', themes:[], type:'multiple', q: enun.join('\n'), options:opts, answer: gab? map[gab]:null, explanation:''});
    }
  }
  return qs;
}
function parseTxtDump(txt){ // QConcursos bruto
  if(!txt) return { meta:{}, questions:[] };

  const answersMap = new Map();
  const tail = txt.split(/\n/).slice(-400).join('\n');
  for(const m of tail.matchAll(/\b(\d+)\s*:\s*([A-E])\b/gi)){
    answersMap.set(parseInt(m[1],10), m[2].toUpperCase());
  }

  const lines = txt.replace(/\r\n?/g,'\n').split('\n');
  const heads = [];
  for(let i=0;i<lines.length;i++){
    if(/^\s*\d+\s+Q\d+\b/.test(lines[i])) heads.push(i);
  }
  const blocks = heads.map((start,k)=> lines.slice(start, heads[k+1] ?? lines.length).join('\n').trim());

  const QUESTIONS = [];
  const mapLetter = {A:0,B:1,C:2,D:3,E:4};
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');

  blocks.forEach((block, idx0)=>{
    const head = block.split('\n',1)[0] || '';
    let category='Geral', themes=[];
    const mHead = head.match(/Q\d+\s+(.+?)>(.+)$/);
    if(mHead){
      category = mHead[1].trim().replace(/\s+/g,' ');
      themes = mHead[2].split(',').map(s=>s.trim()).filter(Boolean);
    }
    const body = block.split('\n').slice(1);
    const altRe = /^\s*(?:\(?([A-E])\)?[)\.\-:]?)\s+(.*)$/i;
    const alts=[]; let cur=null;
    body.forEach(line=>{
      const m = line.match(altRe);
      if(m){
        cur = { L:m[1].toUpperCase(), txt:m[2].trim() };
        alts.push(cur.txt);
      }else if(cur && line.trim() && !/^\s*\d+\s*:\s*[A-E]\b/i.test(line)){
        cur.txt += '\n' + line.trim();
        alts[alts.length-1] = cur.txt;
      }
    });
    const firstAltIdx = body.findIndex(l=>altRe.test(l));
    let question = firstAltIdx>=0 ? body.slice(0, firstAltIdx).join('\n').trim() : body.join('\n').trim();
    question = question
      .replace(/^\s*(Ano|Banca|Órgão)\s*:.+$/gmi,'')
      .replace(/^\s*Treinador.*$/gmi,'')
      .trim();

    let type = 'multiple';
    if(alts.length===2){
      const n0=norm(alts[0]), n1=norm(alts[1]);
      const isVF = (n0==='verdadeiro'&&n1==='falso') || (n0==='falso'&&n1==='verdadeiro');
      const isCE = (n0==='certo'&&n1==='errado')       || (n0==='errado'&&n1==='certo');
      if(isVF||isCE) type='vf';
    }

    const pos = idx0+1;
    const gLetter = answersMap.get(pos) || null;

    let answer = null, answerBool = undefined;
    if(type==='multiple'){
      if(gLetter && mapLetter[gLetter]!=null) answer = mapLetter[gLetter];
    }else{
      if(gLetter==='A' || gLetter==='B'){
        const first = norm(alts[0]);
        const firstIsTrue = (first==='verdadeiro'||first==='certo');
        answerBool = (gLetter==='A') ? firstIsTrue : !firstIsTrue;
      }
    }

    QUESTIONS.push({
      category, themes, type,
      q: question,
      options: type==='multiple' ? alts : undefined,
      answer: type==='multiple' ? answer : undefined,
      answerBool: type==='vf' ? !!answerBool : undefined,
      explanation: ''
    });
  });

  return { meta:{}, questions: QUESTIONS };
}

/* ===== estado ===== */
let ALL_FILES = [];                // todos os .txt em /data
let CATEGORIES = [];               // categorias pelo diretório
let THEMES_CACHE = new Map();      // key = categoriaSlug -> [{name,count}]
let FILES_BY_CATEGORY = new Map(); // categoriaSlug -> [paths]
let CURRENT = {catSlug:null, catName:null, themes:[], pool:[], cursor:0};

/* ===== UI refs ===== */
const screenIntro = $('#screenIntro');
const screenQuiz  = $('#screenQuiz');
const btnHome     = $('#btnHome');
const sel         = $('#catSelect');
const selTrigger  = $('#selTrigger');
const selText     = $('#selTriggerText');
const selMenu     = $('#selMenu');
const themesWrap  = $('#themesWrap');
const btnBuscar   = $('#btnBuscar');
const qList       = $('#questions');
const sentinel    = $('#sentinel');
const currentCat  = $('#currentCat');
const currentThemes = $('#currentThemes');

/* ===== init ===== */
init().catch(e=>toast('Erro: '+e.message));
async function init(){
  btnHome.addEventListener('click', goHome);
  selTrigger.addEventListener('click', ()=> sel.classList.toggle('open'));
  document.addEventListener('click', e=>{ if(!sel.contains(e.target)) sel.classList.remove('open'); });

  btnBuscar.addEventListener('click', startQuiz);

  ALL_FILES = await listDataFiles();
  buildCategoriesFromPaths(ALL_FILES);
  renderCategoryDropdown();

  toast('Categorias carregadas');
}

/* ===== categorias por diretório ===== */
function buildCategoriesFromPaths(paths){
  const set = new Map(); // slug -> {name, slug}
  const byCat = new Map(); // slug -> [file paths]
  for(const p of paths){
    const parts = p.split('/');
    if(parts.length<3) continue;
    const catName = parts[1]; // diretório imediato após data/
    const slugCat = slug(catName);
    set.set(slugCat, {name:catName, slug:slugCat});
    const arr = byCat.get(slugCat)||[];
    arr.push(p); byCat.set(slugCat, arr);
  }
  CATEGORIES = Array.from(set.values()).sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'));
  FILES_BY_CATEGORY = byCat;
}

/* ===== dropdown custom ===== */
function renderCategoryDropdown(){
  selMenu.innerHTML = '';
  CATEGORIES.forEach(c=>{
    const item = document.createElement('div');
    item.className = 'select-item';
    item.textContent = c.name;
    item.addEventListener('click', ()=>{
      CURRENT.catSlug = c.slug;
      CURRENT.catName = c.name;
      selText.textContent = c.name;
      sel.classList.remove('open');
      btnHome.classList.add('hide');
      loadThemesForCategory(c.slug, c.name);
    });
    selMenu.appendChild(item);
  });
}

/* ===== ler temas de uma categoria lendo os TXT e parseando cabeçalhos ===== */
async function loadThemesForCategory(catSlug, catName){
  themesWrap.innerHTML = '';
  btnBuscar.disabled = true;

  if(!THEMES_CACHE.has(catSlug)){
    const files = FILES_BY_CATEGORY.get(catSlug) || [];
    const themeCount = new Map(); // name -> count
    for(const path of files){
      const raw = await fetchText(path);
      const isDump = /\bQ\d{6,}\b/.test(raw) && /Respostas[\s\S]{0,600}\b\d+\s*:\s*[A-E]\b/i.test(raw);
      let questions = [];
      if(isDump) questions = parseTxtDump(raw).questions;
      else questions = parseTxtQuestions(raw);
      // acumular temas
      questions.forEach(q=>{
        (q.themes||[]).forEach(t=>{
          if(!t) return;
          themeCount.set(t, (themeCount.get(t)||0)+1);
        });
      });
    }
    const themesArr = Array.from(themeCount.entries()).map(([name,count])=>({name,count})).sort((a,b)=> a.name.localeCompare(b.name,'pt-BR'));
    THEMES_CACHE.set(catSlug, themesArr);
  }

  const themes = THEMES_CACHE.get(catSlug);
  if(!themes.length){
    themesWrap.innerHTML = `<div class="muted">Nenhum tema encontrado nesta categoria.</div>`;
    return;
  }

  themes.forEach(t=>{
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<input type="checkbox" /><span>${htmlEscape(t.name)}</span><small style="color:var(--muted)">(${t.count})</small>`;
    chip.addEventListener('click', (e)=>{
      const on = chip.classList.toggle('on');
      chip.querySelector('input').checked = on;
      toggleThemeSelection(t.name, on);
    });
    themesWrap.appendChild(chip);
  });
}

function toggleThemeSelection(themeName, on){
  CURRENT.themes = CURRENT.themes || [];
  if(on){
    if(!CURRENT.themes.includes(themeName)) CURRENT.themes.push(themeName);
  }else{
    CURRENT.themes = CURRENT.themes.filter(t=>t!==themeName);
  }
  btnBuscar.disabled = CURRENT.themes.length===0;
}

/* ===== montar quiz com rolagem infinita ===== */
async function startQuiz(){
  // coletar questões da categoria selecionada filtrando pelos temas escolhidos
  const files = FILES_BY_CATEGORY.get(CURRENT.catSlug) || [];
  const wanted = new Set(CURRENT.themes.map(t=>t.toLowerCase()));

  const pool = [];
  for(const path of files){
    const raw = await fetchText(path);
    const isDump = /\bQ\d{6,}\b/.test(raw) && /Respostas[\s\S]{0,600}\b\d+\s*:\s*[A-E]\b/i.test(raw);
    const parsed = isDump ? parseTxtDump(raw) : {questions: parseTxtQuestions(raw)};
    parsed.questions.forEach(q=>{
      const qThemes = (q.themes||[]).map(x=>x.toLowerCase());
      if(qThemes.some(t=>wanted.has(t))){
        pool.push({...q, __src:path});
      }
    });
  }

  if(!pool.length){ toast('Nenhuma questão para os temas selecionados'); return; }

  // reset
  CURRENT.pool = pool;
  CURRENT.cursor = 0;
  qList.innerHTML = '';
  $('#currentCat').textContent = CURRENT.catName;
  $('#currentThemes').textContent = '· ' + CURRENT.themes.join(', ');

  screenIntro.classList.add('hide');
  screenQuiz.classList.remove('hide');
  btnHome.classList.remove('hide');

  // primeira carga
  renderNextBatch();

  // observer para rolagem infinita
  if(window._obs) window._obs.disconnect();
  window._obs = new IntersectionObserver((entries)=>{
    for(const e of entries){
      if(e.isIntersecting) renderNextBatch();
    }
  }, {root:null, rootMargin:'200px', threshold:0});
  window._obs.observe(sentinel);
}

function renderNextBatch(){
  const start = CURRENT.cursor;
  const end = Math.min(CURRENT.cursor + CONFIG.pageSize, CURRENT.pool.length);
  if(start>=end) return;
  for(let i=start;i<end;i++){
    const q = CURRENT.pool[i];
    qList.appendChild(renderQuestionCard(q, i+1));
  }
  CURRENT.cursor = end;
}

/* ===== cartão de questão ===== */
function renderQuestionCard(q, idx){
  const card = document.createElement('article');
  card.className = 'card';
  const metaThemes = (q.themes||[]).join(', ');
  const header = `
    <div class="meta">${htmlEscape(q.category)} · ${htmlEscape(metaThemes||'Tema')}</div>
    <h3>Q${idx}</h3>
  `;
  const body = `<div class="enun">${toParasKeepMark(q.q)}</div>`;
  const opts = q.type==='vf'
    ? ['Verdadeiro','Falso']
    : (q.options||[]);

  const mapLetters = ['A','B','C','D','E'];

  const optsHtml = opts.map((t,i)=>`<button class="opt" data-idx="${i}"><strong>${mapLetters[i]||''}</strong> ${toParasKeepMark(t)}</button>`).join('');
  const explain = `<div class="explain hide"></div>`;

  const ia = `
    <div class="ia">
      <button class="btn ia-btn sm">Pergunte ao Google Modo I.A.</button>
      <div class="ia-menu">
        <button class="btn ghost sm" data-ia="exp">Explicação</button>
        <button class="btn ghost sm" data-ia="gloss">Glossário</button>
        <button class="btn ghost sm" data-ia="vid">Vídeos</button>
      </div>
    </div>`;

  card.innerHTML = header + body + optsHtml + explain + ia;

  // interação
  const btns = Array.from(card.querySelectorAll('.opt'));
  const explainEl = card.querySelector('.explain');
  let locked = false;

  btns.forEach(b=>{
    b.addEventListener('click', ()=>{
      if(locked) return;
      locked = true;
      const pick = parseInt(b.dataset.idx,10);
      if(q.type==='vf'){
        const correctIdx = q.answerBool ? 0 : 1; // Verdadeiro = índice 0
        if(pick===correctIdx){ b.classList.add('correct'); toast('Parabéns'); }
        else{
          b.classList.add('wrong');
          const correctBtn = btns[correctIdx]; correctBtn.classList.add('correct');
          explainEl.classList.remove('hide');
          explainEl.textContent = 'Resposta correta marcada em verde.';
        }
      }else{
        const isRight = typeof q.answer==='number' && pick===q.answer;
        if(isRight){ b.classList.add('correct'); toast('Parabéns'); }
        else{
          b.classList.add('wrong');
          const correctBtn = btns.find(x=> parseInt(x.dataset.idx,10)===q.answer);
          if(correctBtn) correctBtn.classList.add('correct');
          explainEl.classList.remove('hide');
          const letter = ['A','B','C','D','E'][q.answer]||'?';
          explainEl.innerHTML = `Gabarito: <strong>${letter}</strong>`;
        }
      }
      // desabilitar restantes
      btns.forEach(x=> x.disabled = true);
      // habilitar IA
      const iaWrap = card.querySelector('.ia');
      iaWrap.classList.add('open'); // mostra menu no primeiro erro/acerto
    });
  });

  // IA menu
  const iaBtn = card.querySelector('.ia-btn');
  const iaMenu = card.querySelector('.ia-menu');
  iaBtn.addEventListener('click', (e)=>{ e.stopPropagation(); card.querySelector('.ia').classList.toggle('open'); });
  iaMenu.querySelectorAll('button').forEach(x=>{
    x.addEventListener('click', ()=>{
      openGoogleIA(x.dataset.ia, q);
      card.querySelector('.ia').classList.remove('open');
    });
  });
  document.addEventListener('click', e=>{ if(!card.contains(e.target)) card.querySelector('.ia').classList.remove('open'); });

  return card;
}

/* ===== Google IA prompts ===== */
function openGoogleIA(mode, q){
  const plainQ = String(q.q||'').replace(/<[^>]+>/g,'');
  const opts = q.type==='vf' ? ['Verdadeiro','Falso'] : (q.options||[]);
  let prompt = '';
  if(mode==='exp'){
    const base = q.type==='vf'
      ? `Enunciado: ${plainQ}. Opções: Verdadeiro | Falso.`
      : `Enunciado: ${plainQ}. Opções: ${opts.map((t,i)=>String.fromCharCode(65+i)+') '+t).join(' | ')}.`;
    prompt = `Explique didaticamente por que a alternativa correta está certa e as demais estão erradas. ${base}`;
  }else if(mode==='gloss'){
    prompt = `Liste e defina de forma concisa os principais conceitos jurídicos presentes no enunciado: ${plainQ}`;
  }else{
    prompt = `Indique videoaulas no YouTube que expliquem o tema desta questão: ${plainQ}`;
  }
  const url = 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(prompt);
  window.open(url, '_blank', 'noopener');
}

/* ===== navegação ===== */
function goHome(){
  screenQuiz.classList.add('hide');
  screenIntro.classList.remove('hide');
  btnHome.classList.add('hide');
  qList.innerHTML = '';
  CURRENT.pool = []; CURRENT.cursor = 0;
}
