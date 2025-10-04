// ============== UTILS ==============
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const shorten = (s,n)=>{ s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; };
const gIA = prompt => `https://www.google.com/search?q=${encodeURIComponent(prompt)}&udm=50`;

// ============== ESTADO ==============
let INDEX = [];  // temas.json
let FICHA = null;

// ============== BOOT / AUTOCOMPLETE ==============
(async function boot(){
  try { INDEX = await fetch('temas.json').then(r=>r.json()); } catch(e){ INDEX=[]; }
})();

const elBusca = $('#busca');
const elSug   = $('#sugestoes');

elBusca.addEventListener('input', () => {
  const termo = norm(elBusca.value);
  if(!termo){ elSug.classList.remove('show'); elSug.innerHTML=''; return; }
  const res = INDEX.filter(t => norm(t.nome).includes(termo)).slice(0,10);
  elSug.innerHTML = res.map(r=>`<li role="option" tabindex="0" data-pasta="${esc(r.pasta)}" data-arquivo="${esc(r.arquivo)}">${esc(r.nome)}</li>`).join('');
  elSug.classList.toggle('show', res.length>0);
});
elSug.addEventListener('click', e => {
  const li = e.target.closest('li'); if(!li) return;
  elSug.classList.remove('show');
  elBusca.value = li.textContent.trim();
  carregarFicha(li.dataset.pasta, li.dataset.arquivo, li.textContent.trim());
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape') elSug.classList.remove('show'); });

// ============== CARREGAR & PARSE TXT ==============
async function carregarFicha(pasta, arquivo, nome){
  $('#intro').classList.add('hidden');
  $('#ficha').classList.remove('hidden');
  $('#ficha-titulo').textContent = nome;
  $('#ficha-sub').textContent = 'Conteúdo consolidado em abas.';

  const txt = await fetch(`data/${pasta}/${arquivo}`).then(r=>r.text());
  FICHA = parseTXT(txt, nome);

  renderCodigo(FICHA.codigo);     // inclui botões IA aqui
  renderVideos(FICHA.videos);     // títulos linkados, prefixo, ↗
  renderPerguntas(FICHA.perguntas); // título interno, links ↗ sem “Google (modo IA)” e sem “?” inicial

  switchTab('codigo');
}

function parseTXT(txt, tema){
  const linhas = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);

  const isHdr = l => /^#\s*(CÓDIGO|VÍDEOS|ARTIGOS|QUESTÕES)\s*$/i.test(l);
  let sec = null;

  const data = {
    tema, 
    codigo: { grupos: [] },   // [{nome, itens:[{title, desc, href?}]}]
    videos: [],               // [{title, href}]
    perguntas: []             // [string]
  };

  // grupo único “Normas”, simples e limpo
  let group = { nome: 'Normas', itens: [] };
  data.codigo.grupos.push(group);

  let tempTitulo = null; // VÍDEOS (par Título/Link)

  for(const l of linhas){
    if(isHdr(l)){
      const hdr = l.replace(/^#\s*/,'').toUpperCase();
      sec = hdr; tempTitulo = null;
      continue;
    }

    if(/^(INTRODUÇÃO|GUIA DE ESTUDOS)/i.test(l)) { continue; } // ignorar

    if(/CÓDIGO/i.test(sec||'')){
      // "- Art./SV/Súmula: descrição"
      const m = l.match(/^-+\s*(.+?)\s*:\s*(.+)$/);
      if(m){
        group.itens.push({ title: m[1].trim(), desc: m[2].trim(), href: null });
      }
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
      // aba “Artigos” foi removida — ignorar bloco mantendo compatibilidade do TXT
      continue;
    }

    if(/QUESTÕES/i.test(sec||'')){
      const q = l.match(/^-+\s*(.+)$/);
      if(q){ data.perguntas.push(q[1].trim()); }
      continue;
    }
  }
  return data;
}

// ============== RENDER: Código (com IA buttons) ==============
function renderCodigo(cod){
  const pane = $('#wrap-codigo');
  pane.innerHTML = '';

  if(!cod?.grupos?.length){
    pane.innerHTML = `<div class="muted">Sem itens normativos.</div>`;
  } else {
    cod.grupos.forEach(g=>{
      const box = document.createElement('div'); box.className='group';
      box.innerHTML = `<h3>${esc(g.nome)}</h3><ul class="list"></ul>`;
      const ul = box.querySelector('.list');
      g.itens.forEach(it=>{
        const titleEl = it.href
          ? `<a class="title" href="${esc(it.href)}" target="_blank" rel="noopener">${esc(it.title)} ↗</a>`
          : `<span class="title">${esc(it.title)}</span>`;
        ul.insertAdjacentHTML('beforeend', `
          <li class="item">
            <div>${titleEl}<div class="desc">${esc(shorten(it.desc, 180))}</div></div>
          </li>
        `);
      });
      pane.appendChild(box);
    });
  }

  // prompts agregados agora baseados APENAS no CÓDIGO/SÚMULAS
  const resumoCodigo = (cod?.grupos||[])
    .flatMap(g => g.itens.map(it => `**${it.title}:** ${it.desc}`))
    .join('\n');

  const tema = FICHA?.tema || $('#ficha-titulo').textContent.trim();

  const promptEstudar =
`Você é professor de Direito e vai preparar uma APOSTILA DIDÁTICA sobre ${tema} usando EXCLUSIVAMENTE o conteúdo abaixo.
Entregue: (1) visão geral; (2) síntese comentada dos dispositivos; (3) mapa mental textual; (4) passo a passo prático; (5) erros frequentes; (6) flash points; (7) referências.
CONTEÚDO:
${resumoCodigo}`;

  const promptQuestoes =
`Você é professor de Direito e vai criar 10 QUESTÕES OBJETIVAS (A–E) sobre ${tema} usando EXCLUSIVAMENTE o conteúdo abaixo.
Após as 10, traga gabarito comentado citando artigo/súmula pertinente.
CONTEÚDO:
${resumoCodigo}`;

  $('#btn-estudar').href  = gIA(promptEstudar);
  $('#btn-questoes').href = gIA(promptQuestoes);
}

// ============== RENDER: Vídeos (títulos + prefixo + ↗) ==============
function renderVideos(items){
  const pane = $('#pane-videos');
  pane.innerHTML = '';

  if(!items?.length){
    pane.innerHTML = `<div class="muted">Sem vídeos.</div>`;
    return;
  }

  const box = document.createElement('div'); box.className='group';
  box.innerHTML = `<h3>Vídeos</h3><ul class="list"></ul>`;
  const ul = box.querySelector('.list');

  items.forEach(v=>{
    const host = v.href ? new URL(v.href).hostname.replace(/^www\./,'') : '';
    const origem = /youtu(\.be|be\.com)$/.test(host) || host.includes('youtube') ? 'YouTube' : (host || 'link');
    ul.insertAdjacentHTML('beforeend', `
      <li class="item">
        <span class="meta">${esc(origem)} ·</span>
        <a class="title" href="${esc(v.href||'#')}" target="_blank" rel="noopener" aria-label="Abrir em nova aba">${esc(v.title)} ↗</a>
      </li>`);
  });

  pane.appendChild(box);
}

// ============== RENDER: Perguntas (título interno + links ↗ sem "?") ==============
function renderPerguntas(items){
  const wrap = $('#wrap-perguntas');
  wrap.innerHTML = '';

  if(!items?.length){
    wrap.innerHTML = `<div class="muted">Sem perguntas.</div>`;
    return;
  }

  const tema = FICHA?.tema || $('#ficha-titulo').textContent.trim();
  const box = document.createElement('div'); box.className='group';
  box.innerHTML = `<ul class="list"></ul>`;
  const ul = box.querySelector('.list');

  items.forEach(q=>{
    const texto = q.replace(/^\?+\s*/,'').trim(); // remove “?” do início se existir
    const prompt =
`Tema: ${tema}
Pergunta: "${texto}"
Explique objetivamente (5–7 frases), cite o dispositivo aplicável (CPP/CF/Súmulas) e dê 1 exemplo prático.`;
    const href = gIA(prompt);
    ul.insertAdjacentHTML('beforeend', `
      <li class="item">
        <a class="title" href="${href}" target="_blank" rel="noopener" aria-label="Abrir em nova aba">${esc(shorten(texto, 160))} ↗</a>
      </li>`);
  });

  wrap.appendChild(box);
}

// ============== TABS UX ==============
$$('.tab').forEach(btn=>{
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(name){
  $$('.tab').forEach(t=>t.classList.toggle('is-active', t.dataset.tab===name));
  $$('.pane').forEach(p=>p.classList.toggle('is-active', p.id===`pane-${name}`));
}
