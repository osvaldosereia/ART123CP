// meujus – app.js (2025-10-04)
// Fonte: data/temas.json -> [{ slug, title, path, tags, group? }]
// TXT: "# Título", "-- explicação", "- Artigo: texto", opcional "## Pergunte pra I.A." com "- Perguntas"
// Ajustes: sem botão Google IA; intro no card do título; artigos em segundo card;
// links dos artigos abrem Google em modo IA (udm=50); hambúrguer no HTML;
// salvar/remover tema (localStorage) e lista "Salvos" no drawer; toasts visíveis.

(function(){
  /* ===== Helpers DOM ===== */
  const $  = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  /* ===== Estado ===== */
  let TEMAS = [];                        // [{slug,title,path,tags,group?}]
  const TEMA_MAP = Object.create(null);  // slug -> path
  let GLOSS = null;                      // [{ termo, def, pattern }]

  /* ===== Router ===== */
  function getHashParts(){ return location.hash.replace(/^#\/?/, '').split('/'); }
  function currentPage(){
    const p = getHashParts();
    if(p[0]==='tema' && p[1]) return {kind:'tema', slug:decodeURIComponent(p[1])};
    if(p[0]==='sobre')        return {kind:'sobre'};
    return {kind:'home'};
  }
  function setTemaSlug(slug){
    const safe = encodeURIComponent(slug);
    if(location.hash !== `#/tema/${safe}`) location.hash = `#/tema/${safe}`;
  }

  /* ===== Fetch ===== */
  async function fetchText(url){
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return res.text();
  }
  async function fetchJSON(url){
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return res.json();
  }

  /* ===== Toasts ===== */
  const toastsEl = $('#toasts');
  function toast(msg, type='info', ttl=3000){
    if(!toastsEl) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${msg}</span><button aria-label="Fechar">✕</button>`;
    toastsEl.appendChild(el);
    const close = ()=> el.remove();
    el.querySelector('button').onclick = close;
    setTimeout(close, ttl);
  }

  /* ===== Drawer ===== */
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
    btnMenu?.setAttribute('aria-expanded','true');
    (drawerPanel.querySelector('a,button,[tabindex]')||drawerPanel).focus();
  }
  function closeDrawer(){
    if(!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    btnMenu?.setAttribute('aria-expanded','false');
    if(drawerLastFocus) drawerLastFocus.focus();
  }
  function trapFocus(e){
    if(!drawer?.classList.contains('open')) return;
    const focusables = $$('a, button, input, [tabindex]:not([tabindex="-1"])', drawerPanel)
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if(focusables.length===0) return;
    const [first,last] = [focusables[0], focusables[focusables.length-1]];
    if(e.key==='Tab'){
      if(e.shiftKey && document.activeElement===first){ last.focus(); e.preventDefault(); }
      else if(!e.shiftKey && document.activeElement===last){ first.focus(); e.preventDefault(); }
    } else if(e.key==='Escape'){ closeDrawer(); }
  }
  btnMenu?.addEventListener('click', openDrawer);
  btnClose?.addEventListener('click', closeDrawer);
  drawerBg?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', trapFocus);

  /* ===== Glossário ===== */
  function wordBoundaryPattern(term){
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flex = `(?:${esc}(?:es|s|a|as|is|os|oes)?)`;
    return new RegExp(`(?<![\\u00A0\\w])(${flex})(?![\\w])`, 'giu');
  }
  function parseGloss(txt){
    const blocks = txt.split(/^-{5,}\s*$/m).map(s=>s.trim()).filter(Boolean);
    const items = [];
    for(const b of blocks){
      const mTerm = b.match(/^@termo:\s*(.+)$/mi);
      const mDef  = b.match(/^@def:\s*([\s\S]+)$/mi);
      if(!mTerm || !mDef) continue;
      const termo = mTerm[1].trim();
      const def   = mDef[1].trim();
      items.push({ termo, def });
    }
    items.sort((a,b)=>b.termo.length - a.termo.length);
    for(const it of items){ it.pattern = wordBoundaryPattern(it.termo); }
    return items;
  }
  async function loadGlossario(){
    if(GLOSS!==null) return GLOSS;
    try{ GLOSS = parseGloss(await fetchText('data/glossario.txt')); }
    catch{ GLOSS = []; }
    return GLOSS;
  }
  let tooltipEl = null;
  function hideTooltip(){ if(tooltipEl){ tooltipEl.remove(); tooltipEl=null; } }
  function showTooltip(target){
    hideTooltip();
    const term = target.getAttribute('data-term') || '';
    const def  = target.getAttribute('data-def')  || '';
    const rect = target.getBoundingClientRect();
    const tip  = document.createElement('div');
    tip.setAttribute('role','tooltip');
    tip.innerHTML = `<div style="font-weight:700;margin-bottom:4px">${term}</div><div>${def}</div>`;
    tip.style.position='absolute'; tip.style.zIndex='9999'; tip.style.maxWidth='320px';
    tip.style.background='#111827'; tip.style.color='#f9fafb';
    tip.style.padding='10px 12px'; tip.style.borderRadius='12px';
    tip.style.boxShadow='0 8px 20px rgba(0,0,0,.15)'; tip.style.fontSize='14px'; tip.style.lineHeight='1.4';
    document.body.appendChild(tip);
    const top  = window.scrollY + rect.bottom + 8;
    const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - tip.offsetWidth - 12);
    tip.style.top  = `${top}px`;
    tip.style.left = `${left}px`;
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
    const segments = html.split(/(<a[\s\S]*?<\/a>|<span class=(?:"|')mj-trail(?:"|')[\s\S]*?<\/span>)/gi);
    for(let i=0;i<segments.length;i++){
      const seg = segments[i];
      if(/^<a[\s\S]*<\/a>$/i.test(seg) || /^<span class=(?:"|')mj-trail(?:"|')[\s\S]*<\/span>$/i.test(seg)) continue;
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

  /* ===== Persistência: Salvos ===== */
  const SAVED_KEY = 'mj_saved_v1';
  function readSaved(){ try{ return JSON.parse(localStorage.getItem(SAVED_KEY)||'[]'); }catch{ return []; } }
  function writeSaved(list){ localStorage.setItem(SAVED_KEY, JSON.stringify(list)); }
  function isSaved(slug){ return readSaved().includes(slug); }
  function toggleSaved(slug){
    const cur = new Set(readSaved());
    if(cur.has(slug)){ cur.delete(slug); writeSaved([...cur]); return false; }
    cur.add(slug); writeSaved([...cur]); return true;
  }

  /* ===== Temas + Drawer ===== */
  async function loadTemas(){
    try{
      TEMAS = await fetchJSON('data/temas.json');
      TEMAS.forEach(t => { TEMA_MAP[t.slug] = t.path; });
      hydrateMenu();
      ensureSavedSection();
      renderSavedList();
    }catch(e){
      console.error(e);
      toast('Erro ao carregar temas','error',2500);
      TEMAS = [];
    }
  }
  function hydrateMenu(){
    const ul = $('#menuList'); if(!ul) return;
    const items = [...TEMAS].sort((a,b)=>a.title.localeCompare(b.title)).slice(0,60);
    ul.innerHTML = items.map(t => `<li><a class="title" href="#/tema/${t.slug}">${t.title}</a></li>`).join('');
  }
  function ensureSavedSection(){
    const cont = $('.drawer-content', drawerPanel) || drawerPanel;
    if(!$('#savedWrap')){
      const wrap = document.createElement('div');
      wrap.id='savedWrap';
      wrap.innerHTML = `<h3 class="h2" style="margin-top:8px">Salvos</h3><ul id="savedList" class="list"></ul>`;
      cont.appendChild(wrap);
    }
  }
  function renderSavedList(){
    const ul = $('#savedList'); if(!ul) return;
    const saved = readSaved();
    if(saved.length===0){ ul.innerHTML = `<li class="item muted">Nenhum tema salvo.</li>`; return; }
    const map = new Map(TEMAS.map(t=>[t.slug,t]));
    ul.innerHTML = saved.map(slug=>{
      const t = map.get(slug); if(!t) return '';
      return `<li class="item">
        <a class="title" href="#/tema/${t.slug}">${t.title}</a>
        <button class="btn-ios" data-remove="${t.slug}" style="margin-left:8px">Remover</button>
      </li>`;
    }).join('');
    ul.querySelectorAll('button[data-remove]').forEach(b=>{
      b.onclick = ()=>{
        const s = b.getAttribute('data-remove');
        toggleSaved(s);
        renderSavedList();
        toast('Removido dos salvos','info',1600);
      };
    });
  }

  /* ===== Busca ===== */
  const searchEl = $('#search');
  const sugEl    = $('#suggestions');

  function normalizeStr(s){ return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,''); }
  function groupLabel(t){
    if(t.group) return t.group;
    const m = (t.path||'').match(/^data\/([^/]+)/i);
    const key = (m?.[1]||'').toLowerCase();
    const map = { codigocivil:'Código Civil', codigopenal:'Código Penal', cpp:'Código de Processo Penal', cf88:'Constituição Federal' };
    if(map[key]) return map[key];
    return key ? key.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : '';
  }
  function searchLocal(q){
    const v = normalizeStr((q||'').trim());
    if(!v) return [];
    const scoreStr = s => {
      const n = normalizeStr(s);
      if(n.startsWith(v)) return 3;
      if(n.includes(v))   return 1;
      return 0;
    };
    return TEMAS
      .map(t => {
        const s = Math.max(scoreStr(t.title), scoreStr(t.slug), ...(t.tags||[]).map(scoreStr));
        return s ? {t,s} : null;
      })
      .filter(Boolean)
      .sort((a,b)=>b.s-a.s || a.t.title.localeCompare(b.t.title))
      .slice(0,10)
      .map(x=>x.t);
  }
  function renderSuggestions(list){
    if(!sugEl) return;
    if(!list.length){ sugEl.classList.remove('show'); sugEl.innerHTML=''; return; }
    sugEl.innerHTML = list.map(t =>
      `<li class="sug-item" role="option" tabindex="0" data-slug="${t.slug}">
         <div class="sug-title">${t.title}</div>
         <div class="sug-sub">${groupLabel(t)}</div>
       </li><div class="sug-sep"></div>`
    ).join('');
    sugEl.classList.add('show');
    $$('.sug-item', sugEl).forEach(el=>{
      el.addEventListener('click', ()=>{ setTemaSlug(el.dataset.slug); sugEl.classList.remove('show'); });
      el.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ setTemaSlug(el.dataset.slug); sugEl.classList.remove('show'); } });
    });
  }
  let sugTimer = null;
  function updateSuggestions(q){
    clearTimeout(sugTimer);
    sugTimer = setTimeout(()=>{ renderSuggestions(searchLocal(q||'')); }, 120);
  }
  searchEl?.addEventListener('input', e=> updateSuggestions(e.target.value));
  searchEl?.addEventListener('focus', e=> updateSuggestions(e.target.value));
  document.addEventListener('click', e=>{ if(!e.target.closest('.search-wrap')) sugEl?.classList.remove('show'); });

  /* ===== Utils ===== */
  function googleAIURL(prefix){ return `https://www.google.com/search?udm=50&q=${encodeURIComponent(prefix)}`; }
  function escapeHTML(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  /* ===== Parser TXT ===== */
  function parseTemaText(raw){
    const lines = raw.split(/\r?\n/);
    let title = null;
    const intro = [];
    const items = [];
    const ask   = [];
    let section = 'body'; // body | ask

    for(const ln of lines){
      const s = ln.trim();
      if(!s) continue;

      if(s.startsWith('# ')){ title = s.slice(2).trim(); section='body'; continue; }
      if(s.startsWith('## ')){
        const h2 = s.slice(3).trim().toLowerCase();
        section = (h2.includes('pergunte') || h2.includes('ia')) ? 'ask' : 'body';
        continue;
      }
      if(s === '-----'){ section='body'; continue; }
      if(s.startsWith('-- ')){ if(section==='body') intro.push(s.slice(3).trim()); continue; }
      if(s.startsWith('- ')){ (section==='ask' ? ask : items).push(s.slice(2).trim()); continue; }
    }
    return { title, intro, items, ask };
  }

  /* ===== Páginas ===== */
  async function loadTema(slug){
    const titleEl   = $('#themeTitle');
    const contentEl = $('#content');
    const headCard  = $('.ficha-head'); // card do título
    contentEl.textContent = 'Carregando…';

    const path = TEMA_MAP[slug];
    if(!path){ contentEl.textContent = 'Tema não encontrado.'; toast('Tema não encontrado','error',2200); return; }

    await loadGlossario();

    try{
      const raw = await fetchText(path);
      const { title, intro, items, ask } = parseTemaText(raw);

      const meta = TEMAS.find(t=>t.slug===slug);
      const tituloTema = title || meta?.title || slug.replace(/-/g,' ');
      titleEl.textContent = tituloTema;

      // Botão Salvar
      let saveBtn = $('#saveBtn');
      if(!saveBtn){
        saveBtn = document.createElement('button');
        saveBtn.id = 'saveBtn';
        saveBtn.className = 'btn-ios';
        saveBtn.style.marginTop = '8px';
        headCard?.appendChild(saveBtn);
      }
      function refreshSaveBtn(){ saveBtn.textContent = isSaved(slug) ? 'Remover dos salvos' : 'Salvar'; }
      refreshSaveBtn();
      saveBtn.onclick = ()=>{
        const added = toggleSaved(slug);
        refreshSaveBtn();
        renderSavedList();
        toast(added ? 'Tema salvo' : 'Removido dos salvos', added ? 'success' : 'info', 1600);
      };

      // Intro no card do título
      let introEl = $('#introText');
      const introHTML = intro.length ? markGlossarioInHTML(escapeHTML(intro.join(' '))) : '';
      if(!introEl){
        introEl = document.createElement('p');
        introEl.id = 'introText';
        introEl.className = 'desc';
        introEl.style.marginTop = '10px';
        if(headCard) headCard.appendChild(introEl);
      }
      introEl.innerHTML = introHTML || '';

      // Artigos
      function prefixFromItem(line){
        const idx = line.indexOf(':');
        return idx>0 ? line.slice(0, idx).trim() : line;
      }
      const itensHTML = items.map(line=>{
        const safe = escapeHTML(line);
        const withGloss = markGlossarioInHTML(safe);
        const prefix = prefixFromItem(line);
        const href = googleAIURL(prefix);
        return `<li class="item">
                  <span class="desc">${withGloss}</span>
                  <span class="mj-trail"> <a class="mj-go" href="${href}" target="_blank" rel="noopener" aria-label="Abrir no Google IA">→</a></span>
                </li>`;
      }).join('');

      // Pergunte pra I.A.
      const askHTML = (ask && ask.length)
        ? `
          <h2 class="h2 pane-title" style="margin-top:10px">Pergunte pra I.A.</h2>
          <ul class="list list-plain">
            ${ask.map(q=>{
              const safe = escapeHTML(q);
              const href = googleAIURL(q);
              return `<li class="item"><span class="desc">${safe}</span><span class="mj-trail"> <a class="mj-go" href="${href}" target="_blank" rel="noopener" aria-label="Abrir no Google IA">↗</a></span></li>`;
            }).join('')}
          </ul>
        `
        : '';

      // Card de artigos + seção IA
      contentEl.classList.add('list-plain');
      contentEl.innerHTML = `
        <div class="card">
          <ul class="list list-plain">${itensHTML || `<li class="item muted">Sem artigos.</li>`}</ul>
          ${askHTML}
        </div>
      `;
      toast('Tema carregado','success',1200);

    }catch(e){
      console.error(e);
      toast('Erro ao carregar conteúdo','error',2500);
      contentEl.textContent = 'Erro ao carregar tema.';
    }
  }

  function loadSobre(){
    const titleEl   = $('#themeTitle');
    const contentEl = $('#content');
    titleEl.textContent = 'Sobre';
    $('#introText')?.remove();
    $('#saveBtn')?.remove();
    contentEl.innerHTML = `<div class="card"><div class="item"><span class="desc">Meujus — estudo guiado por temas com remissões, glossário e salvos.</span></div></div>`;
  }

  async function renderByRoute(){
    const page = currentPage();
    if(page.kind==='tema') await loadTema(page.slug);
    else if(page.kind==='sobre') loadSobre();
    else {
      const titleEl   = $('#themeTitle');
      const contentEl = $('#content');
      $('#introText')?.remove();
      $('#saveBtn')?.remove();
      titleEl.textContent = 'Escolha um tema';
      contentEl.innerHTML = `<div class="card"><div class="item"><span class="desc">Use o menu ☰ ou a busca para abrir um tema.</span></div></div>`;
    }
  }

  /* ===== Boot ===== */
  window.addEventListener('hashchange', renderByRoute);
  (async function init(){
    try{
      await loadTemas();
      await renderByRoute();
    }catch(e){
      console.error(e);
      toast('Erro ao iniciar','error',2500);
    }
  })();

})();
