/* ======================================================================
   BOOTSTRAP DO APP
   ====================================================================== */
(function(){
  const { txtUrl } = window.APP_CONFIG || {};

  const state = {
    disciplina: null,
    temasDisponiveis: [],
    temasSelecionados: new Set(),
    cards: []
  };

  /* ================================================================
     MÓDULO: UTILITÁRIOS
     ================================================================ */
  const U = {
    el(tag, attrs={}, ...children){
      const e = document.createElement(tag);
      Object.entries(attrs).forEach(([k,v]) => {
        if(k === "class") e.className = v;
        else if(k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
        else if(k === "html") e.innerHTML = v;
        else e.setAttribute(k, v);
      });
      children.flat().forEach(c => {
        if(c == null) return;
        e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
      return e;
    },
    trim(s){ return (s || "").replace(/^\s+|\s+$/g, ""); },
    byPrefix(line, prefix){ return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null; },
    uniq(arr){ return [...new Set(arr)]; },
    copy(text){ try { navigator.clipboard && navigator.clipboard.writeText(text); } catch(e){} },
    openGoogle(q){ window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank"); },
    onClickOutside(root, cb){
      function handler(ev){ if(!root.contains(ev.target)) cb(); }
      document.addEventListener("mousedown", handler, { once:true });
    },
    fitPopover(menu, trigger){
      const rect = trigger.getBoundingClientRect();
      const spaceAbove = rect.top;
      if(spaceAbove < 160){ menu.classList.add("below"); } else { menu.classList.remove("below"); }
    }
  };

  /* ================================================================
     MÓDULO: PARSER DO TXT
     ================================================================ */
  function parseTxt(raw){
    const blocks = raw.split("-----").map(s => s.trim()).filter(Boolean);
    const cards = [];

    for(const block of blocks){
      const lines = block.split("\n").map(l => l.trim()).filter(Boolean);

      let referencias = "";
      let enunciado = "";
      const alternativas = [];
      let gabarito = "";
      const temas = [];

      for(const line of lines){
        if(line.startsWith("*****")){
          referencias = U.byPrefix(line, "*****") || "";
          continue;
        }
        if(line.startsWith("***")){
          const g = U.byPrefix(line, "***") || "";
          const m = /Gabarito\s*:\s*([A-Z])/i.exec(g);
          gabarito = m ? m[1].toUpperCase() : "";
          continue;
        }
        if(line.startsWith("****")){
          const t = U.byPrefix(line, "****") || "";
          t.split(",").forEach(x => { const v = U.trim(x); if(v) temas.push(v); });
          continue;
        }
        if(line.startsWith("**")){
          alternativas.push(U.byPrefix(line, "**") || "");
          continue;
        }
        if(line.startsWith("*")){
          const part = U.byPrefix(line, "*") || "";
          enunciado = enunciado ? (enunciado + " " + part) : part;
        }
      }

      cards.push({ referencias, enunciado, alternativas, gabarito, temas });
    }

    return cards;
  }

  /* ================================================================
     MÓDULO: RENDERIZAÇÃO DO CARD
     ================================================================ */
  function buildCard(card, index){
    const meta = U.el("div", { class:"card__meta small" }, card.referencias);
    const stmt = U.el("div", { class:"card__statement" });
    stmt.innerHTML = toInlineHTML(card.enunciado);

    const list = U.el("ul", { class:"card__options" });
    card.alternativas.forEach((opt, i) => {
      const text = opt.replace(/^([A-E])\)\s*/i, ""); // remove "A) "
      const letter = opt.match(/^([A-E])\)/i)?.[1]?.toUpperCase() || String.fromCharCode(65 + i);
      const li = U.el("li", { "data-letter": letter });
      li.appendChild(U.el("span", { class:"opt-letter" }, letter + ")"));
      li.appendChild(U.el("span", {}, " " + text));
      list.appendChild(li);
    });

    const iaBtn = U.el("button", { class:"btn btn--ia", type:"button" }, "Google IA");
    const pop = U.el("div", { class:"popover" });
    const menu = U.el("div", { class:"popover__menu hidden" });
    const subLabels = ["Gabarito", "Vídeo", "Checklist", "Princípios", "Inédita"];

    subLabels.forEach(lbl => {
      const b = U.el("button", { class:"subbtn", type:"button" }, lbl);
      b.addEventListener("click", () => {
        const payload = buildPrompt(lbl, card);
        U.copy(payload);
        U.openGoogle(`${lbl} | ${payload}`);
        if(lbl === "Gabarito"){
          revealAnswer(list, card.gabarito);
        }
        closeMenu();
      });
      menu.appendChild(b);
    });

    function openMenu(){
      menu.classList.remove("hidden");
      U.fitPopover(menu, iaBtn);
      U.onClickOutside(pop, closeMenu);
    }
    function closeMenu(){ menu.classList.add("hidden"); }
    iaBtn.addEventListener("click", () => {
      if(menu.classList.contains("hidden")) openMenu(); else closeMenu();
    });

    pop.appendChild(iaBtn);
    pop.appendChild(menu);

    const actions = U.el("div", { class:"card__actions" },
      pop,
      U.el("div", { class:"muted" }, card.temas.length ? `Temas: ${card.temas.join(", ")}` : "")
    );

    const wrapper = U.el("article", { class:"card", "data-index": index }, meta, stmt, list, actions);
    return wrapper;
  }

  function revealAnswer(listEl, gLetter){
    const lis = Array.from(listEl.children);
    lis.forEach(li => li.classList.remove("correct"));
    const target = lis.find(li => (li.getAttribute("data-letter") || "").toUpperCase() === gLetter.toUpperCase());
    if(target) target.classList.add("correct");
  }

  function toInlineHTML(s){
    return (s || "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }

  /* ================================================================
     UI: SELECT + MULTISELECT
     ================================================================ */
  function mountSelectSingle(root, { label, options, onChange }){
    root.innerHTML = "";
    root.classList.add("select");
    const lab = U.el("label", { class:"select__label" }, label);
    const btn = U.el("button", { class:"select__button", type:"button" }, "Disciplina");
    const menu = U.el("div", { class:"select__menu hidden", role:"listbox" });

    options.forEach(opt => {
      const it = U.el("div", { class:"select__option", role:"option" }, opt);
      it.addEventListener("click", () => {
        btn.textContent = opt;
        menu.classList.add("hidden");
        onChange && onChange(opt);
      });
      menu.appendChild(it);
    });

    btn.addEventListener("click", () => {
      menu.classList.toggle("hidden");
      U.onClickOutside(root, () => menu.classList.add("hidden"));
    });

    root.appendChild(lab);
    root.appendChild(btn);
    root.appendChild(menu);
  }

  function mountMultiselect(root, { label, options, onChange }){
    root.innerHTML = "";
    const lab = U.el("label", { class:"multiselect__label" }, label);
    const control = U.el("div", { class:"multiselect__control" });
    const input = U.el("input", { class:"multiselect__input", type:"text", placeholder:"Buscar temas..." });
    const menu = U.el("div", { class:"multiselect__menu hidden", role:"listbox" });

    function renderTags(){
      Array.from(control.querySelectorAll(".tag")).forEach(t => t.remove());
      state.temasSelecionados.forEach(val => {
        const tag = U.el("span", { class:"tag" }, val, U.el("button", { type:"button", title:"Remover" }, "×"));
        tag.querySelector("button").addEventListener("click", () => {
          state.temasSelecionados.delete(val);
          renderTags();
          onChange && onChange(new Set(state.temasSelecionados));
          syncItems();
        });
        control.insertBefore(tag, input);
      });
    }

    function syncItems(){
      const q = input.value.toLowerCase();
      Array.from(menu.children).forEach(item => {
        const text = item.textContent.toLowerCase();
        const match = !q || text.includes(q);
        item.style.display = match ? "block" : "none";
        const selected = state.temasSelecionados.has(item.textContent);
        item.setAttribute("aria-selected", selected ? "true" : "false");
      });
    }

    options.forEach(opt => {
      const it = U.el("div", { class:"multiselect__item", role:"option" }, opt);
      it.addEventListener("click", () => {
        if(state.temasSelecionados.has(opt)) state.temasSelecionados.delete(opt);
        else state.temasSelecionados.add(opt);
        renderTags();
        onChange && onChange(new Set(state.temasSelecionados));
        syncItems();
      });
      menu.appendChild(it);
    });

    input.addEventListener("focus", () => {
      menu.classList.remove("hidden");
      U.onClickOutside(root, () => menu.classList.add("hidden"));
      syncItems();
    });
    input.addEventListener("input", syncItems);

    renderTags();
    control.appendChild(input);

    root.appendChild(lab);
    root.appendChild(control);
    root.appendChild(menu);
  }

  /* ================================================================
     GOOGLE IA PROMPTS
     ================================================================ */
  function buildPrompt(contextLabel, card){
    const lines = [];
    lines.push(card.enunciado);
    card.alternativas.forEach(a => lines.push(a));
    lines.push("Gabarito: " + (card.gabarito || "?"));
    return `[${contextLabel}] ` + lines.join(" | ");
  }

  /* ================================================================
     LISTA
     ================================================================ */
  function renderList(){
    const mount = document.getElementById("cards");
    mount.innerHTML = "";
    const ativos = state.cards.filter(c => {
      if(!state.temasSelecionados.size) return true;
      return c.temas && c.temas.some(t => state.temasSelecionados.has(t));
    });
    ativos.forEach((c, i) => mount.appendChild(buildCard(c, i)));
  }

  /* ================================================================
     INIT
     ================================================================ */
  async function init(){
    const res = await fetch(txtUrl);
    const raw = await res.text();

    state.cards = parseTxt(raw);
    state.temasDisponiveis = U.uniq(state.cards.flatMap(c => c.temas || [])).sort();

    mountSelectSingle(document.getElementById("disciplina-select"), {
      label: "Disciplina",
      options: ["Direito Processual do Trabalho", "Direito Penal", "Direito Constitucional"],
      onChange: (val) => { state.disciplina = val; }
    });

    mountMultiselect(document.getElementById("temas-multiselect"), {
      label: "Temas",
      options: state.temasDisponiveis,
      onChange: () => renderList()
    });

    renderList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
