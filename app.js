/* app.js — MeuJus (somente modo claro)
   Foco: previsibilidade no reload, leitura de HTML do /data, prefetch controlado,
   reidratação explícita via diálogo de retomada, navegação e acessibilidade estáveis. */

/* ======================== Config ======================== */
const CONFIG = {
  // Caminho base para os arquivos HTML do data/.
  DATA_BASE: "./data/",
  // Controle de retomada automática. Mantemos desligado por padrão.
  AUTO_RESUME_DEFAULT: false,
  // Prefetch da próxima página quando o usuário está lendo a atual.
  PREFETCH_DEFAULT: true,
  // Versão de cache para invalidar chaves antigas quando o parser mudar.
  CACHE_VERSION: "v3",
  // Limite de histórico de sessões recentes.
  HISTORY_LIMIT: 20,
};

/* ======================== Estado ======================== */
const State = {
  loading: false,
  quiz: null,               // { id, title, questions[], currentIndex, meta, pages, sourcePaths[] }
  pageMap: new Map(),       // path -> {meta, questions[]}
  prefetching: new Set(),   // paths em prefetch
  settings: {
    autoResume: CONFIG.AUTO_RESUME_DEFAULT,
    prefetch: CONFIG.PREFETCH_DEFAULT,
    haptics: false,
  },
  lastSession: null,        // { id, path, index, ts, pages[] }
  manifest: null,           // opcional: catálogo carregado
};

/* ======================== Utilidades ======================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const defer = (ms) => new Promise(r => setTimeout(r, ms));

function toast(msg, type = "info", timeout = 3500) {
  const wrap = $("#toast-wrap");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.role = "status";
  el.tabIndex = -1;
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const close = () => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", close);
  setTimeout(close, timeout);
}

function haptics(light = true) {
  try {
    if (!State.settings.haptics) return;
    if ("vibrate" in navigator) navigator.vibrate(light ? 8 : [10, 20, 10]);
  } catch {}
}

function nowISO() { return new Date().toISOString(); }

/* ======================== Storage (LocalStorage) ======================== */
const LS = {
  k(key) { return `meujus:${CONFIG.CACHE_VERSION}:${key}`; },
  get(key, fallback = null) {
    try { const v = localStorage.getItem(LS.k(key)); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(LS.k(key), JSON.stringify(value)); } catch {}
  },
  del(key) {
    try { localStorage.removeItem(LS.k(key)); } catch {}
  },
};

/* Sessões e histórico */
const Sessions = {
  save(session) {
    LS.set("lastSession", session);
    const list = LS.get("history", []);
    const filtered = [session, ...list.filter(s => s.id !== session.id)].slice(0, CONFIG.HISTORY_LIMIT);
    LS.set("history", filtered);
  },
  loadLast() { return LS.get("lastSession", null); },
  history() { return LS.get("history", []); },
  clear() { LS.del("history"); LS.del("lastSession"); },
};

/* Cache de páginas HTML já parseadas do data/ */
const QuizCache = {
  key(path) { return `qcache:${path}`; },
  get(path) { return LS.get(QuizCache.key(path)); },
  set(path, value) { LS.set(QuizCache.key(path), value); },
  del(path) { LS.del(QuizCache.key(path)); },
};

/* ======================== Fetch de HTML (sem credentials, com cache normal) ======================== */
async function fetchText(url, { signal } = {}) {
  // Permite cache HTTP do navegador; evita no-store aqui.
  const res = await fetch(url, { method: "GET", mode: "cors", credentials: "omit", cache: "default", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/* ======================== Parser para HTML do /data ======================== */
/* Mantém compatibilidade: extrai <div id="app" data-page="..."> usado por apps com Inertia-like.
   Não muda o formato do arquivo. Se não houver data-page, tenta heurísticas simples. */
function parseQuizHTML(html, path) {
  // Extração rápida do trecho com id="app"
  const m = html.match(/<div[^>]*id=["']app["'][^>]*>/i);
  if (!m) return heuristicParse(html, path);

  const startIdx = m.index;
  const tail = html.slice(startIdx, startIdx + 2000); // janela curta para achar data-page
  const dp = tail.match(/data-page=(["'])([\s\S]*?)\1/i);
  if (dp && dp[2]) {
    try {
      const page = JSON.parse(dp[2]);
      // Estruturas comuns:
      // page.props: { title, records|questions|items, meta: {current_page,total_pages} ...}
      const props = page.props || {};
      const title = props.title || props.nome || props.titulo || "Simulado";
      const meta = props.meta || props.pagination || {};
      const items = props.questions || props.records || props.items || [];
      const qs = normalizeQuestions(items);
      return { title, meta, questions: qs, raw: props, page };
    } catch {
      // Fallback heurístico
      return heuristicParse(html, path);
    }
  }
  return heuristicParse(html, path);
}

function heuristicParse(html, path) {
  // Último recurso: extrai <article> com data-qid e .alt como opções.
  // Mantém a compatibilidade ao máximo sem alterar data/.
  const dom = new DOMParser().parseFromString(html, "text/html");
  const title = dom.querySelector("title")?.textContent?.trim() || "Simulado";
  const arts = [...dom.querySelectorAll("article[data-qid]")];
  const questions = arts.map((a, i) => {
    const id = a.getAttribute("data-qid") || `${i + 1}`;
    const stmt = a.querySelector(".enunciado, .statement, h1, h2, h3")?.textContent?.trim() || `Questão ${id}`;
    const opts = [...a.querySelectorAll(".opt, li, label")].slice(0, 10).map((el, j) => ({
      id: String.fromCharCode(65 + j),
      text: el.textContent.trim(),
    }));
    const ans = a.getAttribute("data-ans") || a.querySelector("[data-right]")?.textContent?.trim() || null;
    const exp = a.querySelector(".exp, .explain, .just")?.innerHTML || "";
    return { id, statement: stmt, options: opts, answer: ans, explanation: exp };
  });
  return { title, meta: {}, questions, raw: null, page: null };
}

function normalizeQuestions(items) {
  // Tenta mapear as chaves mais comuns para o formato interno.
  return items.map((it, i) => {
    const id = it.id || it.qid || it.codigo || String(i + 1);
    const statement = it.statement || it.enunciado || it.text || it.pergunta || `Questão ${id}`;
    const optionsRaw = it.options || it.alternativas || it.respostas || it.choices || [];
    const options = Array.isArray(optionsRaw)
      ? optionsRaw.map((t, j) => ({ id: String.fromCharCode(65 + j), text: String(t).trim() }))
      : Object.entries(optionsRaw).map(([k, v]) => ({ id: k.toUpperCase(), text: String(v).trim() }));
    const answer = it.answer ?? it.gabarito ?? it.correct ?? it.correta ?? null;
    const explanation = it.explanation ?? it.explicacao ?? it.justificativa ?? "";
    return { id, statement, options, answer, explanation };
  });
}

/* ======================== Leitura e composição de páginas ======================== */
async function loadQuizFromHTML(path, { preferCache = true, signal } = {}) {
  // Cache local primeiro
  if (preferCache) {
    const cached = QuizCache.get(path);
    if (cached) return cached;
  }

  const full = path.startsWith("http") ? path : CONFIG.DATA_BASE + path;
  const html = await fetchText(full, { signal });
  const parsed = parseQuizHTML(html, path);

  // Guarda cache para reutilizar e permitir prévia offline
  QuizCache.set(path, parsed);
  return parsed;
}

function buildQuizIdFromPaths(paths) {
  return btoa(encodeURIComponent(paths.join("|"))).slice(0, 24);
}

async function composeQuiz(paths, { signal } = {}) {
  // paths: lista de páginas de um mesmo tema em ordem
  const pages = [];
  for (const p of paths) {
    const page = await loadQuizFromHTML(p, { preferCache: true, signal });
    pages.push({ path: p, ...page });
  }
  // Título do primeiro bloco prevalece
  const title = pages[0]?.title || "Simulado";
  const meta = Object.assign({}, pages[0]?.meta || {});
  const questions = pages.flatMap(pg => pg.questions || []);
  const id = buildQuizIdFromPaths(paths);
  return { id, title, questions, currentIndex: 0, meta, pages, sourcePaths: paths };
}

/* ======================== Prefetch da próxima página ======================== */
async function prefetchNext(quiz) {
  if (!State.settings.prefetch) return;
  const pg = quiz?.pages?.[0]; // usamos meta da primeira página se existir
  const meta = pg?.meta || quiz?.meta || {};
  const cur = Number(meta.current_page || meta.page || 1);
  const tot = Number(meta.total_pages || meta.total || 1);
  if (!Number.isFinite(cur) || !Number.isFinite(tot)) return;
  if (cur >= tot) return;

  const nextPath = deriveNextPath(quiz.sourcePaths[0], cur + 1);
  if (!nextPath || State.prefetching.has(nextPath)) return;

  State.prefetching.add(nextPath);
  try {
    await loadQuizFromHTML(nextPath, { preferCache: false });
  } catch {}
  finally {
    State.prefetching.delete(nextPath);
  }
}

// Heurística simples: se o path contém "-p{n}.html" ou "?page={n}" avança.
function deriveNextPath(firstPath, nextPageNumber) {
  if (!firstPath) return null;
  let m = firstPath.match(/-p(\d+)\.html$/i);
  if (m) return firstPath.replace(/-p\d+\.html$/i, `-p${nextPageNumber}.html`);
  m = firstPath.match(/[?&]page=(\d+)/i);
  if (m) return firstPath.replace(/([?&]page=)\d+/i, `$1${nextPageNumber}`);
  // Se não há paginação explícita, retornar null para evitar 404.
  return null;
}

/* ======================== Renderização ======================== */
const UI = {
  sections: {
    home: $("#home"),
    quiz: $("#quiz"),
    results: $("#results"),
  },
  // Home
  list: $("#list"),
  search: $("#search"),
  tags: $("#tags"),
  clearFilters: $("#clearFilters"),
  startLatest: $("#startLatest"),
  networkStatus: $("#network-status"),

  // Painel lateral
  sidepanel: $("#sidepanel"),
  sidepanelBackdrop: $("#sidepanel .sidepanel-backdrop"),
  openSidepanel: $("#openSidepanel"),
  openSidepanel2: $("#openSidepanel2"),
  closeSidepanelBtn: $("#sidepanel [data-close='sidepanel']"),
  catalog: $("#catalog"),

  // Quiz
  backHome: $("#backHome"),
  qMeta: $("#q-meta"),
  qTitle: $("#q-title"),
  qStatement: $("#q-statement"),
  qOptions: $("#q-options"),
  explanation: $("#explanation"),
  expBody: $("#exp-body"),
  prev: $("#prev"),
  next: $("#next"),
  finish: $("#finish"),
  progressBar: $("#progress-bar"),
  progressLabel: $("#progress-label"),

  // Tools
  toggleNotes: $("#toggleNotes"),
  toggleBookmark: $("#toggleBookmark"),
  openIA: $("#openIA"),
  iaMenu: $("#ia-menu"),

  // Results
  resultsTitle: $("#results-title"),
  score: $("#score"),
  retry: $("#retry"),
  goHomeFromResults: $("#goHomeFromResults"),

  // Resume dialog
  resumeDialog: $("#resume-dialog"),
  resumeMeta: $("#resume-meta"),
  resumeYes: $("#resume-yes"),
  resumeNo: $("#resume-no"),

  // Header and footer
  year: $("#year"),

  // Config switches
  cfgAutoResume: $("#cfgAutoResume"),
  cfgPrefetch: $("#cfgPrefetch"),
  cfgHaptics: $("#cfgHaptics"),
};

function showSection(name) {
  for (const [k, el] of Object.entries(UI.sections)) {
    if (!el) continue;
    if (k === name) {
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }
  if (name === "home") UI.sections.home.focus();
  if (name === "quiz") UI.sections.quiz.focus();
}

function renderHome() {
  showSection("home");
  UI.list.innerHTML = "";
  // Catálogo básico via manifest opcional; se não houver, apenas botões padrão.
  const hist = Sessions.history();
  if (hist.length) {
    const h = document.createElement("div");
    h.className = "history";
    h.innerHTML = `<h3 class="h6">Recentes</h3>`;
    const ul = document.createElement("div");
    ul.className = "list";
    hist.forEach(s => {
      const item = document.createElement("button");
      item.className = "item";
      item.type = "button";
      item.textContent = s.title || s.path || "Tema";
      item.addEventListener("click", () => startFromSession(s));
      ul.appendChild(item);
    });
    h.appendChild(ul);
    UI.list.appendChild(h);
  }
  UI.networkStatus.textContent = navigator.onLine ? "online" : "offline";
}

function renderQuiz() {
  if (!State.quiz) return;
  const q = State.quiz.questions[State.quiz.currentIndex];
  if (!q) return;

  UI.qMeta.textContent = `Questão ${State.quiz.currentIndex + 1} de ${State.quiz.questions.length}`;
  UI.qTitle.textContent = State.quiz.title;
  UI.qStatement.innerHTML = sanitizeText(q.statement);
  UI.qOptions.innerHTML = "";

  UI.qOptions.setAttribute("role", "listbox");
  q.options.forEach(opt => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt";
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", "false");
    btn.textContent = `${opt.id}) ${opt.text}`;
    btn.addEventListener("click", () => onAnswer(opt.id));
    UI.qOptions.appendChild(btn);
  });

  const pct = Math.round(((State.quiz.currentIndex) / Math.max(1, State.quiz.questions.length)) * 100);
  UI.progressBar.style.width = `${pct}%`;
  UI.progressLabel.textContent = `${pct}%`;

  // Prefetch da próxima página se aplicável
  prefetchNext(State.quiz);
}

function renderExplanation(correctId, chosenId, explanationHTML) {
  UI.explanation.hidden = false;
  const ok = chosenId && correctId && String(chosenId).toUpperCase() === String(correctId).toUpperCase();
  UI.expBody.innerHTML = `
    <p><strong>Gabarito:</strong> ${correctId ?? "—"}${chosenId ? ` • <strong>Sua resposta:</strong> ${chosenId}` : ""}</p>
    ${explanationHTML || ""}
  `;
  haptics(ok);
}

function sanitizeText(s) {
  // Mantém HTML mínimo; assume s possa conter marcação segura já vinda do data/.
  return String(s ?? "").replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
}

/* ======================== Ações do Quiz ======================== */
function onAnswer(id) {
  const q = State.quiz.questions[State.quiz.currentIndex];
  if (!q) return;
  for (const el of $$(".opt", UI.qOptions)) el.setAttribute("aria-selected", "false");
  // Marca seleção visualmente
  const idx = q.options.findIndex(o => o.id === id);
  if (idx >= 0) {
    $$(".opt", UI.qOptions)[idx].setAttribute("aria-selected", "true");
  }
  // Renderiza explicação se houver
  renderExplanation(q.answer, id, q.explanation);
}

function nextQuestion() {
  if (!State.quiz) return;
  State.quiz.currentIndex = Math.min(State.quiz.currentIndex + 1, State.quiz.questions.length - 1);
  UI.explanation.hidden = true;
  renderQuiz();
  persistSession();
}

function prevQuestion() {
  if (!State.quiz) return;
  State.quiz.currentIndex = Math.max(State.quiz.currentIndex - 1, 0);
  UI.explanation.hidden = true;
  renderQuiz();
  persistSession();
}

function finishQuiz() {
  if (!State.quiz) return;
  const total = State.quiz.questions.length;
  // Heurística: contar acertos se usuário respondeu; como não guardamos respostas, mostramos apenas resumo.
  UI.score.textContent = `Você concluiu ${total} questão(ões).`;
  showSection("results");
}

/* ======================== Sessão e retomada ======================== */
function persistSession() {
  if (!State.quiz) return;
  const session = {
    id: State.quiz.id,
    title: State.quiz.title,
    path: State.quiz.sourcePaths?.[0] || null,
    pages: State.quiz.sourcePaths || [],
    index: State.quiz.currentIndex,
    ts: Date.now(),
  };
  State.lastSession = session;
  Sessions.save(session);
}

async function startFromPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    toast("Tema inválido", "warn");
    return;
  }
  try {
    State.loading = true;
    showSection("quiz");
    State.quiz = await composeQuiz(paths);
    State.quiz.currentIndex = 0;
    persistSession();
    renderQuiz();
  } catch (e) {
    toast("Falha ao carregar o tema", "error");
    console.error(e);
    showSection("home");
  } finally {
    State.loading = false;
  }
}

async function startFromSession(session) {
  if (!session || !Array.isArray(session.pages) || session.pages.length === 0) {
    toast("Sessão inválida", "warn");
    return;
  }
  try {
    State.loading = true;
    showSection("quiz");
    State.quiz = await composeQuiz(session.pages);
    State.quiz.currentIndex = Math.min(session.index || 0, Math.max(0, State.quiz.questions.length - 1));
    persistSession();
    renderQuiz();
  } catch (e) {
    toast("Não foi possível retomar", "error");
    console.error(e);
    showSection("home");
  } finally {
    State.loading = false;
  }
}

function maybePromptResume() {
  const last = Sessions.loadLast();
  State.lastSession = last;
  if (!last) return;
  if (!State.settings.autoResume) {
    // Mostrar diálogo de confirmação
    UI.resumeMeta.textContent = `${last.title || "Tema"} • ${new Date(last.ts).toLocaleString()}`;
    openModal(UI.resumeDialog);
  } else {
    // Retoma direto
    startFromSession(last);
  }
}

/* ======================== Catálogo (opcional) ======================== */
function renderCatalog(manifest) {
  UI.catalog.innerHTML = "";
  if (!manifest || !Array.isArray(manifest.items) || manifest.items.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Catálogo indisponível.";
    UI.catalog.appendChild(p);
    return;
  }
  manifest.items.forEach(it => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item";
    btn.textContent = it.title || it.path || "Tema";
    btn.addEventListener("click", () => {
      closeSidepanel();
      startFromPaths(Array.isArray(it.paths) && it.paths.length ? it.paths : [it.path]);
    });
    UI.catalog.appendChild(btn);
  });
}

/* ======================== Painéis e Modais ======================== */
function openSidepanel() {
  UI.sidepanel.hidden = false;
  UI.openSidepanel.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
  UI.sidepanel.querySelector(".sidepanel-sheet").focus();
}
function closeSidepanel() {
  UI.sidepanel.hidden = true;
  UI.openSidepanel.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

function openModal(modalEl) {
  modalEl.hidden = false;
  modalEl.querySelector(".modal-card")?.focus();
  document.body.style.overflow = "hidden";
}
function closeModal(modalEl) {
  modalEl.hidden = true;
  document.body.style.overflow = "";
}

/* ======================== Eventos ======================== */
function bindEvents() {
  // Header
  UI.openSidepanel?.addEventListener("click", openSidepanel);
  UI.openSidepanel2?.addEventListener("click", openSidepanel);
  UI.closeSidepanelBtn?.addEventListener("click", closeSidepanel);
  UI.sidepanelBackdrop?.addEventListener("click", closeSidepanel);

  // Config
  UI.cfgAutoResume.addEventListener("change", (e) => {
    State.settings.autoResume = e.target.checked;
    toast(`Retomada automática: ${State.settings.autoResume ? "ligada" : "desligada"}`, "info");
  });
  UI.cfgPrefetch.addEventListener("change", (e) => {
    State.settings.prefetch = e.target.checked;
  });
  UI.cfgHaptics.addEventListener("change", (e) => {
    State.settings.haptics = e.target.checked;
  });

  // Home
  UI.clearFilters.addEventListener("click", () => {
    UI.search.value = "";
    UI.tags.value = "";
    filterList();
  });
  UI.search.addEventListener("input", filterList);
  UI.tags.addEventListener("change", filterList);

  UI.startLatest.addEventListener("click", () => {
    const last = Sessions.loadLast();
    if (last) startFromSession(last);
    else toast("Nenhum tema recente", "warn");
  });

  // Quiz
  UI.backHome.addEventListener("click", () => {
    showSection("home");
  });
  UI.prev.addEventListener("click", prevQuestion);
  UI.next.addEventListener("click", nextQuestion);
  UI.finish.addEventListener("click", finishQuiz);

  // IA menu
  UI.openIA.addEventListener("click", () => {
    const isOpen = UI.iaMenu.hidden === false;
    UI.iaMenu.hidden = isOpen;
    UI.openIA.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) UI.iaMenu.querySelector(".menu-item")?.focus();
  });
  document.addEventListener("click", (e) => {
    if (!UI.iaMenu.hidden && !UI.openIA.contains(e.target) && !UI.iaMenu.contains(e.target)) {
      UI.iaMenu.hidden = true;
      UI.openIA.setAttribute("aria-expanded", "false");
    }
  });

  // Results
  UI.retry.addEventListener("click", () => {
    if (!State.quiz) return;
    State.quiz.currentIndex = 0;
    UI.explanation.hidden = true;
    showSection("quiz");
    renderQuiz();
    persistSession();
  });
  UI.goHomeFromResults.addEventListener("click", () => {
    showSection("home");
  });

  // Resume dialog
  UI.resumeYes.addEventListener("click", () => {
    closeModal(UI.resumeDialog);
    if (State.lastSession) startFromSession(State.lastSession);
  });
  UI.resumeNo.addEventListener("click", () => {
    closeModal(UI.resumeDialog);
  });
  UI.resumeDialog.querySelector(".modal-backdrop")?.addEventListener("click", () => closeModal(UI.resumeDialog));

  // Network
  window.addEventListener("online", () => UI.networkStatus.textContent = "online");
  window.addEventListener("offline", () => UI.networkStatus.textContent = "offline");

  // Acessibilidade: fechar com Esc modais e painel
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!UI.sidepanel.hidden) closeSidepanel();
      if (!UI.resumeDialog.hidden) closeModal(UI.resumeDialog);
      UI.iaMenu.hidden = true;
      UI.openIA.setAttribute("aria-expanded", "false");
    }
  });

  // Hashchange/back-forward: se no futuro você usar #q=, sincronize aqui.
  window.addEventListener("popstate", () => {
    // Mantemos simples: volta para a home se não houver quiz.
    if (!State.quiz) showSection("home");
  });
}

/* ======================== Lista/Busca (placeholder simples) ======================== */
function filterList() {
  const q = UI.search.value.trim().toLowerCase();
  const tag = UI.tags.value;
  // Como não temos manifest aqui, filtragem da lista renderizada manualmente.
  const items = $$(".list .item", UI.list);
  items.forEach(el => {
    const text = el.textContent.toLowerCase();
    const hit = text.includes(q);
    el.hidden = !hit || (tag && !text.includes(tag.toLowerCase()));
  });
}

/* ======================== Boot ======================== */
async function boot() {
  UI.year.textContent = String(new Date().getFullYear());

  // Carrega manifest se existir (opcional). Mantém compatível sem servidor.
  try {
    const manifestCached = LS.get("manifest", null);
    if (manifestCached) State.manifest = manifestCached;

    // Se houver um manifest.json ao lado, você pode ativar leitura:
    // const txt = await fetchText("./data/manifest.json");
    // const manifest = JSON.parse(txt);
    // State.manifest = manifest;
    // LS.set("manifest", manifest);
    renderCatalog(State.manifest);
  } catch (e) {
    console.warn("Manifest indisponível.", e);
  }

  renderHome();
  bindEvents();

  // Aplicar defaults de config nos switches
  UI.cfgAutoResume.checked = State.settings.autoResume;
  UI.cfgPrefetch.checked = State.settings.prefetch;
  UI.cfgHaptics.checked = State.settings.haptics;

  // Retomada controlada
  maybePromptResume();

  // Exemplo: se quiser iniciar com um tema fixo ao abrir:
  // startFromPaths(["autoria-e-coautoria.html"]);
}

document.addEventListener("DOMContentLoaded", boot);
