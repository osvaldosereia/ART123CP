// meujus – app.js (2025-10-04)
// Regras implementadas sem alterar seu CSS global:
// - Uma aba única por tema (renderização simples neste arquivo)
// - URL por tema via hash: #/tema/<slug>
// - Botão único: “Estudar com Google I.A.” logo abaixo do título
// - Texto dos artigos SEM links; apenas mini-botão "→" ao fim que abre JusBrasil
//   com q= prefixo até ":" de cada linha
// - Glossário global (data/glossario.txt) sem aliases. Clique no termo abre balão discreto
//   usando APENAS inline-style no próprio tooltip (sem classes globais).

(function(){
  const $ = (q, el=document) => el.querySelector(q);

  // ------------------------------
  // Router: tema via #/tema/<slug>
  // ------------------------------
  function getHashParts(){
    const h = location.hash.replace(/^#\/?/, '');
    return h.split('/');
  }
  function currentTemaSlug(){
    const p = getHashParts();
    return (p[0]==='tema' && p[1]) ? decodeURIComponent(p[1]) : null;
  }
  function setTemaSlug(slug){
    const safe = encodeURIComponent(slug);
    if(currentTemaSlug()!==slug) location.hash = `#/tema/${safe}`;
  }

  // ------------------------------
  // Data loaders
  // ------------------------------
  async function fetchText(url){
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return res.text();
  }

  // Mapear tema -> arquivo .txt (ajuste aqui conforme seus caminhos)
  // Exemplo:
  // window.TEMA_MAP = { "codigo-civil": "data/codigo-civil/codigo-civil.txt" };
  const TEMA_MAP = window.TEMA_MAP || {};

  // ------------------------------
  // Glossário
  // ------------------------------
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

  // ------------------------------
  // Tooltip discreto com inline-style
  // ------------------------------
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
    // Inline style para não depender do seu CSS
    tip.style.position = 'absolute';
    tip.style.zIndex = '9999';
    tip.style.maxWidth = '320px';
    tip.style.background = '#111827';
    tip.style.color = '#f9fafb';
    tip.style.padding = '10px 12px';
    tip.style.borderRadius = '10px';
    tip.style.boxShadow = '0 8px 20px rgba(0,0,0,.15)';
    tip.style.fontSize = '14px';
    tip.style.lineHeight = '1.4';

    document.body.appendChild(tip);
    const top = window.scrollY + rect.bottom + 8;
    const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - tip.offsetWidth - 12);
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    tooltipEl = tip;
  }
  document.addEventListener('click', (e)=>{
    const g = e.target.closest('.mj-gloss');
    if(g){ showTooltip(g); return; }
    if(!e.target.closest('[role="tooltip"]')) hideTooltip();
  });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hideTooltip(); });

  // ------------------------------
  // Marcador do glossário (não toca em âncoras nem na trilha do mini-botão)
  // ------------------------------
  function markGlossarioInHTML(html){
    if(!GLOSS || !GLOSS.length) return html;
    // proteger trechos clicáveis: <a>…</a> e span .mj-trail
    const segments = html.split(/(<a[\s\S]*?<\/a>|<span class=(?:"|')mj-trail(?:"|')[\s\S]*?<\/span>)/gi);
    for(let i=0;i<segments.length;i++){
      const seg = segments[i];
      if(/^<a[\s\S]*<\/a>$/i.test(seg) || /^<span class=(?:"|')mj-trail(?:"|')[\s\S]*<\/span>$/i.test(seg)){
        continue;
      }
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

  // ------------------------------
  // Helpers
  // ------------------------------
  function prefixAteDoisPontos(line){
    const idx = line.indexOf(':');
    if(idx>0) return line.slice(0, idx).trim();
    const m = line.match(/^(Art\.?\s*\d+[A-Z\-]*)/i);
    return m ? m[1] : line.slice(0, Math.min(60, line.length));
  }
  function buildJusBrasilURL(prefix){
    return `https://www.jusbrasil.com.br/legislacao/busca?q=${encodeURIComponent(prefix)}`;
  }
  function slugify(s){
    return normalize(String(s)).toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
  }

  // ------------------------------
  // Tema
  // ------------------------------
  async function loadTema(slug){
    const titleEl = $('#themeTitle');
    const contentEl = $('#content');
    contentEl.textContent = 'Carregando…';

    const file = TEMA_MAP[slug];
    if(!file){ contentEl.textContent = 'Tema não encontrado.'; return; }

    await loadGlossario();

    try{
      const raw = await fetchText(file);
      const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);

      const tituloTema = slug.replace(/-/g,' ');
      titleEl.textContent = tituloTema;

      const btnIA = $('#btnIA');
      btnIA.onclick = ()=>{
        const prompt = `Estudar tema: ${tituloTema}`;
        const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(prompt)}`;
        window.open(url, '_blank', 'noopener');
      };

      const html = lines.map((line)=>{
        const prefix = prefixAteDoisPontos(line);
        const href = buildJusBrasilURL(prefix);
        const safe = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const withGloss = markGlossarioInHTML(safe);
        // Sem classes de layout para não interferir no seu CSS
        return `<p>${withGloss}<span class="mj-trail"> <a class="mj-go" href="${href}" target="_blank" rel="noopener">→</a></span></p>`;
      }).join('');

      contentEl.innerHTML = html;

    }catch(e){
      console.error(e);
      contentEl.textContent = 'Erro ao carregar tema.';
    }
  }

  // ------------------------------
  // Boot
  // ------------------------------
  window.addEventListener('hashchange', ()=>{
    const slug = currentTemaSlug();
    if(slug) loadTema(slug);
  });
  (async function init(){
    const slug = currentTemaSlug();
    if(slug){
      await loadTema(slug);
    } else {
      // opcional: defina um tema padrão
      // setTemaSlug('codigo-civil');
    }
  })();
})();
