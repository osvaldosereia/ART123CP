// SPA com página inicial minimalista abaixo da topbar.
// Rotas: #/ (home) • #/tema/:slug • #/sobre

(function(){
  const $  = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  let TEMAS = [];
  let activeCat = 'Todos'; // filtro de categoria nas sugestões

  const SAVED_KEY        = 'meujus:saved';
  const LAST_KEY         = 'meujus:last';
  const LAST_SEARCH_KEY  = 'meujus:lastSearch';
  const LAST_AC_KEY      = 'meujus:lastAc'; // snapshot das sugestões para chips pós-busca

  const readSaved  = () => { try{ return JSON.parse(localStorage.getItem(SAVED_KEY)||'[]'); }catch(_){ return []; } };
  const writeSaved = (list) => localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(new Set(list))));
  const isSaved    = (slug) => readSaved().includes(slug);
  const toggleSaved= (slug) => { const cur=new Set(readSaved()); cur.has(slug)?cur.delete(slug):cur.add(slug); writeSaved([...cur]); return cur.has(slug); };

  const escapeHTML = (s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const slugify = (s)=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-');

  // ===== Normalização PT-BR e plural =====
  const normPT = s => String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // remove acentos
    .replace(/ç/g,'c');

  const escRx = x => x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

  // Gera padrão que casa singular/plural comum em PT
  function pluralRegexToken(w){
    if(w.length<=2) return escRx(w);
    const stem2 = w.slice(0,-2);
    const stem1 = w.slice(0,-1);
    if(/ao$/.test(w)) return `(?:${escRx(w)}|${escRx(stem2+'oes')}|${escRx(stem2+'aes')}|${escRx(stem2+'aos')})`;
    if(/m$/.test(w))  return `(?:${escRx(w)}|${escRx(stem1+'ns')})`;
    if(/[rz]$/.test(w)) return `(?:${escRx(w)}|${escRx(w+'es')})`;
    if(/al$/.test(w)) return `(?:${escRx(w)}|${escRx(stem2+'ais')})`;
    if(/el$/.test(w)) return `(?:${escRx(w)}|${escRx(stem2+'eis')})`;
    if(/il$/.test(w)) return `(?:${escRx(w)}|${escRx(stem2+'is')})`;
    if(/ol$/.test(w)) return `(?:${escRx(w)}|${escRx(stem2+'ois')})`;
    if(/ul$/.test(w)) return `(?:${escRx(w)}|${escRx(stem2+'uis')})`;
    return `(?:${escRx(w)}s?)`; // fallback simples
  }

  function _hitPT(hayRaw, qRaw){
    const hay = normPT(hayRaw);
    const qn  = normPT(qRaw);
    if(!hay || !qn) return 0;

    let s = 0;
    if(hay===qn) s += 100;
    if(hay.includes(qn)) s += 60;

    const toks = qn.split(/\s+/).filter(Boolean);
    for(const t of toks){
      const rx = new RegExp(`(?<![a-z0-9])${pluralRegexToken(t)}(?![a-z0-9])`, 'g');
      if(rx.test(hay)) s += 10;
    }
    return s;
  }

  function currentPage(){
    const h = location.hash || '#/';
    const mTema  = h.match(/^#\/tema\/([^?#]+)/);
    const mSobre = h.match(/^#\/sobre\b/);
    const mHome  = /^#\/?$/.test(h) || /^#\/home\b/.test(h);
    if(mTema)  return { kind:'tema', slug: decodeURIComponent(mTema[1]) };
    if(mSobre) return { kind:'sobre' };
    if(mHome)  return { kind:'home' };
    return { kind:'home' };
  }

  const toastsEl = $('#toasts');
  function toast(msg, type='info', ttl=2200){
    if(!toastsEl) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${escapeHTML(msg)}</span>`;
    toastsEl.appendChild(el);
    setTimeout(()=>el.classList.add('show'), 20);
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(), 350); }, ttl);
  }

  async function fetchText(path){
    const url = (path||'').replace(/^\.?\//,'');
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok){ console.error('Fetch falhou:', url, res.status); toast(`Erro ao carregar ${url}`, 'error', 3000); throw new Error(`HTTP ${res.status}`); }
    return res.text();
  }

  function splitThemesByDelim(raw){
    const txt = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g,'\n').trim();
    return txt.split(/^\s*-{3,}\s*$/m).map(s=>s.trim()).filter(Boolean);
  }

  function parseTemaFromChunk(chunk){
    const fixed = chunk.replace(/^\s*##\s+##\s+/mg, '## ');
    const mTitle = fixed.match(/^\s*#\s+(.+)$/m);
    if(!mTitle) return null;
    const title = mTitle[1].trim();
    const slug  = slugify(title);

    // introdução: linhas que começam com "-- "
    const intro = Array.from(fixed.matchAll(/^\s*--\s+(.+)$/mg)).map(m=>m[1].trim());

    // dividir por headings de 2+ "##"
    const secs = []; const rx=/^\s*#{2,}\s+(.+?)\s*$/mg; let m;
    while((m=rx.exec(fixed))){const name=m[1].trim();const start=rx.lastIndex;const prev=secs.at(-1);if(prev)prev.end=m.index;secs.push({name,start,end:fixed.length});}

    // perguntas e referências (se existirem no TXT)
    let ask=[]; let refs=[];
    for(const s of secs){
      const nm=normalizeHeading(s.name);
      const body=fixed.slice(s.start,s.end);
      if(isQA(nm)){
        ask=ask.concat(Array.from(body.matchAll(/^\s*-\s+(.+?)\s*$/mg)).map(x=>x[1].trim()));
      }else if(/^(referencias?|refer\u00eancias?)\s+do\s+tema\b/.test(nm)){
        refs=refs.concat(Array.from(body.matchAll(/^\s*---\s+(.+?)\s*$/mg)).map(x=>x[1].trim()));
      }
    }
    return { slug, title, intro, ask, refs };
  }
  const normalizeHeading=(h)=> (h||'').toLowerCase().replace(/[.#:]/g,' ').replace(/\s+/g,' ')
                      .normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const isQA=(nm)=> /\bpergunte\s+pra\s+i\s*\.?\s*a\b/.test(nm) || (/estude\s+com\s+o\s+google/.test(nm) && /\bi\s*\.?\s*a\b/.test(nm));

  // ===== Destaque de palavras (>=4 letras)
  function _buildHighlightRegex(q){
    const parts = String(q||'')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 4 && /[\p{L}]/u.test(w) && !/^\d+$/.test(w))
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    if(!parts.length) return null;
    try{
      return new RegExp(`(?<!\\p{L})(` + parts.join('|') + `)(?!\\p{L})`, 'uig');
    }catch(_){
      return new RegExp(`(^|[^\\p{L}])(` + parts.join('|') + `)(?!\\p{L})`, 'uig');
    }
  }
  function highlightHTML(escapedHtml, q){
    const rx = _buildHighlightRegex(q);
    if(!rx) return escapedHtml;
    if(rx.source.startsWith('(^|')){
      return escapedHtml.replace(rx, (m,prefix,word)=> (prefix||'') + '<mark>'+word+'</mark>');
    }
    return escapedHtml.replace(rx, '<mark>$1</mark>');
  }
  function highlightTitle(title, q){
    const esc = String(title).replace(/</g,'&lt;');
    const rx = _buildHighlightRegex(q);
    if(!rx) return esc;
    if(rx.source.startsWith('(^|')){
      return esc.replace(rx, (m,prefix,word)=> (prefix||'') + '<mark>'+word+'</mark>');
    }
    return esc.replace(rx, '<mark>$1</mark>');
  }

  /* ===== Chips pós-busca: helpers ===== */
  function getLastAc(){
    try{ return JSON.parse(sessionStorage.getItem(LAST_AC_KEY)||'null'); }catch(_){ return null; }
  }
  let __popEl = null;
  function closeAcDropdown(){
    if(__popEl){ __popEl.remove(); __popEl=null; }
    document.removeEventListener('click', onDocClickClose, true);
    window.removeEventListener('hashchange', closeAcDropdown, {once:true});
  }
  function onDocClickClose(e){
    if(__popEl && !__popEl.contains(e.target)) closeAcDropdown();
  }
  function openAcDropdown(anchorBtn, cat, data){
    closeAcDropdown();
    const list = (cat && cat!=='Todos')
      ? data.items.filter(it => (it.group||'Geral')===cat)
      : data.items.slice();

    if(!list.length) return;

    __popEl = document.createElement('ul');
    __popEl.className = 'suggestions pop';
    __popEl.setAttribute('role','listbox');
    __popEl.innerHTML = list.slice(0,12).map(it=>`
      <li role="option">
        <a href="#/tema/${it.slug}">
          <div class="s1">${escapeHTML(it.title)}</div>
          <div class="s2">${escapeHTML(it.group||'')}</div>
        </a>
      </li>`).join('');

    document.body.appendChild(__popEl);

    const r = anchorBtn.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const padX = 8;
    const left = Math.min(Math.max(r.left, padX), vw - padX - 320);
    __popEl.style.left = left + 'px';
    __popEl.style.top  = (r.bottom + window.scrollY + 6) + 'px';
    __popEl.style.width = Math.min(640, vw - padX*2) + 'px';
    __popEl.style.maxHeight = '70vh';
    __popEl.style.overflowY = 'auto';
    __popEl.style.overscrollBehavior = 'contain';

    setTimeout(()=>{
      document.addEventListener('click', onDocClickClose, true);
      window.addEventListener('hashchange', closeAcDropdown, {once:true});
    }, 0);
  }
  function renderPostSearchChips(){
    const host  = document.getElementById('postAc');
    const track = document.getElementById('postAcTrack');
    if(!host || !track) return;

    const data = getLastAc();
    if(!data || !data.items?.length){
      host?.classList?.add('hidden');
      host?.setAttribute?.('aria-hidden','true');
      return;
    }

    track.innerHTML = '';
    for(const cat of data.categories||[]){
      const btn = document.createElement('button');
      btn.type='button';
      btn.className='ac-chip';
      btn.textContent=cat;
      btn.dataset.cat = cat;
      btn.addEventListener('click', (ev)=> openAcDropdown(ev.currentTarget, cat, data));
      track.appendChild(btn);
    }

    document.getElementById('postAcPrev')?.addEventListener('click', ()=> track.scrollBy({left:-track.clientWidth*0.8, behavior:'smooth'}));
    document.getElementById('postAcNext')?.addEventListener('click', ()=> track.scrollBy({left:+track.clientWidth*0.8, behavior:'smooth'}));

    host.classList.remove('hidden');
    host.setAttribute('aria-hidden','false');
  }

  /* ===== Busca (autocomplete) ===== */
  const input  = document.querySelector('#search');
  const acList = document.querySelector('#suggestions');
  if (acList) acList.hidden = true;

  function scoreFields(q, t){
    const sT = _hitPT(t.titleN, q);
    const sI = _hitPT(t.introN, q);
    const sP = _hitPT(t.askN,   q);
    return { score: 1.0*sT + 0.5*sI + 0.8*sP, flags: { t: sT>0, i: sI>0, p: sP>0 } };
  }

  input?.addEventListener('input', e=>{
    const q=(e.target.value||'').trim();
    if(q.length<2 || !TEMAS.length){ acList.innerHTML=''; acList.hidden=true; closeAcDropdown(); return; }

    // ranqueia amplo; depois filtramos por categoria
    let arr = TEMAS.map(t=>({ t, ...scoreFields(q,t) }))
      .filter(x=>x.score>0)
      .sort((a,b)=> b.score-a.score || a.t.title.localeCompare(b.t.title,'pt-BR'))
      .slice(0,40);

    if(!arr.length){ acList.innerHTML=''; acList.hidden=true; closeAcDropdown(); return; }

    // contagem por categoria das sugestões atuais
    const counts = new Map();
    for(const x of arr){ const g=x.t.group||'Geral'; counts.set(g,(counts.get(g)||0)+1); }
    const catList = [...counts.keys()].sort((a,b)=> a.localeCompare(b,'pt-BR'));

    // aplica filtro ativo
    if(activeCat && activeCat!=='Todos'){
      const filtered = arr.filter(x => (x.t.group||'Geral')===activeCat);
      arr = filtered.length ? filtered : arr;
    }

    // snapshot para chips pós-busca
    const lastAc = {
      q,
      categories: ['Todos', ...catList],
      items: arr.slice(0, 20).map(x => ({
        slug: x.t.slug,
        title: x.t.title,
        group: x.t.group || 'Geral'
      }))
    };
    try{ sessionStorage.setItem(LAST_AC_KEY, JSON.stringify(lastAc)); }catch(_){}

    // chips
    const chipsHTML = `
      <div class="ac-chips" role="group" aria-label="Filtrar sugestões por categoria">
        <button type="button" class="ac-chip" data-cat="Todos" aria-pressed="${activeCat==='Todos'}">Todos</button>
        ${catList.map(cat=>`
          <button type="button" class="ac-chip" data-cat="${cat.replace(/"/g,'&quot;')}"
            aria-pressed="${activeCat===cat}">${cat}</button>`).join('')}
      </div>`;

    // lista final
    const listHTML = arr.slice(0,8).map(x=>{
      const {t, flags} = x;
      const titleHTML = highlightTitle(t.title, q);
      const badges = [
        flags.t?'<span class="badge t">T</span>':'',
        flags.i?'<span class="badge i">I</span>':'',
        flags.p?'<span class="badge p">P</span>':'',
      ].join('');
      return `
        <li role="option">
          <a href="#/tema/${t.slug}" data-q="${escapeHTML(q)}" data-flags="${['t','i','p'].filter(k=>flags[k]).join('')}">
            <div class="s1">${titleHTML}<span class="badges">${badges}</span></div>
            <div class="s2">${(t.group||'').replace(/</g,'&lt;')}</div>
          </a>
        </li>`;
    }).join('');

    acList.innerHTML = chipsHTML + listHTML;
    acList.hidden=false;

    // listeners dos chips
    acList.querySelectorAll('.ac-chip').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        activeCat = btn.getAttribute('data-cat')||'Todos';
        input.dispatchEvent(new Event('input', {bubbles:false}));
      });
    });
  });

  input?.addEventListener('keydown', ev=>{
    if(ev.key==='Enter'){
      const a = acList?.querySelector('a');
      if(a){
        const q = a.getAttribute('data-q')||'';
        const flags = a.getAttribute('data-flags')||'';
        try{ sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({q, flags})); }catch(_){}
        location.hash = a.getAttribute('href');
        acList.hidden = true;
      }
    }
  });

  acList?.addEventListener('click', ev=>{
    const a = ev.target.closest('a'); if(!a) return;
    const q = a.getAttribute('data-q')||'';
    const flags = a.getAttribute('data-flags')||'';
    try{ sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({q, flags})); }catch(_){}
    acList.hidden = true;
  });

  window.addEventListener('hashchange', ()=>{ if(acList) acList.hidden = true; closeAcDropdown(); });

  /* ===== Seeds ===== */
  async function readAllSeeds(){
    const seeds = $$('#menuList a.title[data-auto="1"][data-path]');
    const temas = [];
    for (const a of seeds){
      const group = (a.dataset.group||'').trim() || 'Geral';
      const path  = (a.dataset.path||'').trim();
      if(!path) continue;
      try{
        const raw    = await fetchText(path);
        const chunks = splitThemesByDelim(raw);
        const parsed = chunks.map(parseTemaFromChunk).filter(Boolean);
        for (const t of parsed){
          const slug  = `${slugify(group)}-${t.slug}`;
          const intro = (t.intro||[]).join(' ');
          const ask   = (t.ask||[]).join(' ');
          temas.push({
            slug, title: t.title, path, tags: [], group, frag: t.slug,
            refs: t.refs||[],
            titleL: (t.title||'').toLowerCase(),
            introL: intro.toLowerCase(),
            askL:   ask.toLowerCase(),
            blob:   (t.title + ' ' + intro + ' ' + ask).toLowerCase(),
            // normalizados para busca PT
            titleN: normPT(t.title),
            introN: normPT(intro),
            askN:   normPT(ask)
          });
        }
      }catch(e){
        console.error('Seed falhou', path, e);
        toast(`Erro ao ler ${path}`, 'error', 2800);
      }
    }
    return temas;
  }

  /* ===== Helpers: drawer e categorias ===== */
  function openDrawer(){
    const d = document.getElementById('drawer');
    if(d && !d.classList.contains('open')){
      const btn = document.getElementById('btnMenu');
      btn?.click();
    }
  }
  function expandSectionByLabel(label){
    const btns = $$('.drawer .cat-btn');
    const btn = btns.find(b => (b.textContent||'').trim().startsWith(label));
    if(!btn) return;
    const li = btn.parentElement;
    const ul = li?.querySelector('.sublist');
    btn.setAttribute('aria-expanded','true');
    if(ul) ul.hidden=false;
  }
  function expandSaved(){ expandSectionByLabel('Salvos'); }
  function expandCategory(name){ expandSectionByLabel(name); }

  /* ===== Menu lateral ===== */
  function renderMenu(){
    const menu=$('#menuList'); if(!menu) return;
    menu.innerHTML='';

    // 1) Sobre
    const liSobre=document.createElement('li');
    const btnSobre=document.createElement('button');
    btnSobre.className='cat-btn'; btnSobre.type='button';
    btnSobre.innerHTML=`<span>Sobre</span><span class="caret">▸</span>`;
    btnSobre.addEventListener('click', ()=> window.__openSobre?.());
    liSobre.appendChild(btnSobre);
    menu.appendChild(liSobre);

    // 2) Salvos
    const saved=readSaved();
    const liSaved=document.createElement('li'); liSaved.className='item';
    const btnSaved=document.createElement('button');
    btnSaved.className='cat-btn'; btnSaved.setAttribute('aria-expanded','false');
    btnSaved.innerHTML=`<span>Salvos</span><span class="caret">▸</span>`;
    const ulSaved=document.createElement('ul'); ulSaved.className='sublist'; ulSaved.hidden=true;

    if(saved.length){
      const map=new Map(TEMAS.map(t=>[t.slug,t]));
      ulSaved.innerHTML = saved
        .map(slug=>{
          const t=map.get(slug); if(!t) return '';
          return `<li>
            <a class="title" href="#/tema/${t.slug}">${escapeHTML(t.title)}</a>
            <button class="mini" data-remove="${t.slug}">Remover</button>
          </li>`;
        }).join('');
    }else{
      ulSaved.innerHTML = `<li><a class="title" href="#/sobre">Nenhum tema salvo</a></li>`;
    }

    btnSaved.addEventListener('click',()=>{
      const open=btnSaved.getAttribute('aria-expanded')==='true';
      btnSaved.setAttribute('aria-expanded', String(!open));
      ulSaved.hidden = open;
    });
    liSaved.appendChild(btnSaved); liSaved.appendChild(ulSaved); menu.appendChild(liSaved);

    // remover salvo inline
    ulSaved.querySelectorAll('button[data-remove]')?.forEach(b=>{
      b.addEventListener('click',(ev)=>{
        ev.preventDefault();
        const slug=b.getAttribute('data-remove');
        const now=toggleSaved(slug);
        toast(now?'Salvo adicionado':'Removido dos salvos', now?'success':'info', 1400);
        renderMenu();
      });
    });

    // 3) divisor
    const div=document.createElement('div'); div.className='divider'; menu.appendChild(div);

    // 4) título
    const title=document.createElement('div'); title.className='menu-title'; title.textContent='Categorias'; menu.appendChild(title);

    // 5) categorias
    const byCat=new Map();
    for(const t of TEMAS){
      const key=t.group||'Geral';
      if(!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(t);
    }
    const cats=[...byCat.keys()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    for(const cat of cats){
      const temas=byCat.get(cat).slice().sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
      const li=document.createElement('li'); li.className='item';
      const btn=document.createElement('button');
      btn.className='cat-btn'; btn.setAttribute('aria-expanded','false');
      btn.innerHTML=`<span>${escapeHTML(cat)}</span><span class="caret">▸</span>`;
      const ul=document.createElement('ul'); ul.className='sublist'; ul.hidden=true;
      ul.innerHTML=temas.map(t=>`<li><a class="title" href="#/tema/${t.slug}" data-path="${t.path}" data-frag="${t.frag}" data-title="${escapeHTML(t.title)}">${escapeHTML(t.title)}</a></li>`).join('');
      btn.addEventListener('click',()=>{
        const open=btn.getAttribute('aria-expanded')==='true';
        btn.setAttribute('aria-expanded', String(!open));
        ul.hidden = open;
      });
      li.appendChild(btn); li.appendChild(ul); menu.appendChild(li);
    }
  }

  /* ===== Home ===== */
  function renderHome(){
    const actionsEl=$('#actions'); const titleEl=$('#themeTitle'); const contentEl=$('#content');
    actionsEl.innerHTML='';
    titleEl.textContent='Estudo jurídico direto ao ponto';
    const lastSlug = localStorage.getItem(LAST_KEY)||'';
    const saved = readSaved();
    const bySlug = new Map(TEMAS.map(t=>[t.slug,t]));
    const last = bySlug.get(lastSlug);

    const discover = TEMAS.slice().sort((a,b)=>a.title.localeCompare(b.title,'pt-BR')).slice(0,6);

    contentEl.innerHTML = `
      <section class="home-hero">
        <p class="home-sub">Busque temas, salve e treine.</p>
      </section>

      ${ last ? `
      <section class="card home-card" id="home-continue">
        <div>
          <div class="t">${escapeHTML(last.title)}</div>
          <div class="s">${escapeHTML(last.group||'')}</div>
        </div>
        <div class="home-actions">
          <a class="btn-ios is-small" data-go="#/tema/${last.slug}" data-variant="primary">Retomar</a>
        </div>
      </section>` : '' }

      <section class="card">
        <h3 class="ubox-sub">Meus salvos</h3>
        <ul class="home-list" id="home-saved">
          ${
            saved.length
            ? saved.slice(0,4).map(sl=>{
                const t=bySlug.get(sl); if(!t) return '';
                return `<li class="home-item">
                  <a class="tt" href="#/tema/${t.slug}">${escapeHTML(t.title)}</a>
                  <span class="gg">${escapeHTML(t.group||'')}</span>
                  <span class="act"><button class="mini" data-remove="${t.slug}">Remover</button></span>
                </li>`;
              }).join('')
            : `<li class="home-item"><span class="gg">Você ainda não salvou temas.</span></li>`
          }
        </ul>
        <div class="home-actions">
          <button class="btn-ios is-small" id="btnSavedAll">Ver todos</button>
        </div>
      </section>

      <section class="card">
        <h3 class="ubox-sub">Categorias essenciais</h3>
        <div class="chips">
          <button class="chip" data-cat="Direito Civil">Civil</button>
          <button class="chip" data-cat="Direito Penal">Penal</button>
          <button class="chip" data-cat="Processo Civil">Proc. Civil</button>
          <button class="chip" data-cat="Direito Constitucional">Constitucional</button>
        </div>
        <div class="home-actions">
          <button class="btn-ios is-small" id="btnMoreCats">Mais categorias</button>
        </div>
      </section>

      <section class="card">
        <h3 class="ubox-sub">Descobrir temas</h3>
        <div class="grid-mini">
          ${discover.map(t=>`
            <div class="home-item">
              <a class="tt" href="#/tema/${t.slug}">${escapeHTML(t.title)}</a>
              <span class="gg">${escapeHTML(t.group||'')}</span>
              <span class="act">
                <a class="mini"
                   href="https://www.google.com/search?udm=50&q=${encodeURIComponent('Explique o tema de forma rápida e objetiva utilizando apenas informações vindas de sites jurídicos. Ao final apresente as fontes. Tema: ' + t.title)}"
                   target="_blank" rel="noopener">Explicação Rápida</a>
                <a class="mini"
                   href="https://www.google.com/search?udm=50&q=${encodeURIComponent('Crie 10 questões objetivas de múltipla escolha sobre o tema, com 4 alternativas cada (A–D), apenas com base em fontes jurídicas confiáveis. No final, forneça o gabarito com justificativas curtas e cite as fontes. Tema: ' + t.title)}"
                   target="_blank" rel="noopener">10 Questões</a>
              </span>
            </div>`).join('')}
        </div>
      </section>
    `;

    contentEl.querySelectorAll('[data-go]').forEach(a=>{
      a.addEventListener('click', (e)=>{ e.preventDefault(); location.hash = a.getAttribute('data-go')||'#/'; });
    });
    contentEl.querySelectorAll('#home-saved .mini[data-remove]').forEach(b=>{
      b.addEventListener('click', (e)=>{
        e.preventDefault();
        const slug=b.getAttribute('data-remove');
        const now=toggleSaved(slug);
        toast(now?'Salvo adicionado':'Removido dos salvos', now?'success':'info', 1400);
        renderHome(); renderMenu();
      });
    });
    $('#btnSavedAll')?.addEventListener('click', ()=>{ openDrawer(); expandSaved(); });
    $('#btnMoreCats')?.addEventListener('click', ()=>{ openDrawer(); });
    contentEl.querySelectorAll('.chip[data-cat]')?.forEach(c=>{
      c.addEventListener('click', ()=>{
        const name=c.getAttribute('data-cat'); openDrawer(); expandCategory(name);
      });
    });
  }

  /* ===== Páginas ===== */
  async function loadTemas(){
    TEMAS = await readAllSeeds();
    renderMenu();
  }

  async function loadTema(slug){
    const titleEl=$('#themeTitle'); const contentEl=$('#content'); const actionsEl=$('#actions');
    contentEl.textContent='Carregando…';
    const meta=TEMAS.find(t=>t.slug===slug); const path=meta?.path; const frag=meta?.frag;
    if(!path){ contentEl.textContent='Tema não encontrado.'; toast('Tema não encontrado','error'); return; }

    try{
      const raw=await fetchText(path);
      const chunks=splitThemesByDelim(raw);
      const parsed=chunks.map(parseTemaFromChunk).filter(Boolean);
      const pick = frag ? parsed.find(t=>t.slug===frag)
                        : (parsed.find(t=>`${slugify(meta.group)}-${t.slug}`===slug) || parsed[0]);
      if(!pick){ contentEl.innerHTML=`<div class="card"><div class="item muted">Tema não encontrado no TXT.</div></div>`; return; }

      const pageTitle=meta.title || pick.title;
      titleEl.textContent=pageTitle;

      try{ localStorage.setItem(LAST_KEY, slug); }catch(_){}

      let lastSearch = null;
      try{ lastSearch = JSON.parse(sessionStorage.getItem(LAST_SEARCH_KEY)||'null'); }catch(_){}
      const shouldHighlight = !!(lastSearch && /[ip]/.test(lastSearch.flags||''));

      actionsEl.innerHTML='';
      const mkBtn=(txt,variant,fn)=>{ const b=document.createElement('button'); b.className='btn-ios is-small'; if(variant) b.setAttribute('data-variant',variant); b.textContent=txt; b.onclick=fn; return b; };
      const saved=isSaved(slug);
      const saveBtn=mkBtn(saved?'Remover':'Salvar', saved?'secondary':'primary', ()=>{
        const added=toggleSaved(slug);
        saveBtn.textContent=added?'Remover':'Salvar';
        saveBtn.setAttribute('data-variant', added?'secondary':'primary');
        renderMenu();
        toast(added?'Tema salvo':'Removido dos salvos', added?'success':'info', 1400);
      });
      const studyBtn=mkBtn('Explicação Rápida','', ()=>window.open(
        `https://www.google.com/search?udm=50&q=${encodeURIComponent('Explique o tema de forma rápida e objetiva para estudantes de direito, seja organizado e didático, utilizando apenas informações vindas de sites jurídicos. Ao final apresente as fontes. Tema: ' + pageTitle)}`,
        '_blank','noopener'
      ));
      const trainBtn=mkBtn('10 Questões','', ()=>window.open(
        `https://www.google.com/search?udm=50&q=${encodeURIComponent('Crie 10 questões objetivas de múltipla escolha sobre o tema, com 4 alternativas cada (A–D), inspiradas em bancas como Cebraspe, Cespe e UFG. No final, forneça o gabarito com justificativas curtas e cite as fontes. Tema: ' + pageTitle)}`,
        '_blank','noopener'
      ));
      actionsEl.append(saveBtn, studyBtn, trainBtn);

      // montar chips pós-busca abaixo da topbar (requer #postAc no HTML)
      renderPostSearchChips();

      // ===== Introdução em até 2 parágrafos =====
      const introParas = (pick.intro || []).slice(0,2).map(txt => escapeHTML(txt));
      const introHTMLParas = shouldHighlight && lastSearch?.q
        ? introParas.map(p => highlightHTML(p, lastSearch.q))
        : introParas.slice();
      const introHTML = introHTMLParas.map(p => `<p class="ubox-intro" style="margin:0 0 .75rem 0">${p}</p>`).join('');

      // ===== Referências do Tema (lidas do TXT: linhas que começam com '--- ')
      const refs = (pick.refs || []).filter(Boolean);
      const refListHTML = refs.map(ref => {
        const prompt = `Localize o texto ORIGINAL em sites oficiais do governo (Planalto, STF, STJ, DOU, CNJ). Traga o link oficial primeiro. Referência: ${ref}`;
        const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(prompt)}`;
        return `<li><a href="${url}" target="_blank" rel="noopener">${escapeHTML(ref)}</a></li>`;
      }).join('');

      // ===== Perguntas (mantidas, com destaque quando houver) =====
      const qList=(pick.ask||[]).map(q=>{
        const qEsc = escapeHTML(q);
        const qHi  = shouldHighlight && lastSearch?.q ? highlightHTML(qEsc, lastSearch.q) : qEsc;
        return `<li><a href="https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}" target="_blank" rel="noopener">${qHi}</a></li>`;
      }).join('');

      // ===== Render com separadores discretos =====
      const sep = `<hr style="border:none;border-top:1px solid #e9ecef;margin:16px 0">`;

      $('#content').innerHTML=`
        <article class="card ubox" role="article">
          ${introHTML}
          ${introHTML && refs.length ? sep : ''}
          ${refs.length ? `
            <section class="ubox-section">
              <h3 class="ubox-sub">Referências do Tema</h3>
              <ul class="ref-list">
                ${refListHTML}
              </ul>
            </section>` : ''
          }
          ${sep}
          <section class="ubox-section">
            <h3 class="ubox-sub">Estude com o Google I.A.</h3>
            ${qList ? `<ol class="q-list">${qList}</ol>` : `<p class="muted">Sem perguntas cadastradas.</p>`}
          </section>
        </article>`;

      try{ sessionStorage.removeItem(LAST_SEARCH_KEY); }catch(_){}

    }catch(e){
      console.error(e);
      contentEl.innerHTML=`<div class="card"><div class="item error">Erro ao carregar o tema.</div></div>`;
    }
  }

  function loadSobre(){
    $('#actions').innerHTML='';
    $('#themeTitle').textContent='Sobre';
    $('#content').innerHTML=`<div class="card ubox"><h2 class="ubox-title">Sobre o projeto</h2><p class="ubox-intro">TXT único por categoria, temas separados por <code>-----</code>, busca local e links no Google I.A.</p></div>`;
  }

  async function renderByRoute(){
    const page=currentPage();
    if(!TEMAS.length) await loadTemas();
    if(page.kind==='tema') await loadTema(page.slug);
    else if(page.kind==='sobre') loadSobre();
    else renderHome();
  }

  // Fechar dropdown pop ao focar o campo de busca
  document.querySelector('#search')?.addEventListener('focus', closeAcDropdown);

  window.addEventListener('hashchange', renderByRoute);
  (async function init(){ await renderByRoute(); })();
})();
