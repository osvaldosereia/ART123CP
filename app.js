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
      children.flat().forEach(c => { if (c!=null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
      return e;
    },
    trim: s => (s || "").replace(/^\s+|\s+$/g, ""),
    byPrefix: (l, p) => l.startsWith(p) ? l.slice(p.length).trim() : null,
    uniq: arr => [...new Set(arr)],
    copy: t => { try { navigator.clipboard && navigator.clipboard.writeText(t); } catch { } },
    openGoogle: q => window.open("https://www.google.com/search?udm=50&q=" + encodeURIComponent(q), "_blank"),
    onClickOutside(root, cb) { const h = ev => { if (!root.contains(ev.target)) cb(); }; document.addEventListener("mousedown", h, { once: true }); },
    fitPopover(menu, trigger) { const r = trigger.getBoundingClientRect(); if (r.top < 160) menu.classList.add("below"); else menu.classList.remove("below"); },
    mdInline: s => (s || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>"),
    // Backdrop para fechar dropdowns confiavelmente em mobile/desktop
    backdrop(onClose){
      const el = document.createElement("div");
      el.className = "dropdown-backdrop";
      document.body.appendChild(el);
      const handler = () => { try{ onClose(); } finally { el.remove(); document.removeEventListener("pointerdown", handler, true); } };
      setTimeout(() => document.addEventListener("pointerdown", handler, true), 0);
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

  function formatStatement(text){
    const html = U.mdInline(text || "");
    const parts = html.split(/(?<=[.!?])\s+/).filter(Boolean); // quebra em final de frase
    return parts.map(p => `<p>${p}</p>`).join("");
  }

  /* ------------------------------ IA Prompts ------------------------------ */
  function buildPrompt(kind, card) {
    const join = []; join.push(card.enunciado); card.alternativas.forEach(a => join.push(a));
    const full = join.join(" | "), withAnswer = `${full} | Gabarito: ${card.gabarito || "?"}`;
    switch (kind) {
      case "Gabarito": return [
        "Papel: examinador.","Tarefa: decidir a alternativa correta.","Saída:","Gabarito: <LETRA>","Fundamentação: 3 bullets.",
        "Se faltar dado: 'Indeterminado' + o que falta.","Questão:", full].join("\n");
      case "Vídeo": return [
        "Papel: curador educacional.","Tarefa: termos YouTube + roteiro 60–90s.","Saída:","1) 5 termos;","2) Roteiro em 5 tópicos;",
        "3) 3 títulos.","Entrada:", withAnswer].join("\n");
      case "Checklist": return [
        "Papel: auditor.","Tarefa: checklist para resolver questões iguais.","Saída:","Pré-requisitos; Passos numerados; Erros comuns.",
        "Entrada:", withAnswer].join("\n");
      case "Princípios": return [
        "Papel: professor.","Tarefa: mapear princípios e impacto em A..E.","Saída:","Lista de princípios; Impacto em A..E; Conclusão curta.",
        "Entrada:", withAnswer].join("\n");
      case "Inédita": return [
        "Papel: elaborador.","Tarefa: criar 1 questão inédita do mesmo tema e nível.","Saída:",
        "Enunciado; A) ... E); Gabarito: <LETRA>; Justificativa 2–3 linhas; Tag de temas.",
        "Tema base:", (card.temas||[]).join(", "), "Entrada:", full].join("\n");
      default: return full;
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
    const stmt = U.el("div", { class: "q__stmt", html: formatStatement(card.enunciado) });

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
    ["Gabarito", "Vídeo", "Checklist", "Princípios", "Inédita"].forEach(lbl => {
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

    const actions = U.el("div", { class: "q__actions" }, pop);

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
      if (bd){ try{ bd.remove(); }catch{} bd = null; }
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
      if (bd){ try{ bd.remove(); }catch{} bd = null; }
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
      groups.push({ key: "ALL", items: state.cards.map((_, i) => i), ptr: 0 });
    } else {
      temasAtivos.forEach(t => {
        const idxs = state.cards.map((c, i) => c.temas.includes(t) ? i : -1).filter(i => i >= 0);
        groups.push({ key: t, items: idxs, ptr: 0 });
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
