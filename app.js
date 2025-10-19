/* app.js — Parser TXT + integração com index.html atual */
"use strict";

/* ================= PARSER TXT ================= */

function parseTxt(rawTxt) {
  if (typeof rawTxt !== "string") throw new TypeError("Entrada deve ser string");
  const lines = rawTxt.replace(/\r\n?/g, "\n").split("\n");
  const out = [], warnings = [];
  let cur = resetCurrent();

  const pushIfComplete = () => {
    if (!cur.hasData) return;
    const q = finalizeCurrent(cur);
    validateQuestion(q, warnings);
    out.push(q);
    cur = resetCurrent();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (/^-+\s*$/.test(line)) { pushIfComplete(); continue; }

    if (line.trim() === "") { if (cur.stage === "stem") { cur.stem.push(""); cur.hasData = true; } continue; }

    const g = (/^\*\*\*\s*Gabarito:\s*([A-E])\s*$/.exec(line) || [])[1];
    if (g) { cur.answer = g; cur.stage = "answer"; cur.hasData = true; continue; }

    const mAlt = /^\*\*\s*([A-E])\)\s*(.+)$/.exec(line);
    if (mAlt) {
      const alt = { key: mAlt[1], text: mAlt[2].trim() };
      if (!cur.options.some(o => o.key === alt.key)) cur.options.push(alt);
      else warnings.push(warn(i + 1, `Alternativa "${alt.key}" repetida; linha ignorada.`));
      cur.stage = "options"; cur.hasData = true; continue;
    }

    if (line.startsWith("* ")) { cur.stem.push(line.slice(2)); cur.stage = "stem"; cur.hasData = true; continue; }

    if (cur.stage === "stem" || !cur.hasData) { cur.stem.push(line); cur.hasData = true; continue; }
    if (cur.stage === "options") { warnings.push(warn(i + 1, "Linha ignorada após alternativas.")); continue; }
    if (cur.stage === "answer") { warnings.push(warn(i + 1, "Linha ignorada após gabarito.")); continue; }
  }
  pushIfComplete();
  return { questions: out.filter(q => q.stem.trim().length > 0), warnings };
}

function resetCurrent() { return { hasData:false, stage:"empty", stem:[], options:[], answer:null }; }
function finalizeCurrent(cur){
  const stemLines = trimEmpty(cur.stem);
  return { id: uuid(), stemLines, stem: stemLines.join("\n").trim(), options: cur.options.slice(), answer: cur.answer ?? "" };
}
function trimEmpty(arr){ let a=0,b=arr.length; while(a<b&&arr[a].trim()==="")a++; while(b>a&&arr[b-1].trim()==="")b--; return arr.slice(a,b); }
function validateQuestion(q,w){
  const keys = new Set(q.options.map(o=>o.key));
  for (const k of ["A","B","C","D","E"]) if(!keys.has(k)) w.push(`Questão "${shorten(q.stem)}": faltou ${k}.`);
  if(!q.answer) w.push(`Questão "${shorten(q.stem)}": gabarito ausente.`);
  else if(!keys.has(q.answer)) w.push(`Questão "${shorten(q.stem)}": gabarito "${q.answer}" não existe.`);
}
function warn(n,msg){ return `L${n}: ${msg}`; }
function shorten(s,n=80){ s=s.replace(/\s+/g," ").trim(); return s.length<=n?s:s.slice(0,n-1)+"…"; }
function uuid(){ try{ if(crypto?.randomUUID) return crypto.randomUUID(); }catch{} return "q_"+Math.random().toString(36).slice(2,10); }

function parseQuestions(txt){ return parseTxt(txt).questions; }
function parseWithWarnings(txt){ return parseTxt(txt); }
function toJSON(questions){ return JSON.stringify({version:1,format:"txt:v1",count:questions.length,questions},null,2); }

/* Expor API global mesmo em módulo */
globalThis.QuestionsTxt = { parseQuestions, parseWithWarnings, toJSON };
globalThis.debugParse = (s)=>{ const r=parseWithWarnings(s); console.log(r); return r; };

/* ================= INTEGRAÇÃO COM index.html ================= */

const $ = (sel)=>document.querySelector(sel);
const $$ = (sel)=>document.querySelectorAll(sel);

let STATE = {
  all: /** @type {ParsedQuestion[]} */([]),
  filtered: /** @type {ParsedQuestion[]} */([]),
  idx: 0,
  shuffle: false,
};

window.addEventListener("DOMContentLoaded", async () => {
  // Carrega penal.txt da raiz do site
  const txt = await fetchTxt("penal.txt");
  const { questions, warnings } = parseWithWarnings(txt);
  if (warnings.length) console.warn("[warnings]", warnings);
  STATE.all = questions.slice();
  updateKpis(STATE.all.length, 0, 0);
  wireHome();
});

async function fetchTxt(path){
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar ${path}: ${res.status}`);
  return await res.text();
}

function wireHome(){
  const btnStart = $("#btnStart");
  const shuffle = $("#optShuffle");
  const pathInfo = $("#pathInfo");

  if (pathInfo) pathInfo.textContent = "Banco: penal.txt";

  if (shuffle) shuffle.addEventListener("change", (e)=>{
    STATE.shuffle = e.target.checked;
  });

  if (btnStart) {
    btnStart.disabled = STATE.all.length === 0;
    btnStart.addEventListener("click", startQuiz);
    btnStart.disabled = false;
  }

  $("#btnReset")?.addEventListener("click", resetAll);
}

function startQuiz(){
  STATE.filtered = STATE.all.slice();
  if (STATE.shuffle) shuffleInPlace(STATE.filtered);
  STATE.idx = 0;
  $("#home")?.classList.add("hidden");
  $("#quiz")?.classList.remove("hidden");
  renderNext();
}

function resetAll(){
  $("#quizList").innerHTML = "";
  $("#home")?.classList.remove("hidden");
  $("#quiz")?.classList.add("hidden");
  updateKpis(STATE.all.length, 0, 0);
}

function renderNext(){
  if (STATE.idx >= STATE.filtered.length) {
    $("#sentinel").textContent = "Fim.";
    return;
  }
  const q = STATE.filtered[STATE.idx];
  const el = buildQuestion(q, STATE.idx + 1);
  $("#quizList").appendChild(el);
  STATE.idx++;
  $("#sentinel").textContent = `${STATE.idx}/${STATE.filtered.length}`;
  updateKpis(STATE.filtered.length, STATE.idx - 1, countHits());
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildQuestion(q, num){
  const tpl = /** @type {HTMLTemplateElement} */($("#tplQuestion"));
  const node = tpl.content.firstElementChild.cloneNode(true);
  const $num = node.querySelector(".q-num");
  const $id = node.querySelector(".q-id");
  const $stem = node.querySelector(".q-stem");
  const $opts = node.querySelector(".q-options");
  const $res = node.querySelector(".q-result");
  const $btnShow = node.querySelector(".q-show");
  const $btnNext = node.querySelector(".q-next");

  node.dataset.num = String(num);
  $num.textContent = `#${num}`;
  $id.textContent = q.id.slice(0,8);
  $stem.innerText = q.stem;

  q.options.forEach(opt=>{
    const li = document.createElement("li");
    li.innerText = `${opt.key}) ${opt.text}`;
    li.dataset.key = opt.key;
    li.tabIndex = 0;
    li.addEventListener("click", ()=>select(li, q, $res));
    li.addEventListener("keypress", (e)=>{ if(e.key==="Enter") select(li, q, $res); });
    $opts.appendChild(li);
  });

  $btnShow.addEventListener("click", ()=>{
    $res.textContent = `Gabarito: ${q.answer}`;
    $res.className = "q-result ok";
    highlightCorrect($opts, q.answer);
  });
  $btnNext.addEventListener("click", renderNext);

  return node;
}

function select(li, q, $res){
  const key = li.dataset.key;
  const correct = key === q.answer;
  $res.textContent = correct ? "Correto" : `Errado • Gabarito: ${q.answer}`;
  $res.className = "q-result " + (correct ? "ok" : "bad");
  highlightCorrect(li.parentElement, q.answer);
  li.parentElement.querySelectorAll("li").forEach(el=>el.classList.add("locked"));
}

function highlightCorrect(ol, ans){
  ol.querySelectorAll("li").forEach(el=>{
    el.classList.toggle("hit", el.dataset.key === ans);
  });
}

function updateKpis(total, done, hits){
  $("#kTotal").textContent = String(total);
  $("#kDone").textContent = String(done);
  $("#kScore").textContent = String(hits);
}

function countHits(){
  return [...$$(".q-result.ok")].length;
}

function shuffleInPlace(a){
  for (let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
}

/* ===== Tipagem JSDoc ===== */
/**
 * @typedef {Object} ParsedQuestion
 * @property {string} id
 * @property {string} stem
 * @property {string[]} stemLines
 * @property {{key:string,text:string}[]} options
 * @property {string} answer
 */
