// app.js — SPA de estudo
// UI intacta. Parser aceita: JSON novo (pages/questions), JSON {lines:[...]}, texto antigo.
// Catálogo autodetectado via /data/index.json (manifest) ou GitHub API.

// ====== CATÁLOGO DINÂMICO ======
let CATALOG = {}; // preenchido em discoverCatalog()

// ====== ELEMENTOS ======
const $ = (sel, root = document) => root.querySelector(sel);
const els = {
  catMenu: $('#catMenu'),
  catTrigger: $('#catTrigger'),
  catText: $('#catTriggerText'),
  themesGrid: $('#themesGrid'),
  themesCount: $('#themesCount'),
  btnSelectAll: $('#btnSelectAll'),
  btnStart: $('#btnStart'),
  optShuffle: $('#optShuffle'),

  quiz: $('#quiz'),
  home: $('#home'),
  list: $('#quizList'),
  sentinel: $('#sentinel'),
  tpl: $('#tplQuestion'),

  kTotal: $('#kTotal'),
  kDone: $('#kDone'),
  kScore: $('#kScore'),
  pathInfo: $('#pathInfo'),
  btnReset: $('#btnReset'),
};

// ====== ESTADO ======
const state = {
  category: null,
  files: [],
  allQuestions: [],
  themesIndex: new Map(),
  selectedThemes: new Set(),
  sessionQuestions: [],
  order: [],
  pageSize: 3,
  page: 0,
  done: new Set(),
  score: 0,
  io: null,
  storageKey: null,
};

// ====== BOOT ======
document.addEventListener('DOMContentLoaded', async () => {
  wireUI();
  await discoverCatalog();
  populateCategories();
  restoreLastSession();
});

// ====== UI ======
function populateCategories(){
  const names = Object.keys(CATALOG).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const items = names.map((name,i) =>
    `<div class="item" role="option" aria-selected="false" data-i="${i}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</div>`
  ).join('');
  els.catMenu.innerHTML = items || `<div class="item" role="option" aria-selected="false" data-i="0" data-name="Geral">Geral</div>`;
}

function wireUI(){
  els.catTrigger.addEventListener('click', () => {
    els.catMenu.classList.toggle('open');
    els.catTrigger.setAttribute('aria-expanded', els.catMenu.classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (!els.catMenu.contains(e.target) && !els.catTrigger.contains(e.target)) {
      els.catMenu.classList.remove('open');
      els.catTrigger.setAttribute('aria-expanded','false');
    }
  });
  els.catMenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.item');
    if (!item) return;
    const name = item.dataset.name;
    await onSelectCategory(name);
    els.catMenu.classList.remove('open');
    els.catTrigger.setAttribute('aria-expanded','false');
  });

  els.btnSelectAll.addEventListener('click', () => {
    const allPressed = [...els.themesGrid.querySelectorAll('.chip[aria-pressed="true"]')].length === els.themesGrid.children.length;
    [...els.themesGrid.children].forEach(ch => ch.setAttribute('aria-pressed', String(!allPressed)));
    state.selectedThemes = new Set(
      !allPressed ? [...els.themesGrid.children].map(c => c.dataset.theme) : []
    );
    updateThemesCount();
    updateStartEnabled();
  });

  els.btnStart.addEventListener('click', () => startQuiz());
  els.btnReset.addEventListener('click', () => clearSession());

  state.io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) mountNextPage(); });
  });
  state.io.observe(els.sentinel);
}

async function onSelectCategory(name){
  if (state.category === name) return;
  state.category = name;
  els.catText.textContent = name;
  els.pathInfo.textContent = `${name} • selecione temas`;
  state.files = CATALOG[name] || [];
  state.storageKey = `qcquiz:${name}`;
  setProgress(0,0,0);
  state.done.clear(); state.score = 0;

  const texts = await Promise.all(state.files.map(loadText));
  const parsed = texts.map((txt, i) => parseQC(txt, basename(state.files[i])));
  state.allQuestions = parsed.flatMap(p => p.questions);

  state.themesIndex = buildThemesIndex(state.allQuestions);
  renderThemeChips(state.themesIndex);

  els.btnStart.disabled = state.selectedThemes.size === 0;
  els.kTotal.textContent = state.allQuestions.length;
}

function renderThemeChips(map){
  state.selectedThemes.clear();
  const entries = [...map.keys()].sort((a,b)=> a.localeCompare(b,'pt-BR'));
  if (!entries.includes('*')) entries.unshift('*');
  els.themesGrid.innerHTML = entries.map(t =>
    `<button class="chip" type="button" aria-pressed="${t === '*' ? 'true':'false'}" data-theme="${escapeHtml(t)}">${escapeHtml(labelTheme(t))}</button>`
  ).join('');
  state.selectedThemes = new Set(['*']);
  updateThemesCount();
  els.themesGrid.addEventListener('click', onThemeClick, { once: true });
  updateStartEnabled();
}

function onThemeClick(e){
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const t = chip.dataset.theme;
  const pressed = chip.getAttribute('aria-pressed') === 'true';
  if (t === '*'){
    const newState = !pressed;
    [...els.themesGrid.children].forEach(c => c.setAttribute('aria-pressed', String(newState)));
    state.selectedThemes = new Set(newState ? [...els.themesGrid.children].map(c=>c.dataset.theme) : []);
  } else {
    chip.setAttribute('aria-pressed', String(!pressed));
    const on = !pressed;
    if (on) state.selectedThemes.add(t); else state.selectedThemes.delete(t);
    const others = [...els.themesGrid.children].filter(c => c.dataset.theme !== '*');
    const allOn = others.every(c => c.getAttribute('aria-pressed') === 'true');
    const star = els.themesGrid.querySelector('.chip[data-theme="*"]');
    if (star){
      star.setAttribute('aria-pressed', String(allOn));
      if (allOn) state.selectedThemes.add('*'); else state.selectedThemes.delete('*');
    }
  }
  updateThemesCount();
  updateStartEnabled();
  els.themesGrid.addEventListener('click', onThemeClick, { once: true });
}

function updateStartEnabled(){
  els.btnStart.disabled = state.selectedThemes.size === 0;
}
function updateThemesCount(){
  const count = [...state.selectedThemes].filter(t=>t!=='*').length || (state.selectedThemes.has('*') ? state.themesIndex.size-1 : 0);
  els.themesCount.textContent = `${count} selecionado(s)`;
}

function startQuiz(){
  const selected = [...state.selectedThemes];
  let ids = new Set();
  if (selected.includes('*')) {
    ids = new Set(state.allQuestions.map((_,i)=>i));
  } else {
    for (const t of selected) {
      for (const idx of state.themesIndex.get(t) || []) ids.add(idx);
    }
  }
  state.sessionQuestions = [...ids].sort((a,b)=> a-b).map(i => state.allQuestions[i]);

  state.order = state.sessionQuestions.map((_,i)=>i);
  if (els.optShuffle.checked) shuffle(state.order);

  els.list.innerHTML = '';
  state.page = 0;
  state.done.clear();
  state.score = 0;
  els.kDone.textContent = '0';
  els.kScore.textContent = '0';
  els.kTotal.textContent = state.sessionQuestions.length;
  els.pathInfo.textContent = `${state.category} • ${summaryThemes()}`;
  els.home.classList.add('hidden');
  els.quiz.classList.remove('hidden');

  persistProgress('init');
  mountNextPage();
}

function mountNextPage(){
  const start = state.page * state.pageSize;
  const end = Math.min(start + state.pageSize, state.order.length);
  if (start >= end) { els.sentinel.textContent = 'Fim'; return; }
  for (let i=start; i<end; i++){
    const idx = state.order[i];
    mountCard(idx);
  }
  state.page++;
}

function mountCard(sessionIndex){
  const q = state.sessionQuestions[sessionIndex];
  const node = els.tpl.content.firstElementChild.cloneNode(true);
  node.dataset.num = q.numero;
  node.querySelector('.q-num').textContent = `#${q.numero}`;
  node.querySelector('.q-id').textContent = q.id_qc ? `Q${q.id_qc}` : '';
  node.querySelector('.q-type').textContent = q.tipo;
  node.querySelector('.q-stem').textContent = q.enunciado;

  const ol = node.querySelector('.q-options');
  q.alternativas.forEach(({key,text})=>{
    const li = document.createElement('li');
    li.setAttribute('role','button');
    li.setAttribute('aria-disabled','false');
    li.dataset.key = key;
    const k = document.createElement('span'); k.className='opt-key'; k.textContent = key + ')';
    const t = document.createElement('div'); t.className='opt-text'; t.textContent = text;
    li.append(k,t);
    li.addEventListener('click', () => onAnswer(li, q, sessionIndex, node));
    ol.append(li);
  });

  node.querySelector('.q-show').addEventListener('click', () => reveal(node, q.correta, sessionIndex));
  node.querySelector('.q-next').addEventListener('click', () => {
    const next = node.nextElementSibling;
    if (next) next.scrollIntoView({behavior:'smooth', block:'start'});
    else els.sentinel.scrollIntoView({behavior:'smooth', block:'end'});
  });

  els.list.append(node);
}

function onAnswer(li, q, sessionIndex, card){
  if (li.getAttribute('aria-disabled') === 'true') return;
  const chosen = li.dataset.key;
  const correct = q.correta;
  const options = card.querySelectorAll('.q-options li');
  options.forEach(o => o.setAttribute('aria-disabled','true'));
  if (chosen === correct){
    li.classList.add('correct');
    state.score++;
  } else {
    li.classList.add('wrong');
    options.forEach(o => { if (o.dataset.key === correct) o.classList.add('correct'); });
  }
  state.done.add(sessionIndex);
  card.querySelector('.q-result').textContent = `Gabarito: ${correct}`;
  setProgress(state.sessionQuestions.length, state.done.size, state.score);
  persistProgress('answer', {sessionIndex, chosen});
}

function reveal(card, correct, sessionIndex){
  const options = card.querySelectorAll('.q-options li');
  options.forEach(o => o.setAttribute('aria-disabled','true'));
  options.forEach(o => { if (o.dataset.key === correct) o.classList.add('correct'); });
  card.querySelector('.q-result').textContent = `Gabarito: ${correct}`;
  state.done.add(sessionIndex);
  setProgress(state.sessionQuestions.length, state.done.size, state.score);
}

function setProgress(total, done, score){
  els.kTotal.textContent = String(total ?? state.sessionQuestions.length ?? 0);
  els.kDone.textContent = String(done ?? state.done.size);
  els.kScore.textContent = String(score ?? state.score);
}

function clearSession(){
  state.done.clear(); state.score = 0;
  els.kDone.textContent = '0'; els.kScore.textContent = '0';
  document.querySelectorAll('.q-options li').forEach(li => {
    li.classList.remove('correct','wrong');
    li.setAttribute('aria-disabled','false');
  });
  document.querySelectorAll('.q-result').forEach(e => e.textContent = '');
  localStorage.removeItem(state.storageKey);
}

function summaryThemes(){
  const t = [...state.selectedThemes].filter(x=>x!=='*');
  if (state.selectedThemes.has('*') || t.length === 0) return 'Todos os temas';
  return t.slice(0,4).map(labelTheme).join(', ') + (t.length>4 ? ` +${t.length-4}` : '');
}

// ====== PERSISTÊNCIA ======
function persistProgress(kind, extra={}){
  if (!state.storageKey) return;
  const data = {
    kind, ts: Date.now(),
    category: state.category,
    selectedThemes: [...state.selectedThemes],
    optShuffle: els.optShuffle.checked,
    done: [...state.done],
    score: state.score,
    total: state.sessionQuestions.length,
    ...extra,
  };
  localStorage.setItem(state.storageKey, JSON.stringify(data));
}
function restoreLastSession(){
  els.btnReset.disabled = false;
}

// ====== PARSER (JSON novo + JSON {lines} + texto antigo) ======
function parseQC(raw, sourceName){
  const asJson = tryParseJson(raw);

  // 1) JSON pages/questions
  if (asJson && (Array.isArray(asJson?.pages) || Array.isArray(asJson))) {
    const questions = parseFromJson(asJson, sourceName);
    return { questions };
  }

  // 2) JSON {lines:[...]} -> junta e usa caminho textual
  if (asJson && Array.isArray(asJson?.lines)) {
    const text = asJson.lines.join('\n');
    return parseFromText(text, sourceName);
  }

  // 3) Texto puro
  return parseFromText(raw, sourceName);
}

// ====== CAMINHO TEXTO ======
function parseFromText(raw, sourceName){
  const norm = normalize(raw);
  const keyMap = parseAnswerKey_full(norm);
  const blocks = splitQuestions(norm);
  const questions = [];

  for (const b of blocks) {
    const q = parseQuestionBlock(b);
    if (!q) continue;

    // filtra imagens
    if (hasImageHint(q.enunciado) || q.alternativas.some(a => hasImageHint(a.text))) continue;

    // gabarito pelo índice n:
    const k = keyMap.get(q.numero);
    if (!k) continue;
    const corr = mapCEtoVF(k);

    // validações
    const isVF = q.alternativas.every(a => a.key === 'V' || a.key === 'F');
    const has = q.alternativas.some(a => a.key === corr) || (isVF && (corr === 'V' || corr === 'F'));
    if (!has) continue;

    q.correta = corr;
    q.fonte = sourceName || 'text';
    questions.push(q);
  }
  return { questions };
}

// ====== JSON (pages/questions) ======
function tryParseJson(t){
  const s = String(t || '').trim();
  if (!s || (s[0] !== '{' && s[0] !== '[')) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function parseFromJson(doc, sourceName){
  const pages = Array.isArray(doc?.pages) ? doc.pages : Array.isArray(doc) ? doc : [];
  const questions = [];
  let seq = 1;

  for (const p of pages){
    const qs = Array.isArray(p?.questions) ? p.questions : [];
    for (const q of qs){
      let stem = String(q?.title ?? '').trim();
      const opts = Array.isArray(q?.options) ? q.options : [];
      const alts = collectAlternativesFromOptions(opts);

      if (alts.length < 4) { seq++; continue; }
      if (hasImageHint(stem) || alts.some(a => hasImageHint(a.text))) { seq++; continue; }

      const id_qc = extractQCId(stem);
      const ciRaw = Number.isInteger(q?.correctIndex) ? q.correctIndex : null;
      const ci = normalizeCorrectIndex(ciRaw, alts.length);
      if (ci == null) { seq++; continue; }
      const letter = indexToLetter(ci);
      if (!alts.some(a => a.key === letter)) { seq++; continue; }

      questions.push({
        numero: seq,
        id_qc,
        tipo: deduceType(alts),
        enunciado: plain(stem),
        alternativas: alts,
        correta: letter,
        fonte: sourceName || 'json',
      });
      seq++;
    }
  }
  return questions;
}

function collectAlternativesFromOptions(options){
  const out = [];
  const startAt = detectOptionsStart(options);
  const letters = ['A','B','C','D','E'];
  for (let i = startAt; i < options.length && out.length < letters.length; i++){
    const raw = options[i];
    const text = typeof raw === 'string' ? raw : String(raw?.text ?? '');
    const clean = cleanupOption(text);
    if (!clean) continue;
    out.push({ key: letters[out.length], text: clean });
  }
  return out;
}

function detectOptionsStart(options){
  if (!Array.isArray(options) || options.length === 0) return 0;
  const first = typeof options[0] === 'string' ? options[0] : String(options[0]?.text ?? '');
  const hint = /Disciplina|Banca|Órgão|Orgao|Ano|Alternativas/i.test(first) || first.length > 240;
  return hint ? 1 : 0;
}

function normalizeCorrectIndex(ci, altsLen){
  if (!Number.isInteger(ci)) return null;
  if (ci >= 1 && ci <= altsLen) return ci - 1; // 1-based
  if (ci >= 0 && ci < altsLen) return ci;      // 0-based
  return null;
}

function indexToLetter(i){ return String.fromCharCode(65 + i); }
function deduceType(alts){
  const keys = new Set(alts.map(a=>a.key));
  return ([...keys].every(k => k==='V' || k==='F')) ? 'VF' : 'ME';
}
function plain(s){ return String(s).replace(/\s+/g,' ').trim(); }
function cleanupOption(s){
  const t = String(s || '').replace(/\s+/g,' ').trim();
  if (!t) return '';
  if (/^alternativas?:?\s*$/i.test(t)) return '';
  return t;
}
function extractQCId(s){
  const m = String(s).match(/\bQ(\d{3,})\b/i);
  return m ? m[1] : null;
}
function hasImageHint(s){
  if (!s) return false;
  const txt = String(s);
  if (/<img\b/i.test(txt)) return true;
  if (/\bhttps?:\/\/\S+\.(png|jpe?g|gif|webp|svg)\b/i.test(txt)) return true;
  return false;
}

// ====== TEXTO ANTIGO ======
function normalize(text){
  let t = String(text ?? '').replace(/\r\n?/g, '\n');
  t = t.replace(/\t/g, ' ');
  t = t.replace(/[–—]/g, '-');
  t = t.split('\n').map(line => line.replace(/\s+$/,'')).join('\n');
  return t;
}

// aceita blocos "1-5: A" e "1: A"
function parseAnswerKey_full(text){
  const sections = [...text.matchAll(/(?:^|\n)\s*(?:Respostas?|Gabarito)[^\n]*\n([\s\S]*?)(?=\n\s*(?:Respostas?|Gabarito)\b|$)/gmi)];
  const body = sections.length ? sections.map(m=>m[1]).join('\n') : text;
  const map = new Map();
  for (const m of body.matchAll(/(^|\s)(\d+)\s*-\s*(\d+)\s*:\s*([A-ECEVF])/gmi)){
    const a = +m[2], b = +m[3], v = m[4].toUpperCase();
    for (let n=a; n<=b; n++) map.set(n, v);
  }
  for (const m of body.matchAll(/(^|\s)(\d+)\s*:\s*([A-ECEVF])/gmi)){
    map.set(+m[2], m[3].toUpperCase());
  }
  return map;
}

// divide pelos cabeçalhos numéricos "1", "2", "3"… até antes de "Respostas"
function splitQuestions(text){
  const lines = text.split('\n');
  const idxs = [];
  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    if (/^\s*\d{1,5}\s*(?:Q\d+)?\s*$/.test(line)) idxs.push(i);
    if (/^\s*(Respostas?|Gabarito)\b/i.test(line)) break;
  }
  const blocks = [];
  for (let i=0;i<idxs.length;i++){
    const start = idxs[i];
    const end = i+1<idxs.length ? idxs[i+1] : lines.length;
    const chunk = lines.slice(start,end).join('\n').trim();
    if (chunk) blocks.push(chunk);
  }
  return blocks;
}

function parseQuestionBlock(block){
  const firstLine = block.split('\n',1)[0];
  const headerRe = /^\s*(\d{1,5})(?:\s+Q(\d+))?\s*$/;
  const h = firstLine.match(headerRe);
  if (!h) return null;
  const numero = Number(h[1]);
  const id_qc = h[2] ? String(h[2]) : null;

  const body = block.split('\n').slice(1);

  const altIdxs = body.map((l,i)=> isAltMarker(l) ? i : -1).filter(i=>i>=0);
  if (!altIdxs.length) return null;
  const firstAlt = altIdxs[0];

  const stemLines = cleanNoise(body.slice(0, firstAlt))
    .filter(l => !/^\s*(Ano|Banca|Órgão|Orgao|Prova)\b/i.test(l))
    .filter(l => !/^\s*(www\.|https?:\/\/)/i.test(l))
    .filter(l => !/^\s*(>|Breadcrumb|Assunto|Disciplina)\b/i.test(l));
  const stem = stemLines.join(' ').replace(/\s+/g,' ').trim();

  const altLines = body.slice(firstAlt);
  const alts = [];
  let current = null;
  for (let i=0;i<altLines.length;i++){
    const line = altLines[i];
    if (isAltMarker(line)){
      const m = splitMarker(line);
      if (current) alts.push(current);
      if (m.text && m.text.trim()){
        current = { key: m.key, text: m.text.trim() };
      } else {
        let j = i+1, buf = [];
        while (j < altLines.length && !isAltMarker(altLines[j])){
          const s = altLines[j].trim();
          if (s) buf.push(s);
          j++;
        }
        i = j-1;
        current = { key: m.key, text: buf.join(' ').replace(/\s+/g,' ').trim() };
      }
    } else if (current){
      const s = line.trim();
      if (s) current.text += ' ' + s;
    }
  }
  if (current) alts.push(current);

  const keys = new Set(alts.map(a=>a.key));
  const tipo = (keys.size && [...keys].every(k => k==='V'||k==='F')) ? 'VF' : 'ME';
  const valid = tipo==='ME' ? ['A','B','C','D','E'] : ['V','F'];
  const alternativas = alts
    .filter(a => valid.includes(a.key))
    .map(a => ({ key: a.key, text: a.text.trim() }))
    .filter(a => a.text.length);

  if (!alternativas.length || !stem) return null;

  return { numero, id_qc, tipo, enunciado: stem, alternativas, correta: null };
}

function cleanNoise(lines){
  return lines.filter(l =>
    !/^\s*(https?:\/\/|www\.)/i.test(l) &&
    !/^\s*(Treinador|Resumão|Conferir|Baixe|Assine|Prova comentada)\b/i.test(l)
  );
}

function isAltMarker(line){
  return /^\s*([ABCDEVFabcdevf])(?:[\)\.\-:]\s*|\s*$)/.test(line);
}
function splitMarker(line){
  const m = line.match(/^\s*([ABCDEVFabcdevf])(?:[\)\.\-:]\s*|\s*)(.*)$/);
  const key = normalizeKey(m[1]);
  return { key, text: (m[2]||'').trim() };
}
function normalizeKey(k){
  k = k.toUpperCase();
  if (k==='C') return 'C';
  if (k==='E') return 'E';
  return k;
}
function mapCEtoVF(letter){
  if (letter==='C') return 'V';
  if (letter==='E') return 'F';
  return letter.toUpperCase();
}

// ====== TEMAS ======
function buildThemesIndex(questions){
  const idx = new Map();
  idx.set('*', questions.map((_,i)=>i));
  const stop = new Set(['de','da','do','dos','das','e','a','o','os','as','em','no','na','nos','nas','para','por','com','sem','um','uma','ao','à','às','ou','que','se','é','ser','sobre','não','nos','às','um','uma','sua','seu','são','como','qual','quais','entre','pela','pelo']);
  const freq = new Map();
  questions.forEach((q)=>{
    const words = q.enunciado
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9\s]/g,' ')
      .split(/\s+/).filter(w => w && !stop.has(w) && w.length >= 3);
    for (let j=0;j<words.length-1;j++){
      const bg = words[j] + ' ' + words[j+1];
      if (bg.length < 7) continue;
      freq.set(bg, (freq.get(bg)||0)+1);
    }
  });
  const top = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).map(e=>e[0]);
  top.forEach(t => idx.set(t, []));
  questions.forEach((q,i)=>{
    for (const t of top){
      if (q.enunciado.toLowerCase().includes(t)) idx.get(t).push(i);
    }
  });
  for (const [t,arr] of [...idx.entries()]){
    if (t !== '*' && arr.length === 0) idx.delete(t);
  }
  return idx;
}
function labelTheme(t){ return t === '*' ? 'Todos' : t; }

// ====== HELPERS ======
async function loadText(path){
  const res = await fetch(path, {cache:'no-store'});
  if (!res.ok) throw new Error(`Falha ao carregar ${path}: HTTP ${res.status}`);
  return await res.text();
}
function shuffle(arr){
  for (let i=arr.length-1;i>0;i--){
    const j = (Math.random()*(i+1))|0; [arr[i],arr[j]] = [arr[j],arr[i]];
  }
}
function basename(p){ return p.split('/').pop(); }
function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ====== DISCOVERY ======
async function discoverCatalog(){
  // 1) Manifesto local opcional: /data/index.json  -> { "Categoria":[ "data/arquivo.json", ... ] }
  try {
    const r = await fetch('data/index.json', {cache:'no-store'});
    if (r.ok) {
      const j = await r.json();
      if (j && typeof j === 'object' && Object.keys(j).length){
        CATALOG = j;
        return;
      }
    }
  } catch {}

  // 2) GitHub API (GitHub Pages). Funciona para repositório público.
  try {
    const { owner, repo } = inferRepoFromLocation();
    if (!owner || !repo) throw new Error('repo indefinido');
    const branch = await getDefaultBranch(owner, repo);
    const base = `https://api.github.com/repos/${owner}/${repo}/contents`;

    const dataRoot = await ghList(`${base}/data?ref=${encodeURIComponent(branch)}`);
    const dirs = dataRoot.filter(e => e.type === 'dir');

    const catalog = {};
    for (const d of dirs){
      const files = await collectJsonFiles(`${base}/data/${encodeURIComponent(d.name)}?ref=${encodeURIComponent(branch)}`, branch);
      if (files.length) catalog[humanize(d.name)] = files.map(u => u.download_url);
    }
    const loose = dataRoot.filter(e => e.type === 'file' && e.name.toLowerCase().endsWith('.json'));
    if (loose.length){
      catalog['Geral'] = (catalog['Geral'] || []).concat(loose.map(u => u.download_url));
    }

    if (Object.keys(catalog).length) { CATALOG = catalog; return; }
  } catch (e){
    console.warn('Discovery via GitHub API falhou', e);
  }

  // 3) Fallback mínimo: tenta um arquivo padrão
  try {
    const fallback = 'data/quiz-1-10.json';
    const r = await fetch(fallback, {cache:'no-store'});
    if (r.ok) { CATALOG = { Geral: [fallback] }; return; }
  } catch {}
}

async function collectJsonFiles(apiUrl, branch){
  const items = await ghList(apiUrl);
  const acc = [];
  for (const it of items){
    if (it.type === 'file' && it.name.toLowerCase().endsWith('.json')) acc.push(it);
    if (it.type === 'dir'){
      const nested = await collectJsonFiles(`${it.url}?ref=${encodeURIComponent(branch)}`, branch);
      acc.push(...nested);
    }
  }
  return acc;
}

async function ghList(url){
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' }});
  if (!res.ok) throw new Error(`GitHub API ${res.status} @ ${url}`);
  return await res.json();
}

async function getDefaultBranch(owner, repo){
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (r.ok){
      const j = await r.json();
      return j.default_branch || 'main';
    }
  } catch {}
  return 'main';
}

function inferRepoFromLocation(){
  // Ex.: https://usuario.github.io/REPO/...
  const host = location.hostname;               // usuario.github.io
  const path = location.pathname.replace(/^\/+/,''); // REPO/...
  const owner = host.split('.')[0];
  const repo = path.split('/')[0] || '';
  return { owner, repo };
}

function humanize(s){
  return s.replace(/[-_]+/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}
