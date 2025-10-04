// ===== Utils =====
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const shorten = (s,n)=>{ s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; };
const gIA = prompt => `https://www.google.com/search?q=${encodeURIComponent(prompt)}&udm=50`;
const labelizePasta = slug => {
  if(!slug) return '';
  const map = {
    'codigo-penal':'Código Penal',
    'codigo-civil':'Código Civil',
    'cpp':'CPP',
    'cf-88':'CF/88'
  };
  return map[slug] || slug.replace(/-/g,' ').replace(/\b\w/g, m=>m.toUpperCase());
};

// ===== Estado =====
let INDEX = [];
let FICHA = null;

// ===== Boot + Autocomplete =====
(async function boot(){
  try { INDEX = await fetch('temas.json').then(r=>r.json()); } catch(e){ INDEX=[]; }
})();

const elBusca = $('#busca');
const elSug   = $('#sugestoes');

elBusca.addEventListener('input', () => {
  const termo = norm(elBusca.value);
  if(!termo){ elSug.classList.remove('show'); elSug.innerHTML=''; return; }
  const res = INDEX.filter(t => norm(t.nome).includes(termo)).slice(0,10);
  elSug.innerHTML = res.map(r=>`
    <li class="sug-item" role="option" tabindex="0" data-pasta="${esc(r.pasta)}" data-arquivo="${esc(r.arquivo)}">
      <div class="sug-title">${esc(r.nome)}</div>
      <div class="sug-sub">${esc(labelizePasta(r.pasta))}</div>
      <div class="sug-sep"></div>
    </li>`).join('');
  elSug.classList.toggle('show', res.length>0);
});

elSug.addEventListener('click', e => {
  const li = e.target.closest('.sug-item'); if(!li) return;
  elSug.classList.remove('show');
  elBusca.value = li.querySelector('.sug-title').textContent.trim();
  carregarFicha(li.dataset.pasta, li.dataset.arquivo, elBusca.value);
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape') elSug.classList.remove('show'); });

// ===== Drawer =====
const drawer = $('#drawer');
const menuBtn = $('#menu-btn');
const drawerClose = $('#drawer-close');
const drawerBackdrop = $('#drawer-backdrop');

function openDrawer(){ drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false'); menuBtn.setAttribute('aria-expanded','true'); }
function closeDrawer(){ drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); menuBtn.setAttribute('aria-expanded','false'); }

menuBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

// ===== Carregar & Parse TXT =====
async function carregarFicha(pasta, arquivo, nome){
  $('#intro').classList.add('hidden');
  $('#ficha').classList.remove('hidden');
  $('#ficha-titulo').textContent = nome;
  $('#ficha-sub').textContent = '';

  const txt = await fetch(`data/${pasta}/${arquivo}`).then(r=>r.text());
  FICHA = parseTXT(txt, nome);

  renderCodigo(FICHA.codigo);
  renderVideos(FICHA.videos);
  renderPerguntas(FICHA.perguntas);

  switchTab('codigo');
}

function parseTXT(txt, tema){
  const linhas = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const isHdr = l => /^#\s*(CÓDIGO|VÍDEOS|ARTIGOS|QUESTÕES)\s*$/i.test(l);
  let sec = null;

  const data = { tema, codigo: { itens: [] }, videos: [], perguntas: [] };
  let tempTitulo = null;

  for(const l of linhas){
    if(isHdr(l)){ sec = l.replace(/^#\s*/,'').toUpperCase(); tempTitulo=null; continue; }
    if(/^(INTRODUÇÃO|GUIA DE ESTUDOS)/i.test(l)) continue;

    if(/CÓDIGO/i.test(sec||'')){
      const m = l.match(/^-+\s*(.+?)\s*:\s*(.+)$/);
      if(m) data.codigo.itens.push({ title: m[1].trim(), desc: m[2].trim(), href: null });
      continue;
    }
    if(/VÍDEOS/i.test(sec||'')){
      const t = l.match(/^-+\s*T[íi]tulo:\s*(.+)$/i);
      const k = l.match(/^--+\s*Link:\s*(https?:\/\/\S+)/i);
      if(t){ tempTitulo = t[1].trim(); continue; }
      if(k){ if(tempTitulo){ data.videos.push({ title: tempTitulo, href: k[1].trim() }); tempTitulo=null; } continue; }
      continue;
    }
    if(/ARTIGOS/i.test(sec||'')){
      /* aba eliminada — ignorar bloco, mantendo compatibilidade do TXT */
      continue;
    }
    if(/QUESTÕES/i.test(sec||'')){
      const q = l.match(/^-+\s*(.+)$/);
      if(q) data.perguntas.push(q[1].trim());
      continue;
    }
  }
  return data;
}

// ===== Render: Código (com IA) — lista plana =====
function renderCodigo(cod){
  const pane = $('#wrap-codigo');
  pane.innerHTML = '';

  if(!cod?.itens?.length){ pane.innerHTML = `<div class="muted">Sem itens normativos.</div>`; }
  else {
    cod.itens.forEach(it=>{
      const titleEl = it.href
        ? `<a class="title" href="${esc(it.href)}" target="_blank" rel="noopener">${esc(it.title)} ↗</a>`
        : `<span class="title">${esc(it.title)}</span>`;
      pane.insertAdjacentHTML('beforeend', `
        <li class="item">
          <div>${titleEl}<div class="desc">${esc(shorten(it.desc, 180))}</div></div>
        </li>
      `);
    });
  }

  const resumoCodigo = (cod?.itens||[]).map(it => `**${it.title}:** ${it.desc}`).join('\n');
  const tema = FICHA?.tema || $('#ficha-titulo').textContent.trim();

  const promptEstudar =
`Me explique o tema ${tema}, seja didático e organizado. Inclua na sua exmplicação todos o conteído a seguir:
${resumoCodigo}`;

  const promptQuestoes =
`Crie 10 QUESTÕES OBJETIVAS (A–E) sobre ${tema} para eu treinar meu conhecimento.
Após as 10, traga gabarito com breve comentário. As questões devem conter informações de todo o conteudo a seguir:
${resumoCodigo}`;

  $('#btn-estudar').href  = gIA(promptEstudar);
  $('#btn-questoes').href = gIA(promptQuestoes);
}

// ===== Render: Vídeos (usa busca do YouTube pelo título) =====
function renderVideos(items){
  const pane = $('#pane-videos');
  pane.innerHTML = '';

  if(!items?.length){
    pane.innerHTML = `<div class="muted">Sem vídeos.</div>`;
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'list list-plain';

  items.forEach(v=>{
    const q = encodeURIComponent(v.title.trim()); // título -> query
    const href = `https://www.youtube.com/results?search_query=${q}`;
    ul.insertAdjacentHTML('beforeend', `
      <li class="item">
        <span class="meta">YouTube ·</span>
        <a class="title" href="${href}" target="_blank" rel="noopener" aria-label="Abrir em nova aba">
          ${esc(v.title)} ↗
        </a>
      </li>`);
  });

  pane.appendChild(ul);
}


// ===== Render: Perguntas (título interno + links ↗ sem "?") — lista plana =====
function renderPerguntas(items){
  const wrap = $('#wrap-perguntas');
  wrap.innerHTML = '';

  if(!items?.length){
    wrap.innerHTML = `<div class="muted">Sem perguntas.</div>`;
    return;
  }

  const tema = FICHA?.tema || $('#ficha-titulo').textContent.trim();

  items.forEach(q=>{
    const texto = q.replace(/^\?+\s*/,'').trim();
    const prompt =
`Tema: ${tema}
Pergunta: "${texto}"
Explique objetivamente (5–7 frases), cite o dispositivo aplicável (CPP/CF/Súmulas) e dê 1 exemplo prático.`;
    const href = gIA(prompt);
    wrap.insertAdjacentHTML('beforeend', `
      <li class="item">
        <a class="title" href="${href}" target="_blank" rel="noopener" aria-label="Abrir em nova aba">${esc(shorten(texto, 160))} ↗</a>
      </li>`);
  });
}

// ===== Tabs =====
$$('.tab').forEach(btn=>{
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(name){
  $$('.tab').forEach(t=>t.classList.toggle('is-active', t.dataset.tab===name));
  $$('.pane').forEach(p=>p.classList.toggle('is-active', p.id===`pane-${name}`));
}
