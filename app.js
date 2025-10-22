/* ============================== APP ============================== */
(function () {
  const { txtUrl } = window.APP_CONFIG || {};

  const state = {
    disciplina: null,
    temasDisponiveis: [],
    temasSelecionados: new Set(),
    cards: []
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
      children.flat().forEach(c => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
      return e;
    },
    trim: s => (s || "").replace(/^\s+|\s+$/g, ""),
    byPrefix: (l, p) => l.startsWith(p) ? l.slice(p.length).trim() : null,
    uniq: arr => [...new Set(arr)],
    copy: t => { try { navigator.clipboard && navigator.clipboard.writeText(t); } catch { } },
    openGoogle: q => window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank"),
    onClickOutside(root, cb) {
      const h = ev => { if (!root.contains(ev.target)) cb(); };
      document.addEventListener("mousedown", h, { once: true });
    },
    fitPopover(menu, trigger) {
      const r = trigger.getBoundingClientRect();
      if (r.top < 160) menu.classList.add("below"); else menu.classList.remove("below");
    },
    mdInline(s) {
      return (s || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
    }
  };

  /* ------------------------------ Loader ------------------------------ */
  async function loadTxt() {
    try {
      const res = await fetch(txtUrl);
      if (!res.ok) throw new Error("not found");
      return await res.text();
    } catch {
      const mount = document.getElementById("cards");
      mount.innerHTML = `<div class="q"><div class="q__stmt">Arquivo não encontrado: <code>${txtUrl}</code></div></div>`;
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
      let referencias = "";
      let enunciado = "";
      const alternativas = [];
      let gabarito = "";
      const temas = [];

      for (const line of lines) {
        if (line.startsWith("*****")) { referencias = U.byPrefix(line, "*****") || ""; continue; }
        if (line.startsWith("***")) { const g = U.byPrefix(line, "***") || ""; const m = /Gabarito\s*:\s*([A-Z])/i.exec(g); gabarito = m ? m[1].toUpperCase() : ""; continue; }
        if (line.startsWith("****")) { const t = U.byPrefix(line, "****") || ""; t.split(",").forEach(x => { const v = U.trim(x); if (v) temas.push(v); }); continue; }
        if (line.startsWith("**")) { alternativas.push(U.byPrefix(line, "**") || ""); continue; }
        if (line.startsWith("*")) { const part = U.byPrefix(line, "*") || ""; enunciado = enunciado ? (enunciado + " " + part) : part; }
      }
      cards.push({ referencias, enunciado, alternativas, gabarito, temas });
    }
    return cards;
  }

  /* ------------------------------ Badge logic ------------------------------ */
  function inferBadges(alts) {
    const letterMatch = alts.every(a => /^[A-E]\)/i.test(a));
    if (letterMatch) return alts.map(a => a[0].toUpperCase()); // A..E

    const text = alts.join(" ").toLowerCase();
    if (alts.length === 2 && /certo|errado/.test(text)) return ["C", "E"];
    if (alts.length === 2 && /verdadeiro|falso/.test(text)) return ["V", "F"];

    // fallback A..E
    return alts.map((_, i) => String.fromCharCode(65 + i));
  }

  /* ------------------------------ IA Prompts ------------------------------ */
  function buildPrompt(kind, card) {
    const join = [];
    join.push(card.enunciado);
    card.alternativas.forEach(a => join.push(a));
    const full = join.join(" | ");
    const withAnswer = `${full} | Gabarito: ${card.gabarito || "?"}`;

    switch (kind) {
      case "Gabarito":
        return [
          "Papel: examinador.",
          "Tarefa: decidir a alternativa correta, sem rodeios.",
          "Saída: ",
          "Gabarito: <LETRA>",
          "Fundamentação: 3 bullets enxutos.",
          "Se não houver dado suficiente: 'Indeterminado' + o que falta.",
          "Questão:", full
        ].join("\n");
      case "Vídeo":
        return [
          "Papel: curador educacional.",
          "Tarefa: gerar termos de busca YouTube e roteiro de 60–90s que explique a questão.",
          "Saída:",
          "1) 5 termos de busca exatos;",
          "2) Roteiro em 5 tópicos;",
          "3) 3 títulos para o vídeo.",
          "Entrada:", withAnswer
        ].join("\n");
      case "Checklist":
        return [
          "Papel: auditor de resolução.",
          "Tarefa: checklist objetivo para resolver questões idênticas.",
          "Saída:",
          "- Pré-requisitos (normas/súmulas);",
          "- Passos numerados;",
          "- Erros comuns.",
          "Entrada:", withAnswer
        ].join("\n");
      case "Princípios":
        return [
          "Papel: professor de teoria.",
          "Tarefa: mapear princípios aplicáveis e sua incidência nas alternativas.",
          "Saída:",
          "- Lista de princípios;",
          "- Impacto em A..E;",
          "- Conclusão curta até o gabarito.",
          "Entrada:", withAnswer
        ].join("\n");
      case "Inédita":
        return [
          "Papel: elaborador de prova.",
          "Tarefa: criar 1 questão inédita do mesmo tema e nível.",
          "Saída:",
          "Enunciado;",
          "A) ... E);",
          "Gabarito: <LETRA>;",
          "Justificativa 2–3 linhas;",
          "Tag de temas;",
          "Referências normativas curtas se couber.",
          "Tema base:", (card.temas || []).join(", "),
          "Entrada:", full
        ].join("\n");
      default:
        return full;
    }
  }

  /* ------------------------------ Render Card ------------------------------ */
  function buildCard(card, idx) {
    const badges = inferBadges(card.alternativas);

    const meta = U.el("div", { class: "q__meta" }, card.referencias);
    const stmt = U.el("div", { class: "q__stmt", html: U.mdInline(card.enunciado) });

    const ul = U.el("ul", { class: "q__opts" });
    card.alternativas.forEach((opt, i) => {
      const clean = opt.replace(/^[A-E]\)\s*/i, "");
      const li = U.el("li", { class: "q__opt", "data-letter": badges[i] });
      const badge = U.el("span", { class: "q__badge" }, badges[i]);
      const text = U.el("div", {}, clean);
      li.appendChild(badge);
      li.appendChild(text);
      ul.appendChild(li);
    });

    // IA popover
    const iaBtn = U.el("button", { class: "btn", type: "button" }, "Google IA");
    const pop = U.el("div", { class: "popover" });
    const menu = U.el("div", { class: "popover__menu hidden" });
    ["Gabarito", "Vídeo", "Checklist", "Princípios", "Inédita"].forEach(lbl => {
      const b = U.el("button", { class: "subbtn", type: "button" }, lbl);
      b.addEventListener("click", () => {
        const prompt = buildPrompt(lbl, card);
        U.copy(prompt);
        U.openGoogle(`${lbl} | ${prompt}`);
        if (lbl === "Gabarito") revealAnswer(ul, card.gabarito);
        closeMenu();
      });
      menu.appendChild(b);
    });
    function openMenu() { menu.classList.remove("hidden"); U.fitPopover(menu, iaBtn); U.onClickOutside(pop, closeMenu); }
    function closeMenu() { menu.classList.add("hidden"); }
    iaBtn.addEventListener("click", () => menu.classList.contains("hidden") ? openMenu() : closeMenu());
    pop.appendChild(iaBtn);
    pop.appendChild(menu);

    const actions = U.el("div", { class: "q__actions" }, pop);

    const wrap = U.el("article", { class: "q", "data-idx": idx }, meta, stmt, ul, actions);

    // Resposta do usuário
    let answered = false;
    ul.addEventListener("click", ev => {
      const li = ev.target.closest(".q__opt");
      if (!li || answered) return;
      answered = true;
      const chosen = (li.getAttribute("data-letter") || "").toUpperCase();
      const correct = (card.gabarito || "").toUpperCase();

      if (chosen === correct) {
        li.classList.add("correct");
      } else {
        li.classList.add("wrong");
        revealAnswer(ul, correct, true);
      }
    });

    return wrap;
  }

  function revealAnswer(ul, gLetter, showExplain = false) {
    const items = Array.from(ul.children);
    const right = items.find(li => (li.getAttribute("data-letter") || "").toUpperCase() === (gLetter || "").toUpperCase());
    if (right) right.classList.add("correct");
    if (showExplain) {
      const info = U.el("div", { class: "q__explain" }, `Gabarito: ${gLetter}`);
      ul.parentElement.appendChild(info);
    }
  }

  /* ------------------------------ Filters UI ------------------------------ */
  function mountSelectSingle(root, { label, options, onChange }) {
    root.innerHTML = "";
    root.classList.add("select");
    const lab = U.el("label", { class: "select__label" }, label);
    const btn = U.el("button", { class: "select__button", type: "button" }, label);
    const menu = U.el("div", { class: "select__menu hidden", role: "listbox" });

    options.forEach(opt => {
      const it = U.el("div", { class: "select__option", role: "option" }, opt);
      it.addEventListener("click", () => { btn.textContent = opt; menu.classList.add("hidden"); onChange && onChange(opt); });
      menu.appendChild(it);
    });

    btn.addEventListener("click", () => { menu.classList.toggle("hidden"); U.onClickOutside(root, () => menu.classList.add("hidden")); });

    root.appendChild(lab); root.appendChild(btn); root.appendChild(menu);
  }

  function mountMultiselect(root, { label, options, onChange }) {
    root.innerHTML = "";
    const lab = U.el("label", { class: "multiselect__label" }, label);
    const control = U.el("div", { class: "multiselect__control" });
    const input = U.el("input", { class: "multiselect__input", type: "text", placeholder: "Buscar temas..." });
    const menu = U.el("div", { class: "multiselect__menu hidden", role: "listbox" });

    function renderTags() {
      Array.from(control.querySelectorAll(".tag")).forEach(t => t.remove());
      state.temasSelecionados.forEach(val => {
        const tag = U.el("span", { class: "tag" }, val, U.el("button", { type: "button", title: "Remover" }, "×"));
        tag.querySelector("button").addEventListener("click", () => { state.temasSelecionados.delete(val); renderTags(); onChange && onChange(new Set(state.temasSelecionados)); syncItems(); });
        control.insertBefore(tag, input);
      });
    }
    function syncItems() {
      const q = input.value.toLowerCase();
      Array.from(menu.children).forEach(item => {
        const match = !q || item.textContent.toLowerCase().includes(q);
        item.style.display = match ? "block" : "none";
        const selected = state.temasSelecionados.has(item.textContent);
        item.setAttribute("aria-selected", selected ? "true" : "false");
      });
    }

    options.forEach(opt => {
      const it = U.el("div", { class: "multiselect__item", role: "option" }, opt);
      it.addEventListener("click", () => {
        if (state.temasSelecionados.has(opt)) state.temasSelecionados.delete(opt); else state.temasSelecionados.add(opt);
        renderTags(); onChange && onChange(new Set(state.temasSelecionados)); syncItems();
      });
      menu.appendChild(it);
    });

    input.addEventListener("focus", () => { menu.classList.remove("hidden"); U.onClickOutside(root, () => menu.classList.add("hidden")); syncItems(); });
    input.addEventListener("input", syncItems);

    renderTags();
    control.appendChild(input);
    root.appendChild(lab); root.appendChild(control); root.appendChild(menu);
  }

  /* ------------------------------ Render list ------------------------------ */
  function renderList() {
    const mount = document.getElementById("cards");
    mount.innerHTML = "";
    const ativos = state.cards.filter(c => {
      if (!state.temasSelecionados.size) return true;
      return c.temas && c.temas.some(t => state.temasSelecionados.has(t));
    });
    ativos.forEach((c, i) => mount.appendChild(buildCard(c, i)));
  }

  /* ------------------------------ Init ------------------------------ */
  async function init() {
    const raw = await loadTxt();
    state.cards = parseTxt(raw);
    state.temasDisponiveis = U.uniq(state.cards.flatMap(c => c.temas || [])).sort();

    mountSelectSingle(document.getElementById("disciplina-select"), {
      label: "Disciplina",
      options: ["Direito Penal", "Direito Processual do Trabalho", "Direito Civil", "Direito Constitucional"],
      onChange: val => state.disciplina = val
    });

    mountMultiselect(document.getElementById("temas-multiselect"), {
      label: "Temas",
      options: state.temasDisponiveis,
      onChange: renderList
    });

    renderList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
