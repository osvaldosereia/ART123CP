// app.js
/* Site: Quiz para "dump bruto do QConcursos" com gabarito ao final. */

const els = {
  url: document.getElementById('txtUrl'),
  file: document.getElementById('txtFile'),
  load: document.getElementById('btnLoad'),
  reset: document.getElementById('btnReset'),
  info: document.getElementById('srcInfo'),
  list: document.getElementById('list'),
  sentinel: document.getElementById('sentinel'),
  kTotal: document.getElementById('kTotal'),
  kDone: document.getElementById('kDone'),
  kScore: document.getElementById('kScore'),
  fOnlyPending: document.getElementById('fShowOnlyPending'),
  fShuffle: document.getElementById('fShuffle'),
  tpl: document.getElementById('tplQuestion'),
};

let state = {
  questions: [],
  order: [],
  pageSize: 12,
  page: 0,
  done: new Set(),
  score: 0,
  sourceName: '',
};

els.load.addEventListener('click', async () => {
  const text = await readInputText();
  if (!text) return;
  resetAll();
  const { questions, sourceName } = parseQC(text);
  state.questions = questions;
  state.sourceName = sourceName;
  els.info.textContent = sourceName;
  state.order = [...questions.keys()];
  if (els.fShuffle.checked) shuffle(state.order);
  renderStats();
  mountFirstPage();
});

els.file.addEventListener('change', async () => {
  if (els.file.files?.length) {
    const txt = await els.file.files[0].text();
    els.url.value = '';
    resetAll();
    const { questions, sourceName } = parseQC(txt, els.file.files[0].name);
    state.questions = questions;
    state.sourceName = sourceName;
    els.info.textContent = sourceName;
    state.order = [...questions.keys()];
    if (els.fShuffle.checked) shuffle(state.order);
    renderStats();
    mountFirstPage();
  }
});

els.fOnlyPending.addEventListener('change', () => {
  rerenderList();
});
els.fShuffle.addEventListener('change', () => {
  if (!state.questions.length) return;
  state.order = [...state.questions.keys()];
  if (els.fShuffle.checked) shuffle(state.order);
  state.page = 0;
  els.list.innerHTML = '';
  mountFirstPage();
});

els.reset.addEventListener('click', () => {
  state.done.clear();
  state.score = 0;
  document.querySelectorAll('.q-options li').forEach(li => {
    li.classList.remove('correct','wrong');
    li.setAttribute('aria-disabled','false');
  });
  document.querySelectorAll('.q-result').forEach(e => e.textContent = '');
  renderStats();
});

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      mountNextPage();
    }
  }
});
io.observe(els.sentinel);

async function readInputText() {
  const url = els.url.value.trim();
  if (url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      return txt;
    } catch (e) {
      alert('Falha ao baixar URL.');
      return '';
    }
  }
  if (els.file.files?.length) {
    return await els.file.files[0].text();
  }
  alert('Informe uma URL ou selecione um arquivo .txt.');
  return '';
}

function resetAll() {
  state = { questions: [], order: [], pageSize: 12, page: 0, done: new Set(), score: 0, sourceName: '' };
  els.list.innerHTML = '';
  els.info.textContent = 'carregando…';
  renderStats();
}

function renderStats() {
  els.kTotal.textContent = state.questions.length;
  els.kDone.textContent = state.done.size;
  els.kScore.textContent = state.score;
}

function mountFirstPage() {
  els.list.innerHTML = '';
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
  const onlyPending = els.fOnlyPending.checked;
  for (let i = start; i < end; i++) {
    const idx = state.order[i];
    if (onlyPending && state.done.has(idx)) continue;
    mountQuestion(idx);
  }
  state.page++;
}

function rerenderList() {
  els.list.innerHTML = '';
  state.page = 0;
  mountNextPage();
}

function mountQuestion(index) {
  const q = state.questions[index];
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
    li.addEventListener('click', () => onAnswer(li, q, index, node));
    ol.append(li);
  });

  node.querySelector('.q-show').addEventListener('click', () => {
    reveal(node, q.correta);
  });

  els.list.append(node);
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
}

function reveal(card, correct) {
  const options = card.querySelectorAll('.q-options li');
  options.forEach(o => o.setAttribute('aria-disabled','true'));
  options.forEach(o => { if (o.dataset.key === correct) o.classList.add('correct'); });
  const num = Number(card.dataset.num);
  const idx = state.questions.findIndex(q => q.numero === num);
  if (idx >= 0) state.done.add(idx);
  card.querySelector('.q-result').textContent = `Gabarito: ${correct}`;
  renderStats();
}

/* ===================== PARSER QC ===================== */

function parseQC(raw, overrideName) {
  const sourceName = overrideName || guessSourceName(raw);
  const norm = normalize(raw);
  const keyMap = parseAnswerKey(norm);
  const blocks = splitQuestions(norm);
  const questions = [];

  for (const b of blocks) {
    const q = parseQuestionBlock(b);
    if (!q) continue;
    const correct = keyMap.get(q.numero);
    if (!correct) continue; // ignorar sem gabarito
    // coerção C/E -> V/F quando aplicável
    const corr = mapCEtoVF(correct);
    // manter só alternativas que existem
    const has = q.alternativas.some(a => a.key === corr);
    if (!has) {
      // se corr C/E e alternativas V/F, converter
      if ((corr === 'V' || corr === 'F') &&
          q.alternativas.every(a => a.key === 'V' || a.key === 'F')) {
        // ok
      } else {
        continue;
      }
    }
    q.correta = corr;
    questions.push(q);
  }

  return { questions, sourceName };
}

function normalize(text) {
  // normalizações básicas
  let t = text.replace(/\r\n?/g, '\n');
  t = t.replace(/\t/g, ' ');
  // colar linhas que são continuações de alternativa por indentação
  t = t.split('\n').map(line => line.replace(/\s+$/,'')).join('\n');
  // padronizar travessão/range
  t = t.replace(/–|—/g, '-');
  return t;
}

function guessSourceName(text) {
  const firstLine = text.split('\n').find(l => l.trim().length);
  return firstLine ? `arquivo: ${firstLine.slice(0,60)}…` : 'arquivo sem título';
}

function parseAnswerKey(text) {
  // Captura pares e intervalos como "61: D" ou "61-80: D"
  const map = new Map();
  const keyRegex = /(^|\s)(\d+)\s*-\s*(\d+)\s*:\s*([A-ECEVF])/gmi;
  const pairRegex = /(^|\s)(\d+)\s*:\s*([A-ECEVF])/gmi;

  // Buscar da metade final do arquivo para evitar falsos positivos no enunciado
  const mid = Math.floor(text.length * 0.5);
  const tail = text.slice(mid);

  for (const m of tail.matchAll(keyRegex)) {
    const a = Number(m[2]); const b = Number(m[3]); const v = m[4].toUpperCase();
    for (let n = a; n <= b; n++) map.set(n, v);
  }
  for (const m of tail.matchAll(pairRegex)) {
    const n = Number(m[2]); const v = m[3].toUpperCase();
    map.set(n, v); // última ocorrência vence
  }
  return map;
}

function splitQuestions(text) {
  // Delimitar por linhas que começam com número e opcional "Q\d+"
  const lines = text.split('\n');
  const idxs = [];
  const head = /^\s*(\d{1,5})(?:\s+Q\d+)?\b/;
  for (let i = 0; i < lines.length; i++) {
    if (head.test(lines[i])) idxs.push(i);
  }
  const blocks = [];
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i];
    const end = i + 1 < idxs.length ? idxs[i+1] : lines.length;
    const chunk = lines.slice(start, end).join('\n').trim();
    if (chunk) blocks.push(chunk);
  }
  return blocks;
}

function parseQuestionBlock(block) {
  // Cabeçalho
  const headerRe = /^\s*(\d{1,5})(?:\s+Q(\d+))?/;
  const m = block.match(headerRe);
  if (!m) return null;
  const numero = Number(m[1]);
  const id_qc = m[2] ? String(m[2]) : null;

  // Separar enunciado e alternativas
  const lines = block.split('\n').slice(1); // remove cabeçalho
  const altStartIdx = lines.findIndex(l => isAltMarker(l));
  if (altStartIdx === -1) return null;

  const stem = lines.slice(0, altStartIdx).join('\n').trim();
  const altLines = lines.slice(altStartIdx);

  // Unir linhas contínuas de cada alternativa
  const alts = [];
  let current = null;
  for (const raw of altLines) {
    if (isAltMarker(raw)) {
      if (current) alts.push(current);
      const { key, text } = splitMarker(raw);
      current = { key, text };
    } else {
      if (current) {
        const s = raw.trim();
        if (s) current.text += '\n' + s;
      }
    }
  }
  if (current) alts.push(current);

  // Determinar tipo
  const keys = new Set(alts.map(a => a.key));
  let tipo = 'ME';
  if (keys.size <= 2 && subset(keys, new Set(['V','F'])) ) tipo = 'VF';

  // Filtrar alternativas inválidas
  const validKeys = tipo === 'ME' ? ['A','B','C','D','E'] : ['V','F'];
  const alternativas = alts
    .filter(a => validKeys.includes(a.key))
    .map(a => ({ key: a.key, text: a.text.trim() }))
    .filter(a => a.text.length);

  if (!alternativas.length) return null;

  return { numero, id_qc, tipo, enunciado: stem, alternativas, correta: null };
}

function isAltMarker(line) {
  // Início de alternativa no começo da linha
  return /^\s*([ABCDEVFabcdevf])[\)\.\-]\s+/.test(line);
}
function splitMarker(line) {
  const m = line.match(/^\s*([ABCDEVFabcdevf])[\)\.\-]\s+(.*)$/);
  const key = normalizeKey(m[1]);
  return { key, text: m[2] || '' };
}
function normalizeKey(k) {
  k = k.toUpperCase();
  if (k === 'E') return 'E'; // cuidado: pode ser alternativa E ou Errado, resolvemos no gabarito
  if (k === 'C') return 'C'; // só aparece em gabarito; não aqui
  if (k === 'V' || k === 'F') return k;
  return k; // A-D-E
}
function mapCEtoVF(letter) {
  if (letter === 'C') return 'V';
  if (letter === 'E') return 'F';
  return letter;
}
function subset(a, b) {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/* ===================== UTILS ===================== */

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
