// meujus – app.js (indexação garantida + feedback + fetch simples)

(function(){
  const $  = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  let TEMAS = [];
  let GLOSS = null;

  /* ---------- Persistência ---------- */
  const SAVED_KEY = 'meujus:saved';
  const readSaved  = () => { try{ return JSON.parse(localStorage.getItem(SAVED_KEY)||'[]'); }catch(_){ return []; } };
  const writeSaved = (list) => localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(new Set(list))));
  const isSaved    = (slug) => readSaved().includes(slug);
  const toggleSaved= (slug) => { const cur=new Set(readSaved()); cur.has(slug)?cur.delete(slug):cur.add(slug); writeSaved([...cur]); return cur.has(slug); };

  /* ---------- Util ---------- */
  const escapeHTML = (s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const slugify = (s)=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-');

  function currentPage(){
    const h = location.hash || '';
    const mTema  = h.match(/^#\/tema\/([^?#]+)/);
    const mSobre = h.match(/^#\/sobre\b/);
    if(mTema)  return { kind:'tema', slug: decodeURIComponent(mTema[1]) };
    if(mSobre) return { kind:'sobre' };
    return { kind:'home' };
  }

  /* ---------- Toast ---------- */
  const toastsEl = $('#toasts');
  function toast(msg, type='info', ttl=2600){
    if(!toastsEl) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${escapeHTML(msg)}</span>`;
    toastsEl.appendChild(el);
    setTimeout(()=>el.classList.add('show'), 20);
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(), 350); }, ttl);
  }

  /* ---------- Fetch relativo simples ---------- */
  async function fetchText(path){
    const url = (path||'').replace(/^\.?\//,''); // relativo à raiz do site
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok){ console.error('Fetch falhou:', url, res.status); toast(`Erro ao carregar ${url}`, 'error', 3200); throw new Error(`HTTP ${res.status}`); }
    return res.text();
  }

  /* ---------- Parser do TXT ---------- */
  function splitThemesByDelim(raw){
    const txt = raw.replace(/^\uFEFF/, '') // BOM
                   .replace(/\r\n?/g,'\n').trim();
    return txt.split(/^\s*-{3,}\s*$/m).map(s=>s.trim()).filter(Boolean);
  }

  function parseTemaFromChunk(chunk){
    const fixed = chunk.replace(/^\s*##\s+##\s+/mg, '## ');
    const mTitle = fixed.match(/^\s*#\s+(.+)$/m);
    if(!mTitle) return null;

    const title = mTitle[1].trim();
    const slug  = slugify(title);
    const intro = Array.from(fixed.matchAll(/^\s*--\s+(.+)$/mg)).map(m=>m[1].trim());

    // seções
    const secs = [];
    const rx = /^\s*#{2,}\s+(.+?)\s*$/mg;
    let m; while((m = rx.exec(fixed))){ const name=m[1].trim(); const start=rx.lastIndex; const prev=secs.at(-1); if(prev) prev.end=m.index; secs.push({name,start,end:fixed.length}); }

    // coleta perguntas
    let ask=[];
    for(const s of secs){
      const name = normalizeHeading(s.name);
      if(isQASection(name)){
        const body = fixed.slice(s.start, s.end);
        const items = Array.from(body.matchAll(/^\s*-\s+(.+?)\s*$/mg)).map(x=>x[1].trim());
        ask = ask.concat(items);
      }
    }
    return { slug, title, intro, ask };
  }

  function normalizeHeading(h){
    return (h||'').toLowerCase().replace(/[.#:]/g,' ').replace(/\s+/g,' ')
             .normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  }
  function isQASection(nameNorm){
    if(/\bpergunte\s+pra\s+i\s*\.?\s*a\b/.test(nameNorm)) return true;
    return /estude\s+com\s+o\s+google/.test(nameNorm) && /\bi\s*\.?\s*a\b/.test(nameNorm);
  }

  /* ---------- Glossário opcional ---------- */
  let GLOSS_PATTERNS=[];
  async function loadGlossario(){
    if(GLOSS!==null) return;
    try{
      const raw = await fetchText('data/glossario.txt');
      const blocks = splitThemesByDelim(raw);
      GLOSS = blocks.map(b=>{
        const t = b.match(/^\s*@termo:\s*(.+)$/m)?.[1]?.trim();
        const d = b.match(/^\s*@def:\s*(.+)$/m)?.[1]?.trim();
        if(!t||!d) return null;
        return { termo:t, def:d };
      }).filter(Boolean);
      GLOSS_PATTERNS = GLOSS.map(g=>({ re: new RegExp(`\\b${g.termo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i'), def:g.def }));
    }catch{ GLOSS=[]; GLOSS_PATTERNS=[]; }
  }
  function markGlossarioInHTML(html){
    if(!GLOSS_PATTERNS.length) return html;
    let out = html;
    for(const g of GLOSS_PATTERNS){
      out = out.replace(g.re, m=>`<abbr title="${escapeHTML(g.def)}">${escapeHTML(m)}</abbr>`);
    }
    return out;
  }

  /* ---------- Busca (autocomplete) ---------- */
  const input = $('#search');
  const acList = $('#suggestions');
  if(acList) acList.hidden = true;

  input?.addEventListener('input', onSearchInput);
  input?.addEventListener('keydown', onSearchKey);
  acList?.addEventListener('click', onSuggestionClick);

  function onSearchInput(e){
    const q = (e.target.value||'').trim().toLowerCase();
    if(!q || !TEMAS.length){ acList.innerHTML=''; acList.hidden=true; return; }
    const arr = TEMAS.map(t=>({ slug:t.slug, title:t.title, group:t.group||'', score: score(q,t) }))
                     .filter(a=>a.score>0).sort((a,b)=>b.score-a.score).slice(0,8);
    if(!arr.length){ acList.innerHTML=''; acList.hidden=true; return; }
    acList.innerHTML = arr.map(a => `
      <li role="option">
        <a href="#/tema/${a.slug}">
          <div class="s1">${escapeHTML(a.title)}</div>
          <div class="s2">${escapeHTML(a.group||'')}</div>
        </a>
      </li>`).join('');
    acList.hidden=false;
  }
  function score(q,t){ const s1 = hit((t.title||'').toLowerCase(), q); const s2 = hit((t.tags||[]).join(' ').toLowerCase(), q); return s1+s2; }
  function hit(hay,q){ if(!hay) return 0; if(hay===q) return 100; if(hay.includes(q)) return 60; return q.split(/\s+/).reduce((s,w)=>s+(hay.includes(w)?10:0),0); }
  function onSearchKey(ev){ if(ev.key==='Enter'){ const a = acList?.querySelector('a'); if(a){ location.hash = a.getAttribute('href'); acList.hidden=true; } } }
  function onSuggestionClick(ev){ const a = ev.target.closest('a'); if(!a) return; acList.hidden=true; }

  /* ---------- Indexação a partir do menu (seeds) ---------- */
  async function buildTemasFromSeeds(){
    const seed = $('#menuList a.title[data-auto="1"][data-path]');
    if(!seed) return [];

    const group = (seed.dataset.group||'').trim() || 'Geral';
    const path  = (seed.dataset.path||'').trim();
    if(!path){ toast('data-path ausente no item do menu','error'); return []; }

    let parsed=[];
    try{
      const raw    = await fetchText(path);
      const chunks = splitThemesByDelim(raw);
      parsed = chunks.map(parseTemaFromChunk).filter(Boolean);
      if(!parsed.length) throw new Error('TXT sem temas');
    }catch(e){
      console.error('Indexação falhou:', path, e);
      toast(`Falha ao ler ${path}`, 'error', 3600);
      return [];
    }

    // injeta itens abaixo do seed
    const li = seed.closest('li'); const ul = li.parentElement;
    const header = document.createElement('li'); header.className='item muted'; header.textContent=group;
    ul.insertBefore(header, li);

    const frag = document.createDocumentFragment();
    for(const t of parsed){
      const slug = `${slugify(group)}-${t.slug}`;
      const liItem = document.createElement('li');
      liItem.innerHTML = `<a class="title" href="#/tema/${slug}" data-path="${path}" data-frag="${t.slug}" data-title="${escapeHTML(t.title)}">${escapeHTML(t.title)}</a>`;
      frag.appendChild(liItem);
    }
    ul.insertBefore(frag, li);
    li.remove();

    // monta TEMAS
    const temas = parsed.map(t=>({ slug: `${slugify(group)}-${t.slug}`, title: t.title, path, tags: [], group, frag: t.slug }));
    console.log('Indexados:', temas.length, temas);
    toast(`${temas.length} temas carregados`, 'info', 1800);
    return temas;
  }

  function collectTemasFromMenu(){
    const links = Array.from(document.querySelectorAll('#menuList a.title[data-path]'));
    return links.map(a=>{
      const href = a.getAttribute('href')||'';
      const m = href.match(/#\/tema\/([^?#]+)/);
      const slug = m ? decodeURIComponent(m[1]) : slugify(a.textContent||'');
      const title= (a.dataset.title||a.textContent||'').trim();
      const path = (a.dataset.path||'').trim();
      const frag = (a.dataset.frag||'').trim();
      const group= (a.dataset.group||'').trim();
      return { slug, title, path, tags:[], group, frag };
    }).filter(x=>x.slug && x.path);
  }

  /* ---------- Páginas ---------- */
  async function loadTemas(){
    const hasSeed = !!$('#menuList a.title[data-auto="1"][data-path]');
    TEMAS = hasSeed ? await buildTemasFromSeeds() : collectTemasFromMenu();
    if(!TEMAS.length) console.warn('Nenhum tema indexado. Verifique data-path e TXT.');
  }

  async function loadTema(slug){
    const titleEl   = $('#themeTitle');
    const contentEl = $('#content');
    const actionsEl = $('#actions');
    contentEl.textContent = 'Carregando…';

    const meta = TEMAS.find(t=>t.slug===slug);
    const path = meta?.path; const frag = meta?.frag;
    if(!path){ contentEl.textContent='Tema não encontrado.'; toast('Tema não encontrado','error'); return; }

    await loadGlossario();

    try{
      const raw    = await fetchText(path);
      const chunks = splitThemesByDelim(raw);
      const parsed = chunks.map(parseTemaFromChunk).filter(Boolean);
      const pick   = frag ? parsed.find(t=>t.slug===frag) : (parsed.find(t=>`${slugify(meta.group)}-${t.slug}`===slug) || parsed[0]);
      if(!pick){ contentEl.innerHTML = `<div class="card"><div class="item muted">Tema não encontrado no TXT.</div></div>`; return; }

      const pageTitle = meta.title || pick.title;
      titleEl.textContent = pageTitle;

      // Ações
      actionsEl.innerHTML = '';
      const mkBtn = (txt, variant, fn)=>{ const b=document.createElement('button'); b.className='btn-ios is-small'; if(variant) b.setAttribute('data-variant',variant); b.textContent=txt; b.onclick=fn; return b; };
      const saved = isSaved(slug);
      const saveBtn = mkBtn(saved?'Remover':'Salvar', saved?'secondary':'primary', ()=>{
        const added = toggleSaved(slug);
        saveBtn.textContent = added?'Remover':'Salvar';
        saveBtn.setAttribute('data-variant', added?'secondary':'primary');
        toast(added?'Tema salvo':'Removido dos salvos', added?'success':'info', 1400);
      });
      const studyBtn = mkBtn('Estudar','', ()=>window.open(`https://www.google.com/search?udm=50&q=${encodeURIComponent(pageTitle)}`,'_blank','noopener'));
      const trainBtn = mkBtn('Treinar','', ()=>window.open(`https://www.google.com/search?udm=50&q=${encodeURIComponent(pageTitle+' questões objetivas')}`,'_blank','noopener'));
      actionsEl.append(saveBtn, studyBtn, trainBtn);

      // Conteúdo
      const introHTML = pick.intro.length ? markGlossarioInHTML(escapeHTML(pick.intro.join(' '))) : '';
      const qList = (pick.ask||[]).map(q=>`<li><a href="https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}" target="_blank" rel="noopener">${escapeHTML(q)}</a></li>`).join('');

      contentEl.innerHTML = `
        <article class="card ubox" role="article">
          ${introHTML ? `<p class="ubox-intro">${introHTML}</p>` : ''}
          <section class="ubox-section">
            <h3 class="ubox-sub">Estude com o Google I.A.</h3>
            ${qList ? `<ol class="q-list">${qList}</ol>` : `<p class="muted">Sem perguntas cadastradas.</p>`}
          </section>
        </article>`;
    }catch(e){
      console.error(e);
      contentEl.innerHTML = `<div class="card"><div class="item error">Erro ao carregar o tema.</div></div>`;
    }
  }

  function loadSobre(){
    $('#actions').innerHTML='';
    $('#themeTitle').textContent='Sobre';
    $('#content').innerHTML=`<div class="card ubox"><h2 class="ubox-title">Sobre o projeto</h2><p class="ubox-intro">TXT único por categoria, temas separados por <code>-----</code>.</p></div>`;
  }

  async function renderByRoute(){
    const page = currentPage();
    if(!TEMAS.length) await loadTemas();
    if(page.kind==='tema') await loadTema(page.slug);
    else if(page.kind==='sobre') loadSobre();
    else{
      $('#actions').innerHTML='';
      $('#themeTitle').textContent='Escolha um tema';
      $('#content').innerHTML=`<div class="card"><div class="item muted">Use o menu ☰ ou a busca.</div></div>`;
    }
  }

  window.addEventListener('hashchange', renderByRoute);
  (async function init(){ await renderByRoute(); })();

})();
