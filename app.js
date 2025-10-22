/* MeuJus – app.js (PNG apenas) */

(() => {
  const W = 1080, H = 1920, SAFE_BOTTOM = 150;

  const C = {
    BG: "#ffffff",
    TEXT: "#111827",
    MUTED: "#6b7280",
    LINE: "#dfe3e8",
    BADGE: "#cbd5e1",
    BADGE_TEXT: "#111827",
    OPT_TEXT: "#1f2937",
    EXPLAIN: "#0f172a",
  };

  const E = {
    cards: document.getElementById("cards"),
    canvas: document.getElementById("share-canvas"),
    a: document.getElementById("share-download"),
  };

  const base = {
    padTop: 220,
    padSide: 72,
    gapBlock: 28,
    divider: 24,
    stmt: 46,
    stmtLH: 1.38,
    opt: 40,
    optLH: 1.38,
    meta: 28,
    badge: 28,
    footer: 26,
    water: 22,
  };

  const letters = ["A","B","C","D","E"];

  init();

  async function init(){
    const data = await loadData(window.APP_CONFIG?.txtUrl);
    renderCards(data);
    observeSafeArea();
  }

  async function loadData(url){
    try{
      const res = await fetch(url, {cache: "no-store"});
      if(!res.ok) throw new Error("fetch fail");
      const txt = await res.text();
      // Formato simples: meta\n\npergunta\n\nA) ...\nB) ...\n...\nGabarito: X
      const blocks = txt.trim().split(/\n\n+--+\n\n+|^\s*$/m).filter(Boolean);
      const qs = parseSimple(txt);
      if(qs.length) return qs;
      return fallbackData();
    }catch{
      return fallbackData();
    }
  }

  function parseSimple(txt){
    const parts = txt.split(/\n{2,}/);
    let items = [];
    let buf = [];
    for(const line of parts){
      buf.push(line.trim());
      if(/Gabarito\s*:/.test(line)) { items.push(buf.join("\n\n")); buf = []; }
    }
    return items.map(raw => {
      const metaMatch = raw.match(/^(.+?)\n/);
      const meta = metaMatch ? metaMatch[1].trim() : "Direito • Questão";
      const stmt = raw.replace(/^.+?\n/, "").split(/\n\n/)[0].trim();
      const opts = [];
      raw.split(/\n/).forEach(l=>{
        const m = l.match(/^([A-E])\)\s*(.+)$/);
        if(m) opts.push(m[2].trim());
      });
      const g = (raw.match(/Gabarito\s*:\s*([A-E])/i)||[])[1] || "A";
      return { meta, stmt, opts, correct: g.toUpperCase(), source: "meujus.com" };
    }).filter(q=>q.opts?.length>=4);
  }

  function fallbackData(){
    return [{
      meta: "Direito Penal • Súmula • 2025",
      stmt: "Sobre a aplicação do princípio da insignificância, assinale a alternativa correta considerando a orientação predominante nos tribunais superiores.",
      opts: [
        "O princípio é aplicado automaticamente a crimes contra a Administração.",
        "Depende de mínima ofensividade, ausência de periculosidade e reduzido grau de reprovabilidade.",
        "Nunca se aplica em crimes patrimoniais sem violência ou grave ameaça.",
        "Exige prejuízo superior ao salário mínimo vigente.",
        "Somente se aplica mediante confissão espontânea do agente."
      ],
      correct: "B",
      source: "meujus.com"
    }];
  }

  function renderCards(list){
    E.cards.innerHTML = "";
    list.forEach((q, idx) => {
      const card = h("article",{class:"q-card"},
        h("div",{class:"q__meta"}, q.meta),
        h("h2",{class:"q__stmt stmt--xl"}, q.stmt),
        h("div",{class:"q__divider"}),
        h("ul",{class:"q__options"},
          ...q.opts.map((t,i)=>h("li",{class:"q__opt"},
            h("span",{class:"q__badge"}, letters[i]),
            h("div",{class:"q__opt-text opt--lg"}, t)
          ))
        ),
        h("div",{class:"q__explain"}, `Gabarito: ${q.correct}`),
        actionsRow(q)
      );
      E.cards.appendChild(card);
      if(idx===0) card.classList.add("safe-bottom-150");
    });
  }

  function actionsRow(q){
    const row = h("div",{class:"actions"});
    const btnGoogle = h("button",{class:"btn btn--google", type:"button"}, "Google IA");
    const btnShare  = h("button",{class:"btn btn--share", type:"button"}, "Compartilhar");
    btnShare.addEventListener("click", ()=>sharePNG(q));
    row.append(btnGoogle, btnShare);
    return row;
  }

  function h(tag, attrs={}, ...children){
    const el = document.createElement(tag);
    for(const k in attrs){ el.setAttribute(k, attrs[k]); }
    for(const c of children){
      if(typeof c === "string") el.appendChild(document.createTextNode(c));
      else if(c) el.appendChild(c);
    }
    return el;
  }

  async function sharePNG(q){
    const blob = await renderCardToPNG(q);
    const file = new File([blob], "meujus_story.png", {type:"image/png"});
    if(navigator.canShare && navigator.canShare({ files: [file] })){
      try{
        await navigator.share({ files:[file], title:"MeuJus", text:"Questão do dia" });
        return;
      }catch(e){ /* usuário cancelou */ }
    }
    const url = URL.createObjectURL(blob);
    E.a.href = url;
    E.a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }

  async function renderCardToPNG(q){
    const canvas = E.canvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);

    // scale loop
    let scale = 1.0;
    const minScale = 0.68;
    for(let i=0;i<18;i++){
      const metrics = measureLayout(ctx, q, scale);
      if(metrics.totalHeight <= H - SAFE_BOTTOM) break;
      scale = Math.max(minScale, scale * 0.93);
    }

    drawCard(ctx, q, scale);

    return await new Promise(res => canvas.toBlob(b=>res(b), "image/png"));
  }

  function measureLayout(ctx, q, s){
    const padTop = base.padTop;
    const padSide = base.padSide;
    let y = padTop;

    // brand watermark slot uses padTop offset; already accounted
    // meta
    setFont(ctx, base.meta*s, 500);
    y += textLineHeight(base.meta*s);

    // stmt
    setFont(ctx, base.stmt*s, 700);
    const stmtLines = wrap(ctx, q.stmt, W - 2*padSide);
    y += stmtLines.length * (base.stmt*s * base.stmtLH);

    y += 10; // gap
    y += base.divider; // divider
    y += 24; // after divider

    // options
    setFont(ctx, base.opt*s, 500);
    const badgeSize = 56 * s;
    for(const t of q.opts){
      const lines = wrap(ctx, t, W - 2*padSide - (68*s));
      const blockHeight = Math.max(badgeSize, lines.length * (base.opt*s*base.optLH));
      y += blockHeight + 18*s;
    }

    // explain
    setFont(ctx, base.meta*s, 500);
    y += 10*s + textLineHeight(base.meta*s) + 40*s;

    // footer
    const footerY = H - 120*s;
    const totalHeight = Math.max(y, footerY + 24*s + textLineHeight(base.footer*s)); // conservative

    return { totalHeight };
  }

  function drawCard(ctx, q, s){
    // bg
    ctx.fillStyle = C.BG;
    ctx.fillRect(0,0,W,H);

    const padTop = base.padTop;
    const padSide = base.padSide;

    // brand
    setFont(ctx, 44*s, 700);
    ctx.fillStyle = C.TEXT;
    ctx.fillText("MeuJus", padSide, padTop - 120*s);

    // watermark
    setFont(ctx, base.water*s, 500);
    ctx.fillStyle = C.MUTED;
    ctx.fillText("Questão do dia", padSide, padTop - 60*s);

    let y = padTop;

    // meta
    setFont(ctx, base.meta*s, 500);
    ctx.fillStyle = C.MUTED;
    ctx.fillText(q.meta, padSide, y);
    y += 48*s;

    // stmt
    setFont(ctx, base.stmt*s, 700);
    ctx.fillStyle = C.TEXT;
    y = drawParagraph(ctx, q.stmt, padSide, y, W - 2*padSide, base.stmtLH, base.stmt*s);

    y += 10*s;

    // divider
    ctx.strokeStyle = C.LINE;
    ctx.lineWidth = 4*s;
    line(ctx, padSide, y, W - padSide, y);
    y += 24*s;

    // options
    setFont(ctx, base.opt*s, 500);
    for(let i=0;i<q.opts.length;i++){
      const letter = letters[i] || String.fromCharCode(65+i);
      // badge
      const cx = padSide + 28*s;
      const cy = y + 24*s;
      const r  = 28*s;

      ctx.fillStyle = C.BG;
      ctx.strokeStyle = C.BADGE;
      ctx.lineWidth = 4*s;
      circle(ctx, cx, cy, r);

      // badge letter
      setFont(ctx, base.badge*s, 700);
      ctx.fillStyle = C.BADGE_TEXT;
      const m = ctx.measureText(letter);
      ctx.fillText(letter, cx - m.width/2, cy + textAscent(base.badge*s)/2 - 2*s);

      // text
      setFont(ctx, base.opt*s, 500);
      ctx.fillStyle = C.OPT_TEXT;
      const tx = padSide + 68*s;
      const tyStart = y;
      const ty = drawParagraph(ctx, q.opts[i], tx, y, W - tx - padSide, base.optLH, base.opt*s);
      const blockH = Math.max(56*s, ty - tyStart);
      y = tyStart + blockH + 18*s;
    }

    // explain
    setFont(ctx, base.meta*s, 600);
    ctx.fillStyle = C.EXPLAIN;
    ctx.fillText(`Gabarito: ${q.correct}`, padSide, y + 10*s);
    y += 50*s;

    // footer
    const footerY = H - 120*s;
    ctx.strokeStyle = C.LINE;
    ctx.lineWidth = 2*s;
    line(ctx, padSide, footerY, W - padSide, footerY);

    setFont(ctx, base.footer*s, 500);
    ctx.fillStyle = C.MUTED;
    ctx.fillText(q.source || "meujus.com", padSide, footerY + 24*s);

    const cta = "Compartilhe • Arraste para cima";
    const w = ctx.measureText(cta).width;
    ctx.fillText(cta, W - padSide - w, footerY + 24*s);
  }

  function setFont(ctx, size, weight=500){
    ctx.font = `${weight} ${size}px ui-sans-serif, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textBaseline = "alphabetic";
  }

  function wrap(ctx, text, maxW){
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = "";
    for(const w of words){
      const probe = cur ? cur + " " + w : w;
      if(ctx.measureText(probe).width <= maxW){
        cur = probe;
      }else{
        if(cur) lines.push(cur);
        cur = w;
      }
    }
    if(cur) lines.push(cur);
    return lines;
  }

  function drawParagraph(ctx, text, x, y, maxW, lh, fs){
    const lines = wrap(ctx, text, maxW);
    for(const ln of lines){
      ctx.fillText(ln, x, y);
      y += fs * lh;
    }
    return y;
  }

  function textLineHeight(fs){ return fs * 1.3; }
  function textAscent(fs){ return fs * 0.35; }

  function line(ctx, x1,y1,x2,y2){ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
  function circle(ctx, cx, cy, r){ ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill(); ctx.stroke(); }

  function observeSafeArea(){
    // Garante respiro no DOM enquanto o conteúdo cresce
    const root = document.querySelector(".q-card");
    if(!root) return;
    const ro = new ResizeObserver(() => {
      const rect = root.getBoundingClientRect();
      const bottomFree = window.innerHeight - rect.bottom;
      if(bottomFree < SAFE_BOTTOM) root.classList.add("safe-bottom-150");
      else root.classList.remove("safe-bottom-150");
      // Ajuste visual de classes de fonte no DOM (não afeta PNG)
      tuneDomFonts(root);
    });
    ro.observe(root);
  }

  function tuneDomFonts(root){
    const stmt = root.querySelector(".q__stmt");
    const opts = root.querySelectorAll(".q__opt-text");
    if(!stmt) return;

    // Heurística simples baseada na altura do cartão
    const h = root.getBoundingClientRect().height;
    const tall = h > 720;
    const veryTall = h > 900;

    stmt.classList.remove("stmt--xl","stmt--lg","stmt--md");
    opts.forEach(o=>o.classList.remove("opt--lg","opt--md","opt--sm"));

    if(veryTall){
      stmt.classList.add("stmt--md");
      opts.forEach(o=>o.classList.add("opt--sm"));
    }else if(tall){
      stmt.classList.add("stmt--lg");
      opts.forEach(o=>o.classList.add("opt--md"));
    }else{
      stmt.classList.add("stmt--xl");
      opts.forEach(o=>o.classList.add("opt--lg"));
    }
  }
})();
