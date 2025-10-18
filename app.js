// app.js
// SPA: Home → Quiz. Fonte: arquivos locais em /data/<categoria>/*.txt
// Formato único: dump bruto QConcursos com gabarito ao final.

const els = {
  // topbar
  pathInfo: document.getElementById('pathInfo'),
  kTotal: document.getElementById('kTotal'),
  kDone: document.getElementById('kDone'),
  kScore: document.getElementById('kScore'),
  btnReset: document.getElementById('btnReset'),

  // home
  home: document.getElementById('home'),
  catTrigger: document.getElementById('catTrigger'),
  catTriggerText: document.getElementById('catTriggerText'),
  catMenu: document.getElementById('catMenu'),
  themesGrid: document.getElementById('themesGrid'),
  btnSelectAll: document.getElementById('btnSelectAll'),
  themesCount: document.getElementById('themesCount'),
  optShuffle: document.getElementById('optShuffle'),
  btnStart: document.getElementById('btnStart'),

  // quiz
  quiz: document.getElementById('quiz'),
  quizList: document.getElementById('quizList'),
  sentinel: document.getElementById('sentinel'),

  // template
  tpl: document.getElementById('tplQuestion'),
};

/* ================== CONFIG DOS DADOS ================== */
/* Adicione categorias e arquivos abaixo */
const CATEGORIES = {
  'Direito Penal': [
    'data/direito-penal/p3_p2_p1_merged.txt',
    // adicione outros dumps aqui
  ],
  // 'Direito Constitucional': ['data/constitucional/lote1.txt'],
};

const STOPWORDS_PT = new Set(`
a à ao aos as às o os um uma umas uns de da das do dos dum duma duns dumas
e em no na nos nas num numa nuns numas por para com sem sob sobre entre até
ou como mais menos muito muitos muita muitas pouco poucos pouca poucas
que qual quais cujo cuja cujos cujas cujo cuja se já só também porém todavia
porque porquê portanto sendo sendo-se ser ter há houve tinham tinham-se
é são foi eram estava estavam estiveram estivera sendo sido
eu tu ele ela nós vós eles elas me te se nos vos lhes lhe meu minha meus minhas
teu tua teus tuas seu sua seus suas nosso nossa nossos nossas vosso vossa vossos vossas
depois antes durante quando onde enquanto então assim ainda cada todo toda todos todas
`.split(/\s+/).filter(Boolean));

/* ================== ESTADO DA APLICAÇÃO ================== */
let state = {
  route: 'home',
  category: null,
  themesAll: [],       // lista de temas possíveis para a categoria
  themesSelected: new Set(),
  questionsAll: [],    // todas questões da categoria
  questionsFiltered: [],
  order: [],
  pageSize: 3,
  page: 0,
  done: new Set(),     // índices em questionsFiltered
  score: 0,
};

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) mountNextPage();
});
io.observe(els.sentinel);

/* ================== BOOT ================== */
init();

function init() {
  buildCategoryMenu();
  bindUI();
  loadSessionIfAny();
  renderStats();
}

/* ================== UI BINDINGS ================== */
function bindUI() {
  // Dropdown de categoria
  els.catTrigger.addEventListener('click', () => {
    const open = els.catMenu.classList.toggle('open');
    els.catTrigger.setAttribute('aria-expanded', String(open));
    if (open) els.catMenu.focus();
  });
  document.addEventListener('click', (e) => {
    if (!els.catMenu.contains(e.target) && !els.catTrigger.contains(e.target)) {
      els.catMenu.classList.remove('open');
      els.catTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  // Selecionar todos os temas
  els.btnSelectAll.addEventListener('click', () => {
    if (state.themesSelected.size === state.themesAll.length) {
      state.themesSelected.clear();
    } else {
      state.themesAll.forEach(t => state.themesSelected.add(t));
    }
    renderThemes();
    updateStartButton();
  });

  // Embaralhar opt
  els.optShuffle.addEventListener('change', () => {
    if (state.route === 'quiz') {
      prepareOrder();
      rerenderQuiz();
    }
  });

  // Iniciar quiz
  els.btnStart.addEventListener('click', () => {
    if (!state.category || state.themesSelected.size === 0) return;
    startQuiz();
  });

  // Zerar sessão
  els.btnReset.addEventListener('click', () => {
    clearSession();
    if (state.route === 'quiz') {
      state.done.clear();
      state.score = 0;
      rerenderQuiz();
      renderStats();
      saveSession();
    }
  });
}

/* ================== MENU DE CATEGORIAS ================== */
function buildCategoryMenu() {
  els.catMenu.innerHTML = '';
  Object.keys(CATEGORIES).forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.setAttribute('role', 'option');
    item.dataset.value = name;
    item.textContent = name;
    item.addEventListener('click', () => onChooseCategory(name));
    if (i === 0) item.setAttribute('aria-selected', 'false');
    els.catMenu.append(item);
  });
}

async function onChooseCategory(name) {
  if (state.category === name && state.questionsAll.length) {
    els.catTriggerText.textContent = name;
    els.catMenu.querySelectorAll('.item').forEach(i => {
      i.setAttribute('aria-selected', i.dataset.value === name ? 'true' : 'false');
    });
    renderThemes();
    updateStartButton();
    return;
  }

  // UI
  els.catTriggerText.textContent = 'Carregando…';
  els.catMenu.classList.remove('open');
  els.catTrigger.setAttribute('aria-expanded', 'false');
  els.catMenu.querySelectorAll('.item').forEach(i => {
    i.setAttribute('aria-selected', i.dataset.value === name ? 'true' : 'false');
  });

  // Estado
  resetStateKeepCategory();
  state.category = name;

  // Carregar e parsear todos os arquivos da categoria
  const files = CATEGORIES[name];
  const allQuestions = [];
  for (const path of files) {
    const txt = await fetchLocal(path);
    const parsed = parseQC(txt, path);
    allQuestions.push(...parsed.questions);
  }
  state.questionsAll = allQuestions;

  // Derivar temas pela frequência de termos do enunciado
  state.themesAll = extractThemes(state.questionsAll);
  state.themesSelected = new Set(state.themesAll.slice(0, 8)); // seleção inicial
  els.catTriggerText.textContent = name;
  renderThemes();
  updateStartButton();
  els.pathInfo.textContent = `${name} • selecione temas`;
  saveSession();
}

function resetStateKeepCategory() {
  state = {
    route: 'home',
    category: state.category,
    themesAll: [],
    themesSelected: new Set(),
    questionsAll: [],
    questionsFiltered: [],
    order: [],
    pageSize: 3,
    page: 0,
    done: new Set(),
    score: 0,
  };
  els.quizList.innerHTML = '';
  renderStats();
}

/* ================== TEMAS ================== */
function renderThemes() {
  els.themesGrid.innerHTML = '';
  const list = state.themesAll;
  list.forEach(t => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', state.themesSelected.has(t) ? 'true' : 'false');
    chip.textContent = t;
    chip.addEventListener('click', () => {
      if (state.themesSelected.has(t)) state.themesSelected.delete(t);
      else state.themesSelected.add(t);
      chip.setAttribute('aria-pressed', state.themesSelected.has(t) ? 'true' : 'false');
      updateThemesCount();
      updateStartButton();
      saveSession();
    });
    els.themesGrid.append(chip);
  });
  updateThemesCount();
}

function updateThemesCount() {
  els.themesCount.textContent = `${state.themesSelected.size} selecionado(s)`;
}

function updateStartButton() {
  els.btnStart.disabled = !(state.category && state.themesSelected.size > 0);
}

/* ================== QUIZ ================== */
function startQuiz() {
  state.route = 'quiz';
  // Filtrar por temas
  state.questionsFiltered = state.questionsAll.filter(q => {
    const tags = guessQuestionThemes(q);
    return tags.some(t => state.themesSelected.has(t));
  });
  if (state.questionsFiltered.length === 0) {
    // fallback: se filtro ficou vazio, usa todas
    state.questionsFiltered = [...state.questionsAll];
  }
  prepareOrder();
  // UI
  els.home.classList.add('hidden');
  els.quiz.classList.remove('hidden');
  els.pathInfo.textContent = `${state.category} • ${[...state.themesSelected].slice(0,3).join(', ')}${state.themesSelected.size>3?'…':''}`;
  rerenderQuiz();
  renderStats();
  saveSession();
}

function prepareOrder() {
  state.order = [...state.questionsFiltered.keys()];
  if (els.optShuffle.checked) shuffle(state.order);
  state.page = 0;
}

function rerenderQuiz() {
  els.quizList.innerHTML = '';
  state.page = 0;
  mountNextPage();
}

function mountNextPage() {
  const start = state.page * state.pageSize;
  const end = Math.min(start + state.pageSize, state.order.length);
  if (start >= end) {
    els.sentinel.textContent = 'Fim';
    return;
  }
  els.sentinel.textContent = 'Carregando…';
  const slice = state.order.slice(start, end);
  for (const idx of slice) mountQuestion(idx);
  state.page++;
  els.sentinel.textContent = 'Carregando…';
}

function mountQuestion(i) {
  const q = state.questionsFiltered[i];
  const node = els.tpl.content.firstElementChild.cloneNode(true);
  node.dataset.num = q.numero;
  node.querySelector('.q-num').textContent = `#${q.numero}`;
  node.querySelector('.q-id').textContent = q.id_qc ? `Q${q.id_qc}` : '';
  node.querySelector('.q-type').textContent = q.tipo;
  node.querySelector('.q-stem').textContent = q.enunciado;

  const ol = node.querySelector('.q-options');
  q.alternativas.forEach(({ key, text }) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'button');
    li.setAttribute('aria-disabled', 'false');
    li.dataset.key = key;
    const k = document.createElement('span');
    k.className = 'opt-key';
    k.textContent = key + ')';
    const t = document.createElement('div');
    t.className = 'opt-text';
    t.textContent = text;
    li.append(k, t);
    li.addEventListener('click', () => onAnswer(li, q, i, node));
    ol.append(li);
  });

  node.querySelector('.q-show').addEventListener('click', () => reveal(node, q.correta, i));
  node.querySelector('.q-next').addEventListener('click', () => scrollToNextCard(node));

  els.quizList.append(node);
}

function onAnswer(li, q, idx, card) {
  if (li.getAttribute('aria-disabled') === 'true') return;
  const chosen = li.dataset.key;
  const correct = q.correta;
  const options = card.querySelectorAll('.q-options li');
  options.forEach(o => o.setAttribute('aria-disabled','true'));
  if (chosen === correct) {
    li.classList.add('correct');
    state.score++;
  } else {
    li.classList.add('wrong');
    options.forEach(o => { if (o.dataset.key === correct) o.classList.add('correct'); });
  }
  state.done.add(idx);
  card.querySelector('.q-result').textContent = `Gabarito: ${correct}`;
  renderStats();
  saveSession();
}

function reveal(card, correct, idx) {
  const options = card.querySelectorAll('.q-options li');
  options.forEach(o => o.setAttribute('aria-disabled','true'));
  options.forEach(o => { if (o.dataset.key === correct) o.classList.add('correct'); });
  state.done.add(idx);
  card.querySelector('.q-result').textContent = `Gabarito: ${correct}`;
  renderStats();
  saveSession();
}

function scrollToNextCard(card) {
  const next = card.nextElementSibling;
  if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================== PARSER QC ================== */
function parseQC(raw, pathName) {
  const norm = normalize(raw);
  const keyMap = parseAnswerKey(norm);
  const blocks = splitQuestions(norm);
  const questions = [];

  for (const b of blocks) {
    const q = parseQuestionBlock(b);
    if (!q) continue;
    const correct = keyMap.get(q.numero);
    if (!correct) continue;
    const corr = mapCEtoVF(correct);
    // garantir existência
    const ok = q.alternativas.some(a => a.key === corr) ||
               ((corr === 'V' || corr === 'F') && q.alternativas.every(a => a.key === 'V' || a.key === 'F'));
    if (!ok) continue;
    q.correta = corr;
    questions.push(q);
  }
  return { questions, sourceName: pathName || '' };
}

function normalize(text) {
  let t = text.replace(/\r\n?/g, '\n');
  t = t.replace(/\t/g, ' ');
  t = t.replace(/[–—]/g, '-');
  t = t.split('\n').map(l => l.replace(/\s+$/,'')).join('\n');
  // remover banners/rodapés óbvios
  t = t.replace(/Treinador\s*→.*?\n/g, '');
  t = t.replace(/Conferir resumão.*?\n/gi, '');
  t = t.replace(/qconcursos\.com.*?\n/gi, '');
  return t;
}

function parseAnswerKey(text) {
  const map = new Map();
  const mid = Math.floor(text.length * 0.4);
  const tail = text.slice(mid);

  const range = /(^|\s)(\d{1,5})\s*-\s*(\d{1,5})\s*:\s*([A-ECEVF])/gmi;
  for (const m of tail.matchAll(range)) {
    const a = Number(m[2]); const b = Number(m[3]); const v = m[
