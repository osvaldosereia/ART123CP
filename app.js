"use strict";

/* ==================== UTIL ==================== */
const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>r.querySelectorAll(s);
function toast(msg, t=3000){ const el=$("#toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), t); }
function uid(){ try{ if(crypto?.randomUUID) return crypto.randomUUID(); }catch{} return "q_"+Math.random().toString(36).slice(2,10); }
function pretty(s){ return s.replace(/[-_]/g," ").replace(/\.txt$/,""); }
const deb = (fn,ms=150)=>{let h;return (...a)=>{clearTimeout(h);h=setTimeout(()=>fn(...a),ms);} };
const strip = (s)=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const canon = (s)=>strip(s); // chave canônica para temas

/* ==================== PARSER TXT (com temas ****) ==================== */
function parseTxt(raw){
  const lines = raw.replace(/\r\n?/g,"\n").split("\n");
  const out=[];
  let cur = { has:false, stage:"empty", stem:[], opts:[], ans:null, themes:[] };

  const push=()=>{ if(!cur.has) return;
    const stemLines=trimBlank(cur.stem);
    out.push({
      id: uid(),
      stemLines,
      stem: stemLines.join("\n").trim(),
      options: cur.opts.slice(),
      answer: cur.ans || "",
      themes: cur.themes.length ? cur.themes : []
    });
    cur = { has:false, stage:"empty", stem:[], opts:[], ans:null, themes:[] };
  };

  for(let i=0;i<lines.length;i++){
    const L=lines[i].trimEnd();

    if (/^-+\s*$/.test(L)){ push(); continue; }
    if (L.trim()===""){ if(cur.stage==="stem"){cur.stem.push(""); cur.has=true;} continue; }

    // Temas: **** tema1, tema2, tema3
    const t = /^\*\*\*\*\s*(.+)$/.exec(L);
    if (t){ cur.themes = t[1].split(",").map(s=>s.trim()).filter(Boolean); cur.has = true; continue; }

    // Gabarito
    const g = (/^\*\*\*\s*Gabarito:\s*([A-E])\s*$/.exec(L)||[])[1];
    if (g){ cur.ans=g; cur.stage="ans"; cur.has=true; continue; }

    // Alternativa
    const m = /^\*\*\s*([A-E])\)\s*(.+)$/.exec(L);
    if (m){ const key=m[1],text=m[2].trim();
      if (!cur.opts.some(o=>o.key===key)) cur.opts.push({key,text});
      cur.stage="opts"; cur.has=true; continue;
    }

    // Enunciado
    if (L.startsWith("* ")){ cur.stem.push(L.slice(2)); cur.stage="stem"; cur.has=true; continue; }

    if (cur.stage==="stem" || !cur.has){ cur.stem.push(L); cur.has=true; continue; }
  }
  push();
  return out;
}
function trimBlank(arr){ let a=0,b=arr.length; while(a<b&&arr[a].trim()==="")a++; while(b>a&&arr[b-1].trim()==="")b--; return arr.slice(a,b); }

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

/* ==================== ESTADO ==================== */
const STATE = {
  tree: /** @type {Record<string,{label:string,files:string[]}>} */({}),
  disciplina: "",
  temasSel: /** @type {Set<string>} */(new Set()),    // seleção feita na Home (chaves CANÔNICAS)
  temasAll: /** @type {string[]} */([]),              // lista de chaves canônicas para UI
  themeMap: /** @type {Map<string,string>} */(new Map()), // canon -> rótulo bonito
  allQuestions: /** @type {any[]} */([]),             // base do quiz
  viewQuestions: /** @type {any[]} */([]),            // após segmentação por chips
  activeThemes: /** @type {Set<string>} */(new Set()),// chips ativos (CANÔNICAS)
  batchSize: 3,
  cursor: 0,
  observer: /** @type {IntersectionObserver|null} */ (null),
  cache: /** @type {Map<string,{text:string, parsed:any[]}>>} */(new Map()),
  ms:{ open:false, filter:"", list:[], listStripped:[] },

  poolQuestions: /** @type {any[]} */([]),
};

/* ==================== UI HOME ==================== */
window.addEventListener("DOMContentLoaded", async ()=>{
  $("#btnHome").addEventListener("click", goHome);
  setupDropdown();
  initTopbarAutoHide();
  initBackToTop();
  try{
    STATE.tree = await discoverDataTree();
    fillDisciplines(Object.keys(STATE.tree).sort());
    toast("Pronto");
  }catch(e){
    console.error(e);
    toast("Erro ao ler /data/");
  }
  $("#btnBuscar").addEventListener("click", startSearch);
  document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") closeThemesPanel(); });
  document.addEventListener("click",(e)=>{
    const wrap = $("#chipsTemas");
    if(!wrap) return;
    if(STATE.ms.open && !wrap.contains(e.target)) closeThemesPanel();
  });
});

function setupDropdown(){
  const btn=$("#ddDiscBtn"), list=$("#ddDiscList");
  btn.addEventListener("click", ()=>{
    list.classList.toggle("show");
    btn.setAttribute("aria-expanded", list.classList.contains("show")?"true":"false");
  });
  document.addEventListener("click", (e)=>{
    const dd = $(".dropdown");
    if (dd && !dd.contains(e.target)) list.classList.remove("show");
  });
}

function fillDisciplines(keys){
  const ul=$("#ddDiscList"); ul.innerHTML="";
  if(!keys.length){
    const li=document.createElement("li"); li.textContent="Nenhuma disciplina encontrada"; li.style.color="var(--muted)";
    ul.appendChild(li); return;
  }
  for(const k of keys){
    const li=document.createElement("li");
    li.textContent=pretty(k);
    li.addEventListener("click", async ()=>{
      STATE.disciplina=k;
      $("#ddDiscLabel").textContent=pretty(k);
      ul.classList.remove("show");
      await buildThemesMultiselect();
    });
    ul.appendChild(li);
  }
}

/* ==================== TEMAS: Multiselect tipo dropdown (Home) ==================== */
async function buildThemesMultiselect(){
  const box=$("#chipsTemas"); box.innerHTML="";
  STATE.temasSel.clear();
  $("#btnBuscar").disabled = true;

  const node = STATE.tree[STATE.disciplina];
  if(!node) return;

  toast("Lendo temas…");

  // Carregar questões da disciplina e preparar chave canônica dos temas
  const allParsed = [];
  for (const path of node.files){
    const parsed = await getParsedForPath(path); // já inclui themesCanon
    allParsed.push(...parsed);
  }
  STATE.poolQuestions = allParsed;

  // Montar mapa canônico -> rótulo original
  STATE.themeMap = new Map();
  for (const q of allParsed){
    const origThemes = q.themes || [];
    for (const t of origThemes){
      const c = canon(t);
      if (!STATE.themeMap.has(c)) STATE.themeMap.set(c, t);
    }
  }

  // UI: trigger + painel
  const trigger = document.createElement("button");
  trigger.type="button";
  trigger.className="dd-btn ms-trigger";
  trigger.id="msTemasBtn";
  trigger.innerHTML = `<span id="msTemasLabel">Selecionar temas</span><span class="chev">▾</span>`;
  trigger.addEventListener("click", toggleThemesPanel);
  box.appendChild(trigger);

  const panel = document.createElement("div");
  panel.className="ms-panel";
  panel.innerHTML = `
    <div class="ms-head">
      <input id="msSearch" type="text" placeholder="Buscar tema…" autocomplete="off" />
      <div class="ms-actions">
        <button type="button" id="msSelAll" class="btn ghost">Selecionar exibidos</button>
        <button type="button" id="msClear" class="btn ghost">Limpar</button>
      </div>
    </div>
    <div id="msList" class="ms-list" role="listbox" aria-multiselectable="true"></div>
    <div class="ms-foot"><span id="msCount"></span></div>
  `;
  box.appendChild(panel);

  // Dados da lista para o multiselect
  STATE.ms.list = [...STATE.themeMap.keys()].sort((a,b)=>{
    const A = STATE.themeMap.get(a) || a;
    const B = STATE.themeMap.get(b) || b;
    return A.localeCompare(B, 'pt-BR', {sensitivity:'base'});
  });
  STATE.ms.listStripped = STATE.ms.list.map(k => strip(STATE.themeMap.get(k) || k));
  STATE.ms.filter = "";

  // Render inicial e eventos
  renderMsList();
  updateTriggerLabel();
  updateCount();

  $("#msSearch").addEventListener("input", deb((e)=>{
    STATE.ms.filter = e.target.value;
    renderMsList();
  },150));

  $("#msSelAll").addEventListener("click", ()=>{
    const visible = getVisibleItems();          // chaves canônicas visíveis
    visible.forEach(cKey=>STATE.temasSel.add(cKey));
    $$("#msList .ms-item input").forEach(i=>{
      i.checked=true; i.closest(".ms-item").classList.add("on");
    });
    updateTriggerLabel(); updateCount();
    $("#btnBuscar").disabled = STATE.temasSel.size===0;
  });

  $("#msClear").addEventListener("click", ()=>{
    STATE.temasSel.clear();
    $$("#msList .ms-item").forEach(el=>{
      el.classList.remove("on"); el.querySelector("input").checked=false;
    });
    updateTriggerLabel(); updateCount();
    $("#btnBuscar").disabled = true;
  });
}

/* ==================== BUSCA E QUIZ ==================== */
async function startSearch(){
  try{
    toast("Carregando questões…");
    const files = STATE.tree[STATE.disciplina]?.files || [];
    const batches = await Promise.all(files.map(getParsedForPath));
    const all = batches.flat();

    const wanted = new Set(STATE.temasSel); // canônicas
    const filtered = all.filter(q => (q.themesCanon||[]).some(t => wanted.has(t)));
    if (!filtered.length){ toast("Nenhuma questão encontrada"); return; }

    STATE.allQuestions = filtered;
    STATE.activeThemes.clear();
    STATE.viewQuestions = STATE.allQuestions.slice();

    STATE.cursor = 0;
    $("#quizList").innerHTML="";
    $("#home").classList.add("hidden");
    $("#quiz").classList.remove("hidden");

    renderSelectedThemesChips();
    mountInfinite();
    closeThemesPanel();
  }catch(err){
    console.error(err);
    toast("Erro ao ler dados");
  }
}

/* Chips de segmentação no topo do quiz */
function renderSelectedThemesChips(){
  const quiz = $("#quiz");
  if (!quiz) return;
  let box = $("#quizThemes");
  if (!box){
    box = document.createElement("div");
    box.id = "quizThemes";
    box.className = "chips";
    box.style.justifyContent = "center";
    box.style.margin = "6px 0 12px";
    quiz.insertBefore(box, $("#quizList"));
  }
  box.innerHTML = "";

  // Contagem por tema dentro do conjunto base usando chave canônica
  const counts = new Map();
  for (const q of STATE.allQuestions){
    for (const cKey of (q.themesCanon||[])){
      if(STATE.temasSel.has(cKey)) counts.set(cKey, (counts.get(cKey)||0)+1);
    }
  }
  const temas = [...STATE.temasSel].sort((a,b)=>{
    return (STATE.themeMap.get(a)||a).localeCompare(STATE.themeMap.get(b)||b,'pt-BR',{sensitivity:"base"});
  });

  // Chip "Todos"
  const chipAll = document.createElement("button");
  chipAll.className = "chip" + (STATE.activeThemes.size===0 ? " on" : "");
  chipAll.textContent = "Todos";
  chipAll.addEventListener("click", ()=>{
    STATE.activeThemes.clear();
    applyThemeFilter();
    renderSelectedThemesChips();
  });
  box.appendChild(chipAll);

  // Demais chips
  temas.forEach(cKey=>{
    const c = counts.get(cKey)||0;
    const label = STATE.themeMap.get(cKey) || cKey;
    const b = document.createElement("button");
    b.className = "chip" + (STATE.activeThemes.has(cKey) ? " on" : "");
    b.textContent = c ? `${label} (${c})` : label;
    b.dataset.tema = cKey; // canônica
    b.addEventListener("click", ()=>{
      if (STATE.activeThemes.has(cKey)) STATE.activeThemes.delete(cKey);
      else STATE.activeThemes.add(cKey);
      applyThemeFilter();
      renderSelectedThemesChips();
    });
    box.appendChild(b);
  });
}

/* Aplica união dos chips ativos ao conjunto base e repagina */
function applyThemeFilter(){
  const act = [...STATE.activeThemes];

  if (act.length === 0){
    STATE.viewQuestions = STATE.allQuestions.slice();
  } else {
    const want = new Set(act); // canônicas
    STATE.viewQuestions = STATE.allQuestions.filter(q =>
      (q.themesCanon||[]).some(t => want.has(t))
    );
  }

  $("#quizList").innerHTML = "";
  STATE.cursor = 0;
  mountInfinite();
  const names = act.map(k=>STATE.themeMap.get(k)||k);
  toast(`Filtro: ${act.length ? names.join(", ") : "Todos"} · ${STATE.viewQuestions.length} questões`);
}

async function loadTxt(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`Falhou ${path}: ${res.status}`);
  return await res.text();
}

/* ==================== INFINITE SCROLL ROBUSTO ==================== */
function mountInfinite(){
  const sentinel=$("#sentinel");
  STATE.observer?.disconnect();
  STATE.observer = new IntersectionObserver(async (entries)=>{
    const entry = entries[0];
    if(entry.isIntersecting){
      await renderBatch();
      if(STATE.cursor >= STATE.viewQuestions.length){
        $("#sentinel").textContent="Fim.";
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
  for(let i=start;i<end;i++){
    const q = STATE.viewQuestions[i];
    $("#quizList").appendChild(buildQuestion(q, i+1));
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
  const tpl = /** @type {HTMLTemplateElement} */($("#tplQuestion"));
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelector(".q-num").textContent = `#${num}`;
  node.querySelector(".q-stem").textContent = q.stem;

  const ol = node.querySelector(".q-opts");
  q.options.forEach(opt=>{
    const li=document.createElement("li");
    li.textContent = `${opt.key}) ${opt.text}`;
    li.dataset.key = opt.key;
    li.addEventListener("click", ()=>mark(node, li, q));
    ol.appendChild(li);
  });

  // Google modo IA
  const btnIA = node.querySelector('[data-role="ia-toggle"]');
  const menu = node.querySelector(".ia-menu");
  btnIA.addEventListener("click", ()=>{ menu.classList.toggle("show"); });
  menu.querySelectorAll(".ia-item").forEach(a=>{
    a.addEventListener("click", ()=>{
      const kind = a.getAttribute("data-ia");
      const url = buildGoogleIA(kind, q);
      a.setAttribute("href", url);
      menu.classList.remove("show");
    });
  });

  return node;
}

function mark(card, li, q){
  const already = card.classList.contains("ok") || card.classList.contains("bad");
  if (already) return;

  const key = li.dataset.key;
  const correct = key === q.answer;
  const res = card.querySelector(".q-res");
  card.querySelectorAll(".q-opts li").forEach(el=>el.classList.add("lock"));
  card.querySelectorAll(".q-opts li").forEach(el=>{ if (el.dataset.key === q.answer) el.classList.add("hit"); });

  if (correct){
    card.classList.add("ok");
    res.textContent = "Parabéns! Resposta correta.";
    res.className = "q-res good";
  }else{
    card.classList.add("bad");
    res.textContent = `Resposta errada. Correta: ${q.answer}.`;
    res.className = "q-res bad";
  }

  const btnIA = card.querySelector('[data-role="ia-toggle"]');
  btnIA.classList.remove("ia");
  btnIA.classList.add(correct ? "primary" : "");
  if (!correct){ btnIA.style.background="#dc2626"; btnIA.style.borderColor="#b91c1c"; }
}

function buildGoogleIA(kind, q){
  const enc=(s)=>encodeURIComponent(s);
  const alts = q.options.map(o=>`${o.key}) ${o.text}`).join(" ");
  const correct = q.options.find(o=>o.key===q.answer);
  const gab = correct ? `${q.answer}) ${correct.text}` : q.answer;

  let prompt="";
  if (kind==="gabarito"){
    prompt = `Considere a questão a seguir, analise a alternativa escolhida, explique, exemplifique e justifique juridicamente. Questão: "${q.stem}" Gabarito: ${gab}. Alternativas: ${alts}`;
  } else if (kind==="glossario"){
    prompt = `Liste e defina, em tópicos curtos, os termos jurídicos presentes nesta questão. Questão: "${q.stem}" Gabarito: ${gab}. Alternativas: ${alts}`;
  } else {
    const tema = (q.themes||[]).join(", ");
    prompt = `Sugira 3 links de vídeos objetivos e confiáveis para estudar o tema desta questão. Mostre título curto e link. Tema(s): ${tema || "Direito"}. Questão: "${q.stem}" Gabarito: ${gab}. Alternativas: ${alts}`;
  }
  const url = `https://www.google.com/search?udm=50&hl=pt-BR&gl=BR&q=${enc(prompt)}`;
  return url;
}

/* ==================== NAV ==================== */
function goHome(){
  $("#quiz").classList.add("hidden");
  $("#home").classList.remove("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
}

/* === Topbar: esconder ao descer, mostrar rápido ao subir === */
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

/* === Botão voltar ao topo === */
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

/* ==================== EXPOSE DEBUG ==================== */
globalThis.MeuJus = { parseTxt };
