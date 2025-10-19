"use strict";

/* ==================== UTIL ==================== */
const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>r.querySelectorAll(s);
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
function toast(msg, t=1600){ const el=$("#toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), t); }

/* ==================== PARSER TXT ==================== */
function parseTxt(raw){
  const lines = raw.replace(/\r\n?/g,"\n").split("\n");
  const out=[], warnings=[];
  let cur = { has:false, stage:"empty", stem:[], opts:[], ans:null };

  const push=()=>{ if(!cur.has) return;
    const stemLines=trim(cur.stem);
    out.push({
      id: uid(),
      stemLines,
      stem: stemLines.join("\n").trim(),
      options: cur.opts.slice(),
      answer: cur.ans || ""
    });
    cur = { has:false, stage:"empty", stem:[], opts:[], ans:null };
  };

  for(let i=0;i<lines.length;i++){
    const L=lines[i].trimEnd();
    if (/^-+\s*$/.test(L)){ push(); continue; }
    if (L.trim()===""){ if(cur.stage==="stem"){cur.stem.push(""); cur.has=true;} continue; }

    const g = (/^\*\*\*\s*Gabarito:\s*([A-E])\s*$/.exec(L)||[])[1];
    if (g){ cur.ans=g; cur.stage="ans"; cur.has=true; continue; }

    const m = /^\*\*\s*([A-E])\)\s*(.+)$/.exec(L);
    if (m){ const key=m[1],text=m[2].trim();
      if (!cur.opts.some(o=>o.key===key)) cur.opts.push({key,text});
      cur.stage="opts"; cur.has=true; continue;
    }

    if (L.startsWith("* ")){ cur.stem.push(L.slice(2)); cur.stage="stem"; cur.has=true; continue; }

    if (cur.stage==="stem" || !cur.has){ cur.stem.push(L); cur.has=true; continue; }
    warnings.push(`L${i+1}: linha fora do padrão ignorada.`);
  }
  push();
  return out;
}
function trim(arr){ let a=0,b=arr.length; while(a<b&&arr[a].trim()==="")a++; while(b>a&&arr[b-1].trim()==="")b--; return arr.slice(a,b); }
function uid(){ try{ if(crypto?.randomUUID) return crypto.randomUUID(); }catch{} return "q_"+Math.random().toString(36).slice(2,10); }

/* ==================== DISCOVERY data/ ==================== */
/* Descobre owner/repo e lista o diretório data/ via GitHub Contents API.
   Se não estiver em GitHub Pages, cai no modo "única disciplina": varre caminhos conhecidos.
*/
async function discoverDataTree(){
  const gh = detectGithubRepo();
  if (!gh) {
    // fallback simples: tenta GET de um caminho padrão
    const guess = await tryFetchListFallback();
    return guess;
  }
  toast("Lendo data/…");
  const base = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data`;
  const nodes = await walkGitHub(base);
  // Mapear: disciplina = primeira pasta dentro de data/
  /** @type {Record<string, {label:string, files:string[]}>} */
  const map = {};
  for(const n of nodes){
    if(n.type!=="file" || !n.path.endsWith(".txt")) continue;
    const rel = n.path.replace(/^data\//,"");
    const parts = rel.split("/");
    const disciplina = parts[0]; // ex: direito-penal
    if(!map[disciplina]) map[disciplina]={label:disciplina, files:[]};
    map[disciplina].files.push(n.path); // caminho completo "data/…/x.txt"
  }
  return map;
}
function detectGithubRepo(){
  // Suporta https://<user>.github.io/<repo>/...
  const {host, pathname} = window.location;
  if (!/github\.io$/.test(host)) return null;
  const seg = pathname.replace(/^\/+/,"").split("/");
  const repo = seg[0] || "";
  if (!repo) return null;
  const owner = host.split(".")[0];
  return { owner, repo };
}
async function walkGitHub(url){
  // DFS simples
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
async function tryFetchListFallback(){
  // Sem API, ofereça a disciplina "default" com qualquer arquivo sob /data/.
  // Não há como listar diretório local no browser; aqui só mantém estrutura vazia.
  return {};
}

/* ==================== ESTADO ==================== */
const STATE = {
  tree: /** @type {Record<string,{label:string,files:string[]}>} */({}),
  disciplina: "",
  temasSel: /** @type {Set<string>} */(new Set()),
  allQuestions: /** @type {any[]} */([]),
  batchSize: 3,
  cursor: 0,
  observer: /** @type {IntersectionObserver|null} */ (null),
};

/* ==================== UI HOME ==================== */
window.addEventListener("DOMContentLoaded", async ()=>{
  $("#btnHome").addEventListener("click", goHome);
  setupDropdown();
  try{
    STATE.tree = await discoverDataTree();
    fillDisciplines(Object.keys(STATE.tree).sort());
    toast("Pronto");
  }catch(e){
    console.error(e);
    toast("Erro ao ler /data/");
  }
  $("#btnBuscar").addEventListener("click", startSearch);
});

function setupDropdown(){
  const btn=$("#ddDiscBtn"), list=$("#ddDiscList");
  btn.addEventListener("click", ()=>{
    list.classList.toggle("show");
    btn.setAttribute("aria-expanded", list.classList.contains("show")?"true":"false");
  });
  document.addEventListener("click", (e)=>{
    if(!$(".dropdown").contains(e.target)) list.classList.remove("show");
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
    li.addEventListener("click", ()=>{
      STATE.disciplina=k;
      $("#ddDiscLabel").textContent=pretty(k);
      ul.classList.remove("show");
      renderTemas();
    });
    ul.appendChild(li);
  }
}
function renderTemas(){
  const box=$("#chipsTemas"); box.innerHTML="";
  STATE.temasSel.clear();
  const node = STATE.tree[STATE.disciplina];
  if(!node){ $("#btnBuscar").disabled=true; return; }
  // cada arquivo .txt vira um chip
  node.files.forEach((path)=>{
    const chip=document.createElement("button");
    chip.className="chip";
    chip.textContent=pretty(path.split("/").slice(-1)[0].replace(/\.txt$/,""));
    chip.dataset.path=path;
    chip.addEventListener("click", ()=>{
      const on = chip.classList.toggle("on");
      if(on) STATE.temasSel.add(path); else STATE.temasSel.delete(path);
      $("#btnBuscar").disabled = STATE.temasSel.size===0;
    });
    box.appendChild(chip);
  });
  $("#btnBuscar").disabled = true;
}

/* ==================== BUSCA E QUIZ ==================== */
async function startSearch(){
  toast("Carregando questões…");
  const files = [...STATE.temasSel];
  const texts = await Promise.all(files.map(loadTxt));
  const joined = texts.join("\n-----\n");
  STATE.allQuestions = parseTxt(joined);
  STATE.cursor = 0;
  $("#quizList").innerHTML="";
  $("#home").classList.add("hidden");
  $("#quiz").classList.remove("hidden");
  mountInfinite();
}
async function loadTxt(path){
  // Arquivo acessível diretamente via GitHub Pages
  const res = await fetch(`/${path}`);
  if(!res.ok) throw new Error(`Falhou ${path}: ${res.status}`);
  return await res.text();
}

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
    }
  }, {rootMargin:"200px"});
  STATE.observer.observe(sentinel);
  // força primeiro lote
  renderBatch();
}

async function renderBatch(){
  const start = STATE.cursor;
  const end = Math.min(STATE.cursor + STATE.batchSize, STATE.allQuestions.length);
  for(let i=start;i<end;i++){
    const q = STATE.allQuestions[i];
    $("#quizList").appendChild(buildQuestion(q, i+1));
    // leve respiro para UX
    await sleep(0);
  }
  STATE.cursor = end;
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

  // IA toggle
  const btnIA = node.querySelector('[data-role="ia-toggle"]');
  const menu = node.querySelector(".ia-menu");
  btnIA.addEventListener("click", ()=>{
    menu.classList.toggle("show");
  });
  menu.querySelectorAll(".ia-item").forEach(a=>{
    a.addEventListener("click", (e)=>{
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
  card.querySelectorAll(".q-opts li").forEach(el=>{
    if (el.dataset.key === q.answer) el.classList.add("hit");
  });

  if (correct){
    card.classList.add("ok");
    res.textContent = "Parabéns! Resposta correta.";
    res.className = "q-res good";
  }else{
    card.classList.add("bad");
    res.textContent = `Resposta errada. Correta: ${q.answer}.`;
    res.className = "q-res bad";
  }

  // Destacar botão IA
  const btnIA = card.querySelector('[data-role="ia-toggle"]');
  btnIA.classList.remove("ia");
  btnIA.classList.add(correct ? "primary" : "");
  if (!correct){ btnIA.style.background="#dc2626"; btnIA.style.borderColor="#b91c1c"; }
}

function buildGoogleIA(kind, q){
  const enc=(s)=>encodeURIComponent(s);
  const alts = q.options.map(o=>`${o.key}) ${o.text}`).join(" ");
  let prompt="";
  if (kind==="gabarito"){
    prompt = `Considere a questão a seguir e responda SOMENTE a letra correta e uma linha de justificativa. Questão: "${q.stem}" Alternativas: ${alts}`;
  } else if (kind==="glossario"){
    prompt = `Liste e defina, em tópicos curtos, os principais termos jurídicos presentes nesta questão: "${q.stem}"`;
  } else {
    // vídeos
    prompt = `Sugira 3 links de vídeos objetivos e confiáveis para estudar o tema desta questão. Mostre título curto e link. Questão: "${q.stem}"`;
  }
  const url = `https://www.google.com/search?q=${enc(prompt)}`;
  return url;
}

/* ==================== NAV ==================== */
function goHome(){
  $("#quiz").classList.add("hidden");
  $("#home").classList.remove("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
}

/* ==================== HELPERS ==================== */
function pretty(s){ return s.replace(/[-_]/g," ").replace(/\.txt$/,""); }

/* ==================== EXPOSE DEBUG ==================== */
globalThis.MeuJus = { parseTxt };
