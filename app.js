/* ============================== APP ============================== */
(function () {
  const { txtUrl } = window.APP_CONFIG || {};

  const BATCH = 3; // carrega 3 por vez
  const state = {
    disciplina: null,
    temasDisponiveis: [],
    temasSelecionados: new Set(),
    cards: [],
    // feed incremental
    feedGroups: [],     // [{key:'ALL'|'tema x', items:[idxs], ptr:0}]
    rendered: []        // índices já renderizados na ordem do feed
  };

 /* ------------------------------ Utils ------------------------------ */
const U = {
  el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") e.className = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v);
    });
    children.flat().forEach(c => { if (c !== null && c !== undefined) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  },
  trim: s => (s || "").replace(/^\s+|\s+$/g, ""),
  byPrefix: (l, p) => l.startsWith(p) ? l.slice(p.length).trim() : null,
  uniq: arr => [...new Set(arr)],
  shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  },
  copy: t => { try { navigator.clipboard && navigator.clipboard.writeText(t); } catch {} },
  openGoogle: q => window.open("https://www.google.com/search?udm=50&q=" + encodeURIComponent(q), "_blank"),
  onClickOutside(root, cb) { const h = ev => { if (!root.contains(ev.target)) cb(); }; document.addEventListener("mousedown", h, { once: true }); },
  fitPopover(menu, trigger) { const r = trigger.getBoundingClientRect(); if (r.top < 160) menu.classList.add("below"); else menu.classList.remove("below"); },
  mdInline: s => (s || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>"),
  // Backdrop: fecha só quando clicado (não intercepta cliques dentro do menu)
  backdrop(onClose){
    const el = document.createElement("div");
    el.className = "dropdown-backdrop";
    const handler = () => { try { onClose(); } finally { el.remove(); } };
    el.addEventListener("pointerdown", handler, { once: true });
    document.body.appendChild(el);
    const keyH = (e)=>{ if(e.key==="Escape"){ handler(); document.removeEventListener("keydown", keyH, true);} };
    document.addEventListener("keydown", keyH, true);
    return el;
  }
};

  /* ------------------------------ Loader ------------------------------ */
  async function loadTxt() {
    try {
      const res = await fetch(txtUrl);
      if (!res.ok) throw new Error("not found");
      return await res.text();
    } catch {
      document.getElementById("cards").innerHTML = `<div class="q"><div class="q__stmt">Arquivo não encontrado: <code>${txtUrl}</code></div></div>`;
      return "";
    }
  }

  /* ------------------------------ Parser ------------------------------ */
  function parseTxt(raw) {
    if (!raw) return [];
    const blocks = raw.split("-----").map(s => s.trim()).filter(Boolean);
    const cards = [];

    for (const block of blocks) {
      const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
      let referencias = "", enunciado = "", gabarito = "";
      const alternativas = [], temas = [];

      for (const line of lines) {
        const L = line.replace(/^\uFEFF?/, ""); // remove BOM se houver

        if (/^\*{5}\s/.test(L)) { // ***** referências
          referencias = L.replace(/^\*{5}\s*/, "").trim(); continue;
        }
        if (/^\*{3}\s/.test(L)) { // *** gabarito
          const g = L.replace(/^\*{3}\s*/, "").trim();
          const m = /Gabarito\s*:\s*([A-Z])/i.exec(g);
          gabarito = m ? m[1].toUpperCase() : ""; continue;
        }
        if (/^\*{4}\s/.test(L)) { // **** temas
          const t = L.replace(/^\*{4}\s*/, "").trim();
          t.split(",").forEach(x => { const v = (x || "").trim(); if (v) temas.push(v); });
          continue;
        }
        if (/^\*{2}\s/.test(L)) { // ** alternativas
          alternativas.push(L.replace(/^\*{2}\s*/, "").trim()); continue;
        }
        if (/^\*\s/.test(L)) { // * enunciado
          const part = L.replace(/^\*\s*/, "").trim();
          enunciado = enunciado ? (enunciado + " " + part) : part;
        }
      }

      cards.push({ referencias, enunciado, alternativas, gabarito, temas });
    }
    return cards;
  }

/* ------------------------------ Compartilhar Story (PNG 1080x1920) ------------------------------ */
async function shareCardAsStory(card) {
  const pngBlob = await renderStoryPNG(card);
  const file = new File([pngBlob], "meujus-story.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "MeuJus", text: "meujus.com.br" });
      return;
    } catch (e) {}
  }
  const url = URL.createObjectURL(pngBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "meujus-story.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function px(n){ return Math.round(n); }
function createCanvas(w, h){
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}
function setFont(ctx, size, weight=400){
  ctx.font = `${weight} ${px(size)}px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Helvetica, Arial`;
}
function wrapParagraph(ctx, text, maxWidth, size, weight=400, lineHeight=1.42){
  setFont(ctx, size, weight);
  const words = String(text||"").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words){
    const test = line ? (line + " " + w) : w;
    if (ctx.measureText(test).width <= maxWidth) { line = test; }
    else {
      if (line) lines.push(line);
      if (ctx.measureText(w).width > maxWidth){
        let acc = "";
        for (const ch of w){
          const t2 = acc + ch;
          if (ctx.measureText(t2).width <= maxWidth) acc = t2;
          else { if (acc) { lines.push(acc); acc = ch; } }
        }
        line = acc;
      } else line = w;
    }
  }
  if (line) lines.push(line);
  const h = lines.length * px(size*lineHeight);
  return { lines, height: h, lineGap: px(size*lineHeight) };
}
function drawWrapped(ctx, x, y, maxWidth, text, size, color, weight=400, lineHeight=1.42, align="left"){
  ctx.fillStyle = color;
  setFont(ctx, size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  const { lines, lineGap } = wrapParagraph(ctx, text, maxWidth, size, weight, lineHeight);
  let yy = y;
  for (const L of lines){
    const dx = align==="center" ? x + maxWidth/2 : x;
    ctx.fillText(L, dx, yy);
    yy += lineGap;
  }
  return yy;
}
function measureCard(ctx, card, sizes, innerW){
  const gap = 16;
  let total = 0;
  total += wrapParagraph(ctx, card.referencias||"", innerW, sizes.refs, 400, 1.35).height + gap; // referências
  total += wrapParagraph(ctx, card.enunciado||"", innerW, sizes.enun, 500, 1.5).height + gap;   // enunciado
  for (const alt of card.alternativas||[]){                                                    // alternativas
    const clean = String(alt).replace(/^[A-E]\)\s*/i,"");
    const h = wrapParagraph(ctx, clean, innerW - 36 - 8, sizes.alt, 400, 1.42).height;
    total += Math.max(28, h) + 10;
  }
  return total;
}
function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}
async function renderStoryPNG(card){
  const W=1080, H=1920;
  const [cv, ctx] = createCanvas(W, H);

  // fundo branco para arquivo leve
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,W,H);

  // cabeçalho
  setFont(ctx, 28, 700);
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("meujus.com.br", W/2, 48);

  // área do card
  const marginX = 96, topSafe = 120;
  const cardW = W - marginX*2;
  const cardH = H - topSafe - 140;
  const x = marginX, y = topSafe + 40;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, cardW, cardH, 24);
  ctx.fill(); ctx.stroke();

  const innerPad = 36;
  const innerX = x + innerPad;
  const innerY = y + innerPad;
  const innerW = cardW - innerPad*2;
  const innerH = cardH - innerPad*2;

  // auto-fit por busca binária
  const base = { refs: 22, enun: 34, alt: 28 };
  const min  = { refs: 14, enun: 20, alt: 18 };
  let lo = 0, hi = 1;
  const canFit = (s)=>{
    const sizes = { refs: Math.max(min.refs, base.refs*s),
                    enun: Math.max(min.enun, base.enun*s),
                    alt:  Math.max(min.alt,  base.alt*s) };
    return measureCard(ctx, card, sizes, innerW) <= innerH;
  };
  while (canFit(hi)) { lo = hi; hi *= 1.25; if (hi>4) break; }
  for (let i=0;i<18;i++){
    const mid = (lo+hi)/2;
    if (canFit(mid)) lo = mid; else hi = mid;
  }
  const s = lo;
  const sizes = { refs: Math.max(min.refs, base.refs*s),
                  enun: Math.max(min.enun, base.enun*s),
                  alt:  Math.max(min.alt,  base.alt*s) };

  // conteúdo: referências, enunciado, alternativas
  let yy = innerY;
  yy = drawWrapped(ctx, innerX, yy, innerW, card.referencias||"", sizes.refs, "#6b7280", 400, 1.35); // cor igual ao site
  yy += 16;
  yy = drawWrapped(ctx, innerX, yy, innerW, card.enunciado||"", sizes.enun, "#111827", 600, 1.5);
  yy += 16;

const badgeR = 20, badgeD = badgeR*2, badgePad = 12;
  const letters = ["A","B","C","D","E"];
  for (let i=0;i<(card.alternativas||[]).length;i++){
    const raw = String(card.alternativas[i]||"");
    const clean = raw.replace(/^[A-E]\)\s*/i,"");

    // badge
    const by = yy + 2;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(innerX+badgeR, by+badgeR, badgeR, 0, Math.PI*2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // letra
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setFont(ctx, Math.round(badgeR * 0.9), 700);
ctx.fillText(letters[i]||"", innerX+badgeR, by+badgeR);

    // texto
    ctx.textAlign = "left"; ctx.textBaseline = "top";
const textX = innerX + badgeD + badgePad;
const block = wrapParagraph(ctx, clean, innerW - badgeD - badgePad, sizes.alt, 400, 1.42);
    setFont(ctx, sizes.alt, 400);
    let yline = yy;
    for (const L of block.lines){
      ctx.fillStyle = "#454141";
      ctx.fillText(L, textX, yline);
      yline += block.lineGap;
    }
    yy = Math.max(yy, yline) + 10;
  }

  const blob = await new Promise(res=> cv.toBlob(b => res(b), "image/png"));
  if (blob) return blob;
  const d = cv.toDataURL("image/png");
  const bin = atob(d.split(",")[1]);
  const buf = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], {type:"image/png"});
}

  
  /* ------------------------------ IA Prompts (simplificados p/ Google IA) ------------------------------ */
  function buildPrompt(kind, card) {
    const temas = (card.temas || []).join(", ") || "geral";
    const alts = card.alternativas.join(" | ");
    const enun = card.enunciado;

    switch (kind) {
      case "Gabarito":
        return `Atue como professor de Direito e diga qual é a alternativa correta com fundamentação jurídica direta em até 5 pontos, comentando em 1 linha por que cada outra alternativa está errada; Tema: ${temas}; Enunciado: ${enun}; Alternativas: ${alts}; Gabarito oficial: ${card.gabarito || "?"}.`;

      case "Glossário":
        return `Explique em linguagem simples todos os termos jurídicos do enunciado e das alternativas, com definições curtas e referências legais quando existirem; Tema: ${temas}; Enunciado: ${enun}; Alternativas: ${alts}.`;

      case "Vídeo":
        return `Liste 3 vídeos do YouTube com link direto e título curto que expliquem o tema desta questão e depois sugira 5 termos de busca entre aspas; Tema: ${temas}; Enunciado: ${enun}; Alternativas: ${alts}.`;

      case "Dicas":
        return `Dê dicas objetivas para acertar questões desse tema, mostre pegadinhas e erros comuns e finalize com um checklist curto de revisão; Tema: ${temas}; Enunciado: ${enun}; Alternativas: ${alts}.`;

      case "Princípios":
        return `Aponte os princípios jurídicos ligados ao tema, explique cada um em frase curta, indique o impacto em A..E e conclua com a alternativa que melhor se ajusta; Tema: ${temas}; Enunciado: ${enun}; Alternativas: ${alts}.`;

      case "Inédita":
        return `Crie 3 versões inéditas da mesma questão no mesmo nível, cada uma com enunciado, alternativas A..E, gabarito e comentário de 2 linhas; Tema: ${temas}; Base: ${enun}; Alternativas (modelo): ${alts}.`;

      default:
        return `Responda de forma objetiva; Tema: ${temas}; Enunciado: ${enun}; Alternativas: ${alts}.`;
    }
  }

  /* ------------------------------ Badge inference ------------------------------ */
  function inferBadges(alts) {
    const letterMatch = alts.every(a => /^[A-E]\)/i.test(a));
    if (letterMatch) return alts.map(a => a[0].toUpperCase());
    const text = alts.join(" ").toLowerCase();
    if (alts.length === 2 && /certo|errado/.test(text)) return ["C", "E"];
    if (alts.length === 2 && /verdadeiro|falso/.test(text)) return ["V", "F"];
    return alts.map((_, i) => String.fromCharCode(65 + i));
  }

  /* ------------------------------ Card ------------------------------ */
  function buildCard(card, idx) {
    const badges = inferBadges(card.alternativas);
    const meta = U.el("div", { class: "q__meta" }, card.referencias);
    const stmt = U.el("div", { class: "q__stmt", html: U.mdInline(card.enunciado) });

    const ul = U.el("ul", { class: "q__opts" });
    card.alternativas.forEach((opt, i) => {
      const clean = opt.replace(/^[A-E]\)\s*/i, "");
      const li = U.el("li", { class: "q__opt", "data-letter": badges[i] });
      const badge = U.el("span", { class: "q__badge" }, badges[i]);
      li.appendChild(badge);
      li.appendChild(U.el("div", {}, clean));
      ul.appendChild(li);
    });

    const iaBtn = U.el("button", { class: "btn", type: "button" }, "Google IA");
    const pop = U.el("div", { class: "popover" });
    const menu = U.el("div", { class: "popover__menu hidden" });
    ["Gabarito", "Glossário", "Vídeo", "Dicas", "Princípios", "Inédita"].forEach(lbl => {
      const b = U.el("button", { class: "subbtn", type: "button" }, lbl);
      b.addEventListener("click", () => {
        const prompt = buildPrompt(lbl, card);
        U.copy(prompt);
        U.openGoogle(`${lbl} | ${prompt}`);
        if (lbl === "Gabarito") revealAnswer(ul, card.gabarito, true);
        closeMenu();
      });
      menu.appendChild(b);
    });
    function openMenu(){ menu.classList.remove("hidden"); U.fitPopover(menu, iaBtn); U.onClickOutside(pop, closeMenu); }
    function closeMenu(){ menu.classList.add("hidden"); }
    iaBtn.addEventListener("click", () => menu.classList.contains("hidden") ? openMenu() : closeMenu());
    pop.appendChild(iaBtn); pop.appendChild(menu);

const shareBtn = U.el("button", { class: "btn", type: "button" }, "Compartilhar");
shareBtn.addEventListener("click", () => shareCardAsStory(card));
const actions = U.el("div", { class: "q__actions" }, pop, shareBtn);

    const wrap = U.el("article", { class: "q", "data-idx": idx }, meta, stmt, ul, actions);

    // resposta do usuário
    let answered = false;
    ul.addEventListener("click", ev => {
      const li = ev.target.closest(".q__opt");
      if (!li || answered) return;
      answered = true;
      const chosen = (li.getAttribute("data-letter") || "").toUpperCase();
      const correct = (card.gabarito || "").toUpperCase();
      if (chosen === correct) {
        li.classList.add("correct");
        appendGabarito(wrap, correct);
      } else {
        li.classList.add("wrong");
        revealAnswer(ul, correct, true);
      }
    });

    return wrap;
  }

  function appendGabarito(cardEl, g) {
    const info = U.el("div", { class: "q__explain" }, `Gabarito: ${g}`);
    cardEl.appendChild(info);
  }

  function revealAnswer(ul, gLetter, showExplain=false) {
    const items = Array.from(ul.children);
    const right = items.find(li => (li.getAttribute("data-letter") || "").toUpperCase() === (gLetter || "").toUpperCase());
    if (right) right.classList.add("correct");
    if (showExplain) appendGabarito(ul.parentElement, gLetter);
  }

  /* ------------------------------ Filtros ------------------------------ */
  function mountSelectSingle(root, { options, onChange }) {
    root.innerHTML = "";
    root.classList.add("select");

    const btn = U.el("button", { class: "select__button", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" }, "Escolha a disciplina");
    const menu = U.el("div", { class: "select__menu hidden", role: "listbox" });
    let bd = null;

    function open(){
      if (!menu.classList.contains("hidden")) return;
      menu.classList.remove("hidden");
      btn.setAttribute("aria-expanded","true");
      bd = U.backdrop(close);
    }
    function close(){
      menu.classList.add("hidden");
      btn.setAttribute("aria-expanded","false");
      bd = null;
    }

    options.forEach(opt => {
      const it = U.el("div", { class: "select__option", role: "option", "data-value": opt.label }, opt.label);
      it.addEventListener("click", () => { btn.textContent = opt.label; close(); onChange && onChange(opt); });
      menu.appendChild(it);
    });

    btn.addEventListener("click", () => menu.classList.contains("hidden") ? open() : close());

    root.appendChild(btn);
    root.appendChild(menu);
  }

  function mountMultiselect(root, { options, onChange }) {
    root.innerHTML = "";
    const control = U.el("div", { class: "multiselect__control", role: "combobox", "aria-expanded": "false" });
    const input = U.el("input", { class: "multiselect__input", type: "text", placeholder: "Temas..." });
    const menu  = U.el("div", { class: "multiselect__menu hidden", role: "listbox" });
    let bd = null;

    function syncItems() {
      const q = (input.value || "").toLowerCase();
      Array.from(menu.children).forEach(item => {
        const val = item.getAttribute("data-value");
        const match = !q || val.toLowerCase().includes(q);
        item.style.display = match ? "block" : "none";
        const selected = state.temasSelecionados.has(val);
        item.setAttribute("aria-selected", selected ? "true" : "false");
      });
    }

    function open(){
      if (!menu.classList.contains("hidden")) return;
      menu.classList.remove("hidden");
      control.setAttribute("aria-expanded","true");
      bd = U.backdrop(close);
      syncItems();
    }
    function close(){
      menu.classList.add("hidden");
      control.setAttribute("aria-expanded","false");
      bd = null;
    }

    (U.uniq(options || [])).forEach(opt => {
      const it = U.el("div", { class: "multiselect__item", role: "option", "data-value": opt }, opt);
      it.addEventListener("click", () => {
        if (state.temasSelecionados.has(opt)) state.temasSelecionados.delete(opt);
        else state.temasSelecionados.add(opt);
        onChange && onChange(new Set(state.temasSelecionados));
        syncItems();
      });
      menu.appendChild(it);
    });

    input.addEventListener("focus", open);
    input.addEventListener("input", syncItems);
    control.addEventListener("click", open);

    control.appendChild(input);
    root.appendChild(control);
    root.appendChild(menu);
  }

  /* ------------------------------ Feed incremental ------------------------------ */
  function buildFeed() {
  state.rendered = [];
  const temasAtivos = [...state.temasSelecionados];
  const groups = [];

  if (temasAtivos.length === 0) {
    const all = U.shuffle(state.cards.map((_, i) => i));
    groups.push({ key: "ALL", items: all, ptr: 0 });
  } else {
    temasAtivos.forEach(t => {
      const idxs = state.cards.map((c, i) => c.temas.includes(t) ? i : -1).filter(i => i >= 0);
      groups.push({ key: t, items: U.shuffle(idxs), ptr: 0 });
    });
  }
  state.feedGroups = groups;
}

  function nextBatch() {
    const out = [];
    let produced = 0;
    while (produced < BATCH && state.feedGroups.some(g => g.ptr < g.items.length)) {
      for (const g of state.feedGroups) {
        if (g.ptr >= g.items.length) continue;
        const idx = g.items[g.ptr++];
        if (state.rendered.includes(idx)) continue;
        state.rendered.push(idx);
        out.push(idx);
        produced++;
        if (produced >= BATCH) break;
      }
    }
    return out;
  }

  function renderAppend(indexes) {
    const mount = document.getElementById("cards");
    indexes.forEach(i => mount.appendChild(buildCard(state.cards[i], i)));
  }

  function resetAndRender() {
    document.getElementById("cards").innerHTML = "";
    buildFeed();
    renderAppend(nextBatch());
  }

  function mountInfiniteScroll() {
    const sentinel = document.getElementById("sentinela");
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) renderAppend(nextBatch());
      });
    }, { rootMargin: "600px 0px" });
    io.observe(sentinel);
  }

  /* ------------------------------ Init ------------------------------ */
  async function init() {
    const raw = await loadTxt();
    state.cards = parseTxt(raw);

    state.temasDisponiveis = U.uniq(state.cards.flatMap(c => c.temas || [])).sort();

    mountSelectSingle(document.getElementById("disciplina-select"), {
      options: [
        { label: "Direito Penal", txt: "data/direito-penal/penal1.txt" },
        { label: "Direito Civil", txt: "data/direito-civil/civil1.txt" },
        { label: "Direito Processual do Trabalho", txt: "data/direito-processual-trabalho/dpt1.txt" }
      ],
      onChange: async (opt) => {
        window.history.replaceState({}, "", `?txt=${encodeURIComponent(opt.txt)}`);
        const res = await fetch(opt.txt).catch(() => null);
        const txt = res && res.ok ? await res.text() : "";
        state.cards = parseTxt(txt);
        state.temasDisponiveis = U.uniq(state.cards.flatMap(c => c.temas || [])).sort();
        state.temasSelecionados.clear();
        mountMultiselect(document.getElementById("temas-multiselect"), {
          options: state.temasDisponiveis,
          onChange: () => { resetAndRender(); }
        });
        resetAndRender();
      }
    });

    mountMultiselect(document.getElementById("temas-multiselect"), {
      options: state.temasDisponiveis,
      onChange: () => { resetAndRender(); }
    });

    resetAndRender();
    mountInfiniteScroll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
