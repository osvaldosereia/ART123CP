// app.js
// MeuJus — GitHub Pages + GitHub API + PDF.js
// Lê automaticamente PDFs em /data/codigo_penal/, extrai temas e monta quiz incremental.

const CONFIG = {
  OWNER: "osvaldosereia",
  REPO: "ART123CP",
  BRANCH_CANDIDATES: ["main"],
  PATHS: [{ cat: "Direito Penal", dir: "data/codigo_penal" }],
  LOAD_CHUNK: 3
};

// Estado
const state = {
  catalog: {},   // { "Direito Penal": { "Tema": [q...] } }
  flat: [],      // [{...question...}]
  current: { cat: "Direito Penal", tema: null },
  viewIndex: 0
};

// UI refs
const $temaSelect = document.getElementById("tema-select");
const $btnBuscar = document.getElementById("btn-buscar");
const $quiz = document.getElementById("quiz");
const $btnLoadMore = document.getElementById("btn-load-more");
const $loadMoreWrap = document.getElementById("load-more-wrap");
const $btnNovo = document.getElementById("btn-novo");

// Início
init();

async function init() {
  wireSelect($temaSelect);
  $btnBuscar.addEventListener("click", onBuscar);
  $btnLoadMore.addEventListener("click", onLoadMore);
  $btnNovo.addEventListener("click", resetQuiz);

  const ok = await buildCatalog();
  if (!ok) {
    toast("Falha ao listar PDFs do repositório. Verifique OWNER/REPO/branch e se os PDFs estão públicos.");
    return;
  }
  populateTemas();
}

// Lista PDFs via GitHub Contents API e processa
async function buildCatalog() {
  for (const { cat, dir } of CONFIG.PATHS) {
    for (const branch of CONFIG.BRANCH_CANDIDATES) {
      try {
        const listUrl = `https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${dir}?ref=${branch}`;
        const res = await fetch(listUrl, { headers: { "Accept": "application/vnd.github+json" }});
        if (!res.ok) continue;
        const files = await res.json();
        const pdfs = files.filter(f => f.type === "file" && /\.pdf$/i.test(f.name));
        const questions = [];
        for (const f of pdfs) {
          const rawUrl = `https://raw.githubusercontent.com/${CONFIG.OWNER}/${CONFIG.REPO}/${branch}/${dir}/${encodeURIComponent(f.name)}`;
          const qs = await extractQuestionsFromPDF(rawUrl, cat);
          questions.push(...qs);
        }
        const grouped = groupByTema(questions);
        state.catalog[cat] = grouped;
        return true;
      } catch (e) {
        continue;
      }
    }
  }
  return false;
}

// Extrai texto com PDF.js e converte em questões
async function extractQuestionsFromPDF(url, cat) {
  const doc = await pdfjsLib.getDocument({ url, useSystemFonts: true }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ normalizeWhitespace: true });
    const str = content.items.map(i => i.str).join("\n");
    text += "\n" + str;
  }
  const lines = text
    .replace(/\u00A0/g, " ")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const questions = [];
  let currentTema = "Sem tema";
  let buffer = [];

  const pushBuffered = () => {
    if (!buffer.length) return;
    const raw = buffer.join(" ").replace(/\s{2,}/g, " ").trim();
    const q = parseQuestion(raw, currentTema, cat);
    if (q) questions.push(q);
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];

    if (/>Direito Penal/i.test(L) || /Teoria Geral do Delito|Conceito de crime|Lei penal no tempo|Lei penal no espaço|Princípios|Antijuridicidade|Reincidência|Sistemas penais|A norma penal/i.test(L)) {
      const tema = extractTema(L);
      if (tema) currentTema = tema;
    }

    if (/^(Ano:|Q\d{3,}|^\[\s*Questão Inédita\])/i.test(L)) {
      pushBuffered();
      buffer.push(L);
      continue;
    }

    if (/^(A|B|C|D|E)\s[^\s]/.test(L) || /^(Certo|Errado)$/i.test(L)) {
      buffer.push(L);
      continue;
    }

    buffer.push(L);
  }
  pushBuffered();

  const seen = new Set();
  return questions.filter(q => {
    const key = q.title.slice(0, 160);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Extrai tema
function extractTema(line) {
  const afterArrow = line.split(">").pop();
  let tema = afterArrow || line;

  if (tema.includes(",")) {
    const parts = tema.split(",").map(s => s.trim()).filter(Boolean);
    tema = parts[parts.length - 1];
  }

  tema = tema
    .replace(/Prova:.*$/i, "")
    .replace(/\bNoções Fundamentais\b/ig, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\W+|\W+$/g, "")
    .trim();

  const map = [
    ["Teoria Geral do Delito", /Teoria Geral do Delito/i],
    ["Conceito de crime", /Conceit[oó] de crime|A norma penal|Conceitos e caracteres/i],
    ["Lei penal no tempo", /Lei penal no tempo|retroage|ultra-atividade|ultratividade/i],
    ["Lei penal no espaço", /Lei penal no espa[cç]o|extraterritorialidade|territorialidade/i],
    ["Princípios penais", /Princ[ií]pios.*(punitivo|legalidade|insignific[aâ]ncia|continuidade|analogia)/i],
    ["Antijuridicidade e legítima defesa", /Antijuridicidade|leg[ií]tima defesa|ilicitude/i],
    ["Reincidência e penas", /Reincid[eê]ncia|Penas privativas/i],
    ["Sistemas penais", /Sistemas penais/i]
  ];
  for (const [t, rx] of map) if (rx.test(line)) return t;

  return tema || "Sem tema";
}

// Converte bloco em questão
function parseQuestion(raw, tema, cat) {
  const ceRx = /\b(Certo|Errado)\b/ig;
  const parts = raw.split(/\sA\s(?=[^\s])/);
  let title = parts[0].trim();
  let options = [];
  let correctIndex = -1;

  const ce = [...title.matchAll(ceRx)].map(m => m[1]?.toLowerCase());
  if (ce.length) {
    options = ["Certo", "Errado"].map((t, i) => ({ text: t, i }));
  }

  if (parts.length > 1) {
    const rest = "A " + parts.slice(1).join(" A ");
    const opts = rest.split(/\s([B|C|D|E])\s(?=[^\s])/i);
    const reconstructed = [];
    let current = "A " + opts.shift();
    reconstructed.push(current.trim());
    while (opts.length) {
      const marker = opts.shift();
      const content = opts.shift() || "";
      reconstructed.push((marker.toUpperCase() + " " + content).trim());
    }
    options = reconstructed
      .map(s => s.replace(/Prova:.*$/i, "").trim())
      .filter(s => /^[A-E]\s/.test(s))
      .map(s => s.replace(/^[A-E]\s/, ""))
      .map((t, i) => ({ text: t, i }));
  }

  title = title
    .replace(/^Ano:.*?(Certo|Errado)?$/i, "")
    .replace(/^\d+\s+Q\d+\s+>?.*?-\s*/i, "")
    .replace(/Prova:.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!title) return null;

  return { cat, tema, title, options, correctIndex, sources: [] };
}

// Agrupa por tema
function groupByTema(list) {
  const g = {};
  for (const q of list) {
    const key = q.tema || "Sem tema";
    if (!g[key]) g[key] = [];
    g[key].push(q);
  }
  for (const k of Object.keys(g)) g[k].sort((a,b)=>a.title.localeCompare(b.title));
  return g;
}

// Dropdown custom
function wireSelect(root) {
  const toggle = root.querySelector(".select-toggle");
  const menu = root.querySelector(".select-menu");
  toggle.addEventListener("click", () => { menu.hidden = !menu.hidden; });
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) menu.hidden = true; });
  root._set = (label, value) => {
    toggle.querySelector("span").textContent = label;
    root.dataset.value = value;
  };
  root._fill = (items) => {
    const ul = menu;
    ul.innerHTML = "";
    items.forEach(({ label, value }) => {
      const li = document.createElement("li");
      li.textContent = label;
      li.addEventListener("click", () => { root._set(label, value); ul.hidden = true; });
      ul.appendChild(li);
    });
    if (items.length) root._set(items[0].label, items[0].value);
  };
}

// Preenche temas
function populateTemas() {
  const cat = state.current.cat;
  const temas = Object.keys(state.catalog[cat] || {}).sort();
  const items = temas.map(t => ({ label: t, value: t }));
  $temaSelect._fill(items.length ? items : [{ label: "Sem tema", value: "Sem tema" }]);
}

// Buscar → monta quiz
function onBuscar() {
  const tema = $temaSelect.dataset.value || "Sem tema";
  state.current.tema = tema;
  state.flat = [...(state.catalog[state.current.cat]?.[tema] || [])];
  state.viewIndex = 0;
  $quiz.innerHTML = "";
  $loadMoreWrap.hidden = true;
  renderNextChunk();
}

// Carregar mais
function onLoadMore() {
  renderNextChunk();
}

// Renderiza mais N
function renderNextChunk() {
  const start = state.viewIndex;
  const end = Math.min(start + CONFIG.LOAD_CHUNK, state.flat.length);
  for (let i = start; i < end; i++) renderQuestion(state.flat[i]);
  state.viewIndex = end;
  $loadMoreWrap.hidden = state.viewIndex >= state.flat.length;
}

// Render de uma questão
function renderQuestion(q) {
  const tpl = document.getElementById("q-item");
  const node = tpl.content.cloneNode(true);
  node.querySelector(".q-cat").textContent = q.cat;
  node.querySelector(".q-tema").textContent = q.tema;
  node.querySelector(".q-title").textContent = q.title;

  const $opts = node.querySelector(".q-options");
  if (!q.options.length) q.options = [{ text: "Certo", i:0 }, { text: "Errado", i:1 }];
  q.options.forEach((opt, idx) => {
    const li = document.createElement("li");
    li.textContent = opt.text;
    li.addEventListener("click", () => handleAnswer(li, idx, q));
    $opts.appendChild(li);
  });

  const $btnAI = node.querySelector(".btn-ai");
  const $mini = node.querySelector(".mini");
  const [aGabarito, aGlos, aVid] = $mini.querySelectorAll(".mini-btn");
  const qParam = encodeURIComponent(`${q.tema} ${q.title}`.trim());
  aGabarito.href = `https://www.google.com/search?q=${encodeURIComponent("gabarito comentado")}+${qParam}`;
  aGlos.href     = `https://www.google.com/search?q=${encodeURIComponent("glossário penal")}+${qParam}`;
  aVid.href      = `https://www.google.com/search?q=${encodeURIComponent("vídeos explicativos direito penal")}+${qParam}`;
  $btnAI.addEventListener("click", () => { $mini.hidden = !$mini.hidden; });

  $quiz.appendChild(node);
}

// Lógica de resposta
function handleAnswer(li, idx, q) {
  const ul = li.parentElement;
  const items = [...ul.children];
  items.forEach(el => el.classList.remove("correct","wrong","reveal"));
  if (q.correctIndex >= 0) {
    if (idx === q.correctIndex) li.classList.add("correct");
    else { li.classList.add("wrong"); items[q.correctIndex]?.classList.add("correct","reveal"); }
  } else {
    li.classList.add("wrong");
  }
}

// Novo quiz
function resetQuiz() {
  $quiz.innerHTML = "";
  state.viewIndex = 0;
  state.flat = [];
  $loadMoreWrap.hidden = true;
}

// Utilidade simples
function toast(msg) { console.warn(msg); }
