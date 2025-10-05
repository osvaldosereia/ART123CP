// meujus – app.js (2025-10-04)
// Manifesto via MENU (semente por categoria). Sem temas.json.
// 1 TXT por categoria com N temas separados por "-----".
// Cada tema renderiza em um único box: Título • Intro • Estude com o Google I.A.

(function(){
  /* ===== Helpers DOM ===== */
  const $  = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  /* ===== Estado ===== */
  let TEMAS = [];                        // [{slug,title,path,tags,group?,frag?}]
  const TEMA_MAP = Object.create(null);  // slug -> path
  let GLOSS = null;                      // [{ termo, def, pattern }]

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
  function normalizeSlug(s){
    return (s||'').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-');
  }
  function slugify(s){ // para slug global <categoria>-<tema>
    return (s||'').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-');
  }
  async function fetchText(url){
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return res.text();
  }

  /* ===== Separação em TEMAS por '-----' ===== */
  function splitThemesByDelim(raw){
    const txt = raw.replace(/\r\n?/g,'\n').trim();
    return txt.split(/\n-{5,}\n/g).map(s=>s.trim()).filter(Boolean);
  }

  /* ===== Parser de um tema ===== */
  function parseTemaFromChunk(chunk){
    const titleMatch = chunk.match(/^\s*#\s+(.+)$/m);
    if(!titleMatch) return null;

    const title = titleMatch[1].trim();
    const slug  = normalizeSlug(title);
    const intro = Array.from(chunk.matchAll(/^\s*--\s+(.+)$/mg)).map(m=>m[1].trim());

    // Seções iniciadas por "##", tolera "## ##"
    const secRx = /^\s*##+\s+(.+?)\s*$/mg;
    const secs = [];
    let m;
    while((m = secRx.exec(chunk)) !== null){
      const name  = m[1].trim();
      const start = m.index + m[0].length;
      const prev  = secs[secs.length-1];
      if(prev) prev.end = m.index;
      secs.push({ name, start, end: chunk.length });
    }

    let ask = [];
    for(const s of secs){
      const body = chunk.slice(s.start, s.end);
      const list = Array.from(body.matchAll(/^\s*-\s+(.+)$/mg)).map(x=>x[1].trim());
      if(/estude\s+com\s+o\s+google.*i\.a\./i.test(s.name)) ask = ask.concat(list);
    }

    return { slug, title, intro, ask };
  }

  /* ===== Glossário opcional ===== */
  async function loadGlossario(){
    if(GLOSS!==null) return;
    try{
      const raw = await fetchText('data/glossario.txt');
      const blocks = raw.replace(/\r\n?/g,'\n').split(/\n-{5,}\n/).map(s=>s.trim()).filter(Boolean);
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

  /* ===== Indexação automática a partir de SEMENTES =====
     <a class="title" data-auto="1" data-group="Direito Civil" data-path="data/direitocivil/civil.txt">
  */
  async function buildTemasFromSeeds(){
    const seedLinks = Array.from(document.querySelectorAll('#menuList a.title[data-auto="1"][data-path]'));
    const temas = [];
    for (const a of seedLinks){
      const group = (a.dataset.group||'').trim() || 'Geral';
      const path  = (a.dataset.path||'').trim();
      if(!path) continue;

      try{
        const raw    = await fetchText(path);
        const chunks = splitThemesByDelim(raw);
        const parsed = chunks.map(parseTemaFromChunk).filter(Boolean); // {slug,title,intro,ask}

        // Inserir visualmente no menu
        injectGroupAndItemsIntoMenu(a, group, path, parsed);

        // Alimentar TEMAS
        for (const t of parsed){
          const frag = t.slug;                       // slug interno do tema
          const slug = `${slugify(group)}-${frag}`;  // slug global da rota
          temas.push({ slug, title: t.title, path, tags: [], group, frag });
        }
      }catch(e){
        console.error('Falha ao indexar', path, e);
      }
    }
    return temas;
  }

  function injectGroupAndItemsIntoMenu(seedA, group, path, parsed){
    const li = seedA.closest('li'); if(!li) return;
    const ul = li.parentElement;

    const header = document.createElement('li');
    header.className = 'item muted';
    header.textContent = group;
    ul.insertBefore(header, li);

    const fragList = document.createDocumentFragment();
    for (const t of parsed){
      const slug = `${slugify(group)}-${t.slug}`;
      const liItem = document.createElement('li');
      liItem.innerHTML = `<a class="title"
          href="#/tema/${slug}"
          data-path="${path}"
          data-frag="${t.slug}"
          data-title="${escapeHTML(t.title)}">${escapeHTML(t.title)}</a>`;
      fragList.appendChild(liItem);
    }
    ul.insertBefore(fragList, li);
    li.remove(); // remove a semente
  }

  /* ===== Fallback: coletar temas já listados no HTML ===== */
  function collectTemasFromMenu(){
    const links = Array.from(document.querySelectorAll('#menuList a.title[data-path]'));
    const out = [];
    for(const a of links){
      const href = a.getAttribute('href') || '';
      const m = href.match(/#\/tema\/([^?#]+)/);
      const slug = m ? decodeURIComponent(m[1]) : (a.dataset.slug || (a.textContent||'').trim().toLowerCase().replace(/\s+/g,'-'));
      const title = (a.dataset.title || a.textContent || '').trim();
      const path  = (a.dataset.path || '').trim();
      const tags  = (a.dataset.tags||'').split(',').map(s=>s.trim()).filter(Boolean);
      const frag  = (a.dataset.frag||'').trim();
      const group = a.dataset.group || inferGroupFromPath(path) || inferGroupFromSlug(slug);
      if(!slug || !path) continue;
      out.push({ slug, title: title || slug, path, tags, group, frag });
    }
    return out;
  }
  function inferGroupFromPath(p){
    const m = (p||'').match(/^data\/([^/]+)/i);
    const key = (m?.[1]||'').toLowerCase();
    if(!key) return '';
    return key.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }
  function inferGroupFromSlug(slug){
    const key = (slug||'').toLowerCase();
    if(key.includes('penal') && key.includes('process')) return 'Código de Processo Penal';
    if(key.includes('penal')) return 'Código Penal';
    if(key.includes('civil')) return 'Direito Civil';
    return '';
  }

  /* ===== Carregar TEMAS ===== */
  async function loadTemas(){
    try{
      // prioridade: sementes automáticas
      const hasSeeds = document.querySelector('#menuList a.title[data-auto="1"]');
      if(hasSeeds){
        TEMAS = await buildTemasFromSeeds();
      }else{
        // fallback: usa os itens já listados
        TEMAS = collectTemasFromMenu();
      }

      for(const k in TEMA_MAP) delete TEMA_MAP[k];
      TEMAS.forEach(t => { TEMA_MAP[t.slug] = t.path; });

      ensureSavedSection();
      renderSavedList();
    }catch(e){
      console.error(e);
      toast('Erro ao carregar temas','error',2500);
      TEMAS = [];
    }
  }

  function ensureSavedSection(){
    const drawerPanel = $('#drawer-panel');
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

  /* ===== Páginas ===== */
  async function loadTema(slug){
    const titleEl   = $('#themeTitle');
    const contentEl = $('#content');
    const headCard  = $('.ficha-head');
    contentEl.textContent = 'Carregando…';

    const meta = TEMAS.find(t=>t.slug===slug);
    const path = meta?.path;
    const frag = meta?.frag;

    if(!path){ contentEl.textContent='Tema não encontrado.'; toast('Tema não encontrado','error',2200); return; }

    await loadGlossario();

    try{
      const raw    = await fetchText(path);
      const chunks = splitThemesByDelim(raw);
      const parsed = chunks.map(parseTemaFromChunk).filter(Boolean);

      const pick = frag ? parsed.find(t=>t.slug===frag)
                        : (parsed.find(t=>t.slug===slug) || parsed[0]);
      if(!pick){
        contentEl.innerHTML = `<div class="card"><div class="item muted">Tema não encontrado dentro do arquivo.</div></div>`;
        return;
      }

      titleEl.textContent = meta?.title || pick.title;

      // Botão Salvar
      let saveBtn = $('#saveBtn');
      if(!saveBtn){
        saveBtn = document.createElement('button');
        saveBtn.id = 'saveBtn';
        saveBtn.className = 'btn-ios';
        saveBtn.type = 'button';
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

      // Intro
      const introHTML = pick.intro.length ? markGlossarioInHTML(escapeHTML(pick.intro.join(' '))) : '';

      // Perguntas -> Google modo IA
      const qList = (pick.ask||[]).map((q)=>{
        const href = `https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}`;
        return `<li><a href="${href}" target="_blank" rel="noopener">${escapeHTML(q)}</a></li>`;
      }).join('');

      // Box único
      contentEl.innerHTML = `
        <article class="card ubox" role="article">
          <header class="ubox-header">
            <h2 class="ubox-title">${escapeHTML(meta?.title || pick.title)}</h2>
          </header>
          ${introHTML ? `<p class="ubox-intro">${introHTML}</p>` : ''}
          <section class="ubox-section">
            <h3 class="ubox-sub">Estude com o Google I.A.</h3>
            ${qList ? `<ol class="q-list">${qList}</ol>` : `<p class="muted">Sem perguntas cadastradas.</p>`}
          </section>
        </article>
      `;
    }catch(e){
      console.error(e);
      contentEl.innerHTML = `<div class="card"><div class="item error">Erro ao carregar o tema.</div></div>`;
    }
  }

  function loadSobre(){
    const titleEl   = $('#themeTitle');
    const contentEl = $('#content');
    $('#saveBtn')?.remove();
    titleEl.textContent = 'Sobre';
    contentEl.innerHTML = `
      <div class="card ubox">
        <h2 class="ubox-title">Sobre o projeto</h2>
        <p class="ubox-intro">TXT único por categoria, vários temas separados por <code>-----</code>, busca local e links em modo Google I.A.</p>
      </div>
    `;
  }

  async function renderByRoute(){
    const page = currentPage();
    if(page.kind==='tema') await loadTema(page.slug);
    else if(page.kind==='sobre') loadSobre();
    else {
      const titleEl   = $('#themeTitle');
      const contentEl = $('#content');
      $('#saveBtn')?.remove();
      titleEl.textContent = 'Escolha um tema';
      contentEl.innerHTML = `<div class="card"><div class="item"><span class="muted">Use o menu ☰ ou a busca.</span></div></div>`;
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
