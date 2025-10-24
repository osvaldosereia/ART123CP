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
    // Backdrop utilitário usado nos selects
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

      for (const L0 of lines) {
        const L = L0.replace(/^\uFEFF?/, ""); // remove BOM se houver
        if (/^\*{5}\s/.test(L)) { referencias = L.replace(/^\*{5}\s*/, "").trim(); continue; }          // ***** referências
        if (/^\*{3}\s/.test(L)) { const g = L.replace(/^\*{3}\s*/, "").trim();                           // *** gabarito
          const m = /Gabarito\s*:\s*([A-Z])/i.exec(g); gabarito = m ? m[1].toUpperCase() : ""; continue; }
        if (/^\*{4}\s/.test(L)) { const t = L.replace(/^\*{4}\s*/, "").trim();                           // **** temas
          t.split(",").forEach(x => { const v = (x || "").trim(); if (v) temas.push(v); }); continue; }
        if (/^\*{2}\s/.test(L)) { alternativas.push(L.replace(/^\*{2}\s*/, "").trim()); continue; }      // ** alternativas
        if (/^\*\s/.test(L)) { const part = L.replace(/^\*\s*/, "").trim();                              // * enunciado
          enunciado = enunciado ? (enunciado + " " + part) : part; }
      }
      cards.push({ referencias, enunciado, alternativas, gabarito, temas });
    }
    return cards;
  }

  /* ------ Fonte paginada p/ modal Impressora: segue filtros e ordem atual ------ */
  (function exposePagedSource(){
    function computeOrderFromState(){
      const temasAtivos = [...state.temasSelecionados];
      if (temasAtivos.length === 0) return state.cards.map((_, i) => i);
      const groups = [];
      temasAtivos.forEach(t => {
        const idxs = state.cards.map((c, i) => c.temas.includes(t) ? i : -1).filter(i => i >= 0);
        groups.push({ items: idxs, ptr: 0 });
      });
      const order = [];
      let moved = true;
      while (moved) {
        moved = false;
        for (const g of groups) {
          if (g.ptr < g.items.length) {
            const i = g.items[g.ptr++];
            if (!order.includes(i)) order.push(i);
            moved = true;
          }
        }
      }
      return order;
    }

    function normalizeForPrint(c, i){
      const alts = (c.alternativas || []).map((raw, k) => {
        const letra = String.fromCharCode(65 + k);
        const texto = String(raw || "").replace(/^[A-E]\)\s*/i, "");
        return `${letra}) ${texto}`;
      });

      // visual no modal igual aos cartões do site (sem meta “***** …”)
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
        id: i + 1,                                // usado para focar ao abrir o modal
        enunciadoHtml: html,                      // render do modal
        enunciadoPlain: c.enunciado || "",        // base do PDF
        alternativas: alts,                       // A)..E) já normalizadas
        gabarito: String(c.gabarito || "")        // usado no gabarito da última página do PDF
                  .trim().toUpperCase()
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

  /* ------------------------------ Compartilhar Story (PNG 1080x1920) ------------------------------ */
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
  if(grid) grid.innerHTML = '';
  resetFrasesOrder();
  loadNextBatch(FRASES_BATCH);
  mountFrasesInfiniteScroll();
  bindCloseFrases();
  document.getElementById('frases-modal').classList.remove('hidden');
}

function bindCloseFrases(){
  const modal = document.getElementById('frases-modal');
  const hide = ()=>{
    modal.classList.add('hidden');
    if(frasesObserver) frasesObserver.disconnect();
  };
  modal.querySelectorAll('[data-close="true"]').forEach(el=>{ el.onclick = hide; });
  const bd = modal.querySelector('.modal-backdrop');
  if(bd) bd.onclick = hide;
}

function mountSwatches(){
  const wrap = document.getElementById('frases-swatches');
  wrap.innerHTML = '';
  PALETA.forEach((c)=>{
    const s = document.createElement('button');
    s.className = 'swatch';
    s.style.background = c.val;
    s.title = c.name;
    if(c.val === bgAtual) s.setAttribute('aria-selected','true');
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
  if(frasesCache) return;
  const res = await fetch(FRASES_TXT_URL);
  const txt = await res.text();
  // "frase | autor"  ou  "frase - autor"  ou  "frase — autor"
  frasesCache = txt
    .split(/\r?\n/)
    .map(l=>l.trim())
    .filter(l=>l.length>0 && !l.startsWith('#'))
    .map(l=>{
      let [frase, autor] = l.split(/\s[|\-—]\s/);
      if(!autor){ autor=''; frase=l; }
      return {frase, autor};
    });
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
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:'Frase', text:'meujus.com.br'});
    }else{
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
  if(frasesObserver) frasesObserver.disconnect();
  frasesObserver = new IntersectionObserver((entries)=>{
    if(entries.some(e=>e.isIntersecting)) loadNextBatch(FRASES_BATCH);
  }, { root, rootMargin: '400px' });
  frasesObserver.observe(sent);
}

function rerenderVisibleFrases(){
  document.querySelectorAll('#frases-grid .frase-canvas').forEach(cv=>{
    renderFrasePNG(cv, cv.dataset.frase, cv.dataset.autor, bgAtual);
  });
}

// ===== Render PNG frase =====
function isDark(hex){
  const h = hex.replace('#','');
  const bigint = parseInt(h,16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  const lum = 0.2126*r + 0.7152*g + 0.0722*b;
  return lum < 140;
}
function wrapLines(ctx, text, maxW){
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for(const w of words){
    const test = line ? line + ' ' + w : w;
    if(ctx.measureText(test).width > maxW){
      if(line) lines.push(line);
      line = w;
    }else{
      line = test;
    }
  }
  if(line) lines.push(line);
  return lines;
}
function fitFontByBox(ctx, text, maxW, maxH, minPx, maxPx, step, family, lhK){
  for (let s=maxPx; s>=minPx; s-=step){
    ctx.font = `${s}px ${family}`;
    const lines = wrapLines(ctx, text, maxW);
    const h = lines.length * (s*lhK);
    if (h <= maxH) return s;
  }
  return minPx;
}
function renderFrasePNG(canvas, frase, autor, bg){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = bg;
  ctx.fillRect(0,0,W,H);

  ctx.fillStyle = isDark(bg) ? '#FFFFFF' : '#000000';
  ctx.font = '28px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('meujus.com.br', W/2, 36);

  const padX = 96;
  const innerW = W - padX*2;
  const topY = 220;
  const bottomPad = 260;
  const maxH = H - topY - bottomPad;

  const lhK = 1.3;
  let size = fitFontByBox(ctx, frase, innerW, maxH, 28, 72, 2, 'Times New Roman, Times, serif', lhK);
  ctx.font = `${size}px "Times New Roman", Times, serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = isDark(bg) ? '#FFFFFF' : '#000000';

  const lines = wrapLines(ctx, frase, innerW);
  const fraseH = lines.length * (size * lhK);
  const yStart = topY + Math.max(0, Math.floor((maxH - fraseH) / 2));

  let y = yStart;
  for (const line of lines){ ctx.fillText(line, padX, y); y += size * lhK; }

  const autorSize = Math.max(18, Math.round(size * 0.42));
  ctx.font = `italic ${autorSize}px ui-serif, Georgia, "Times New Roman", Times, serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(autor ? `— ${autor}` : '', padX, y + 24);
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

  window.addEventListener('abrirImpressora', (e) => { const id = e?.detail?.id ?? null; openModal(id); });

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
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (selected.size >= 20) { cb.checked = false; return; }
        selected.set(q.id, q);
      } else selected.delete(q.id);
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

  // PDF: margens iguais 10mm, gutter maior, divisor de colunas tracejado,
  // alinhamento à esquerda, círculos menores sem contorno, tudo alinhado.
  function exportarPDF(questoes, { colunas = 1 } = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });

    // Geometria A4
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 10;                       // 10mm em todas as bordas
    const gutter = colunas === 2 ? 18 : 0;   // um pouco maior entre colunas
    const contentW = pageW - margin * 2;
    const colW = colunas === 2 ? (contentW - gutter) / 2 : contentW;

    // Safe paddings para não encostar nas bordas e no divisor
    const SAFE_L = 2.0;
    const SAFE_R = 2.0;
    const TEXT_W = colW - SAFE_L - SAFE_R;

    // Tipografia e espaçamentos
    const ENUN_SIZE = 8;     // 1px menor
    const ALT_SIZE  = 9;
    const ENUN_LH   = 5.0;
    const ALT_LH    = 5.0;
    const GAP_BLOCK_TOP   = 3.0;
    const GAP_ENUN_ALTS   = 3.4;
    const GAP_ALT         = 2.4;
    const SEP_LINE_W      = 0.45;
    const SEP_AFTER_GAP   = 3.0;

    // Bolas das alternativas: menores, sem contorno, cinza claro
    const DOT_R = 1.9;
    const DOT_FILL = 235;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);

    const s = { x: margin, y: margin, col: 1 };

    function newColumnOrPage() {
      if (colunas === 2 && s.col === 1) {
        s.x = margin + colW + gutter;
        s.y = margin;
        s.col = 2;
        drawColumnDivider();
      } else {
        doc.addPage();
        doc.setFont('helvetica', 'normal'); doc.setTextColor(0,0,0);
        s.x = margin; s.y = margin; s.col = 1;
        drawColumnDivider();
      }
    }
    const bottom = () => pageH - margin;
    function ensureLines(n, lh) { if (s.y + n * lh > bottom()) newColumnOrPage(); }
    const split = (t, w) => doc.splitTextToSize(t, w);
    function stripHtml(html){
      try{
        const tmp = document.createElement('div'); tmp.innerHTML = html || '';
        const raw = tmp.textContent || tmp.innerText || '';
        return (window.he ? he.decode(raw) : raw).replace(/\s+\n/g,'\n').replace(/[ \t]+/g,' ').trim();
      }catch{ return ''; }
    }

    function drawColumnDivider() {
      if (colunas !== 2) return;
      const cx = margin + colW + gutter / 2;
      doc.setDrawColor(180);
      doc.setLineWidth(0.2);
      doc.setLineDash([1.2, 1.8], 0);
      for (let y = margin; y < pageH - margin; y += 3) {
        doc.line(cx, y, cx, Math.min(y + 1.2, pageH - margin));
      }
      doc.setLineDash([]);
      doc.setDrawColor(0);
    }

    function drawSeparator() {
      ensureLines(1, 1);
      doc.setDrawColor(0);
      doc.setLineWidth(SEP_LINE_W);
      doc.setLineDash([], 0);
      doc.line(s.x, s.y, s.x + colW, s.y);
      s.y += SEP_AFTER_GAP;
    }

    // Alternativas alinhadas à esquerda, sem linha entre alternativas
    function renderAlternatives(rawAlts) {
      const alts = Array.isArray(rawAlts) ? rawAlts : [];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(ALT_SIZE);

      alts.forEach((t, i) => {
        const letter = String.fromCharCode(65 + i);
        const clean = String(t).replace(/^[A-E]\)\s*/i, '');
        const lines = split(clean, TEXT_W - (DOT_R * 2 + 3));

        ensureLines(lines.length, ALT_LH);

        const y0 = s.y;
        const cx = s.x + SAFE_L + DOT_R + 1.2;
        const cy = y0 - ALT_LH * 0.82 + DOT_R;   // topo da bola ≈ topo da linha

        // bola
        doc.setFillColor(DOT_FILL, DOT_FILL, DOT_FILL);
        doc.circle(cx, cy, DOT_R, 'F');

        // letra centralizada na bola
        const letterSize = Math.min(ALT_SIZE + 1, DOT_R * 1.9);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(letterSize);
        const ly = cy + (letterSize * 0.33);
        doc.text(letter, cx, ly, { align: 'center' });

        // texto da alternativa
        const xText = Math.ceil(s.x + SAFE_L + DOT_R * 2 + 3);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(ALT_SIZE);
        lines.forEach(ln => {
          doc.text(ln, xText, s.y);
          s.y += ALT_LH;
        });

        s.y += GAP_ALT;
      });
    }

    function renderQuestao(q, n) {
      const enunPlain = q.enunciadoPlain ? String(q.enunciadoPlain) : stripHtml(q.enunciado);
      const enunLines = split(enunPlain, TEXT_W);

      ensureLines(Math.ceil(GAP_BLOCK_TOP / ENUN_LH), ENUN_LH);
      s.y += GAP_BLOCK_TOP;

      // Título
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(ENUN_SIZE);
      ensureLines(1, ENUN_LH);
      doc.text(`Questão ${n}`, s.x + SAFE_L, s.y);
      s.y += ENUN_LH * 0.9;

      // Enunciado
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(ENUN_SIZE);
      enunLines.forEach(ln => {
        ensureLines(1, ENUN_LH);
        doc.text(ln, s.x + SAFE_L, s.y);
        s.y += ENUN_LH;
      });

      s.y += GAP_ENUN_ALTS;

      renderAlternatives(q.alternativas);

      drawSeparator();
    }

    drawColumnDivider();
    const itens = questoes.map((q, i) => ({ ...q, _n: i + 1 }));
    itens.forEach(q => renderQuestao(q, q._n));

    // Gabarito
    doc.addPage(); drawColumnDivider();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    const title = 'Gabarito';
    const cx = pageW / 2; const tW = doc.getTextWidth(title);
    doc.text(title, cx - tW / 2, margin + 2);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const keyLH = 6, keyColGap = 20, keyColW = (contentW - keyColGap) / 2;
    let kx = margin, ky = margin + 10, kcol = 0;

    itens.forEach(({ _n, gabarito }) => {
      const g = (gabarito || '').replace(/[^A-E]/gi, '').toUpperCase() || '-';
      if (ky + keyLH > pageH - margin) {
        if (kcol === 0) { kx = margin + keyColW + keyColGap; ky = margin + 10; kcol = 1; }
        else { doc.addPage(); drawColumnDivider(); kx = margin; ky = margin + 10; kcol = 0; }
      }
      doc.text(`${_n}) ${g}`, kx, ky);
      ky += keyLH;
    });

    doc.save('prova.pdf');
  }

  function stripHtml(html){
    try{
      const tmp = document.createElement('div'); tmp.innerHTML = html || '';
      const raw = tmp.textContent || tmp.innerText || '';
      return (window.he ? he.decode(raw) : raw).replace(/\s+\n/g,'\n').replace(/[ \t]+/g,' ').trim();
    }catch{ return ''; }
  }

  btnExportar?.addEventListener('click', () => {
    const colunas = radioCols();
    const itens = Array.from(selected.values());
    exportarPDF(itens, { colunas });
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
