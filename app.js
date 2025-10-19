"use strict";

/* ==================== UTIL ==================== */
const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>r.querySelectorAll(s);
function toast(msg, t=1600){ const el=$("#toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), t); }
function uid(){ try{ if(crypto?.randomUUID) return crypto.randomUUID(); }catch{} return "q_"+Math.random().toString(36).slice(2,10); }
function pretty(s){ return s.replace(/[-_]/g," ").replace(/\.txt$/,""); }
const deb = (fn,ms=150)=>{let h;return (...a)=>{clearTimeout(h);h=setTimeout(()=>fn(...a),ms);} };
const strip = (s)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();

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

    const t = /^\*\*\*\*\s*(.+)$/.exec(L);
    if (t){ cur.themes = t[1].split(",").map(s=>s.trim()).filter(Boolean); cur.has = true; continue; }

    const g = (/^\*\*\*\s*Gabarito:\s*([A-E])\s*$/.exec(L)||[])[1];
    if (g){ cur.ans=g; cur.stage="ans"; cur.has=true; continue; }

    const m = /^\*\*\s*([A-E])\)\s*(.+)$/.exec(L);
    if (m){ const key=m[1],text=m[2].trim();
      if (!cur.opts.some(o=>o.key===key)) cur.opts.push({key,text});
      cur.stage="opts"; cur.has=true; continue;
    }

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
  temasSel: /** @type {Set<string>} */(new Set()),
  temasAll: /** @type {string[]} */([]),
  allQuestions: /** @type {any[]} */([]),
  batchSize: 3,
  cursor: 0,
  observer: /** @type {IntersectionObserver|null} */ (null),
  cache: /** @type {Map<string,{text:string, parsed:any[]}>>} */(new Map()),
  ms:{ open:false, filter:"", list:[], listStripped:[] }
};

/* ==================== UI HOME ==================== */
window.addEventListener("DOMContentLoaded", async ()=>{
  $("#btnHome").addEventListener("click", goHome);
  setupDropdown();
  initTopbarAutoHide();
  initBackToTop();                 // botão "voltar ao topo"
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

/* ==================== TEMAS: Multiselect tipo dropdown ==================== */
async function buildThemesMultiselect(){
  const box=$("#chipsTemas"); box.innerHTML="";
  STATE.temasSel.clear();
  $("#btnBuscar").disabled = true;

  const node = STATE.tree[STATE.disciplina];
  if(!node) return;

  toast("Lendo temas…");
  const allParsed = [];
  for (const path of node.files){
    const parsed = await getParsedForPath(path);
    allParsed.push(...parsed);
  }
  const set = new Set();
  for (const q of allParsed){ if (Array.isArray(q.themes)) q.themes.forEach(t=>set.add(t)); }
  const temas = [...set].sort((a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:"base"}));
  STATE.temasAll = temas;

  // Trigger
  const trigger = document.createElement("button");
  trigger.type="button";
  trigger.className="dd-btn ms-trigger";
  trigger.id="msTemasBtn";
  trigger.innerHTML = `<span id="msTemasLabel">Selecionar temas</span><span class="chev">▾</span>`;
  trigger.addEventListener("click", toggleThemesPanel);
  box.appendChild(trigger);

  // Painel
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

  // Estado lista
  STATE.ms.list = temas.slice();
  STATE.ms.listStripped = STATE.ms.list.map(strip);
  STATE.ms.filter = "";
  renderMsList();

  // Eventos
  $("#msSearch").addEventListener("input", deb((e)=>{
    STATE.ms.filter = e.target.value;
    renderMsList();
  },150));

  $("#msSelAll").addEventListener("click", ()=>{
    const visible = getVisibleItems();
    visible.forEach(t=>STATE.temasSel.add(t));
    $$("#msList .ms-item input").forEach(i=>{ i.checked=true; i.closest(".ms-item").classList.add("on"); });
    updateTriggerLabel(); updateCount(); $("#btnBuscar").disabled = STATE.temasSel.size===0;
  });

  $("#msClear").addEventListener("click", ()=>{
    STATE.temasSel.clear();
    $$("#msList .ms-item").forEach(el=>{ el.classList.remove("on"); el.querySelector("input").checked=false; });
    updateTriggerLabel(); updateCount(); $("#btnBuscar").disabled = true;
  });
}

function toggleThemesPanel(){
  const panel = $(".ms-panel");
  if(!panel) return;
  const open = panel.classList.toggle("show");
  STATE.ms.open = open;
}
function closeThemesPanel(){
  const panel = $(".ms-panel");
  if(panel){ panel.classList.remove("show"); STATE.ms.open=false; }
}
function updateTriggerLabel(){
  const n = STATE.temasSel.size;
  $("#msTemasLabel").textContent = n ? `${n} tema(s) selecionado(s)` : "Selecionar temas";
}
function updateCount(){
  const vis = getVisibleItems().length;
  $("#msCount").textContent = `${vis} exibidos · ${STATE.temasSel.size} selecionados`;
}
function getVisibleItems(){
  const f = strip(STATE.ms.filter);
  if(!f) return STATE.ms.list.slice();
  const out=[]; for(let i=0;i<STATE.ms.list.length;i++){ if(STATE.ms.listStripped[i].includes(f)) out.push(STATE.ms.list[i]); }
  return out;
}
function renderMsList(){
  const list = $("#msList"); list.innerHTML="";
  const items = getVisibleItems();
  const frag = document.createDocumentFragment();
  items.forEach(t=>{
    const on = STATE.temasSel.has(t);
    const row = document.createElement("div");
    row.className = "ms-item"+(on?" on":"");
    row.dataset.tema=t;
    row.innerHTML = `<input type="checkbox" ${on?"checked":""} aria-label="${t}"><span>${t}</span>`;
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
    updateTriggerLabel(); updateCount(); $("#btnBuscar").disabled = STATE.temasSel.size===0;
  };
  updateTriggerLabel(); updateCount();
}

/* Cache por arquivo */
async function getParsedForPath(path){
  if (STATE.cache.has(path)) return STATE.cache.get(path).parsed;
  const text = await loadTxt(path);
  const parsed = parseTxt(text);
  STATE.cache.set(path, { text, parsed });
  return parsed;
}

/* ==================== BUSCA E QUIZ ==================== */
async function startSearch(){
  try{
    toast("Carregando questões…");
    const files = STATE.tree[STATE.disciplina]?.files || [];
    const batches = await Promise.all(files.map(getParsedForPath));
    const all = batches.flat();

    const wanted = new Set(STATE.temasSel);
    const filtered = all.filter(q => q.themes.some(t => wanted.has(t)));

    if (!filtered.length){ toast("Nenhuma questão encontrada"); return; }

    STATE.allQuestions = filtered;
    STATE.cursor = 0;
    $("#quizList").innerHTML="";
    $("#home").classList.add("hidden");
    $("#quiz").classList.remove("hidden");
    mountInfinite();
    closeThemesPanel();
  }catch(err){
    console.error(err);
    toast("Erro ao ler dados");
  }
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
      if(STATE.cursor >= STATE.allQuestions.length){
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
  const end = Math.min(STATE.cursor + STATE.batchSize, STATE.allQuestions.length);
  for(let i=start;i<end;i++){
    const q = STATE.allQuestions[i];
    $("#quizList").appendChild(buildQuestion(q, i+1));
  }
  STATE.cursor = end;
}
function pumpIfVisible(){
  const s = document.getElementById("sentinel");
  if (!s) return;
  if (STATE.cursor >= STATE.allQuestions.length) return;
  const r = s.getBoundingClientRect();
  const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
  if (r.top - vh < 200) {
    let guard = 0;
    (async function loop(){
      while (guard++ < 20 && STATE.cursor < STATE.allQuestions.length) {
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
    prompt = `Considere a questão a seguir e justifique a alternativa escolhida. Questão: "${q.stem}" Gabarito: ${gab}. Alternativas: ${alts}`;
  } else if (kind==="glossario"){
    prompt = `Liste e defina, em tópicos curtos, os principais termos jurídicos presentes nesta questão. Questão: "${q.stem}" Gabarito: ${gab}. Alternativas: ${alts}`;
  } else {
    const tema = q.themes?.join(", ");
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
