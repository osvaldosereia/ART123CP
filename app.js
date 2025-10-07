// SPA com página inicial minimalista abaixo da topbar.
// Rotas: #/ (home) • #/tema/:slug • #/sobre
// TXT por card (formato antigo que você usa):
// # Título
// # Dispositivos Legais
// - item
// -- comentário
// # Remissões Normativas
// - item
// -- comentário
// -----                (fim do card)

(function(){
  const $  = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  let TEMAS = [];
  let activeCat = 'Todos';

  const SAVED_KEY        = 'meujus:saved';
  const LAST_KEY         = 'meujus:last';
  const LAST_SEARCH_KEY  = 'meujus:lastSearch';
  const LAST_AC_KEY      = 'meujus:lastAc';

  const readSaved  = () => { try{ return JSON.parse(localStorage.getItem(SAVED_KEY)||'[]'); }catch(_){ return []; } };
  const writeSaved = (list) => localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(new Set(list))));
  const isSaved    = (slug) => readSaved().includes(slug);
  const toggleSaved= (slug) => { const cur=new Set(readSaved()); cur.has(slug)?cur.delete(slug):cur.add(slug); writeSaved([...cur]); return cur.has(slug); };

  const escapeHTML = (s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const slugify = (s)=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-');

  // ===== Normalização e busca =====
  const normPT = s => String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/ç/g,'c');

  const escRx = x => x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

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
    return `(?:${escRx(w)}s?)`;
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

  // ==== Split dos cards: aceita '-----' e também 3+ hífens ====
  function splitThemesByDelim(raw){
    const txt = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g,'\n').trim();
    return txt.split(/^\s*-{3,}\s*$/m).map(s=>s.trim()).filter(Boolean);
  }

  const normalizeHeading=(h)=> (h||'')
    .toLowerCase()
    .replace(/\(.*?\)/g,'')
    .replace(/[.#:]/g,' ')
    .replace(/\s+/g,' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .trim();

  // ===== IA Prompts: recebem (title, fullText) =====
  const IA_PROMPTS = {
    resumo:    (t,full) => `Resuma de forma didática e objetiva o tema a seguir, explicando seus principais conceitos jurídicos e fundamentos legais.\n\nTEMA: ${t}\n\nCONTEÚDO:\n${full}`,
    detalhada: (t,full) => `Explique detalhadamente e transcreva o texto original dos dispositivos e remissões abaixo, analisando conteúdo, finalidade e aplicação prática.\n\nTEMA: ${t}\n\nCONTEÚDO:\n${full}`,
    perguntas: (t,full) => `Crie 10 perguntas abertas de aprofundamento teórico sobre o tema a seguir, com base em fontes jurídicas confiáveis.\n\nTEMA: ${t}\n\nCONTEÚDO:\n${full}`,
    questoes:  (t,full) => `Crie 10 questões objetivas com 4 alternativas (A–D), no estilo OAB/Cebraspe, com gabarito e justificativas.\n\nTEMA: ${t}\n\nCONTEÚDO:\n${full}`,
    casos:     (t,full) => `Crie 3 casos concretos práticos com solução fundamentada.\n\nTEMA: ${t}\n\nCONTEÚDO:\n${full}`,
    videos:    (t,full) => `Liste e descreva brevemente 5 vídeos do YouTube relevantes e recentes sobre o tema.\n\nTEMA: ${t}\n\nCONTEÚDO:\n${full}`,
    artigos:   (t,full) => `Liste e descreva brevemente 5 artigos jurídicos recentes sobre o tema em Migalhas, ConJur ou Jusbrasil.\n\nTEMA: ${t}\n\nCONTEÚDO:\n${full}`,
  };
  const googleIA = (prompt) => `https://www.google.com/search?udm=50&q=${encodeURIComponent(prompt)}`;

  // ===== Parser para o TXT antigo (sem '----' dentro das seções) =====
  function parseTemaFromChunk(chunk){
    const fixed = chunk.replace(/^\s*##\s+##\s+/mg, '## ');
    const mTitle = fixed.match(/^\s*#\s+(.+?)\s*$/m);
    if(!mTitle) return null;

    const title = mTitle[1].trim();
    const slug  = slugify(title);

    // Localiza headings e limites das seções
    const rxHead = /^\s*#\s+(.+?)\s*$/mg;
    const sections = [];
    let m;
    while ((m = rxHead.exec(fixed))) {
      const name = m[1].trim();
      const nm = normalizeHeading(name);
      const start = rxHead.lastIndex; // após a linha do heading
      const prev = sections.at(-1);
      if (prev) prev.end = m.index;   // termina na posição do próximo heading
      sections.push({ raw:name, nm, start, end: fixed.length });
    }

    const secD = sections.find(s => /^dispositivos\s+legais\b/.test(s.nm));
    const secR = sections.find(s => /^remissoes\s+normativas\b/.test(s.nm));

    // Lista: aceita indentação, ignora linhas vazias, para em novo heading ou '-----'
    function parseList(sec){
      if(!sec) return [];
      const body = fixed.slice(sec.start, sec.end);
      const lines = body.split('\n');
      const out = [];
      let last = null;
      for(const rawLine of lines){
        const L = rawLine.replace(/\r/g,'').trimEnd(); // preserva possíveis espaços iniciais
        if(!L.trim()) continue;

        if (/^\s*#\s+/.test(L)) break;     // novo heading encontrado
        if (/^\s*-{5}\s*$/.test(L)) break; // fim do card
        if (/^\s*-{4}\s*$/.test(L)) continue; // divisor antigo entre seções, se aparecer

        if (/^\s*--\s+/.test(L)){          // comentário com indent opcional
          const c = L.replace(/^\s*--+\s*/, '').trim();
          if(last) last.comentario = c;
          continue;
        }
        if (/^\s*-\s+/.test(L)){           // item com indent opcional
          const texto = L.replace(/^\s*-+\s*/, '').trim();
          last = { texto, comentario:null };
          out.push(last);
          continue;
        }
        // Linha solta: ignore para manter compatibilidade estrita do formato antigo
      }
      return out;
    }

    const dispositivos = parseList(secD);
    const remissoes    = parseList(secR);

    // Links por item
    const mkLink = (txt) => googleIA(IA_PROMPTS.detalhada(title, `${txt}`));
    for(const it of dispositivos){ it.link = mkLink(`${title} — ${it.texto}`); }
    for(const it of remissoes){    it.link = mkLink(`${title} — ${it.texto}`); }

    // textos por seção para busca
    const dispText = dispositivos.map(x=>x.texto + (x.comentario?` ${x.comentario}`:'' )).join(' ');
    const remText  = remissoes.map(x=>x.texto + (x.comentario?` ${x.comentario}`:'' )).join(' ');

    return {
      slug,
      title,
      group: '', path: '', frag: slug,
      dispositivos, remissoes,
      titleL: title.toLowerCase(),
      bodyL: (dispText + ' ' + remText).toLowerCase(),
      titleN: normPT(title),
      dispN:  normPT(dispText),
      remN:   normPT(remText),
      bodyN:  normPT(dispText + ' ' + remText)
    };
  }

  // ===== Highlight =====
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
  function highlightTitle(title, q){
    const esc = String(title).replace(/</g,'&lt;');
    const rx = _buildHighlightRegex(q);
    if(!rx) return esc;
    if(rx.source.startsWith('(^|')){
      return esc.replace(rx, (m,prefix,word)=> (prefix||'') + '<mark>'+word+'</mark>');
    }
    return esc.replace(rx, '<mark>$1</mark>');
  }
  function fmtInlineBold(escapedHtml){
    return String(escapedHtml).replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  }

  /* ===== Etiquetas util ===== */
  function labelFromFlags(flags){
    const tags = [];
    if(flags.T) tags.push('(T)');
    if(flags.D) tags.push('(D)');
    if(flags.R) tags.push('(R)');
    return tags.length ? tags.join(' ') : '';
  }

  /* ===== Chips pós-busca ===== */
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
          <div class="s2">${escapeHTML((it.group||'Geral') + (it.labels?` | ${it.labels}`:''))}</div>
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

  /* ===== Autocomplete ===== */
  const input  = document.querySelector('#search');
  const acList = document.querySelector('#suggestions');
  if (acList) acList.hidden = true;

  function scoreFields(q, t){
    const sT = _hitPT(t.titleN, q);
    const sD = _hitPT(t.dispN || '', q);
    const sR = _hitPT(t.remN  || '', q);
    const score = 1.2*sT + 1.0*sD + 1.0*sR;
    return { score, flags: { T: sT>0, D: sD>0, R: sR>0 } };
  }

  input?.addEventListener('input', e=>{
    const q=(e.target.value||'').trim();
    if(q.length<2 || !TEMAS.length){ acList.innerHTML=''; acList.hidden=true; closeAcDropdown(); return; }

    let arr = TEMAS.map(t=>({ t, ...scoreFields(q,t) }))
      .filter(x=>x.score>0)
      .sort((a,b)=> b.score-a.score || a.t.title.localeCompare(b.t.title,'pt-BR'))
      .slice(0,40);

    if(!arr.length){ acList.innerHTML=''; acList.hidden=true; closeAcDropdown(); return; }

    const counts = new Map();
    for(const x of arr){ const g=x.t.group||'Geral'; counts.set(g,(counts.get(g)||0)+1); }
    const catList = [...counts.keys()].sort((a,b)=> a.localeCompare(b,'pt-BR'));

    if(activeCat && activeCat!=='Todos'){
      const filtered = arr.filter(x => (x.t.group||'Geral')===activeCat);
      arr = filtered.length ? filtered : arr;
    }

    const lastAc = {
      q,
      categories: ['Todos', ...catList],
      items: arr.slice(0, 20).map(x => ({
        slug: x.t.slug,
        title: x.t.title,
        group: x.t.group || 'Geral',
        labels: labelFromFlags(x.flags)
      }))
    };
    try{ sessionStorage.setItem(LAST_AC_KEY, JSON.stringify(lastAc)); }catch(_){}

    const chipsHTML = `
      <div class="ac-chips" role="group" aria-label="Filtrar sugestões por categoria">
        <button type="button" class="ac-chip" data-cat="Todos" aria-pressed="${activeCat==='Todos'}">Todos</button>
        ${catList.map(cat=>`
          <button type="button" class="ac-chip" data-cat="${cat.replace(/"/g,'&quot;')}"
            aria-pressed="${activeCat===cat}">${cat}</button>`).join('')}
      </div>`;

    const listHTML = arr.slice(0,8).map(x=>{
      const {t, flags} = x;
      const titleHTML = highlightTitle(t.title, q);
      const labels = labelFromFlags(flags);
      return `
        <li role="option">
          <a href="#/tema/${t.slug}" data-q="${escapeHTML(q)}" data-flags="${['T','D','R'].filter(k=>flags[k]).join('')}">
            <div class="s1">${titleHTML}</div>
            <div class="s2">${escapeHTML((t.group||'Geral') + (labels?` | ${labels}`:''))}</div>
          </a>
        </li>`;
    }).join('');

    acList.innerHTML = chipsHTML + listHTML;
    acList.hidden=false;

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
          const dispN = t.dispN || '';
          const remN  = t.remN  || '';
          const body  = (dispN + ' ' + remN).toLowerCase();
          temas.push({
            slug, title: t.title, path, tags: [], group, frag: t.slug,
            dispositivos: t.dispositivos||[],
            remissoes:    t.remissoes||[],
            titleL: t.title.toLowerCase(), bodyL: body,
            titleN: t.titleN, bodyN: t.bodyN, dispN, remN
          });
        }
      }catch(e){
        console.error('Seed falhou', path, e);
        toast(`Erro ao ler ${path}`, 'error', 2800);
      }
    }
    return temas;
  }

  /* ===== Menu ===== */
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

  function renderMenu(){
    const menu=$('#menuList'); if(!menu) return;
    menu.innerHTML='';

    // Sobre
    const liSobre=document.createElement('li');
    const btnSobre=document.createElement('button');
    btnSobre.className='cat-btn'; btnSobre.type='button';
    btnSobre.innerHTML=`<span>Sobre</span><span class="caret">▸</span>`;
    btnSobre.addEventListener('click', ()=> window.__openSobre?.());
    liSobre.appendChild(btnSobre);
    menu.appendChild(liSobre);

    // Salvos
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

    ulSaved.querySelectorAll('button[data-remove]')?.forEach(b=>{
      b.addEventListener('click',(ev)=>{
        ev.preventDefault();
        const slug=b.getAttribute('data-remove');
        const now=toggleSaved(slug);
        toast(now?'Salvo adicionado':'Removido dos salvos', now?'success':'info', 1400);
        renderMenu();
      });
    });

    const div=document.createElement('div'); div.className='divider'; menu.appendChild(div);

    const title=document.createElement('div'); title.className='menu-title'; title.textContent='Categorias'; menu.appendChild(title);

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

  /* ===== IA Popover ===== */
  let __iaPop = null;
  function closeIAPopover(){
    __iaPop?.remove(); __iaPop = null;
    document.removeEventListener('click', onDocClickCloseIA, true);
    window.removeEventListener('scroll', closeIAPopover, true);
    window.removeEventListener('hashchange', closeIAPopover, {once:true});
  }
  function onDocClickCloseIA(e){
    if(__iaPop && !__iaPop.contains(e.target)) closeIAPopover();
  }
  function openIAPopover(anchorBtn, title, fullText){
    closeIAPopover();
    const host = $('#iaPopoverHost') || document.body;

    const opts = [
      {key:'resumo',    label:'Resumo'},
      {key:'detalhada', label:'Detalhada'},
      {key:'perguntas', label:'10 Perguntas'},
      {key:'questoes',  label:'10 Questões'},
      {key:'casos',     label:'Casos Concretos'},
      {key:'videos',    label:'Vídeos'},
      {key:'artigos',   label:'Artigos'},
    ];

    __iaPop = document.createElement('div');
    __iaPop.className = 'ia-popover';
    __iaPop.setAttribute('role','menu');
    __iaPop.innerHTML = opts.map(o=>`<button class="ia-opt" data-k="${o.key}" role="menuitem">${o.label}</button>`).join('');
    host.appendChild(__iaPop);

    const r = anchorBtn.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const padX = 8;
    const popW = Math.min(320, vw - padX*2);
    const left = Math.min(Math.max(r.left + window.scrollX, padX), vw - padX - popW);
    __iaPop.style.left = left + 'px';
    __iaPop.style.top  = (r.bottom + window.scrollY + 6) + 'px';
    __iaPop.style.maxWidth = popW + 'px';

    __iaPop.querySelectorAll('.ia-opt').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const k = btn.getAttribute('data-k');
        const fn = IA_PROMPTS[k]; if(!fn) return;
        const url = googleIA(fn(title, fullText));
        window.open(url, '_blank', 'noopener');
        closeIAPopover();
      });
    });

    setTimeout(()=>{
      document.addEventListener('click', onDocClickCloseIA, true);
      window.addEventListener('scroll', closeIAPopover, true);
      window.addEventListener('hashchange', closeIAPopover, {once:true});
    },0);
  }

  /* ===== Páginas ===== */
  async function loadTemas(){
    TEMAS = await readAllSeeds();
    renderMenu();
  }

  function buildBundle(title, dispositivos, remissoes){
    const d = (dispositivos||[]).map(it=>{
      const c = it.comentario ? `\n    Comentário: ${it.comentario}` : '';
      return `- ${it.texto}${c}`;
    }).join('\n');
    const r = (remissoes||[]).map(it=>{
      const c = it.comentario ? `\n    Comentário: ${it.comentario}` : '';
      return `- ${it.texto}${c}`;
    }).join('\n');
    return `Título: ${title}\n\nDispositivos Legais:\n${d}\n\nRemissões Normativas:\n${r}`;
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

      actionsEl.innerHTML='';
      const mkBtn=(txt,variant,fn)=>{ const b=document.createElement('button'); b.className='btn-ios is-small'; if(variant) b.setAttribute('data-variant',variant); b.textContent=txt; b.onclick=fn; return b; };
      const saved=isSaved(slug);
      const saveBtn=mkBtn(saved?'Remover':'Salvar', saved?'primary':'', ()=>{
        const added=toggleSaved(slug);
        saveBtn.textContent=added?'Remover':'Salvar';
        if(added){ saveBtn.setAttribute('data-variant','primary'); }
        else{ saveBtn.removeAttribute('data-variant'); }
        renderMenu();
        toast(added?'Tema salvo':'Removido dos salvos', added?'success':'info', 1400);
      });

      const fullText = buildBundle(pageTitle, pick.dispositivos, pick.remissoes);
      const iaBtn = mkBtn('Estude com I.A.','', ()=>openIAPopover(iaBtn, pageTitle, fullText));

      const bar = document.createElement('div');
      bar.className='chip-bar';
      bar.append(saveBtn, iaBtn);
      actionsEl.append(bar);

      // Só chama se existir para não quebrar o fluxo de render
      if (typeof window.renderPostSearchChips === 'function') {
        try { window.renderPostSearchChips(); } catch(_) {}
      }

      const sep = `<hr style="border:none;border-top:1px solid #e9ecef;margin:8px 0">`;

      function renderList(items){
        if(!items?.length) return '<p class="muted">Sem itens.</p>';
        return `<ul class="ref-list">` + items.map((it,i,arr)=>{
          const li = `
            <li>
              <a class="link-arrow" href="${it.link}" target="_blank" rel="noopener">${fmtInlineBold(escapeHTML(it.texto))}</a>
              ${it.comentario ? `<div class="muted">${escapeHTML(it.comentario)}</div>` : ``}
            </li>`;
          const needSep = i < arr.length-1;
          return needSep ? li + sep : li;
        }).join('') + `</ul>`;
      }

      $('#content').innerHTML=`
        <article class="card ubox" role="article">
          <section class="ubox-section">
            <h3 class="ubox-sub">Dispositivos Legais (D)</h3>
            ${renderList(pick.dispositivos)}
          </section>
          <section class="ubox-section">
            <h3 class="ubox-sub">Remissões Normativas (R)</h3>
            ${renderList(pick.remissoes)}
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
    $('#content').innerHTML=`<div class="card ubox"><h2 class="ubox-title">Sobre o projeto</h2><p class="ubox-intro">TXT por tema: <code># Título</code> → <code># Dispositivos Legais</code> → <code># Remissões Normativas</code> → <code>-----</code>. Linhas com <code>- </code> são linkadas; <code>-- </code> são comentários. As etiquetas (T) (D) (R) são incluídas automaticamente na UI.</p></div>`;
  }

  async function renderByRoute(){
    const page=currentPage();
    if(!TEMAS.length) await loadTemas();
    if(page.kind==='tema') await loadTema(page.slug);
    else if(page.kind==='sobre') loadSobre();
    else renderHome();
  }

  document.querySelector('#search')?.addEventListener('focus', closeAcDropdown);

  window.addEventListener('hashchange', renderByRoute);
  (async function init(){ await renderByRoute(); })();
})();
