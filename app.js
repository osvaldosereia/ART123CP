"use strict";

/* ==================== ESTADO ==================== */
const STATE = {
  // dados e busca
  tree: /** @type {Record<string,{label:string,files:string[]}>} */({}),
  disciplina: "",
  cache: /** @type {Map<string,{text:string, parsed:any[]}>>} */(new Map()),
  poolQuestions: /** @type {any[]} */([]),   // todas as questões da disciplina ativa
  temasAll: /** @type {string[]} */([]),     // todos os temas agregados
  temasSel: /** @type {Set<string>} */(new Set()), // temas selecionados no modal
  activeThemes: /** @type {Set<string>} */(new Set()), // chips ativos no topo do quiz

  // renderização do quiz
  allQuestions: /** @type {any[]} */([]), // base após filtro por temas
  viewQuestions: /** @type {any[]} */([]),// visão filtrada pelos chips
  batchSize: 6,
  cursor: 0,
  observer: /** @type {IntersectionObserver|null} */ (null),

  // simulado
  exam: null,

  // multiselect (modal)
  ms:{ open:false, filter:"", list:[], listStripped:[] },
};

/* ==================== BOOTSTRAP ==================== */
document.addEventListener("DOMContentLoaded", async ()=>{
  // UI base
  initTopbarAutoHide();
  initBackToTop();

  // modal de busca
  wireSearchModal();

  // FAB Criar Simulado
  const btnCreate = document.getElementById("btnCreateExam");
  if (btnCreate){
    btnCreate.addEventListener("click", createExamFromView);
  }

  // leitura do /data e auto-start com 1ª disciplina
  try{
    STATE.tree = await discoverDataTree();
    const keys = Object.keys(STATE.tree).sort();
    fillDisciplines(keys);
    if(keys.length){
      await setActiveDisciplina(keys[0]);     // começa já com a 1ª disciplina
      // carrega tudo dessa disciplina no quiz inicial
      STATE.allQuestions = STATE.poolQuestions.slice();
      STATE.viewQuestions = STATE.allQuestions.slice();
      renderSelectedThemesChips();            // chips vazios no início
      mountInfinite();
      toast(`Carregado: ${pretty(keys[0])} · ${STATE.viewQuestions.length} questões`);
    }else{
      toast("Nenhuma disciplina encontrada");
    }
  }catch(e){
    console.error(e);
    toast("Erro ao ler /data/");
  }

  // botão compartilhar prova
  const btnShareExam = document.getElementById("examShareLink");
  {
  const shareBtns = document.querySelectorAll('[data-action="share-exam"]');
  shareBtns.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      try{
        if(!STATE.exam){ createExamFromView?.(); }
        exportExamPrintView?.();
      }catch(err){
        console.error(err);
        toast?.("Não foi possível compartilhar a prova");
      }
    });
  });
});

/* ==================== MODAL DE BUSCA ==================== */
function wireSearchModal(){
  const modal = /** @type {HTMLDialogElement} */(document.getElementById("searchModal"));
  const btnOpen = document.getElementById("btnOpenSearch");
  const btnClose = document.getElementById("btnCloseSearch");
  const btnRun = document.getElementById("btnRunSearch");

  if(btnOpen){ btnOpen.addEventListener("click", ()=>{ modal?.showModal(); updateMsCount(); }); }
  if(btnClose){ btnClose.addEventListener("click", ()=>modal?.close()); }
  if(btnRun){
    btnRun.addEventListener("click", async (e)=>{
      e.preventDefault();
      await startSearch(); // aplica filtro por temas selecionados
      modal?.close();
      window.scrollTo({top:0,behavior:"smooth"});
    });
  }

  setupDropdownDisciplina();   // dropdown dentro do modal
}

/* ==================== DISCOVERY data/ ==================== */
async function discoverDataTree(){
  const gh = detectGithubRepo();
  if (!gh) return {};
  toast("Lendo data/…");
  const base = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data`;
  const nodes = await walkGitHub(base);
  const map = {};
  for(const n of nodes){
    if(n.type!=="file" || !n.path.endsWith(".txt")) continue;
    const rel = n.path.replace(/^data\//,"");
    const disciplina = rel.split("/")[0];
    if(!map[disciplina]) map[disciplina]={label:disciplina, files:[]};
    map[disciplina].files.push(n.path);
  }
  return map;
}
function detectGithubRepo(){
  const {host, pathname} = window.location;
  if (!/github\.io$/.test(host)) return null;
  const seg = pathname.replace(/^\/+/,"").split("/");
  const repo = seg[0] || "";
  if (!repo) return null;
  const owner = host.split(".")[0];
  return { owner, repo };
}
async function walkGitHub(url){
  const acc=[];
  await dfs(url);
  return acc;
  async function dfs(u){
    const res = await fetch(u, {headers:{Accept:"application/vnd.github+json"}});
    if(!res.ok) throw new Error(`GitHub API falhou: ${res.status}`);
    const arr = await res.json();
    for(const it of arr){
      if(it.type==="dir") await dfs(it.url);
      else acc.push({ type:it.type, path:it.path });
    }
  }
}

/* ==================== DISCIPLINA ATIVA ==================== */
async function setActiveDisciplina(key){
  STATE.disciplina = key;
  STATE.temasSel.clear();
  STATE.activeThemes.clear();

  // parse de todos os arquivos da disciplina
  const node = STATE.tree[key];
  const allParsed = [];
  for (const path of node.files){
    const parsed = await getParsedForPath(path);
    allParsed.push(...parsed);
  }
  STATE.poolQuestions = normalizeThemes(allParsed);
  STATE.temasAll = collectAllThemes(STATE.poolQuestions);

  // prepara multiselect dentro do modal
  buildMsList(STATE.temasAll);
  document.getElementById("ddDiscLabel").textContent = pretty(key);
}

/* ==================== DROPDOWN DISCIPLINA (MODAL) ==================== */
function setupDropdownDisciplina(){
  const btn = document.getElementById("ddDiscBtn");
  const list = document.getElementById("ddDiscList");
  if(!btn || !list) return;

  btn.addEventListener("click", ()=>{
    list.classList.toggle("show");
    btn.setAttribute("aria-expanded", list.classList.contains("show")?"true":"false");
  });
  document.addEventListener("click", (e)=>{
    const dd = btn.closest(".dropdown");
    if (dd && !dd.contains(e.target)) list.classList.remove("show");
  });
}
function fillDisciplines(keys){
  const ul = document.getElementById("ddDiscList");
  if(!ul) return;
  ul.innerHTML="";
  if(!keys.length){
    const li=document.createElement("li"); li.textContent="Nenhuma disciplina"; li.style.color="var(--muted)";
    ul.appendChild(li); return;
  }
  for(const k of keys){
    const li=document.createElement("li");
    li.textContent=pretty(k);
    li.addEventListener("click", async ()=>{
      ul.classList.remove("show");
      await setActiveDisciplina(k);
      // ao trocar disciplina, limpa resultados atuais de quiz
      resetQuizList();
      toast(`Disciplina: ${pretty(k)}`);
    });
    ul.appendChild(li);
  }
}

/* ==================== MULTISELECT DE TEMAS (MODAL) ==================== */
function buildMsList(temas){
  const list = document.getElementById("msList");
  if(!list) return;
  STATE.ms.list = temas.slice();
  STATE.ms.listStripped = STATE.ms.list.map(strip);
  STATE.ms.filter = "";
  list.innerHTML = "";
  const frag = document.createDocumentFragment();
  temas.forEach(t=>{
    const row = document.createElement("div");
    row.className = "ms-item";
    row.dataset.tema=t;
    row.innerHTML = `<input type="checkbox" aria-label="${t}"><span>${t}</span>`;
    frag.appendChild(row);
  });
  list.appendChild(frag);

  list.onclick = (e)=>{
    const item = e.target.closest(".ms-item");
    if(!item || !list.contains(item)) return;
    const tema = item.dataset.tema;
    const ck = item.querySelector("input");
    ck.checked = !ck.checked;
    item.classList.toggle("on", ck.checked);
    if(ck.checked) STATE.temasSel.add(tema); else STATE.temasSel.delete(tema);
    updateMsCount();
    document.getElementById("btnRunSearch").toggleAttribute("disabled", STATE.temasSel.size===0);
  };

  const inp = /** @type {HTMLInputElement} */(document.getElementById("msSearch"));
  const btnAll = document.getElementById("msSelAll");
  const btnClr = document.getElementById("msClear");

  if(inp){
    inp.value="";
    inp.oninput = deb((e)=>{
      STATE.ms.filter = e.target.value || "";
      renderMsFiltered();
      updateMsCount();
    },150);
  }
  if(btnAll){
    btnAll.onclick = ()=>{
      getVisibleMs().forEach(t=>STATE.temasSel.add(t));
      renderMsFiltered(true);
      updateMsCount();
      document.getElementById("btnRunSearch").toggleAttribute("disabled", STATE.temasSel.size===0);
    };
  }
  if(btnClr){
    btnClr.onclick = ()=>{
      STATE.temasSel.clear();
      renderMsFiltered(false);
      updateMsCount();
      document.getElementById("btnRunSearch").setAttribute("disabled","true");
    };
  }
  updateMsCount();
}
function renderMsFiltered(checkVisible){
  const list = document.getElementById("msList");
  if(!list) return;
  const vis = new Set(getVisibleMs());
  list.querySelectorAll(".ms-item").forEach(el=>{
    const tema = el.dataset.tema;
    const show = !STATE.ms.filter || vis.has(tema);
    el.style.display = show ? "" : "none";
    if(checkVisible===true && show){ el.classList.add("on"); el.querySelector("input").checked=true; }
    if(checkVisible===false){ el.classList.remove("on"); el.querySelector("input").checked=false; }
  });
}
function getVisibleMs(){
  const f = strip(STATE.ms.filter);
  if(!f) return STATE.ms.list.slice();
  const out=[];
  for(let i=0;i<STATE.ms.list.length;i++){
    if(STATE.ms.listStripped[i].includes(f)) out.push(STATE.ms.list[i]);
  }
  return out;
}
function updateMsCount(){
  const vis = getVisibleMs().length;
  const sel = STATE.temasSel.size;
  const found = countQuestionsForSelectedThemes();
  const el = document.getElementById("msCount");
  if(el) el.textContent = `${vis} exibidos · ${sel} selecionados${sel?` · ${found} questões`:``}`;
}
function countQuestionsForSelectedThemes(){
  const want = new Set(STATE.temasSel);
  let n=0;
  for(const q of STATE.poolQuestions){
    const th = q.themes||[];
    if(th.some(t=>want.has(t))) n++;
  }
  return n;
}

/* ==================== BUSCA POR TEMAS ==================== */
async function startSearch(){
  if(!STATE.poolQuestions.length){ toast("Carregue uma disciplina"); return; }
  if(STATE.temasSel.size===0){ toast("Selecione pelo menos um tema"); return; }

  const want = new Set(STATE.temasSel);
  const filtered = STATE.poolQuestions.filter(q=>Array.isArray(q.themes)&&q.themes.some(t=>want.has(t)));
  if(!filtered.length){ toast("Nenhuma questão encontrada"); return; }

  STATE.allQuestions = filtered;
  STATE.activeThemes.clear();
  STATE.viewQuestions = STATE.allQuestions.slice();

  resetQuizList();
  renderSelectedThemesChips();
  mountInfinite();
  toast(`Filtro aplicado · ${STATE.viewQuestions.length} questões`);
}
function resetQuizList(){
  const list = document.getElementById("quizList");
  const sentinel = document.getElementById("sentinel");
  if(list) list.innerHTML="";
  if(sentinel) sentinel.textContent="Carregando…";
  STATE.cursor=0;
  STATE.observer?.disconnect();
}

/* ==================== CHIPS NO QUIZ ==================== */
function renderSelectedThemesChips(){
  const box = document.getElementById("quizThemes");
  if(!box) return;
  box.innerHTML="";

  // se nenhum tema selecionado no modal, mostra nada além de "Todos"
  const base = (STATE.temasSel.size? [...STATE.temasSel] : []).sort((a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:"base"}));

  // chip "Todos"
  const chipAll = document.createElement("button");
  chipAll.className = "chip" + (STATE.activeThemes.size===0 ? " on" : "");
  chipAll.textContent = "Todos";
  chipAll.onclick = ()=>{
    STATE.activeThemes.clear();
    applyThemeFilter();
    renderSelectedThemesChips();
  };
  box.appendChild(chipAll);

  // chips por tema
  if(base.length){
    const counts = new Map();
    for (const q of STATE.allQuestions){
      for (const t of q.themes){ if(STATE.temasSel.has(t)) counts.set(t, (counts.get(t)||0)+1); }
    }
    base.forEach(t=>{
      const c = counts.get(t)||0;
      const b = document.createElement("button");
      b.className = "chip" + (STATE.activeThemes.has(t) ? " on" : "");
      b.textContent = c ? `${t} (${c})` : t;
      b.onclick = ()=>{
        if (STATE.activeThemes.has(t)) STATE.activeThemes.delete(t);
        else STATE.activeThemes.add(t);
        applyThemeFilter();
        renderSelectedThemesChips();
      };
      box.appendChild(b);
    });
  }
}
function applyThemeFilter(){
  const act = [...STATE.activeThemes];
  if (act.length === 0){
    STATE.viewQuestions = STATE.allQuestions.slice();
  } else {
    const want = new Set(act);
    STATE.viewQuestions = STATE.allQuestions.filter(q => q.themes.some(t => want.has(t)));
  }
  resetQuizList();
  mountInfinite();
  toast(`Filtro: ${act.length ? act.join(", ") : "Todos"} · ${STATE.viewQuestions.length} questões`);
}

/* ==================== INFINITE SCROLL ==================== */
function mountInfinite(){
  const sentinel=document.getElementById("sentinel");
  if(!sentinel) return;
  STATE.observer?.disconnect();
  STATE.observer = new IntersectionObserver(async (entries)=>{
    const entry = entries[0];
    if(entry.isIntersecting){
      await renderBatch();
      if(STATE.cursor >= STATE.viewQuestions.length){
        sentinel.textContent="Fim.";
        toast("Fim da lista");
        STATE.observer.disconnect();
      }
      pumpIfVisible();
    }
  }, {rootMargin:"1000px"});
  STATE.observer.observe(sentinel);
  renderBatch();
  pumpIfVisible();
  window.addEventListener("scroll", pumpIfVisible, { passive:true });
  window.addEventListener("resize", pumpIfVisible);
}
async function renderBatch(){
  const start = STATE.cursor;
  const end = Math.min(STATE.cursor + STATE.batchSize, STATE.viewQuestions.length);
  const list = document.getElementById("quizList");
  if(!list) return;
  for(let i=start;i<end;i++){
    const q = STATE.viewQuestions[i];
    list.appendChild(buildQuestion(q, i+1));
  }
  STATE.cursor = end;
}
function pumpIfVisible(){
  const s = document.getElementById("sentinel");
  if (!s) return;
  if (STATE.cursor >= STATE.viewQuestions.length) return;
  const r = s.getBoundingClientRect();
  const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
  if (r.top - vh < 200) {
    let guard = 0;
    (async function loop(){
      while (guard++ < 20 && STATE.cursor < STATE.viewQuestions.length) {
        const before = STATE.cursor;
        await renderBatch();
        if (STATE.cursor === before) break;
        const rr = s.getBoundingClientRect();
        if (rr.top - vh > 200) break;
      }
    })();
  }
}

/* ==================== RENDER QUESTÃO ==================== */
function buildQuestion(q, num){
  const tpl = /** @type {HTMLTemplateElement} */(document.getElementById("tplQuestion"));
  const node = tpl.content.firstElementChild.cloneNode(true);

  node.querySelector(".q-num").textContent = `#${num}`;

  const stemEl = node.querySelector(".q-stem");
  stemEl.textContent = q.stem;

  if (q.meta){
    const meta = document.createElement("div");
    meta.className = "q-meta";
    meta.textContent = q.meta;
    meta.style.fontSize = "12px";
    meta.style.color = "var(--muted, #6b7280)";
    meta.style.marginBottom = "6px";
    stemEl.parentNode.insertBefore(meta, stemEl);

    const hr = document.createElement("hr");
    hr.style.border = "0";
    hr.style.borderTop = "1px solid #e5e7eb";
    hr.style.margin = "0 0 8px 0";
    stemEl.parentNode.insertBefore(hr, stemEl);
  }

  const ol = node.querySelector(".q-opts");
  q.options.forEach(opt=>{
    const li = document.createElement("li");
    li.textContent = `${opt.key}) ${opt.text}`;
    li.dataset.key = opt.key;
    li.dataset.q = q.id;
    li.addEventListener("click", ()=>mark(node, li, q));
    ol.appendChild(li);
  });

  const btnIA = node.querySelector('[data-role="ia-toggle"]');
  const menu = node.querySelector(".ia-menu");
  if (btnIA && menu){
    const addItem = (label, kind)=>{
      const a = document.createElement("a");
      a.className = "ia-item";
      a.textContent = label;
      a.setAttribute("data-ia", kind);
      a.setAttribute("href", "#");
      a.setAttribute("rel", "noopener");
      a.setAttribute("target", "_blank");
      menu.appendChild(a);
    };
    addItem("Princípios", "principios");
    addItem("Check-list", "checklist");

    btnIA.addEventListener("click", ()=>{ menu.classList.toggle("show"); });

    menu.addEventListener("click", (ev)=>{
      const link = ev.target.closest(".ia-item");
      if(!link) return;
      const kind = link.getAttribute("data-ia");
      const url = buildGoogleIA(kind, q);
      link.setAttribute("href", url);
      menu.classList.remove("show");
    });
  }

  const btnShare = node.querySelector('[data-role="share"]');
  if (btnShare){
    btnShare.addEventListener("click", ()=>handleShareStory(q, num));
  }

  return node;
}

/* ==================== CORREÇÃO ==================== */
function mark(card, li, q){
  if (card.classList.contains("ok") || card.classList.contains("bad")) return;

  card.querySelectorAll('.q-opts li').forEach(el=>el.removeAttribute('data-picked'));
  li.setAttribute('data-picked','1');

  const key = li.dataset.key;
  const correctKey = q.answer ?? q.answerKey;
  const correct = key === correctKey;
  const res = card.querySelector(".q-res");

  card.querySelectorAll(".q-opts li").forEach(el=>el.classList.add("lock"));
  card.querySelectorAll(".q-opts li").forEach(el=>{ if (el.dataset.key === correctKey) el.classList.add("hit"); });

  if (correct){
    card.classList.add("ok");
    res.textContent = "Parabéns! Resposta correta.";
    res.className = "q-res good";
  }else{
    card.classList.add("bad");
    res.textContent = `Resposta errada. Correta: ${correctKey}.`;
    res.className = "q-res bad";
  }

  // guarda para o simulado, se existir
  if (STATE.exam){
    STATE.exam.answers[q.id] = key;
  }

  const btnIA = card.querySelector('[data-role="ia-toggle"]');
  if (btnIA){
    btnIA.classList.remove("ia");
    btnIA.classList.add(correct ? "primary" : "");
    if (!correct){ btnIA.style.background="#dc2626"; btnIA.style.borderColor="#b91c1c"; }
  }
}

/* ==================== SIMULADO ==================== */
function createExamFromView(){
  const pool = STATE.viewQuestions?.length ? STATE.viewQuestions : STATE.allQuestions;
  if(!pool?.length){ toast("Carregue questões primeiro"); return; }
  const N = Math.min(10, pool.length);
  const idx = [...Array(pool.length).keys()];
  for(let i=idx.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [idx[i],idx[j]]=[idx[j],idx[i]]; }
  const picked = idx.slice(0,N).map(i=>pool[i]);

  STATE.exam = {
    id: uid(),
    questions: picked.map(q=>({
      id: q.id,
      meta: q.meta || "",
      stem: q.stem,
      options: q.options.map(o=>({ key:o.key, text:o.text })),
      answerKey: q.answer ?? q.answerKey
    })),
    answers: Object.fromEntries(picked.map(q=>[q.id, null])),
    student: "",
    startedAt: Date.now(),
    finishedAt: null
  };

  document.getElementById("examTitle").textContent = "Simulado";
  document.getElementById("examIntro").textContent = "10 questões aleatórias para para treinar.";
  renderExam();
  window.scrollTo({top:0, behavior:"smooth"});
}
function renderExam(){
  const examMain = document.getElementById("exam");
  const quizMain = document.getElementById("quiz");
  const list = document.getElementById("examList");
  const rep  = document.getElementById("examReport");
  if(!STATE.exam || !list) return;
  list.innerHTML = "";
  STATE.exam.questions.forEach((q, i)=>{
    const card = buildQuestion(q, i + 1);
    list.appendChild(card);
  });
  quizMain?.classList.add("hidden");
  examMain?.classList.remove("hidden");
  rep?.classList.add("hidden");
  if(rep) rep.innerHTML="";
}
function finishExam(){
  if(!STATE.exam) return;
  // coleta respostas já marcadas no DOM
  STATE.exam.questions.forEach(q=>{
    const picked = document.querySelector(`.q-opts li[data-q="${q.id}"][data-picked="1"]`);
    STATE.exam.answers[q.id] = picked ? picked.dataset.key : null;
  });
  let acertos = 0, total = STATE.exam.questions.length;
  STATE.exam.questions.forEach(q=>{ if(STATE.exam.answers[q.id] === q.answerKey) acertos++; });

  const rep = document.getElementById("examReport");
  if(rep){
    rep.classList.remove("hidden");
    rep.innerHTML = `
      <h3>Resultado</h3>
      <p>Acertos: <strong>${acertos}/${total}</strong></p>
      <details open>
        <summary>Gabarito e suas respostas</summary>
        <ol>
          ${STATE.exam.questions.map((q,i)=>{
            const got = STATE.exam.answers[q.id] ?? "—";
            const ok  = q.answerKey;
            const hit = got===ok;
            return `<li>#${i+1}: você <strong>${got}</strong> · correto <strong>${ok}</strong> ${hit?"✅":"❌"}</li>`;
          }).join("")}
        </ol>
      </details>
    `;
    toast("Simulado concluído");
    rep.scrollIntoView({behavior:"smooth"});
  }
}

/* ==================== PRINT/SHARE PROVA ==================== */
function exportExamPrintView(){
  let acertos = 0, total = STATE.exam.questions.length;
  STATE.exam.questions.forEach(q=>{
    const ans = STATE.exam.answers[q.id];
    if(ans === q.answerKey) acertos++;
  });

  const css = `
  <style>
    :root{
      --ink:#0b0f19; --muted:#64748b; --line:#e5e7eb;
      --brand:#1e40af; --ok:#16a34a20; --bad:#dc262620;
      --w: 920px;
    }
    *{ box-sizing: border-box; }
    html,body{ margin:0; padding:0; }
    body{ font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial; color: var(--ink); background:#fff; }
    .wrap{ max-width: var(--w); margin: 24px auto; padding: 0 18px; }
    header{ display:flex; justify-content:space-between; align-items:end; margin:8px 0 18px; border-bottom:1px solid var(--line); padding-bottom:12px; }
    header h1{ font-size:22px; margin:0; }
    header .sub{ color: var(--muted); font-size:12px; }
    .divider{ height:1px; background:var(--line); margin:12px 0 18px; }
    .q{ page-break-inside:avoid; background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px 14px 10px; margin:0 0 16px 0; }
    .q h3{ margin:0 0 8px 0; font-size:15px; color:#111; }
    .meta{ color: var(--muted); font-size:12px; margin:2px 0 8px; }
    .stem{ white-space:pre-wrap; color: var(--brand); font-weight:700; margin:6px 0 10px; }
    .opts{ margin:0; padding-left:20px; }
    .opts li{ margin:3px 0; }
    .badge{ display:inline-block; padding:2px 6px; border-radius:6px; font-size:12px; vertical-align:middle; }
    .ok{ background: var(--ok); } .bad{ background: var(--bad); }
    .report{ border:1px solid var(--line); border-radius:12px; padding:14px; margin-top:18px; }
    .report h3{ margin:0 0 8px 0; }
    .gabarito{ margin-top:10px; }
    .foot{ margin:24px 0 8px; font-size:12px; color:var(--muted); text-align:center; }
    .print-btn{ margin-top:16px; }
    @media print{ .no-print{ display:none !important; } body{ background:#fff; } .wrap{ margin:0 auto; padding:0; } header{ border:0; margin:0 0 8px 0; padding:0; } .q{ box-shadow:none; } }
  </style>
  `;

  const qHtml = STATE.exam.questions.map((q,i)=>{
    const got = STATE.exam.answers[q.id] ?? "—";
    const ok  = q.answerKey;
    return `
      <article class="q">
        <div class="meta">${escapeHtml(q.meta || "")}</div>
        <h3>#${i+1}</h3>
        <div class="stem">${escapeHtml(q.stem)}</div>
        <ol class="opts" type="A">
          ${q.options.map(o=>{
            const isUser = got===o.key;
            const isOk   = ok===o.key;
            const mark = isOk ? `<span class="badge ok">correta</span>` : (isUser ? `<span class="badge bad">sua</span>` : ``);
            return `<li>${escapeHtml(o.text)} ${mark}</li>`;
          }).join("")}
        </ol>
      </article>
      <hr class="divider">
    `;
  }).join("");

  const html = `
  <html>
    <head><meta charset="utf-8">${css}<title>Prova MeuJus</title></head>
    <body>
      <div class="wrap">
        <header>
          <h1>Prova MeuJus</h1>
          <div class="sub">${new Date().toLocaleString('pt-BR')}</div>
        </header>
        <div class="divider"></div>
        ${qHtml}
        <section class="report">
          <h3>Relatório</h3>
          <p>Acertos: <strong>${acertos}/${total}</strong> · Erros: <strong>${total-acertos}</strong></p>
          <details class="gabarito" open>
            <summary><strong>Gabarito e suas respostas</strong></summary>
            <ol>
              ${STATE.exam.questions.map((q,i)=>{
                const got = STATE.exam.answers[q.id] ?? "—";
                const ok  = q.answerKey;
                const hit = got===ok;
                return `<li>#${i+1}: você <strong>${got}</strong> · correto <strong>${ok}</strong> ${hit?"✅":"❌"}</li>`;
              }).join("")}
            </ol>
          </details>
        </section>
        <div class="foot no-print">
          Clique em “Imprimir” para salvar em PDF.
          <div class="print-btn"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div>
        </div>
      </div>
    </body>
  </html>
  `;

  const w = window.open("", "_blank");
  w.document.open(); w.document.write(html); w.document.close();
  w.focus();
}

/* ==================== STORY 1080x1920 ==================== */
function wrapLines(ctx, text, maxWidth){
  const lines=[], raw=String(text??"").replace(/\r\n?/g,"\n").split("\n");
  for(const par of raw){
    const words=par.split(/\s+/); let cur="";
    for(const w of words){
      const test=cur?cur+" "+w:w;
      if(ctx.measureText(test).width<=maxWidth){ cur=test; }
      else{
        if(cur) lines.push(cur);
        if(ctx.measureText(w).width>maxWidth){
          let chunk=""; for(const ch of w){
            const t2=chunk+ch;
            if(ctx.measureText(t2).width<=maxWidth) chunk=t2;
            else{ if(chunk) lines.push(chunk); chunk=ch; }
          } cur=chunk;
        }else cur=w;
      }
    }
    if(cur) lines.push(cur);
  }
  return lines;
}
async function renderStoryJPG(q, num){
  const W=1080, H=1920, PAD=72;
  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const ctx=cv.getContext("2d");

  ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,W,H);

  const meta = q.meta||"";
  const stem = q.stem||"";
  const alts = Array.isArray(q.options)&&q.options.length
    ? q.options.map(o=>`${o.key}) ${o.text}`).join("\n") : "";

  const total=(meta+stem+alts).length;
  let S={ meta:28, stem:44, alt:36, gap:28, top:170, bot:120, maxW:W-PAD*2 };
  if(total<=280){ S={ meta:30, stem:50, alt:42, gap:36, top:190, bot:140, maxW:W-PAD*2 }; }
  else if(total>700){ S={ meta:26, stem:36, alt:32, gap:24, top:146, bot:96, maxW:W-PAD*2 }; }

  let y=S.top;

  const TAG_BG="#f1f5f9";
  const TAG_FG="#1e40af";
  const tagPadY=10, tagPadX=16;
  const tagText="meujus.com.br";

  ctx.font=`600 ${S.meta}px system-ui,-apple-system,Segoe UI,Roboto,Arial`;
  const textW = ctx.measureText(tagText).width;
  const tagH = S.meta + tagPadY*2;
  const tagW = textW + tagPadX*2;

  ctx.fillStyle=TAG_BG;
  ctx.fillRect(PAD, y, tagW, tagH);

  ctx.fillStyle=TAG_FG;
  ctx.fillText(tagText, PAD + tagPadX, y + tagPadY + S.meta);
  y += tagH + S.gap;

  if(meta){
    ctx.font=`600 ${S.meta}px system-ui,-apple-system,Segoe UI,Roboto,Arial`;
    ctx.fillStyle="#111111";
    for(const line of wrapLines(ctx, meta, S.maxW)){
      ctx.fillText(line, PAD, y+S.meta);
      y+=S.meta+2;
    }
    y+=S.gap;
  }

  ctx.font=`700 ${S.stem}px system-ui,-apple-system,Segoe UI,Roboto,Arial`;
  ctx.fillStyle="#1e40af";
  for(const line of wrapLines(ctx, stem, S.maxW)){
    if(y+S.stem > H-S.bot-260) break;
    ctx.fillText(line, PAD, y+S.stem);
    y+=S.stem+6;
  }
  y+=S.gap;

  if(alts){
    ctx.font=`400 ${S.alt}px system-ui,-apple-system,Segoe UI,Roboto,Arial`;
    ctx.fillStyle="#0b0f19";
    for(const line of wrapLines(ctx, alts, S.maxW)){
      if(y+S.alt > H-S.bot-220) break;
      ctx.fillText(line, PAD, y+S.alt);
      y+=S.alt+4;
    }
  }

  return cv;
}
async function shareOrDownload(canvas, filename="story.png"){
  const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
  if(!blob) return;
  const file = new File([blob], filename, { type:"image/png" });
  if(navigator.canShare && navigator.canShare({ files:[file] })){
    try{ await navigator.share({ files:[file], title:"Questão" }); return; }catch{}
  }
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a);
  a.click(); a.remove();
}
async function handleShareStory(q, num){
  try{
    toast("Gerando Story…");
    const cv=await renderStoryJPG(q,num);
    await shareOrDownload(cv, `story-q${num}.png`);
    toast("Pronto");
  }catch(e){ console.error(e); toast("Falha ao gerar Story"); }
}

/* ==================== PARSER TXT ==================== */
async function getParsedForPath(path){
  if (STATE.cache.has(path)) return STATE.cache.get(path).parsed;
  const text = await loadTxt(path);
  const parsed = parseTxt(text);
  STATE.cache.set(path, { text, parsed });
  return parsed;
}
async function loadTxt(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`Falhou ${path}: ${res.status}`);
  return await res.text();
}
function parseTxt(raw){
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let cur = { has:false, stage:"empty", stem:[], opts:[], ans:null, themes:[], meta:null };

  const push = () => {
    if (!cur.has) return;
    const stemLines = trimBlank(cur.stem);
    out.push({
      id: uid(),
      stemLines,
      stem: stemLines.join("\n").trim(),
      options: cur.opts.slice(),
      answer: cur.ans || "",
      themes: cur.themes.length ? cur.themes : [],
      meta: cur.meta || ""
    });
    cur = { has:false, stage:"empty", stem:[], opts:[], ans:null, themes:[], meta:null };
  };

  for (let i = 0; i < lines.length; i++){
    const L = lines[i].trimEnd();

    if (/^-+\s*$/.test(L)){ push(); continue; }
    if (L.trim() === ""){ if (cur.stage === "stem"){ cur.stem.push(""); cur.has = true; } continue; }

    const mm = /^\*{5}\s*(.+)$/.exec(L);
    if (mm){
      if (cur.has && (cur.stem.length || cur.opts.length || cur.ans || cur.themes.length)) push();
      cur.meta = mm[1].trim();
      cur.stage = "meta";
      cur.has = true;
      continue;
    }

    const t = /^\*\*\*\*\s*(.+)$/.exec(L);
    if (t){
      cur.themes = t[1].split(",").map(s => s.trim()).filter(Boolean);
      cur.has = true;
      continue;
    }

    const g = (/^\*\*\*\s*Gabarito:\s*([A-E])\s*$/.exec(L) || [])[1];
    if (g){ cur.ans = g; cur.stage = "ans"; cur.has = true; continue; }

    const m = /^\*\*\s*([A-E])\)\s*(.+)$/.exec(L);
    if (m){
      const key = m[1], text = m[2].trim();
      if (!cur.opts.some(o => o.key === key)) cur.opts.push({ key, text });
      cur.stage = "opts";
      cur.has = true;
      continue;
    }

    if (L.startsWith("* ")){ cur.stem.push(L.slice(2)); cur.stage = "stem"; cur.has = true; continue; }

    if (cur.stage === "stem" || !cur.has){ cur.stem.push(L); cur.has = true; continue; }
  }
  push();
  return out;
}
function trimBlank(arr){
  let a = 0, b = arr.length;
  while (a < b && arr[a].trim() === "") a++;
  while (b > a && arr[b - 1].trim() === "") b--;
  return arr.slice(a, b);
}

/* ==================== NORMALIZAÇÃO DE TEMAS ==================== */
function normalizeThemes(items){
  const norm = (s)=>strip(String(s||"")).replace(/\s+/g," ").trim();
  const first3 = (s)=>{
    const w = norm(s).split(" ");
    return w.slice(0,3).join(" ");
  };
  const groups = new Map();

  for (const q of items){
    if (!Array.isArray(q.themes)) continue;
    for (const t of q.themes){
      const k = first3(t);
      if(!k) continue;
      if(!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
  }

  const pickLabel = (arr)=>{
    return arr.slice().sort((a,b)=>{
      const aw=a.trim().split(/\s+/).length, bw=b.trim().split(/\s+/).length;
      if(aw!==bw) return aw-bw;
      if(a.length!==b.length) return a.length-b.length;
      return a.localeCompare(b,'pt-BR',{sensitivity:"base"});
    })[0];
  };
  const keyToLabel = new Map();
  for (const [k, list] of groups){ keyToLabel.set(k, pickLabel(list)); }

  const out = items.map(q=>{
    const res = {...q};
    if (!Array.isArray(res.themes)) { res.themes = []; return res; }
    const mapped = res.themes.map(t=>{
      const k = first3(t);
      return keyToLabel.get(k) ?? t;
    });
    const seen = new Set();
    res.themes = mapped.filter(t=>{ if(seen.has(t)) return false; seen.add(t); return true; });
    return res;
  });
  return out;
}
function collectAllThemes(arr){
  const set = new Set();
  for (const q of arr){ for (const t of (q.themes||[])) set.add(t); }
  return [...set].sort((a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:"base"}));
}

/* ==================== IA / GOOGLE ==================== */
function buildGoogleIA(kind, q){
  const enc = (s)=>encodeURIComponent(s);
  const alts = q.options.map(o=>`${o.key}) ${o.text}`).join(" ");
  const correctKey = q.answer ?? q.answerKey;
  const correct = q.options.find(o=>o.key===correctKey);
  const gab = correct ? `${correctKey}) ${correct.text}` : correctKey;
  const tema = Array.isArray(q.themes) && q.themes.length ? q.themes.join(", ") : "Direito";

  let prompt = "";
  if (kind === "gabarito"){
    prompt = `Considere a questão a seguir, analise a alternativa escolhida, explique, exemplifique e justifique juridicamente. Questão: "${q.stem}" Gabarito: ${gab}. Alternativas: ${alts}`;
  } else if (kind === "glossario"){
    prompt = `Liste e defina, em tópicos curtos, os termos jurídicos presentes nesta questão. Questão: "${q.stem}" Gabarito: ${gab}. Alternativas: ${alts}`;
  } else if (kind === "principios"){
    prompt = `Pesquise PRINCÍPIOS jurídicos do tema e apresente nome, breve comentário e referência. Tema(s): ${tema}. Questão: "${q.stem}". Gabarito: ${gab}. Alternativas: ${alts}`;
  } else if (kind === "checklist"){
    prompt = `Gere um CHECK-LIST de estudo: conteúdos, erros comuns, dicas, 3–5 microexercícios. Tema(s): ${tema}. Questão: "${q.stem}". Gabarito: ${gab}. Alternativas: ${alts}`;
  } else {
    prompt = `Sugira 3 vídeos objetivos e confiáveis. Mostre título curto e link. Tema(s): ${tema}. Questão: "${q.stem}". Gabarito: ${gab}. Alternativas: ${alts}`;
  }
  return `https://www.google.com/search?udm=50&hl=pt-BR&gl=BR&q=${enc(prompt)}`;
}

/* ==================== TOPO / BACKTOP ==================== */
function initTopbarAutoHide(){
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  let last = window.scrollY;
  let hidden = false;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    const dy = y - last;
    if (y < 48) { bar.classList.remove("hide"); hidden = false; last = y; return; }
    if (dy > 6 && y > 80) { if (!hidden){ bar.classList.add("hide"); hidden = true; } }
    else if (dy < -2) { if (hidden){ bar.classList.remove("hide"); hidden = false; } }
    last = y;
  }, { passive: true });
}
function initBackToTop(){
  const btn = document.createElement("button");
  btn.className = "backtop";
  btn.setAttribute("aria-label","Voltar ao topo");
  btn.textContent = "↑";
  document.body.appendChild(btn);

  const toggle = ()=>{
    if (window.scrollY > 400) btn.classList.add("show");
    else btn.classList.remove("show");
  };
  window.addEventListener("scroll", toggle, {passive:true});
  window.addEventListener("resize", toggle);
  toggle();

  btn.addEventListener("click", ()=>{
    window.scrollTo({top:0, behavior:"smooth"});
  });
}

/* ==================== UTILS ==================== */
const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>r.querySelectorAll(s);
function toast(msg, t=3000){ const el=$("#toast"); if(!el) return; el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), t); }
function uid(){ try{ if(crypto?.randomUUID) return crypto.randomUUID(); }catch{} return "q_"+Math.random().toString(36).slice(2,10); }
function pretty(s){ return s.replace(/[-_]/g," ").replace(/\.txt$/,""); }
const deb = (fn,ms=150)=>{let h;return (...a)=>{clearTimeout(h);h=setTimeout(()=>fn(...a),ms);} };
const strip = (s)=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();

/* ==================== DEBUG EXPORT ==================== */
globalThis.MeuJus = { parseTxt };
