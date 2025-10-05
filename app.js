// meujus – app.js (2025-10-04)
// Fonte: data/temas.json -> [{ slug, title, path, tags, group? }]
// TXT: "# Título", "-- explicação", "-----", "## Artigos Relaci...os" + "- itens", "-----", "## Pergunte pra I.A." + "- perguntas"
// UI: intro no card do título; artigos em card próprio com subt... links dos artigos e perguntas abrem Google em modo IA (udm=50);
// salvar/remover tema (localStorage) e lista "Salvos" no drawer; toasts; drawer acessível; autocomplete com grupo.

(function(){
  /* ===== Helpers DOM ===== */
  const $  = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  /* ===== Estado ===== */
  let TEMAS = [];                        // [{slug,title,path,tags,group?}]
  const TEMA_MAP = Object.create(null);  // slug -> path
  let GLOSS = null;                      // [{ termo, def, pattern }]

  /* ===== Drawer ===== */
  const drawer    = $('#drawer');
  const drawerBtn = $('#drawerBtn');
  const drawerPanel = $('#drawer-panel');
  drawerBtn?.addEventListener('click', ()=>{
    const open = drawer?.getAttribute('data-open') === '1';
    drawer?.setAttribute('data-open', open ? '0' : '1');
    drawerBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  /* ===== Persistência (Salvos) ===== */
  const SAVED_KEY = 'meujus:saved';
  function readSaved(){
    try{ return JSON.parse(localStorage.getItem(SAVED_KEY)||'[]'); }catch(_){ return []; }
  }
  function writeSaved(list){
    localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(new Set(list))));
  }
  function isSaved(slug){ return readSaved().includes(slug); }
  function toggleSaved(slug){
    const cur = new Set(readSaved());
    if(cur.has(slug)) cur.delete(slug); else cur.add(slug);
    writeSaved([...cur]);
    return cur.has(slug);
  }

  /* ===== Roteamento ===== */
  function currentPage(){
    const h = location.hash || '';
    const mTema  = h.match(/^#\/tema\/([^?#]+)/);
    const mSobre = h.match(/^#\/sobre\b/);
    if(mTema)  return { kind:'tema', slug: decodeURIComponent(mTema[1]) };
    if(mSobre) return { kind:'sobre' };
    return { kind:'home' };
  }

  /* ===== Util ===== */
  function escapeHTML(s){
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  function splitBlocks(raw){
    const lines = raw.replace(/\r\n?/g,'\n').split('\n');
    const blocks = [];
    let cur = [];
    for(const ln of lines){
      if(ln.trim()==='-----'){
        if(cur.length){ blocks.push(cur.join('\n').trim()); cur=[]; }
      }else cur.push(ln);
    }
    if(cur.length) blocks.push(cur.join('\n').trim());
    return blocks;
  }
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
    el.innerHTML = `<span>${msg}</span>`;
    toastsEl.appendChild(el);
    setTimeout(()=>{ el.classList.add('show'); }, 30);
    setTimeout(()=>{
      el.classList.remove('show');
      setTimeout(()=> el.remove(), 400);
    }, ttl);
  }

  /* ===== Autocomplete ===== */
  const input = $('#search');
  const acList = $('#suggestions');
  input?.addEventListener('input', onSearchInput);
  input?.addEventListener('keydown', onSearchKey);
  acList?.addEventListener('click', onSuggestionClick);

  function onSearchInput(e){
    const q = (e.target.value||'').trim().toLowerCase();
    if(!q){ acList.innerHTML=''; acList.hidden=true; return; }
    const all = TEMAS.map(t=>({
      slug:t.slug, title:t.title, group:t.group||'',
      score: scoreTitle(q, t.title) + scoreTags(q, t.tags||[])
    }));
    const top = all.filter(a=>a.score>0).sort((a,b)=>b.score-a.score).slice(0,8);
    if(top.length===0){ acList.innerHTML=''; acList.hidden=true; return; }
    acList.innerHTML = top.map(item => `
      <li role="option">
        <a href="#/tema/${item.slug}">
          <div class="s1">${escapeHTML(item.title)}</div>
          <div class="s2">${escapeHTML(item.group||'')}</div>
        </a>
      </li>
    `).join('');
    acList.hidden=false;
  }
  function onSearchKey(ev){
    if(ev.key==='Enter'){
      const q = (input.value||'').trim().toLowerCase();
      if(!q) return;
      const best = TEMAS
        .map(t=>({t, s: scoreTitle(q,t.title)+scoreTags(q,t.tags||[])}))
        .sort((a,b)=>b.s-a.s)[0];
      if(best && best.s>0) location.hash = `#/tema/${best.t.slug}`;
      acList.hidden=true;
    }
  }
  function onSuggestionClick(ev){
    const a = ev.target.closest('a'); if(!a) return;
    acList.hidden=true;
  }
  function scoreTitle(q, title){
    const t = (title||'').toLowerCase();
    if(t===q) return 100;
    if(t.includes(q)) return 60;
    const words = q.split(/\s+/).filter(Boolean);
    let s=0; for(const w of words){ if(t.includes(w)) s+=10; }
    return s;
  }
  function scoreTags(q, tags){
    const t = (tags||[]).map(s=>s.toLowerCase()).join(' ');
    if(!t) return 0;
    let s=0; if(t.includes(q)) s+=20;
    return s;
  }

  /* ===== GLOSSÁRIO (opcional) ===== */
  async function loadGlossario(){
    if(GLOSS!==null) return;
    try{
      const raw = await fetchText('data/glossario.txt');
      const blocks = splitBlocks(raw);
      GLOSS = blocks.map(b=>{
        const m1 = b.match(/^\s*@termo:\s*(.+)$/m);
        const m2 = b.match(/^\s*@def:\s*(.+)$/m);
        if(!m1||!m2) return null;
        const termo = m1[1].trim();
        const def   = m2[1].trim();
        const pattern = new RegExp(`\\b${escapeRegex(termo)}\\b`,'i');
        return { termo, def, pattern };
      }).filter(Boolean);
    }catch(_){
      GLOSS = [];
    }
  }
  function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
  function markGlossarioInHTML(html){
    if(!Array.isArray(GLOSS) || GLOSS.length===0) return html;
    let out = html;
    for(const g of GLOSS){
      out = out.replace(g.pattern, m => `<abbr title="${escapeHTML(g.def)}">${escapeHTML(m)}</abbr>`);
    }
    return out;
  }

  /* ===== Parser de TXT do tema ===== */
  function parseTemaText(raw){
    const blocks = splitBlocks(raw);
    // Espera:
    // [0]: "# Título" + "-- intro (opcional)"
    // [1..N]: listas ou seções subsequentes
    let title = 'Tema';
    let intro = [];
    let items = [];
    let itemsTitle = 'Artigos e materiais';
    let ask = [];

    if(blocks.length>0){
      const head = blocks[0];
      const t = head.match(/^#\s*(.+)$/m);
      if(t) title = t[1].trim();
      intro = Array.from(head.matchAll(/^\s*--\s+(.+)$/mg)).map(m=>m[1].trim());
    }
    for(let i=1;i<blocks.length;i++){
      const b = blocks[i];
      if(/^##\s*Pergunte pra I\.A\./mi.test(b)){
        ask = Array.from(b.matchAll(/^\s*-\s+(.+)$/mg)).map(m=>m[1].trim());
      }else if(/^##\s*Artigos Relaci.*$/mi.test(b)){
        itemsTitle = (b.match(/^##\s*(.+)$/m)||[])[1] || itemsTitle;
        const list = Array.from(b.matchAll(/^\s*-\s+(.+)$/mg)).map(m=>m[1].trim());
        items = items.concat(list);
      }else{
        // bloco genérico vira itens também
        const list = Array.from(b.matchAll(/^\s*-\s+(.+)$/mg)).map(m=>m[1].trim());
        if(list.length) items = items.concat(list);
      }
    }
    return { title, intro, items, ask, itemsTitle };
  }

  /* ===== Render ===== */
  async function loadTema(slug){
    const titleEl   = $('#themeTitle');
    const contentEl = $('#content');
    const headCard  = $('.ficha-head');
    contentEl.textContent = 'Carregando…';

    const path = TEMA_MAP[slug];
    if(!path){ contentEl.textContent = 'Tema não encontrado.'; toast('Tema não encontrado','error',2200); return; }

    await loadGlossario();

    try{
      const raw = await fetchText(path);
      const { title, intro, items, ask, itemsTitle } = parseTemaText(raw);

      const meta = TEMAS.find(t=>t.slug===slug);
      // Título
      titleEl.textContent = meta?.title || title || slug;

      // Botão Salvar
      let saveBtn = $('#saveBtn');
      if(!saveBtn){
        saveBtn = document.createElement('button');
        saveBtn.id = 'saveBtn';
        saveBtn.className = 'btn-ios';
        saveBtn.type = 'button';
        saveBtn.setAttribute('aria-live','polite');
        headCard?.appendChild(saveBtn);
      }
      function refreshSaveBtn(){
        const saved = isSaved(slug);
        saveBtn.textContent = saved ? 'Remover dos salvos' : 'Salvar tema';
        saveBtn.setAttribute('data-variant', saved ? 'secondary' : 'primary');
      }
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
        introEl.className = 'muted';
        headCard?.appendChild(introEl);
      }
      introEl.innerHTML = introHTML;

      // Conteúdo
      const htmlItems = items.map(renderItem).join('');
      const htmlAsk   = ask.length ? renderAsk(ask) : '';
      const titleBlock = itemsTitle ? `<h3 class="h2">${escapeHTML(itemsTitle)}</h3>` : '';
      contentEl.innerHTML = `
        <div class="card">
          ${titleBlock}
          <div class="list">${htmlItems || '<div class="item muted">Sem itens.</div>'}</div>
        </div>
        ${htmlAsk}
      `;
    }catch(e){
      console.error(e);
      contentEl.innerHTML = `<div class="card"><div class="item error">Erro ao carregar o tema.</div></div>`;
    }
  }

  function renderItem(txt){
    // Transforma um "- Artigo: texto" em link IA (udm=50)
    const query = encodeURIComponent(txt);
    const href  = `https://www.google.com/search?udm=50&q=${query}`;
    return `<div class="item"><a class="title" href="${href}" target="_blank" rel="noopener">${escapeHTML(txt)}</a></div>`;
  }
  function renderAsk(list){
    const lis = list.map(q=>{
      const href = `https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}`;
      return `<li><a href="${href}" target="_blank" rel="noopener">${escapeHTML(q)}</a></li>`;
    }).join('');
    return `
      <div class="card">
        <h3 class="h2">Pergunte pra I.A.</h3>
        <ul class="list">${lis}</ul>
      </div>
    `;
  }

  function loadSobre(){
    const titleEl   = $('#themeTitle');
    const contentEl = $('#content');
    $('#introText')?.remove();
    $('#saveBtn')?.remove();
    titleEl.textContent = 'Sobre';
    contentEl.innerHTML = `
      <div class="card"><div class="item">
        <p>Projeto de estudo jurídico com arquivos TXT simples, busca local e links para modo IA.</p>
      </div></div>
    `;
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
      contentEl.innerHTML = `<div class="card"><div class="item"><span class="muted">Use o menu ☰ ou a busca para abrir um tema.</span></div></div>`;
    }
  }

  /* ===== Temas via MENU (sem temas.json) ===== */
  function collectTemasFromMenu(){
    const links = Array.from(document.querySelectorAll('#menuList a.title'));
    const out = [];
    for(const a of links){
      const href = a.getAttribute('href') || '';
      const m = href.match(/#\/tema\/([^?#]+)/);
      const slug = m ? decodeURIComponent(m[1]) : (a.dataset.slug || (a.textContent||'').trim().toLowerCase().replace(/\s+/g,'-'));
      const title = (a.dataset.title || a.textContent || '').trim();
      const path  = (a.dataset.path || guessPathFromSlug(slug)).trim();
      const tags  = (a.dataset.tags||'').split(',').map(s=>s.trim()).filter(Boolean);
      const group = inferGroupFromPath(path) || inferGroupFromSlug(slug);
      if(!slug || !path) continue;
      out.push({ slug, title: title || slug, path, tags, group });
    }
    return out;
  }
  function guessPathFromSlug(slug){
    if(!slug) return '';
    // Padrão: data/<slug>.txt
    return `data/${slug}.txt`;
  }
  function inferGroupFromPath(p){
    const m = (p||'').match(/^data\/([^/]+)/i);
    const key = (m?.[1]||'').toLowerCase();
    const map = { 'codigo-civil':'Código Civil', 'codigo-penal':'Código Penal', 'codigo-processo-penal':'Código de Processo Penal', 'cpp':'Código de Processo Penal', 'cf88':'Constituição Federal' };
    if(map[key]) return map[key];
    return key ? key.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : '';
  }
  function inferGroupFromSlug(slug){
    const key = (slug||'').toLowerCase();
    if(key.includes('penal') && key.includes('process')) return 'Código de Processo Penal';
    if(key.includes('penal')) return 'Código Penal';
    if(key.includes('civil')) return 'Código Civil';
    return '';
  }

  async function loadTemas(){
    try{
      TEMAS = collectTemasFromMenu();
      // reset TEMA_MAP
      for(const k in TEMA_MAP) delete TEMA_MAP[k];
      TEMAS.forEach(t => { TEMA_MAP[t.slug] = t.path; });
      // não re-renderiza o menu; ele já é a fonte de verdade
      ensureSavedSection();
      renderSavedList();
    }catch(e){
      console.error(e);
      toast('Erro ao carregar temas','error',2500);
      TEMAS = [];
    }
  }
  function hydrateMenu(){
    /* Sem efeito: o menu no HTML é a fonte de verdade. */
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
        <a class="title" href="#/tema/${t.slug}">${escapeHTML(t.title)}</a>
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

  /* ===== Boot ===== */
  window.addEventListener('hashchange', renderByRoute);
  (async function init(){
    try{
      $('#btnIA')?.remove(); // garante remoção do botão legado, se existir no HTML
      await loadTemas();
      await renderByRoute();
    }catch(e){
      console.error(e);
      toast('Erro ao iniciar','error',2500);
    }
  })();

})();
