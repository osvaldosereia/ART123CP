// meujus – app.js (UI/UX + A11y + Drawer + Toasts + Navegação)
// Mantém seu layout. Sem CSS inline intrusivo.

/* =========================
 * Helpers DOM
 * =======================*/
(function(){
  const $  = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  /* =========================
   * Router
   * =======================*/
  function getHashParts(){
    const h = location.hash.replace(/^#\/?/, '');
    return h.split('/');
  }
  function currentTemaSlug(){
    const p = getHashParts();
    return (p[0]==='tema' && p[1]) ? decodeURIComponent(p[1]) : null;
  }
  function currentPage(){
    const p = getHashParts();
    if(p[0]==='tema' && p[1]) return {kind:'tema', slug:decodeURIComponent(p[1])};
    if(p[0]==='sobre') return {kind:'sobre'};
    return {kind:'home'};
  }
  function setTemaSlug(slug){
    const safe = encodeURIComponent(slug);
    if(currentTemaSlug()!==slug) location.hash = `#/tema/${safe}`;
  }

  /* =========================
   * Data
   * =======================*/
  async function fetchText(url){
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return res.text();
  }

  // Configure seus temas aqui (exemplos):
  // window.TEMA_MAP = { "codigo-civil": "data/codigo-civil/codigo-civil.txt", ... }
  const TEMA_MAP = window.TEMA_MAP || {};

  /* =========================
   * Toasts
   * =======================*/
  const toastsEl = $('#toasts');
  function toast(msg, type='info', ttl=3000){
    if(!toastsEl) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${msg}</span><button aria-label="Fechar">✕</button>`;
    toastsEl.appendChild(el);
    const close = ()=>{ el.remove(); };
    el.querySelector('button').onclick = close;
    setTimeout(close, ttl);
  }

  /* =========================
   * Drawer (hamburger) A11y
   * =======================*/
  const drawer      = $('#drawer');
  const drawerPanel = $('#drawer-panel');
  const drawerBg    = $('#drawerBackdrop');
  const btnMenu     = $('#btnMenu');
  const btnClose    = $('#btnCloseMenu');
  let drawerLastFocus = null;

  function openDrawer(){
    if(!drawer) return;
    drawerLastFocus = document.activeElement;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    btnMenu.setAttribute('aria-expanded','true');
    // foco inicial
    (drawerPanel.querySelector('a,button,[tabindex]')||drawerPanel).focus();
    toast('Menu aberto','info',1600);
  }
  function closeDrawer(){
    if(!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    btnMenu.setAttribute('aria-expanded','false');
    if(drawerLastFocus) drawerLastFocus.focus();
  }
  function trapFocus(e){
    if(!drawer.classList.contains('open')) return;
    const focusables = $$('a, button, input, [tabindex]:not([tabindex="-1"])', drawerPanel)
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if(focusables.length===0) return;
    const first = focusables[0];
    const last  = focusables[focusables.length-1];
    if(e.key==='Tab'){
      if(e.shiftKey && document.activeElement===first){ last.focus(); e.preventDefault(); }
      else if(!e.shiftKey && document.activeElement===last){ first.focus(); e.preventDefault(); }
    } else if(e.key==='Escape'){ closeDrawer(); }
  }

  if(btnMenu){ btnMenu.addEventListener('click', openDrawer); }
  if(btnClose){ btnClose.addEventListener('click', closeDrawer); }
  if(drawerBg){ drawerBg.addEventListener('click', closeDrawer); }
  document.addEventListener('keydown', trapFocus);

  /* =========================
   * Glossário
   * =======================*/
  let GLOSS = null; // [{ termo, def, pattern }]

  function normalize(s){
    return s.normalize('NFD').replace(/\p{Diacritic}/gu,'');
  }
  function wordBoundaryPattern(term){
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flex = `(?:${esc}(?:es|s|a|as|is|os|oes)?)`; // heurístico simples
    return new RegExp(`(?<![\u00A0\w])(${flex})(?![\w])`, 'giu');
  }
  function parseGloss(txt){
    const blocks = txt.split(/^-{5,}\s*$/m).map(s=>s.trim()).filter(Boolean);
    const items = [];
    for(const b of blocks){
      const mTerm = b.match(/^@termo:\s*(.+)$/mi);
      const mDef  = b.match(/^@def:\s*([\s\S]+)$/mi);
      if(!mTerm || !mDef) continue;
      const termo = mTerm[1].trim();
      const def = mDef[1].trim();
      items.push({ termo, def });
    }
    items.sort((a,b)=>b.termo.length - a.termo.length);
    for(const it of items){ it.pattern = wordBoundaryPattern(it.termo); }
    return items;
  }
  async function loadGlossario(){
    if(GLOSS!==null) return GLOSS;
    try{
      const txt = await fetchText('data/glossario.txt');
      GLOSS = parseGloss(txt);
    }catch(e){
      console.warn('Glossário ausente/erro:', e);
      GLOSS = [];
    }
    return GLOSS;
  }

  // Tooltip do glossário com inline style mínimo
  let tooltipEl = null;
  function hideTooltip(){ if(tooltipEl){ tooltipEl.remove(); tooltipEl=null; } }
  function showTooltip(target){
    hideTooltip();
    const term = target.getAttribute('data-term') || '';
    const def = target.getAttribute('data-def') || '';
    const rect = target.getBoundingClientRect();
    const tip = document.createElement('div');
    tip.setAttribute('role','tooltip');
    tip.innerHTML = `<div style="font-weight:700;margin-bottom:4px">${term}</div><div>${def}</div>`;
    tip.style.position='absolute'; tip.style.zIndex='9999'; tip.style.maxWidth='320px';
    tip.style.background='#111827'; tip.style.color='#f9fafb';
    tip.style.padding='10px 12px'; tip.style.borderRadius='12px';
    tip.style.boxShadow='0 8px 20px rgba(0,0,0,.15)'; tip.style.fontSize='14px'; tip.style.lineHeight='1.4';
    document.body.appendChild(tip);
    const top = window.scrollY + rect.bottom + 8;
    const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - tip.offsetWidth - 12);
    tip.style.top = `${top}px`; tip.style.left = `${left}px`;
    tooltipEl = tip;
  }
  document.addEventListener('click', (e)=>{
    const g = e.target.closest('.mj-gloss');
    if(g){ showTooltip(g); return; }
    if(!e.target.closest('[role="tooltip"]')) hideTooltip();
  });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hideTooltip(); });

  function markGlossarioInHTML(html){
    if(!GLOSS || !GLOSS.length) return html;
    // proteger <a …>…</a> e span .mj-trail
    const segments = html.split(/(<a[\s\S]*?<\/a>|<span class=(?:"|')mj-trail(?:"|')[\s\S]*?<\/span>)/gi);
    for(let i=0;i<segments.length;i++){
      const seg = segments[i];
      if(/^<a[\s\S]*<\/a>$/i.test(seg) || /^<span class=(?:"|')mj-trail(?:"|')[\s\S]*<\/span>$/i.test(seg)){ continue; }
      let replaced = seg;
      for(const it of GLOSS){
        replaced = replaced.replace(it.pattern, (m)=>{
          const safeTerm = it.termo.replace(/"/g,'&quot;');
          const safeDef  = it.def.replace(/"/g,'&quot;');
          return `<span class="mj-gloss" data-term="${safeTerm}" data-def="${safeDef}">${m}</span>`;
        });
      }
      segments[i] = replaced;
    }
    return segments.join('');
  }

  /* =========================
   * Helpers render
   * =======================*/
  function prefixAteDoisPontos(line){
    const idx = line.indexOf(':');
    if(idx>0) return line.slice(0, idx).trim();
    const m = line.match(/^(Art\.?\s*\d+[A-Z\-]*)/i);
    return m ? m[1] : line.slice(0, Math.min(60, line.length));
  }
  function buildJusBrasilURL(prefix){
    return `https://www.jusbrasil.com.br/legislacao/busca?q=${encodeURIComponent(prefix)}`;
  }

  /* =========================
   * Search mínimo: sugere slugs
   * =======================*/
  const searchEl = $('#search');
  const sugEl    = $('#suggestions');

  function updateSuggestions(q){
    if(!sugEl) return;
    sugEl.innerHTML = '';
    const v = (q||'').trim().toLowerCase();
    if(!v){ sugEl.classList.remove('show'); return; }
    const keys = Object.keys(TEMA_MAP);
    const items = keys.filter(k => k.includes(v) || k.replace(/-/g,' ').includes(v)).slice(0,8);
    if(items.length===0){ sugEl.classList.remove('show'); return; }
    items.forEach(slug=>{
      const li = document.createElement('li');
      li.className='sug-item'; li.setAttribute('role','option'); li.tabIndex=0;
      li.innerHTML = `<div class="sug-title">${slug.replace(/-/g,' ')}</div><div class="sug-sub">Abrir tema #/tema/${slug}</div>`;
      li.addEventListener('click', ()=>{ setTemaSlug(slug); sugEl.classList.remove('show'); });
      li.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ setTemaSlug(slug); sugEl.classList.remove('show'); } });
      sugEl.appendChild(li);
      const sep = document.createElement('div'); sep.className='sug-sep'; sugEl.appendChild(sep);
    });
    sugEl.classList.add('show');
  }
  if(searchEl){
    searchEl.addEventListener('input', e=> updateSuggestions(e.target.value));
    searchEl.addEventListener('focus', e=> updateSuggestions(e.target.value));
    document.addEventListener('click', e=>{ if(!e.target.closest('.search-wrap')) sugEl.classList.remove('show'); });
  }

  /* =========================
   * Páginas
   * =======================*/
  async function loadTema(slug){
    const titleEl = $('#themeTitle');
    const contentEl = $('#content');
    contentEl.textContent = 'Carregando…';

    const file = TEMA_MAP[slug];
    if(!file){ contentEl.textContent = 'Tema não encontrado.'; toast('Tema não encontrado','error'); return; }

    await loadGlossario();

    try{
      const raw = await fetchText(file);
      const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);

      const tituloTema = slug.replace(/-/g,' ');
      titleEl.textContent = tituloTema;

      const btnIA = $('#btnIA');
      if(btnIA){
        btnIA.onclick = ()=>{
          const prompt = `Estudar tema: ${tituloTema}`;
          const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(prompt)}`;
          window.open(url, '_blank', 'noopener');
        };
      }

      const html = lines.map((line)=>{
        const prefix = prefixAteDoisPontos(line);
        const href = buildJusBrasilURL(prefix);
        const safe = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const withGloss = markGlossarioInHTML(safe);
        return `<div class="item"><span class="desc">${withGloss}</span><span class="mj-trail"> <a class="mj-go" href="${href}" target="_blank" rel="noopener" aria-label="Abrir no JusBrasil">→</a></span></div>`;
      }).join('');

      contentEl.classList.add('list-plain');
      contentEl.innerHTML = `<ul class="list list-plain">${html}</ul>`;
      toast('Tema carregado','success',1500);

    }catch(e){
      console.error(e);
      toast('Erro ao carregar tema','error');
      const contentEl = $('#content');
      if(contentEl) contentEl.textContent = 'Erro ao carregar tema.';
    }
  }

  function loadSobre(){
    const titleEl = $('#themeTitle');
    const contentEl = $('#content');
    titleEl.textContent = 'Sobre';
    contentEl.innerHTML = `
      <div class="item">
        <span class="desc">Meujus — estudo guiado por temas com remissões, glossário e integrações leves.</span>
      </div>`;
  }

  async function renderByRoute(){
    const page = currentPage();
    if(page.kind==='tema'){ await loadTema(page.slug); }
    else if(page.kind==='sobre'){ loadSobre(); }
    else {
      const titleEl = $('#themeTitle');
      const contentEl = $('#content');
      titleEl.textContent = 'Escolha um tema';
      contentEl.innerHTML = `<div class="item"><span class="desc">Use o menu ☰ ou a busca para abrir um tema.</span></div>`;
    }
  }

  /* =========================
   * Boot
   * =======================*/
  window.addEventListener('hashchange', renderByRoute);
  (async function init(){
    try{
      await renderByRoute();
      toast('Pronto','info',1000);
    }catch(e){
      console.error(e);
      toast('Erro ao iniciar','error');
    }
  })();

})();
