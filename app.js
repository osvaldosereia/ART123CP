/* ============================== APP ============================== */
(function () {
  const { txtUrl } = window.APP_CONFIG || {};

  const BATCH = 3; // carrega 3 por vez
  const state = {
    disciplina: null,
    temasDisponiveis: [],
    temasSelecionados: new Set(),
    cards: [],
    feedGroups: [],   // [{key:'ALL'|'tema x', items:[idxs], ptr:0}]
    rendered: []      // índices já renderizados na ordem do feed
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
    const out = [];

    for (const block of blocks) {
      const lines = block
        .split("\n")
        .map(l => l.replace(/^\uFEFF?/, "").trim())
        .filter(l => l.length);

      let referencias = "", enunciado = "", gabarito = "";
      const alternativas = [], temas = [];
      let inEnunciado = false;

      for (const L of lines) {
        if (/^\*{5}\s/.test(L)) { referencias = L.replace(/^\*{5}\s*/, "").trim(); inEnunciado = false; continue; }
        if (/^\*{4}\s/.test(L)) { L.replace(/^\*{4}\s*/, "").split(",").forEach(t => { t = t.trim(); if (t) temas.push(t); }); inEnunciado = false; continue; }
        if (/^\*{3}\s/.test(L)) { const m = /Gabarito\s*:\s*([A-Z])/i.exec(L.replace(/^\*{3}\s*/, "")); gabarito = m ? m[1].toUpperCase() : ""; inEnunciado = false; continue; }
        if (/^\*{2}\s/.test(L)) { alternativas.push(L.replace(/^\*{2}\s*/, "").trim()); inEnunciado = false; continue; }
        if (/^\*\s/.test(L))   { const part = L.replace(/^\*\s*/, "").trim(); enunciado = enunciado ? enunciado + " " + part : part; inEnunciado = true; continue; }

        if (inEnunciado) enunciado += (enunciado ? " " : "") + L;
      }

      out.push({ referencias, enunciado, alternativas, gabarito, temas });
    }
    return out;
  }

  /* ------ Fonte paginada p/ modal Impressora ------ */
  (function exposePagedSource(){
    function computeOrderFromState(){
  // 1) começa exatamente pelo feed atual já renderizado
  const order = [...state.rendered];
  const seen = new Set(order);

  // 2) continua o mesmo ciclo dos grupos a partir dos ponteiros atuais
  const clones = (state.feedGroups || []).map(g => ({
    items: [...(g.items || [])],
    ptr: g.ptr || 0
  }));

  let moved = true;
  while (moved) {
    moved = false;
    for (const g of clones) {
      if (g.ptr >= g.items.length) continue;
      const idx = g.items[g.ptr++];
      if (!seen.has(idx)) { order.push(idx); seen.add(idx); }
      moved = true;
    }
  }
  return order;
}
// expõe a ordem atual para o listener da impressora
window.QUESTOES_CURRENT_ORDER = computeOrderFromState;


    function normalizeForPrint(c, i){
      const alts = (c.alternativas || []).map((raw, k) => {
        const letra = String.fromCharCode(65 + k);
        const texto = String(raw || "").replace(/^[A-E]\)\s*/i, "");
        return `${letra}) ${texto}`;
      });

      const html = [
        `<div class="q__stmt">${U.mdInline(c.enunciado || "")}</div>`,
        alts.length
          ? `<ul class="q__opts">${alts
              .map(a => {
                const letra = a.slice(0,1);
                const texto = a.replace(/^[A-E]\)\s*/i,"").replace(/^[A-E]\)\s*/i,"");
                return `<li class="q__opt"><span class="q__badge">${letra}</span><div>${texto}</div></li>`;
              })
              .join("")}</ul>`
          : ""
      ].join("");

     return {
  id: i + 1,
  enunciadoHtml: html,
  enunciadoPlain: c.enunciado || "",
  alternativas: alts,
  gabarito: String(c.gabarito || "").trim().toUpperCase(),
  temas: Array.isArray(c.temas) ? c.temas.slice() : []
};

    }

    window.QUESTOES_FETCH_PAGE = async function(cursor){
      const pageSize = 20;
      const order = computeOrderFromState();
      const start = Number.isInteger(cursor) ? cursor : 0;
      const end = Math.min(start + pageSize, order.length);
      const itens = [];
      for (let i=start;i<end;i++){
        const idx = order[i];
        itens.push(normalizeForPrint(state.cards[idx], idx));
      }
      return { itens, nextCursor: end < order.length ? end : null };
    };
  })();

  /* ------------------------------ Story PNG ------------------------------ */
  async function shareCardAsStory(card) {
    const pngBlob = await renderStoryPNG(card);
    const file = new File([pngBlob], "meujus-story.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "MeuJus", text: "meujus.com.br" }); return; } catch {}
    }
    alert("Seu navegador não permite compartilhar imagem diretamente.");
  }

  function px(n){ return Math.round(n); }
  function createCanvas(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; }
  function setFont(ctx, size, weight=400){ ctx.font = `${weight} ${px(size)}px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Helvetica, Arial`; }
  function wrapParagraph(ctx, text, maxWidth, size, weight=400, lineHeight=1.42){
    setFont(ctx, size, weight);
    const words = String(text||"").split(/\s+/); const lines = []; let line = "";
    for (const w of words){
      const test = line ? (line + " " + w) : w;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else { if (line) lines.push(line);
        if (ctx.measureText(w).width > maxWidth){
          let acc = ""; for (const ch of w){ const t2 = acc + ch;
            if (ctx.measureText(t2).width <= maxWidth) acc = t2; else { if (acc) { lines.push(acc); acc = ch; } } }
          line = acc;
        } else line = w;
      }
    }
    if (line) lines.push(line);
    const h = lines.length * px(size*lineHeight);
    return { lines, height: h, lineGap: px(size*lineHeight) };
  }
  function drawWrapped(ctx, x, y, maxWidth, text, size, color, weight=400, lineHeight=1.42, align="left"){
    ctx.fillStyle = color; setFont(ctx, size, weight); ctx.textAlign = align; ctx.textBaseline = "top";
    const { lines, lineGap } = wrapParagraph(ctx, text, maxWidth, size, weight, lineHeight);
    let yy = y; for (const L of lines){ const dx = align==="center" ? x + maxWidth/2 : x; ctx.fillText(L, dx, yy); yy += lineGap; }
    return yy;
  }
  function measureCard(ctx, card, sizes, innerW){
    const gap = 16; let total = 0;
    total += wrapParagraph(ctx, card.referencias||"", innerW, sizes.refs, 400, 1.35).height + gap;
    total += wrapParagraph(ctx, card.enunciado||"", innerW, sizes.enun, 500, 1.5).height + gap;
    for (const alt of card.alternativas||[]){
      const clean = String(alt).replace(/^[A-E]\)\s*/i,"");
      const h = wrapParagraph(ctx, clean, innerW - 36 - 12, sizes.alt, 400, 1.42).height;
      total += Math.max(28, h) + 10;
    }
    return total;
  }
  function roundRect(ctx, x, y, w, h, r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath(); ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr); ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr); ctx.arcTo(x, y, x+w, y, rr); ctx.closePath();
  }
  async function renderStoryPNG(card){
    const W=1080, H=1920; const [cv, ctx] = createCanvas(W, H);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,W,H);
    setFont(ctx, 28, 700); ctx.fillStyle = "#111827"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("meujus.com.br", W/2, 48);
    const marginX = 96, topSafe = 120; const cardW = W - marginX*2; const cardH = H - topSafe - 140; const x = marginX, y = topSafe + 40;
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 2; roundRect(ctx, x, y, cardW, cardH, 24); ctx.fill(); ctx.stroke();
    const innerPad = 36; const innerX = x + innerPad; const innerY = y + innerPad; const innerW = cardW - innerPad*2; const innerH = cardH - innerPad*2;
    const base = { refs: 22, enun: 34, alt: 28 }; const min  = { refs: 14, enun: 20, alt: 18 }; const cap  = { refs: 32, enun: 48, alt: 40 };
    let lo = 0, hi = 1; const canFit = (s)=>{ const sizes = { refs: Math.min(cap.refs, Math.max(min.refs, base.refs * s)), enun: Math.min(cap.enun, Math.max(min.enun, base.enun * s)), alt:  Math.min(cap.alt,  Math.max(min.alt,  base.alt  * s)) }; return measureCard(ctx, card, sizes, innerW) <= innerH; };
    while (canFit(hi)) { lo = hi; hi *= 1.25; if (hi>4) break; } for (let i=0;i<18;i++){ const mid = (lo+hi)/2; if (canFit(mid)) lo = mid; else hi = mid; }
    const s = lo; const sizes = { refs: Math.min(cap.refs, Math.max(min.refs, base.refs * s)), enun: Math.min(cap.enun, Math.max(min.enun, base.enun * s)), alt:  Math.min(cap.alt,  Math.max(min.alt,  base.alt  * s)) };
    let yy = innerY; yy = drawWrapped(ctx, innerX, yy, innerW, card.referencias||"", sizes.refs, "#6b7280", 400, 1.35); yy += 16;
    yy = drawWrapped(ctx, innerX, yy, innerW, card.enunciado||"", sizes.enun, "#103a9c", 600, 1.5); yy += 16;
    const badgeR = 20, badgeD = badgeR*2, badgePad = 12; const letters = ["A","B","C","D","E"];
    for (let i=0;i<(card.alternativas||[]).length;i++){
      const raw = String(card.alternativas[i]||""); const clean = raw.replace(/^[A-E]\)\s*/i,"");
      const by = yy + 2; ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(innerX+badgeR, by+badgeR, badgeR, 0, Math.PI*2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#111827"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; setFont(ctx, Math.round(badgeR * 0.9), 700); ctx.fillText(letters[i]||"", innerX+badgeR, by+badgeR);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      const textX = innerX + badgeD + badgePad;
      const block = wrapParagraph(ctx, clean, innerW - badgeD - badgePad, sizes.alt, 400, 1.42);
      setFont(ctx, sizes.alt, 400);
      let yline = yy; for (const L of block.lines){ ctx.fillStyle = "#454141"; ctx.fillText(L, textX, yline); yline += block.lineGap; }
      yy = Math.max(yy, yline) + 10;
    }
    const blob = await new Promise(res=> cv.toBlob(b => res(b), "image/png")); if (blob) return blob;
    const d = cv.toDataURL("image/png"); const bin = atob(d.split(",")[1]); const buf = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], {type:"image/png"});
  }

  /* ------------------------------ IA Prompts ------------------------------ */
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

    appendFrasesButton(actions);
    appendImpressoraButton(actions, idx);

    const wrap = U.el("article", { class: "q", "data-idx": idx }, meta, stmt, ul, actions);

    let answered = false;
    ul.addEventListener("click", ev => {
      const li = ev.target.closest(".q__opt");
      if (!li || answered) return;
      answered = true;
      const chosen = (li.getAttribute("data-letter") || "").toUpperCase();
      const correct = (card.gabarito || "").toUpperCase();
      if (chosen === correct) { li.classList.add("correct"); appendGabarito(wrap, correct); }
      else { li.classList.add("wrong"); revealAnswer(ul, correct, true); }
    });

    return wrap;
  }

  function appendGabarito(cardEl, g) { cardEl.appendChild(U.el("div", { class: "q__explain" }, `Gabarito: ${g}`)); }
  function revealAnswer(ul, gLetter, showExplain=false) {
    const items = Array.from(ul.children);
    const right = items.find(li => (li.getAttribute("data-letter") || "").toUpperCase() === (gLetter || "").toUpperCase());
    if (right) right.classList.add("correct");
    if (showExplain) appendGabarito(ul.parentElement, gLetter);
  }

  /* ------------------------------ Filtros ------------------------------ */
  function mountSelectSingle(root, { options, onChange }) {
    root.innerHTML = ""; root.classList.add("select");
    const btn = U.el("button", { class: "select__button", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" }, "Disciplina");
    const menu = U.el("div", { class: "select__menu hidden", role: "listbox" });

    function open(){ if (!menu.classList.contains("hidden")) return; menu.classList.remove("hidden"); btn.setAttribute("aria-expanded","true"); U.backdrop(close); }
    function close(){ menu.classList.add("hidden"); btn.setAttribute("aria-expanded","false"); }

    options.forEach(opt => {
      const it = U.el("div", { class: "select__option", role: "option", "data-value": opt.label }, opt.label);
      it.addEventListener("click", () => { btn.textContent = opt.label; close(); onChange && onChange(opt); });
      menu.appendChild(it);
    });

    btn.addEventListener("click", () => menu.classList.contains("hidden") ? open() : close());
    root.appendChild(btn); root.appendChild(menu);
  }

  function mountMultiselect(root, { options, onChange }) {
    root.innerHTML = "";
    const control = U.el("div", { class: "multiselect__control", role: "combobox", "aria-expanded": "false" });
    const input = U.el("input", { class: "multiselect__input", type: "text", placeholder: "Temas..." });
    const menu  = U.el("div", { class: "multiselect__menu hidden", role: "listbox" });

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

    function open(){ if (!menu.classList.contains("hidden")) return; menu.classList.remove("hidden"); control.setAttribute("aria-expanded","true"); U.backdrop(close); syncItems(); }
    function close(){ menu.classList.add("hidden"); control.setAttribute("aria-expanded","false"); }

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
  function toggleWelcome(count){
    const el = document.getElementById("welcome"); if (!el) return;
    if (count > 0) el.classList.add("hidden"); else el.classList.remove("hidden");
  }

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
    const batch = nextBatch();
    toggleWelcome(batch.length);
    renderAppend(batch);
  }

  function mountInfiniteScroll() {
    const sentinel = document.getElementById("sentinela");
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) renderAppend(nextBatch()); });
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
        { label: "Direito Penal", txt: [
          "data/direito-penal/penal1.txt",
          "data/direito-penal/penal2.txt"
        ]},
        { label: "Direito Civil", txt: "data/direito-civil/civil1.txt" },
        { label: "Direito Processual do Trabalho", txt: "data/direito-processual-trabalho/dpt1.txt" }
      ],
      onChange: async (opt) => {
        const urls = Array.isArray(opt.txt) ? opt.txt : [opt.txt];
        const txtParam = urls.join(",");
        window.history.replaceState({}, "", `?txt=${encodeURIComponent(txtParam)}`);
        const parts = await Promise.all(urls.map(u => fetch(u).then(r => r.ok ? r.text() : "").catch(() => "")));
        const txt = parts.join("\n-----\n");
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

/* ===================== MODAL DE FRASES ===================== */
const FRASES_TXT_URL = 'data/frases/frases.txt';
const PALETA = [
  {name:'Preto', val:'#000000'}, {name:'Branco', val:'#FFFFFF'},
  {name:'Cinza claro', val:'#E5E7EB'}, {name:'Azul pastel', val:'#BFDBFE'},
  {name:'Verde pastel', val:'#BBF7D0'}, {name:'Lilás pastel', val:'#E9D5FF'},
  {name:'Pêssego', val:'#FED7AA'}, {name:'Amarelo', val:'#FEF3C7'},
  {name:'Rosa', val:'#FBCFE8'}, {name:'Água', val:'#CFFAFE'},
  {name:'Verde petróleo', val:'#0B3D2E'}, {name:'Ameixa profunda', val:'#2E0530'},
];

let frasesCache = null;
let bgAtual = '#FFFFFF';
const FRASES_BATCH = 6;
let frasesOrder = [];
let frasesPtr = 0;
let frasesObserver = null;

function appendFrasesButton(actionsEl){
  const btn = document.createElement('button');
  btn.className = 'btn-icon-round';
  btn.title = 'Frases';
  btn.innerHTML = '<img src="assets/icons/frases.png" alt="Frases">';
  btn.addEventListener('click', openFrasesModal);
  btn.style.marginLeft = 'auto';
  actionsEl.appendChild(btn);
}

function shuffleArray(a){
  for(let i=a.length-1;i>0;i--){
    const j = (Math.random()*(i+1))|0;
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function resetFrasesOrder(){
  frasesOrder = Array.from({length: frasesCache.length}, (_,i)=>i);
  shuffleArray(frasesOrder);
  frasesPtr = 0;
}
function nextFrases(n){
  const out = [];
  while(out.length < n){
    if(frasesPtr >= frasesOrder.length) resetFrasesOrder();
    out.push(frasesCache[frasesOrder[frasesPtr++]]);
  }
  return out;
}

async function openFrasesModal(){
  await ensureFrases();
  mountSwatches();
  const grid = document.getElementById('frases-grid');
  if (grid) grid.innerHTML = '';
  resetFrasesOrder();
  loadNextBatch(FRASES_BATCH);
  mountFrasesInfiniteScroll();
  bindCloseFrases();

  const modal = document.getElementById('frases-modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false'); // acessível e visível
}

function bindCloseFrases(){
  const modal = document.getElementById('frases-modal');
  const hide = ()=>{
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');   // oculta e remove do fluxo
    if (frasesObserver) frasesObserver.disconnect();
  };
  modal.querySelectorAll('[data-close="true"]').forEach(el=>{ el.onclick = hide; });
  const bd = modal.querySelector('.modal-backdrop');
  if (bd) bd.onclick = hide;
}

function mountSwatches(){
  const wrap = document.getElementById('frases-swatches');
  wrap.innerHTML = '';
  PALETA.forEach((c)=>{
    const s = document.createElement('button');
    s.className = 'swatch';
    s.style.background = c.val;
    s.title = c.name;
    if (c.val === bgAtual) s.setAttribute('aria-selected','true');
    s.onclick = ()=>{
      bgAtual = c.val;
      wrap.querySelectorAll('.swatch').forEach(x=>x.removeAttribute('aria-selected'));
      s.setAttribute('aria-selected','true');
      rerenderVisibleFrases();
    };
    wrap.appendChild(s);
  });
}

async function ensureFrases(){
  if (frasesCache) return;
  const res = await fetch(FRASES_TXT_URL);
  const txt = await res.text();
  // "frase | autor"  ou  "frase - autor"  ou  "frase — autor"
  frasesCache = txt
    .split(/\r?\n/)
    .map(l=>l.trim())
    .filter(l=>l.length>0 && !l.startsWith('#'))
    .map(l=>{
      let [frase, autor] = l.split(/\s[|\-—]\s/);
      if (!autor){ autor=''; frase=l; }
      return {frase, autor};
    });
}
// ===== Helpers de renderização do PNG de frases =====
function isDark(hex){
  const h = String(hex||'#000000').replace('#','');
  const n = parseInt(h,16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const lum = 0.2126*r + 0.7152*g + 0.0722*b;
  return lum < 140;
}
function wrapLines(ctx, text, maxW){
  const words = String(text||'').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for(const w of words){
    const test = line ? line + ' ' + w : w;
    if(ctx.measureText(test).width > maxW){
      if(line) lines.push(line);
      line = w;
    }else line = test;
  }
  if(line) lines.push(line);
  return lines;
}
function fitFontByBox(ctx, text, maxW, maxH, minPx, maxPx, step, family, lh){
  for (let s=maxPx; s>=minPx; s-=step){
    ctx.font = `${s}px ${family}`;
    const h = wrapLines(ctx, text, maxW).length * (s*lh);
    if (h <= maxH) return s;
  }
  return minPx;
}
function renderFrasePNG(canvas, frase, autor, bg){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // fundo
  ctx.fillStyle = bg || '#FFFFFF';
  ctx.fillRect(0,0,W,H);

  // header
  ctx.fillStyle = isDark(bg) ? '#FFFFFF' : '#000000';
  ctx.font = '28px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('meujus.com.br', W/2, 36);

  // área interna
  const padX = 96;
  const innerW = W - padX*2;
  const topY = 220;
  const bottomPad = 260;
  const maxH = H - topY - bottomPad;

  // frase
  const lh = 1.3;
  const size = fitFontByBox(ctx, frase, innerW, maxH, 28, 72, 2, 'Times New Roman, Times, serif', lh);
  ctx.font = `${size}px "Times New Roman", Times, serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = isDark(bg) ? '#FFFFFF' : '#000000';

  const lines = wrapLines(ctx, frase, innerW);
  const fraseH = lines.length * (size*lh);
  let y = topY + Math.max(0, Math.floor((maxH - fraseH)/2));
  for (const L of lines){ ctx.fillText(L, padX, y); y += size*lh; }

  // autor
  const aSize = Math.max(18, Math.round(size * 0.42));
  ctx.font = `italic ${aSize}px ui-serif, Georgia, "Times New Roman", Times, serif`;
  ctx.fillText(autor ? `— ${autor}` : '', padX, y + 24);
}

function makeFraseItem(it){
  const item = document.createElement('div');
  item.className = 'frase-item';

  const cv = document.createElement('canvas');
  cv.className = 'frase-canvas';
  cv.width = 1080; cv.height = 1350;
  cv.setAttribute('aria-label', 'Frase');
  cv.dataset.frase = it.frase;
  cv.dataset.autor = it.autor;

  renderFrasePNG(cv, it.frase, it.autor, bgAtual);

  const btn = document.createElement('button');
  btn.className = 'btn-share-vert';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Compartilhar frase');
  btn.textContent = 'Compartilhar';
  btn.onclick = async ()=>{
    const blob = await new Promise(r=>cv.toBlob(r,'image/png',1));
    const file = new File([blob], 'frase.png', {type:'image/png'});
    if (navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:'Frase', text:'meujus.com.br'});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'frase.png'; a.click();
      URL.revokeObjectURL(url);
    }
  };

  item.appendChild(cv);
  item.appendChild(btn);
  return item;
}

function loadNextBatch(n){
  const grid = document.getElementById('frases-grid');
  nextFrases(n).forEach(it => grid.appendChild(makeFraseItem(it)));
}

function mountFrasesInfiniteScroll(){
  const root = document.querySelector('#frases-modal .modal-body');
  const sent = document.getElementById('frases-sentinela');
  if (frasesObserver) frasesObserver.disconnect();
  frasesObserver = new IntersectionObserver((entries)=>{
    if (entries.some(e=>e.isIntersecting)) loadNextBatch(FRASES_BATCH);
  }, { root, rootMargin: '400px' });
  frasesObserver.observe(sent);
}

function rerenderVisibleFrases(){
  document.querySelectorAll('#frases-grid .frase-canvas').forEach(cv=>{
    renderFrasePNG(cv, cv.dataset.frase, cv.dataset.autor, bgAtual);
  });
}


/* ===================== Impressora / PDF ===================== */
(function(){
  const modal = document.getElementById('modal-impressora');
  const closeEls = modal?.querySelectorAll?.('[data-close-impressora]') || [];
  const lista = document.getElementById('imp-lista');
  const loading = document.getElementById('imp-loading');
  const btnExportar = document.getElementById('imp-exportar');
  const contadorEl = document.getElementById('imp-contador');
  const radioCols = () => Number(document.querySelector('input[name="imp-colunas"]:checked')?.value || 1);

  // --- Botão "Criar Prova" + seleção aleatória balanceada por tema ---
let allItemsCache = null;

const btnCriar = document.createElement('button');
btnCriar.id = 'imp-criar';
btnCriar.type = 'button';
btnCriar.className = 'btn';
btnCriar.textContent = 'Criar Prova';
btnCriar.addEventListener('click', handleCriarProva);

// coloca antes do Exportar
if (btnExportar && btnExportar.parentNode) {
  btnExportar.parentNode.insertBefore(btnCriar, btnExportar);
}

async function getAllItems(){
  if (allItemsCache) return allItemsCache.slice();
  let cur = null, acc = [];
  while (true){
    const page = await fetchQuestoes(cur);
    const itens = page?.itens || [];
    acc = acc.concat(itens);
    cur = page?.nextCursor ?? null;
    if (cur == null) break;
  }
  allItemsCache = acc.slice();
  return acc;
}

function pickCountsByTema(buckets, total){
  const temas = Object.keys(buckets);
  if (temas.length === 0) return {};
  const counts = {};
  const N = Math.min(total, Object.values(buckets).reduce((s,a)=>s+a.length,0));

  // pelo menos 1 por tema, se possível
  temas.forEach(t => counts[t] = Math.min(1, buckets[t].length));
  let used = temas.reduce((s,t)=>s+counts[t],0);

  // proporcional ao tamanho do bucket
  if (used < N){
    const totalAvail = temas.reduce((s,t)=>s + Math.max(buckets[t].length - counts[t], 0), 0);
    if (totalAvail > 0){
      temas.forEach(t => {
        if (used >= N) return;
        const room = Math.max(buckets[t].length - counts[t], 0);
        const share = Math.floor((room / totalAvail) * (N - used));
        const add = Math.min(share, room);
        counts[t] += add; used += add;
      });
    }
  }

  // round-robin para completar sobras
  let k = 0;
  while (used < N){
    const t = temas[k % temas.length];
    if (counts[t] < buckets[t].length){ counts[t]++; used++; }
    k++;
  }
  return counts;
}

function shuffleInPlace(arr){
  for (let i=arr.length-1;i>0;i--){
    const j = (Math.random()*(i+1))|0;
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

async function handleCriarProva(){
  const all = await getAllItems();
  if (!all.length) return;

  // buckets por tema; itens sem tema vão para "__SEM_TEMA__"
  const buckets = {};
  for (const it of all){
    const ts = (Array.isArray(it.temas) && it.temas.length) ? it.temas : ['__SEM_TEMA__'];
    ts.forEach(t => {
      if (!buckets[t]) buckets[t] = [];
      buckets[t].push(it);
    });
  }
  Object.values(buckets).forEach(shuffleInPlace);

  const counts = pickCountsByTema(buckets, 20);

  // limpar seleção atual e aplicar nova
  selected.clear();
  const chosen = [];
  Object.keys(counts).forEach(t => {
    const need = counts[t];
    const arr = buckets[t];
    for (let i=0;i<need && i<arr.length;i++){
      const q = arr[i];
      if (!selected.has(q.id)){ selected.set(q.id, q); chosen.push(q.id); }
    }
  });

  updateCounter();

  // refletir visualmente nos cards já renderizados
  lista.querySelectorAll('.imp-card').forEach(card => {
    const id = Number(card.dataset.id || '0');
    const cb = card.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = selected.has(id);
  });
}

// limpar cache ao abrir o modal para refletir filtros/ordem atuais
// (complemento em openModal)


  let selected = new Map();   // id -> questão
  let cursor = null;          // paginação
  let isLoading = false;
  let hasMore = true;
  let initialFocusId = null;
  let impObserver = null;

  function ensureSentinel(){
    let sent = document.getElementById('imp-sentinela');
    if (!sent) { sent = document.createElement('div'); sent.id = 'imp-sentinela'; sent.setAttribute('aria-hidden','true'); lista?.appendChild(sent); }
    return sent;
  }
  function mountImpInfiniteScroll(){
    if (!modal || !lista) return;
    const root = modal.querySelector('.modal-body') || lista;
    const sent = ensureSentinel();
    if (impObserver) impObserver.disconnect();
    impObserver = new IntersectionObserver((entries)=>{ if (entries.some(e=>e.isIntersecting)) loadMore(); }, { root, rootMargin: '600px 0px' });
    impObserver.observe(sent);
  }

  async function fetchQuestoes(nextCursor){
    if (window.QUESTOES_FETCH_PAGE) return await window.QUESTOES_FETCH_PAGE(nextCursor);
    return { itens: [], nextCursor: null };
  }

function openModal(focusId){
  if (!modal) return;
  allItemsCache = null; // zera cache para refletir estado atual
  initialFocusId = focusId || null;
  modal.classList.remove('hidden');
  if (lista) { lista.innerHTML = ''; lista.appendChild(loading); lista.appendChild(ensureSentinel()); lista.scrollTop = 0; }
  selected.clear();
  updateCounter();
  cursor = null;
  hasMore = true;
  loadMore();
  mountImpInfiniteScroll();
}


  function closeModal(){ if (!modal) return; modal.classList.add('hidden'); if (impObserver) impObserver.disconnect(); }
  closeEls.forEach(el => el.addEventListener('click', closeModal));
  modal?.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

window.addEventListener('abrirImpressora', (e) => {
  const id = e?.detail?.id ?? null;            // id = idx+1 do card clicado
  try {
    const order = (window.QUESTOES_CURRENT_ORDER && window.QUESTOES_CURRENT_ORDER()) || [];
    // faz a lista da impressora começar na questão clicada
    if (Number.isInteger(id)) {
      const pos = order.findIndex(i => i + 1 === id);
      if (pos >= 0) cursor = pos;              // usa o cursor já existente no escopo do modal
    }
  } catch {}
  openModal(id);                                // mantém foco/scroll para o id
});

  function updateCounter(){ if (contadorEl) contadorEl.textContent = selected.size; if (btnExportar) btnExportar.disabled = selected.size === 0; }

  function makeCard(q){
    const article = document.createElement('article');
    article.className = 'q imp-card';
    article.dataset.id = q.id;

    const body = document.createElement('div');
    body.className = 'imp-body';
    body.innerHTML = q.enunciadoHtml || '';

    const sel = document.createElement('label');
    sel.className = 'imp-selecionar';
   const cb = document.createElement('input');
cb.type = 'checkbox';
cb.checked = selected.has(q.id); // respeita seleção programática
cb.addEventListener('change', () => {
  if (cb.checked) {
    if (selected.size >= 20 && !selected.has(q.id)) { cb.checked = false; return; }
    selected.set(q.id, q);
  } else {
    selected.delete(q.id);
  }
  updateCounter();
});

    sel.appendChild(cb);
    sel.appendChild(document.createTextNode('Selecionar'));

    article.appendChild(body);
    article.appendChild(sel);
    return article;
  }

  async function loadMore(){
    if (isLoading || !hasMore || !lista) return;
    isLoading = true;
    if (loading) loading.classList.remove('hidden');

    const page = await fetchQuestoes(cursor);
    const itens = page.itens || [];
    cursor = page.nextCursor;
    hasMore = Boolean(cursor);

    if (loading?.parentNode) loading.remove();
    const frag = document.createDocumentFragment();
    itens.forEach(q => frag.appendChild(makeCard(q)));
    lista.appendChild(frag);
    lista.appendChild(ensureSentinel());
    if (loading) loading.classList.add('hidden');
    isLoading = false;

    if (initialFocusId != null) {
      const el = lista.querySelector(`[data-id="${initialFocusId}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
      initialFocusId = null;
    }
  }

  // ---------- Hifenização pt-BR (heurística leve) ----------
  function hyphenPoints(word){
    const w = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const pts = [];
    const V = /[aeiouy]/;
    for(let i=1;i<w.length-1;i++){
      const a=w[i-1], b=w[i], c=w[i+1];
      const cl = a+b, cr = b+c;
      const cons = (x)=>!V.test(x);
      const twoCons = ['br','cr','dr','fr','gr','pr','tr','bl','cl','fl','gl','pl'];
      if (V.test(a) && cons(b) && V.test(c)) pts.push(i);
      else if (V.test(a) && cons(b) && cons(c) && !twoCons.includes(cr)) pts.push(i+1);
      else if (cons(a) && cons(b) && V.test(c) && !twoCons.includes(cl)) pts.push(i);
    }
    return pts.filter(p=>p>=2 && p<=w.length-2);
  }
  function splitWithHyphen(word, maxWidth, doc){
    const pts = hyphenPoints(word);
    for(let k=pts.length-1;k>=0;k--){
      const left = word.slice(0, pts[k]) + '-';
      if (doc.getTextWidth(left) <= maxWidth) return [left, word.slice(pts[k])];
    }
    return null;
  }

  // ---------- Quebra + justificação ----------
  function layoutLines(doc, text, maxWidth){
    const words = String(text||'').split(/\s+/).filter(Boolean);
    const lines = [];
    const spaceW = doc.getTextWidth(' ');
    let cur = [], curW = 0;

    function pushLine(forceLeft=false){
      if (cur.length === 0) return;
      const gaps = Math.max(cur.length-1, 1);
      const natural = cur.reduce((s,w)=>s+doc.getTextWidth(w),0) + (cur.length-1)*spaceW;
      const extra = Math.max(maxWidth - natural, 0);
      lines.push({ words: cur.slice(), justify: !forceLeft && cur.length>1, natural, extra, gaps });
      cur = []; curW = 0;
    }

    for (let i=0;i<words.length;i++){
      const w = words[i];
      const wW = doc.getTextWidth(w);
      if (cur.length === 0){
        if (wW <= maxWidth){ cur.push(w); curW = wW; }
        else{
          const hp = splitWithHyphen(w, maxWidth, doc);
          if (hp){ cur.push(hp[0]); pushLine(true); words.splice(i+1,0,hp[1]); }
          else { cur.push(w); pushLine(true); }
        }
        continue;
      }
      if (curW + spaceW + wW <= maxWidth){
        cur.push(w); curW += spaceW + wW;
      } else {
        const room = maxWidth - curW - spaceW;
        const hp = room>0 ? splitWithHyphen(w, room, doc) : null;
        if (hp){
          cur.push(hp[0]); pushLine(); words.splice(i+1,0,hp[1]);
        }else{
          pushLine(); i--;
        }
      }
    }
    pushLine(true);
    return lines;
  }
  function drawJustified(doc, x, y, lines, lh){
    const spaceW = doc.getTextWidth(' ');
    let yy = y;
    lines.forEach((ln)=>{
      let xx = x;
      if (!ln.justify){
        ln.words.forEach((w,j)=>{
          doc.text(w, xx, yy);
          xx += doc.getTextWidth(w) + (j<ln.words.length-1?spaceW:0);
        });
      }else{
        const add = ln.extra / ln.gaps;
        ln.words.forEach((w,j)=>{
          doc.text(w, xx, yy);
          xx += doc.getTextWidth(w) + (j<ln.words.length-1?(spaceW+add):0);
        });
      }
      yy += lh;
    });
    return yy;
  }

  // ---------- Exportação PDF 100% texto (A4, 1–2 colunas, sem cortes) ----------
async function exportarPDF_PURO(questoes){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4', compress:true });
  doc.setProperties({ title: 'Prova MeuJus' });

  // Métricas
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();

  const M = 10;                       // margens iguais 10mm
  const TOP_EXTRA = 3;                // respiro topo
  const COLS = Number(document.querySelector('input[name="imp-colunas"]:checked')?.value || 1);
  const GAP  = COLS === 2 ? 10 : 0;   // margem entre colunas
  const COL_W = COLS === 2 ? (PAGE_W - 2*M - GAP)/2 : (PAGE_W - 2*M);

  // Fontes e espaçamentos
  const ENUN_FS = 11;                 // +1
  const ALT_FS  = 10;                 // +1
  const TIT_FS  = 11;

  const LH_ENUN = 4.8;
  const LH_ALT  = 4.6;
  const LH_TIT  = 5.2;

  const SEP = 5;                      // separador com respiro simétrico
  const PRE_TITLE = 2.7;              // +10px entre linha e "Questão X"
  const TITLE_GAP = LH_ENUN + 2.7;    // +10px entre "Questão X" e início do enunciado
  const ENUN_TO_ALTS = 6;             // respiro entre enunciado e alternativas
  const ALT_IND = 1.0;                // recuo menor à esquerda
  const ALT_GAP = 1.2;                // respiro entre alternativas

  function setEnun(){ doc.setFont('Helvetica',''); doc.setFontSize(ENUN_FS); }
  function setAlt(){  doc.setFont('Helvetica',''); doc.setFontSize(ALT_FS);  }
  function setTit(){  doc.setFont('Helvetica','bold'); doc.setFontSize(TIT_FS); }

  // Fluxo de página/coluna
  let curCol = 0;
  let curX = M;
  let curY = M + TOP_EXTRA;

  function newPage(){
    doc.addPage();
    curCol = 0;
    curX = M;
    curY = M + TOP_EXTRA;
  }
  function nextColumnOrPage(){
    if (COLS === 2 && curCol === 0){
      curCol = 1;
      curX = M + COL_W + GAP;
      curY = M + TOP_EXTRA;
    } else newPage();
  }
  function ensureSpace(need){
    if (curY + need > PAGE_H - M) nextColumnOrPage();
  }

  // Quebra + justificação
  function layoutLines(doc, text, maxWidth){
    const words = String(text||'').split(/\s+/).filter(Boolean);
    const lines = [];
    const spaceW = doc.getTextWidth(' ');
    let cur = [], curW = 0;
    function pushLine(forceLeft=false){
      if (!cur.length) return;
      const natural = cur.reduce((s,w)=>s+doc.getTextWidth(w),0) + (cur.length-1)*spaceW;
      const extra = Math.max(maxWidth - natural, 0);
      lines.push({ words: cur.slice(), justify: !forceLeft && cur.length>1, extra, gaps: Math.max(cur.length-1,1) });
      cur = []; curW = 0;
    }
    for (let i=0;i<words.length;i++){
      const w = words[i], wW = doc.getTextWidth(w);
      if (!cur.length){
        if (wW <= maxWidth){ cur.push(w); curW = wW; }
        else { cur.push(w); pushLine(true); }
        continue;
      }
      if (curW + spaceW + wW <= maxWidth){ cur.push(w); curW += spaceW + wW; }
      else { pushLine(); i--; }
    }
    pushLine(true);
    return lines;
  }
  function drawJustified(doc, x, y, lines, lh){
    const spaceW = doc.getTextWidth(' ');
    let yy = y;
    for (const ln of lines){
      let xx = x;
      const add = ln.justify ? ln.extra/ln.gaps : 0;
      ln.words.forEach((w,j)=>{
        doc.text(w, xx, yy);
        xx += doc.getTextWidth(w) + (j<ln.words.length-1 ? spaceW + add : 0);
      });
      yy += lh;
    }
    return yy;
  }

  // Render
  questoes.forEach((q, qi)=>{
    // espaço extra entre linha separadora e próximo título
    const pre = qi>0 ? PRE_TITLE : 0;

    // garantir título + gaps (sem exigir 1ª linha do enunciado)
setTit();
const minBlock = pre + LH_TIT + TITLE_GAP;
ensureSpace(minBlock);


    if (pre) curY += PRE_TITLE;

    // Título
    doc.text(`Questão ${qi+1}`, curX, curY);
    curY += TITLE_GAP;

   // Enunciado (quebra linha a linha, permitindo partir de coluna/página)
setEnun();
const enunParas = String(q.enunciadoPlain||'').replace(/\r/g,'').split(/\n+/).filter(Boolean);
for (let pi=0; pi<enunParas.length; pi++){
  const lines = layoutLines(doc, enunParas[pi], COL_W);
  if (pi) { ensureSpace(LH_ENUN*0.5); curY += LH_ENUN*0.5; } // espaço entre parágrafos
  for (let li=0; li<lines.length; li++){
    ensureSpace(LH_ENUN);
    curY = drawJustified(doc, curX, curY, [lines[li]], LH_ENUN);
  }
}


    // Respiro entre enunciado e alternativas
    curY += ENUN_TO_ALTS;

    // Alternativas
    setAlt();
    (q.alternativas||[]).forEach((a, k)=>{
      const label = `[ ${String.fromCharCode(65+k)} ] - `;
      const text = String(a).replace(/^[A-E]\)\s*/i,'').trim();

      // largura e linhas
      doc.setFont('Helvetica','bold'); // letras um pouco mais pesadas
      const labelW = doc.getTextWidth(label);
      doc.setFont('Helvetica','');     // texto normal

      const maxTextW = Math.max(COL_W - labelW - ALT_IND, 10);
      const lines = layoutLines(doc, text, maxTextW);

      const need = lines.length*LH_ALT + LH_ALT*0.25 + ALT_GAP;
      ensureSpace(need);

      let y0 = curY;

      // label
      doc.setFont('Helvetica','bold');
      doc.text(label, curX, y0);
      doc.setFont('Helvetica',''); // volta

      // primeira linha ao lado do label
      const first = lines.shift();
      if (first){
        y0 = drawJustified(doc, curX + labelW + ALT_IND, y0, [first], LH_ALT);
      }
      // demais linhas
      if (lines.length){
        y0 = drawJustified(doc, curX + labelW + ALT_IND, y0, lines, LH_ALT);
      }
      curY = y0 + ALT_GAP; // respiro entre alternativas
    });

    // Separador com respiro simétrico
    curY += SEP;
    ensureSpace(0);
    doc.setLineWidth(0.2);
    doc.line(curX, curY, curX + COL_W, curY);
    curY += SEP;
  });

  // Gabarito
  nextColumnOrPage();
  setTit(); doc.text('Gabarito', curX, curY);
  curY += LH_TIT;
  doc.setFont('Helvetica',''); doc.setFontSize(ENUN_FS);

  const half = Math.ceil(questoes.length/2);
  const colGap = 18;
  const gabColW = (COL_W - colGap)/2;

  const colA = questoes.slice(0, half).map((q,i)=>`${i+1}) ${String(q.gabarito||'-').toUpperCase().replace(/[^A-E]/g,'')}`);
  const colB = questoes.slice(half).map((q,i)=>`${half+i+1}) ${String(q.gabarito||'-').toUpperCase().replace(/[^A-E]/g,'')}`);
  const maxRows = Math.max(colA.length, colB.length);

  for (let r=0; r<maxRows; r++){
    ensureSpace(LH_ENUN);
    if (colA[r]) doc.text(colA[r], curX, curY);
    if (colB[r]) doc.text(colB[r], curX + gabColW + colGap, curY);
    curY += LH_ENUN;
  }

  doc.save('prova.pdf');
}

  btnExportar?.addEventListener('click', async () => {
    const itens = Array.from(selected.values());
    await exportarPDF_PURO(itens);
  });

})();

/* =================== Botão Impressora em cada card =================== */
function appendImpressoraButton(actionsEl, idx){
  const btn = document.createElement('button');
  btn.className = 'btn-icon-round';
  btn.title = 'Impressora';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-12 0v3h12v-3M8 14h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  btn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('abrirImpressora', { detail: { id: idx + 1 } }));
  });
  actionsEl.appendChild(btn);
}
