"use strict";

/* ===== Compartilhar Prova: impressão/PDF ===== */
(function setupShareExamButton(){
  document.addEventListener("DOMContentLoaded", ()=>{
    const btn = document.getElementById("examShareLink");
    if(!btn) return;
    btn.addEventListener("click", ()=>{
      if(!STATE.exam){ toast("Nenhuma prova carregada"); return; }
      exportExamPrintView();
    });
  });
})();

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
    *{ box-sizing:border-box; }
    html,body{ margin:0; padding:0; }
    body{
      font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial;
      color: var(--ink); background:#fff;
    }
    .wrap{ max-width:var(--w); margin:24px auto; padding:0 18px; }
    header{
      display:flex; justify-content:space-between; align-items:end;
      margin:8px 0 18px; border-bottom:1px solid var(--line); padding-bottom:12px;
    }
    header h1{ font-size:22px; margin:0; }
    header .sub{ color:var(--muted); font-size:12px; }
    .divider{ height:1px; background:var(--line); margin:12px 0 18px; }

    .q{
      page-break-inside:avoid;
      background:#fff; border:1px solid var(--line); border-radius:10px;
      padding:14px 14px 10px; margin:0 0 16px 0;
    }
    .q h3{ margin:0 0 8px 0; font-size:15px; color:#111; }
    .meta{ color:var(--muted); font-size:12px; margin:2px 0 8px; }
    .stem{ white-space:pre-wrap; color:var(--brand); font-weight:700; margin:6px 0 10px; }
    .opts{ margin:0; padding-left:20px; }
    .opts li{ margin:3px 0; }
    .badge{ display:inline-block; padding:2px 6px; border-radius:6px; font-size:12px; vertical-align:middle; }
    .ok{ background:var(--ok); }
    .bad{ background:var(--bad); }

    .report{ border:1px solid var(--line); border-radius:12px; padding:14px; margin-top:18px; }
    .report h3{ margin:0 0 8px 0; }
    .gabarito{ margin-top:10px; }
    .foot{ margin:24px 0 8px; font-size:12px; color:var(--muted); text-align:center; }
    .print-btn{ margin-top:16px; }

    @media print{
      .no-print{ display:none !important; }
      body{ background:#fff; }
      .wrap{ margin:0 auto; padding:0; }
      header{ border:0; margin:0 0 8px 0; padding:0; }
      .q{ box-shadow:none; }
    }
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

function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

/* ===== Estado mínimo ===== */
const STATE = {
  exam: null,
  allQuestions: [],
  viewQuestions: [],
  batchSize: 3,
  cursor: 0,
  observer: null,
};

/* ===== Infinite scroll ===== */
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

/* ===== Card da questão ===== */
function buildQuestion(q, num){
  const tpl = /** @type {HTMLTemplateElement} */($("#tplQuestion"));
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

/* ===== Correção ===== */
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

  const btnIA = card.querySelector('[data-role="ia-toggle"]');
  if (btnIA){
    btnIA.classList.remove("ia");
    btnIA.classList.add(correct ? "primary" : "");
    if (!correct){ btnIA.style.background="#dc2626"; btnIA.style.borderColor="#b91c1c"; }
  }
}

/* ===== Google IA helpers ===== */
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
    prompt = `Pesquise em bibliotecas e obras jurídicas reconhecidas os PRINCÍPIOS relacionados ao tema desta questão e apresente cada princípio com: (1) nome do princípio, (2) breve comentário de 1–2 frases, (3) referência completa da fonte consultada. Tema(s): ${tema}. Contexto: "${q.stem}". Gabarito: ${gab}. Alternativas: ${alts}.`;
  } else if (kind === "checklist"){
    prompt = `Gere um CHECK-LIST de estudo para prova com base na questão. Tópicos: conteúdos a dominar, erros comuns, dicas práticas, 3–5 microexercícios. Tema(s): ${tema}. Questão: "${q.stem}". Gabarito: ${gab}. Alternativas: ${alts}.`;
  } else {
    prompt = `Sugira 3 vídeos objetivos e confiáveis sobre o tema. Mostre título curto e link. Tema(s): ${tema}. Questão: "${q.stem}". Gabarito: ${gab}. Alternativas: ${alts}`;
  }
  return `https://www.google.com/search?udm=50&hl=pt-BR&gl=BR&q=${enc(prompt)}`;
}

/* ===== Topbar auto-hide ===== */
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

/* ===== Voltar ao topo ===== */
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

/* ===== Story 1080x1920 ===== */
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

/* ===== Utils ===== */
const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>r.querySelectorAll(s);
function toast(msg, t=3000){ const el=$("#toast"); if(!el) return; el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), t); }
function uid(){ try{ if(crypto?.randomUUID) return crypto.randomUUID(); }catch{} return "q_"+Math.random().toString(36).slice(2,10); }


/* ==================== PARSER TXT (com metas ***** e temas ****) ==================== */
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

    // Metadados: ***** Ano | Banca | Órgão ...
    const mm = /^\*{5}\s*(.+)$/.exec(L);
    if (mm){ 
      if (cur.has && (cur.stem.length || cur.opts.length || cur.ans || cur.themes.length)) push();
      cur.meta = mm[1].trim(); 
      cur.stage = "meta";
      cur.has = true; 
      continue; 
    }

    // Temas: **** tema1, tema2, tema3
    const t = /^\*\*\*\*\s*(.+)$/.exec(L);
    if (t){ 
      cur.themes = t[1].split(",").map(s => s.trim()).filter(Boolean); 
      cur.has = true; 
      continue; 
    }

    // Gabarito
    const g = (/^\*\*\*\s*Gabarito:\s*([A-E])\s*$/.exec(L) || [])[1];
    if (g){ cur.ans = g; cur.stage = "ans"; cur.has = true; continue; }

    // Alternativa
    const m = /^\*\*\s*([A-E])\)\s*(.+)$/.exec(L);
    if (m){ 
      const key = m[1], text = m[2].trim();
      if (!cur.opts.some(o => o.key === key)) cur.opts.push({ key, text });
      cur.stage = "opts"; 
      cur.has = true; 
      continue;
    }

    // Enunciado
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

/* ==================== EXPOSE DEBUG ==================== */
globalThis.MeuJus = { parseTxt };
