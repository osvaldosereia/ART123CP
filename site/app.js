/* SPA minimal; parser + UI + PDF + links de prompt */
const EL = (tag, attrs={}, ...children) => {
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v==="function") el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
};

const state = {
  manifest: null,
  banco: new Map(),   // disciplina -> tema -> [questoes]
  frases: [],
  view: "home",
  disciplina: null,
  temas: [],
  qtd: 10,
  prova: null,        // { seed, itens: [ {type:'q', q, tema}, {type:'frase', frase} ], total, corretas, pools }
};

const ICONS = {
  gabarito: "check-circle",
  glossario: "book-open",
  videos: "video",
  dicas: "lightbulb",
  principios: "scale",
  inedita: "sparkles",
  substituir: "shuffle"
};

function icon(name) {
  const svg = window.lucide.createElement(window.lucide[name], { color: "#444", size: 16 });
  const wrap = EL("span");
  wrap.append(svg);
  return wrap;
}

async function init() {
  const app = document.getElementById("app");
  app.textContent = "Carregando dados...";
  await loadManifestAndData();
  renderHome();
}

async function loadManifestAndData() {
  const mRes = await fetch("./manifest.json", { cache: "no-store" });
  state.manifest = await mRes.json();

  // frases (aceita prefixos "* ")
  try {
    const fRes = await fetch("./frases.txt", { cache: "no-store" });
    const raw = await fRes.text();
    state.frases = raw.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>l.replace(/^\*+\s*/,"")).map(l=>{
      const parts = l.split("|");
      const frase = (parts[0]||"").trim();
      const autor = (parts[1]||"").trim();
      return frase ? { frase, autor } : null;
    }).filter(Boolean);
  } catch { state.frases = []; }

  // carrega TXT listados
  const files = state.manifest.items || [];
  const limit = 4;
  const queue = files.slice();
  const tasks = Array.from({length:limit}, async () => {
    while(queue.length){
      const it = queue.shift();
      const url = `./data/${it.path}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const txt = await res.text();
      parseTxtIntoBank(txt);
    }
  });
  await Promise.all(tasks);
}

function parseTxtIntoBank(text) {
  const blocks = text.split(/^-{3,}\s*$/m).map(b=>b.trim()).filter(Boolean);
  for (const raw of blocks) {
    const lines = raw.split("\n").map(l=>l.trim());
    let meta=null, enun=[], alts=[], gab=null, tema=null, disc=null;
    for (const l of lines) {
      if (l.startsWith("****** ")) disc = l.replace(/^(\*{6}\s*)/,"").trim();
      else if (l.startsWith("***** ")) tema = l.replace(/^(\*{5}\s*)/,"").trim();
      else if (l.startsWith("**** ")) {
        const m = l.match(/^(\*{4}\s*)Gabarito:\s*([A-E])/i);
        if (m) gab = m[2].toUpperCase();
      } else if (l.startsWith("*** ")) {
        const m = l.match(/^\*{3}\s*([A-E])\)\s*(.+)$/i);
        if (m) alts.push({ letra: m[1].toUpperCase(), texto: m[2].trim() });
      } else if (l.startsWith("** ")) {
        enun.push(l.replace(/^\*{2}\s*/,""));
      } else if (l.startsWith("* ")) {
        if (!meta) meta = l.replace(/^\*\s*/,"");
      }
    }
    if (!disc || !tema || !meta || enun.length===0 || !gab || alts.length<2 || alts.length>5) continue;
    if (!alts.find(a=>a.letra===gab)) continue;
    const enunciado = enun.join(" ").replace(/\s+/g," ").trim();
    const q = { disc, tema, meta, enunciado, alts, gab };
    if (!state.banco.has(disc)) state.banco.set(disc, new Map());
    const temas = state.banco.get(disc);
    if (!temas.has(tema)) temas.set(tema, []);
    temas.get(tema).push(q);
  }
}

function renderHome() {
  state.view = "home";
  const app = document.getElementById("app");
  const discs = [...state.banco.keys()].sort();
  app.replaceChildren(
    EL("div", {class:"breadcrumb"}, "Home"),
    EL("h2", {}, "Disciplinas"),
    EL("div", {class:"grid"},
      ...discs.map(d=>EL("div", {class:"card", onclick:()=>renderDisciplina(d)},
        EL("div", {class:"title"}, d),
        EL("div", {class:"meta"}, `${contaQuestoesDisciplina(d)} questões`)
      ))
    )
  );
}

function contaQuestoesDisciplina(disc) {
  const temas = state.banco.get(disc) || new Map();
  let n=0; for (const arr of temas.values()) n+=arr.length; return n;
}

function renderDisciplina(disc) {
  state.view = "disc";
  state.disciplina = disc;
  state.temas = [];
  const temas = [...(state.banco.get(disc)||new Map()).entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const app = document.getElementById("app");
  const list = EL("div", {});
  for (const [t, arr] of temas) {
    const row = EL("label", {class:"controls"},
      EL("input", {type:"checkbox", onchange:(e)=>toggleTema(t,e.target.checked)}),
      EL("span", {}, t),
      EL("span", {class:"badge"}, `${arr.length}`)
    );
    list.append(row);
  }
  const qtd = EL("input", {type:"number", min:"1", max:"20", value:String(state.qtd), oninput:(e)=>state.qtd = clamp(parseInt(e.target.value||"0",10),1,20)});
  const btn = EL("button", {onclick:()=>criarProva()}, "Criar Prova");
  const back = EL("button", {onclick:()=>renderHome()}, "← Voltar");
  app.replaceChildren(
    EL("div", {class:"breadcrumb"}, `Home › ${disc}`),
    EL("h2", {}, "Temas"),
    list,
    EL("div", {class:"controls"}, EL("label", {}, "Qtd: ", qtd), btn, back)
  );
}

function toggleTema(t, checked) {
  const i = state.temas.indexOf(t);
  if (checked && i===-1) state.temas.push(t);
  if (!checked && i>-1) state.temas.splice(i,1);
}

function criarProva() {
  const temasSel = state.temas.slice();
  if (!state.disciplina || temasSel.length===0) { alert("Selecione ao menos um tema."); return; }
  const seed = new URLSearchParams(location.search).get("seed") || String(Date.now());
  const rng = mulberry32(hashString(seed));
  const poolPorTema = new Map();
  const temasMap = state.banco.get(state.disciplina);
  for (const t of temasSel) {
    const arr = (temasMap.get(t)||[]).slice();
    shuffleInPlace(arr, rng);
    poolPorTema.set(t, arr);
  }
  const totalDisponivel = [...poolPorTema.values()].reduce((s,a)=>s+a.length,0);
  const desejadas = Math.min(state.qtd, totalDisponivel);
  const base = Math.floor(desejadas / temasSel.length);
  let sobra = desejadas % temasSel.length;
  const porTema = new Map(temasSel.map(t=>[t, base + (sobra-->0?1:0)]));

  const escolhidas = [];
  for (const t of temasSel) {
    const n = porTema.get(t);
    const arr = poolPorTema.get(t);
    for (let i=0;i<n && arr.length;i++) escolhidas.push({ type:"q", q: arr.shift(), tema:t });
  }
  shuffleInPlace(escolhidas, rng);

  const itens = [];
  let countQ=0, idxFrase=0;
  for (const it of escolhidas) {
    itens.push(it);
    countQ++;
    if (countQ % 3 === 0 && state.frases[idxFrase]) itens.push({ type:"frase", frase: state.frases[idxFrase++] });
  }

  state.prova = { seed, itens, total: escolhidas.length, corretas: 0, pools: poolPorTema };
  const url = new URL(location.href); url.searchParams.set("seed", seed); history.replaceState(null, "", url);
  renderProva();
}

function renderProva() {
  state.view = "prova";
  const app = document.getElementById("app");
  const bc = EL("div",{class:"breadcrumb"},"Home › ", state.disciplina, " › Prova");
  const list = EL("div", {});
  state.prova.itens.forEach((it, idx)=>{
    if (it.type === "frase") list.append(renderFrase(it.frase));
    else { list.append(renderQuestao(it.q, idx, it.tema)); list.append(EL("hr",{class:"sep"})); }
  });
  const footer = EL("div", {class:"footer"},
    EL("div", {class:"score", id:"score"}, placarText()),
    EL("button", {onclick:()=>exportarPDF()}, "Exportar Prova"),
    EL("button", {onclick:()=>renderDisciplina(state.disciplina)}, "← Voltar")
  );
  app.replaceChildren(bc, list, footer);
  window.lucide.createIcons && window.lucide.createIcons();
}

function renderQuestao(q, idx, tema) {
  const wrap = EL("section", {});
  const meta = EL("div", {class:"meta"}, q.meta);
  const enun = EL("div", {class:"enun"}, q.enunciado);
  const ul = EL("ul", {class:"alt", role:"listbox", "aria-label":`Questão ${idx+1}`});
  q.alts.forEach(a=>{
    const li = EL("li", {role:"option", tabindex:"0"}, `${a.letra}) ${a.texto}`);
    li.addEventListener("click", ()=>responder(idx, a.letra, li));
    li.addEventListener("keydown", (e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); li.click(); }});
    ul.append(li);
  });

  const mkBtn = (iconName, title, href)=> {
    const a = EL("a", {class:"icon-btn", href, target:"_blank", rel:"nofollow noopener", title});
    a.append(icon(iconName));
    return a;
  };
  const links = linksMiniBotoes(q);
  const left = EL("div", {class:"q-left"},
    mkBtn(ICONS.gabarito, "Explicar gabarito", links.gabarito),
    mkBtn(ICONS.glossario, "Glossário do enunciado", links.glossario),
    mkBtn(ICONS.videos, "Aulas rápidas", links.videos),
    mkBtn(ICONS.dicas, "Dicas e mnemônicos", links.dicas),
    mkBtn(ICONS.principios, "Princípios aplicáveis", links.principios),
    mkBtn(ICONS.inedita, "Gerar inédita", links.inedita),
  );

  const subBtn = EL("button", {class:"icon-btn", title:"Substituir", onclick:()=>substituir(idx, tema)});
  subBtn.append(icon(ICONS.substituir));
  const actions = EL("div", {class:"q-actions"}, left, EL("div", {}, subBtn));

  const gab = EL("div", {class:"gabarito", id:`gab_${idx}`, style:"display:none"}, `Gabarito: ${q.gab}`);

  wrap.append(meta, enun, ul, actions, gab);
  return wrap;
}

function renderFrase(fr) {
  const wrap = EL("section", {class:"frase"});
  wrap.append(
    EL("div", {class:"texto"}, `“${fr.frase}”`),
    EL("div", {class:"autor"}, fr.autor ? `— ${fr.autor}` : "")
  );
  const share = EL("div", {class:"share"}, EL("button", {onclick:()=>shareFrase(fr)}, "Compartilhar frase"));
  wrap.append(share);
  return wrap;
}

function responder(idx, letra, liEl) {
  const it = state.prova.itens[idx];
  if (!it || it.type!=="q") return;
  const q = it.q;
  const ul = liEl.parentElement;
  if (ul.getAttribute("data-answered")==="1") return;
  const nodes = Array.from(ul.children);
  nodes.forEach(n=>n.classList.remove("correct","wrong"));
  if (letra === q.gab) {
    liEl.classList.add("correct");
    state.prova.corretas++;
  } else {
    liEl.classList.add("wrong");
    const correta = nodes.find(n=>n.textContent.trim().startsWith(q.gab + ")"));
    if (correta) correta.classList.add("correct");
  }
  document.getElementById(`gab_${idx}`).style.display = "block";
  ul.setAttribute("data-answered","1");
  document.getElementById("score").textContent = placarText();
}

function substituir(idx, tema) {
  const it = state.prova.itens[idx];
  if (!it || it.type!=="q") return;
  const pool = state.prova.pools.get(tema) || [];
  if (pool.length === 0) { alert("Sem mais questões deste tema."); return; }
  const nova = pool.shift();
  state.prova.itens[idx] = { type:"q", q: nova, tema };
  renderProva();
}

function placarText() { return `Resultado: ${state.prova.corretas}/${state.prova.total}`; }

function linksMiniBotoes(q) {
  const joinAlts = (alts) => alts.map(a=>`${a.letra}) ${a.texto}`).join("\n");
  const base = (prompt) => {
    const payload = `${prompt}\n\nEnunciado:\n${truncate(q.enunciado, 2400)}\n\nAlternativas:\n${truncate(joinAlts(q.alts), 3000)}`;
    return "https://www.google.com/search?udm=50&q=" + encodeURIComponent(payload);
  };
  return {
    gabarito: base(`Explique por que ${q.gab} e refute as demais.`),
    glossario: base("Defina 3–6 termos do enunciado."),
    videos: base("Liste 5 vídeos confiáveis sobre o tema."),
    dicas: base("Forneça mnemônicos e dicas rápidas."),
    principios: base("Relacione princípios aplicáveis."),
    inedita: base("Gere 1 questão inédita estilo banca com gabarito.")
  };
}

function shareFrase(fr) {
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,W,H);
  const colW = Math.floor(W*0.7);
  const x = Math.floor((W-colW)/2);
  let y = 500;
  ctx.fillStyle = "#111111";
  ctx.font = "600 48px 'Inter Tight', Arial, sans-serif";
  y = drawWrappedLeft(ctx, `“${fr.frase}”`, x, y, colW, 56);
  ctx.fillStyle = "#666666";
  ctx.font = "400 28px 'Inter Tight', Arial, sans-serif";
  y += 20;
  drawWrappedLeft(ctx, fr.autor ? `— ${fr.autor}` : "", x, y, colW, 36);
  const link = document.createElement("a");
  link.download = "frase.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function drawWrappedLeft(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  let line = "";
  for (let i=0;i<words.length;i++){
    const test = line ? line + " " + words[i] : words[i];
    const w = ctx.measureText(test).width;
    if (w > maxWidth && line) { ctx.fillText(line, x, y); line = words[i]; y += lineHeight; }
    else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lineHeight; }
  return y;
}

function exportarPDF() {
  const w = window.open("", "_blank");
  if (!w) return;
  const doc = w.document;
  const css = `
    @page { size: A4; margin: 10mm 10mm 12mm 10mm; }
    body { font-family: "Inter Tight", Arial, sans-serif; color:#111; }
    .cols { column-count: 2; column-gap: 10mm; }
    .q { break-inside: avoid; margin: 0 0 6mm 0; }
    .meta { font-size: 9.5pt; color:#666; margin-bottom: 1mm; }
    .enun { font-size: 11.5pt; line-height: 1.5; text-align: justify; }
    .alt { font-size: 10.5pt; line-height: 1.4; margin: 1mm 0 0 0; padding:0; list-style:none; }
    .alt li { margin: .5mm 0; }
    hr { border:0; border-top: .5pt solid #d9d9d9; margin: 3mm 0; }
    h1 { font-size: 16pt; margin: 0 0 4mm 0; }
    .gabarito-page { page-break-before: always; }
  `;
  const paged = `<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"><\/script>`;
  const head = `
    <meta charset="utf-8"/>
    <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
    <style>${css}</style>
  `;
  doc.write(`<html><head>${head}</head><body>`);
  doc.write(`<div class="cols">`);
  const qs = state.prova.itens.filter(x=>x.type==="q");
  qs.forEach((it)=>{
    const q = it.q;
    doc.write(`<section class="q">`);
    doc.write(`<div class="meta">${escapeHTML(q.meta)}</div>`);
    doc.write(`<div class="enun">${escapeHTML(q.enunciado)}</div>`);
    doc.write(`<ul class="alt">`);
    q.alts.forEach(a=>doc.write(`<li>${a.letra}) ${escapeHTML(a.texto)}</li>`));
    doc.write(`</ul>`);
    doc.write(`</section><hr/>`);
  });
  doc.write(`</div>`);
  doc.write(`<div class="gabarito-page"><h1>Gabarito</h1><ol>`);
  qs.forEach((it)=> doc.write(`<li>${it.q.gab}</li>`));
  doc.write(`</ol></div>`);
  doc.write(`${paged}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));<\/script>`);
  doc.write(`</body></html>`);
  doc.close();
}

function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n||0)); }
function hashString(str){ let h=1779033703^str.length; for(let i=0;i<str.length;i++){ h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h<<13)|(h>>>19);} return (h>>>0); }
function mulberry32(a){ return function(){ let t = a += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } }
function shuffleInPlace(arr, rng){ for(let i=arr.length-1;i>0;i--){ const j = Math.floor(rng()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } }
function truncate(s, max){ if (!s) return ""; s=String(s); return s.length>max ? s.slice(0,max-1)+"…" : s; }

init();
