// ========================= UTIL =========================
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

// Google IA (udm=50)
const gIA = prompt => `https://www.google.com/search?q=${encodeURIComponent(prompt)}&udm=50`;

// ====================== ESTADO BÁSICO ====================
let INDEX = [];        // temas.json
let FICHA = null;      // ficha atual já parseada

// ===================== AUTOCOMPLETE ======================
(async function boot(){
  try { INDEX = await fetch('temas.json').then(r=>r.json()); } catch(e){ INDEX=[]; }
})();

const elBusca = $('#busca');
const elSug   = $('#sugestoes');

elBusca.addEventListener('input', () => {
  const termo = norm(elBusca.value);
  if(!termo){ elSug.classList.remove('show'); elSug.innerHTML=''; return; }

  const res = INDEX.filter(t => norm(t.nome).includes(termo)).slice(0,10);
  elSug.innerHTML = res.map((r,i)=>`<li role="option" tabindex="0" data-pasta="${esc(r.pasta)}" data-arquivo="${esc(r.arquivo)}">${esc(r.nome)}</li>`).join('');
  elSug.classList.toggle('show', res.length>0);
});

elSug.addEventListener('click', e => {
  const li = e.target.closest('li'); if(!li) return;
  elSug.classList.remove('show');
  elBusca.value = li.textContent.trim();
  carregarFicha(li.dataset.pasta, li.dataset.arquivo, li.textContent.trim());
});

document.addEventListener('keydown', e=>{
  if(e.key==='Escape') elSug.classList.remove('show');
});

// ================== CARREGAR & PARSEAR TXT ===============
async function carregarFicha(pasta, arquivo, nome){
  $('#intro').classList.add('hidden');
  $('#ficha').classList.remove('hidden');
  $('#ficha-titulo').textContent = nome;
  $('#ficha-sub').textContent = 'Conteúdo consolidado em abas.';

  const txt = await fetch(`data/${pasta}/${arquivo}`).then(r=>r.text());
  FICHA = parseTXT(txt, nome);
  renderCodigo(FICHA.codigo);
  renderVideos(FICHA.videos);
  renderArtigos(FICHA.artigos);    // também amarra Estudar/Questões
  renderPerguntas(FICHA.perguntas);

  // Seleciona aba "Código" como padrão
  switchTab('codigo');
}

// Parser robusto para o formato enviado pelo usuário
function parseTXT(txt, tema){
  const linhas = txt.split(/\r?\n/);

  // Títulos que DEVEM ser ignorados
  const ignoreTitle = t => /introdução/i.test(t) || /guia de estudos/i.test(t);

  // Mapas de grupo
  const isCodigoHeader    = t => /(código de processo|processo penal|cpp|constituição federal|súmula)/i.test(t);
  const isVideosHeader    = t => /vídeoaulas|vídeos/i.test(t);
  const isArtigosHeader   = t => /artigos\s*(\(jusbrasil\))?/i.test(t);
  const isPergHeader      = t => /(perguntas|quest(ões|oes))/i.test(t);

  let grupo = null;
  const data = { tema, codigo: [], videos: [], artigos: [], perguntas: [] };

  // Aux: empilha "cards" por subgrupo dentro de Código (CPP, CF/88, Súmulas…)
  let sub = null;
  const pushCodigoItem = (title, desc) => {
    if(!sub) { sub = { grupo:'Geral', itens: [] }; data.codigo.push(sub); }
    sub.itens.push({ title, desc, href: null });
  };

  // Aux: vídeos/artigos (Titulo/Link) — títulos e links podem vir em linhas separadas
  let tempTitulo = null;
  const flushPair = (arr, link) => {
    if(tempTitulo){
      arr.push({ title: tempTitulo, href: link || null });
      tempTitulo = null;
    }
  };

  for (let raw of linhas){
    const l = raw.trim();
    if(!l) continue;

    // Detecta header tipo "### **Texto**"
    const mHeader = l.match(/^#{2,3}\s*\*{0,2}(.+?)\*{0,2}\s*$/);
    if(mHeader){
      const head = mHeader[1].trim();
      if(ignoreTitle(head)) { grupo=null; sub=null; continue; }

      if(isVideosHeader(head)){ grupo='videos'; sub=null; continue; }
      if(isArtigosHeader(head)){ grupo='artigos'; sub=null; continue; }
      if(isPergHeader(head)){ grupo='perguntas'; sub=null; continue; }
      if(isCodigoHeader(head)){ grupo='codigo'; 
        // define subgrupo compacto p/ visual (CPP, CF/88, Súmulas…)
        let label = 'Código';
        if(/constitui/i.test(head)) label='CF/88';
        else if(/processo penal|cpp/i.test(head)) label='CPP';
        else if(/vinculante/i.test(head)) label='Súmulas Vinculantes (STF)';
        else if(/súmula.*stf/i.test(head)) label='Súmulas STF';
        else if(/súmula.*stj/i.test(head)) label='Súmulas STJ';
        sub = { grupo: label, itens: [] };
        data.codigo.push(sub);
        continue;
      }
      // headers desconhecidos: se parecem com seção do código, mantemos no mesmo bloco
      continue;
    }

    // Dentro do grupo atual, trata linhas
    if(grupo === 'codigo'){
      // bullets: **Art. 6º:** Descrição
      const mBullet = l.match(/^\*\s*\*{0,2}(.+?)\*{0,2}\s*:\s*(.+)$/); // **Título**: desc
      if(mBullet){ pushCodigoItem(mBullet[1].trim(), mBullet[2].trim()); continue; }

      // também aceita "**Súmula 524 (STF):** ..."
      const mBoldColon = l.match(/^\*{0,2}(.+?)\*{0,2}\s*:\s*(.+)$/);
      if(mBoldColon){ pushCodigoItem(mBoldColon[1].replace(/^\*\*|\*\*$/g,''), mBoldColon[2].trim()); continue; }

      // linhas soltas informativas (poucas): ignorar para manter visual limpo
      continue;
    }

    if(grupo === 'videos' || grupo === 'artigos'){
      // "Título: ...."
      const tMatch = l.match(/^t[ií]tulo:\s*(.+)$/i);
      if(tMatch){ tempTitulo = tMatch[1].trim(); continue; }
      // "Link: https://..."
      const linkMatch = l.match(/^link:\s*(https?:\/\/\S+)/i);
      if(linkMatch){ flushPair(data[grupo], linkMatch[1].trim()); continue; }
      // linha única com URL
      const loneUrl = l.match(/(https?:\/\/\S+)/);
      if(loneUrl && tempTitulo){ flushPair(data[grupo], loneUrl[1]); continue; }
      // se vier bullet com markdown
      const bullet = l.match(/^\*\s*(.+)$/);
      if(bullet){ tempTitulo = bullet[1].trim(); continue; }
      continue;
    }

    if(grupo === 'perguntas'){
      // "1. Pergunta..."
      const n = l.match(/^\d+\.\s*(.+)$/);
      if(n){ data.perguntas.push(n[1].trim()); continue; }
      // bullet
      const b = l.match(/^\*\s*(.+)$/);
      if(b){ data.perguntas.push(b[1].trim()); continue; }
    }
  }
  // flush de par pendente
  if(tempTitulo){ (grupo==='videos' ? data.videos : data.artigos).push({ title: tempTitulo, href: null }); }

  return data;
}

// ==================== RENDER (CÓDIGO) ====================
function renderCodigo(groups){
  const pane = $('#pane-codigo');
  pane.innerHTML = '';

  if(!groups || !groups.length){
    pane.innerHTML = `<div class="muted">Sem itens normativos.</div>`;
    return;
  }

  groups.forEach(g=>{
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `<h3>${esc(g.grupo)}</h3><ul class="list"></ul>`;
    const ul = wrap.querySelector('.list');

    g.itens.forEach(it=>{
      // Títulos do código são clicáveis apenas se houver link no TXT (normalmente não há)
      const a = it.href ? `<a class="title" href="${esc(it.href)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
                        : `<span class="title">${esc(it.title)}</span>`;
      ul.insertAdjacentHTML('beforeend', `
        <li class="item">
          <div>${a}<div class="desc">${esc(shorten(it.desc, 160))}</div></div>
        </li>`);
    });

    pane.appendChild(wrap);
  });
}

// ==================== RENDER (VÍDEOS) ====================
function renderVideos(items){
  const pane = $('#pane-videos');
  pane.innerHTML = '';
  if(!items?.length){ pane.innerHTML = `<div class="muted">Sem vídeos.</div>`; return; }

  const box = document.createElement('div'); box.className='group';
  box.innerHTML = `<h3>Vídeos</h3><ul class="list"></ul>`;
  const ul = box.querySelector('.list');

  items.forEach(v=>{
    ul.insertAdjacentHTML('beforeend', `
      <li class="item">
        <a class="title" href="${esc(v.href||'#')}" target="_blank" rel="noopener">${esc(v.title)}</a>
        <div class="desc">YouTube</div>
      </li>`);
  });

  pane.appendChild(box);
}

// ===== RENDER (ARTIGOS) + BOTÕES IA (Estudar/Questões) ====
function renderArtigos(items){
  const pane = $('#pane-artigos');
  const cont = $('#lista-artigos');
  cont.innerHTML = '';
  if(!items?.length){ cont.innerHTML = `<div class="muted">Sem artigos.</div>`; }

  const box = document.createElement('div'); box.className='group';
  box.innerHTML = `<h3>Artigos (JusBrasil)</h3><ul class="list"></ul>`;
  const ul = box.querySelector('.list');

  items.forEach(a=>{
    ul.insertAdjacentHTML('beforeend', `
      <li class="item">
        <a class="title" href="${esc(a.href||'#')}" target="_blank" rel="noopener">${esc(a.title)}</a>
        <div class="desc">${a.href? new URL(a.href).hostname : '—'}</div>
      </li>`);
  });
  cont.appendChild(box);

  // Monta prompts com conteúdo agregado (Código + Súmulas + títulos/links dos artigos)
  const resumoCodigo = (FICHA?.codigo||[])
    .flatMap(g => g.itens.map(it => `**${it.title}:** ${it.desc}`))
    .join('\n');
  const listaArt = (FICHA?.artigos||[])
    .map(a => `• ${a.title}${a.href?` — ${a.href}`:''}`).join('\n');

  const tema = FICHA?.tema || $('#ficha-titulo').textContent.trim();

  const promptEstudar =
`Você é professor de Direito e vai preparar uma APOSTILA DIDÁTICA sobre ${tema} usando EXCLUSIVAMENTE o conteúdo abaixo.
Entregue: (1) visão geral; (2) síntese comentada dos dispositivos; (3) mapa mental textual; (4) passo a passo prático; (5) erros frequentes; (6) flash points; (7) referências.
CONTEÚDO:
${resumoCodigo}
Artigos citados:
${listaArt}`;

  const promptQuestoes =
`Você é professor de Direito e vai criar 10 QUESTÕES OBJETIVAS (A–E) sobre ${tema} usando EXCLUSIVAMENTE o conteúdo abaixo.
Após as 10, traga gabarito comentado citando artigo/súmula pertinente.
CONTEÚDO:
${resumoCodigo}
Artigos citados:
${listaArt}`;

  $('#btn-estudar').href  = gIA(promptEstudar);
  $('#btn-questoes').href = gIA(promptQuestoes);
}

// ==================== RENDER (PERGUNTAS) ==================
function renderPerguntas(items){
  const pane = $('#pane-perguntas');
  pane.innerHTML = '';
  if(!items?.length){ pane.innerHTML = `<div class="muted">Sem perguntas.</div>`; return; }

  const tema = FICHA?.tema || $('#ficha-titulo').textContent.trim();
  const box = document.createElement('div'); box.className='group';
  box.innerHTML = `<h3>Perguntas</h3><ul class="list"></ul>`;
  const ul = box.querySelector('.list');

  items.forEach(q=>{
    const prompt =
`Tema: ${tema}
Pergunta: "${q}"
Explique objetivamente (5–7 frases), cite o dispositivo aplicável (CPP/CF/Súmulas) e dê 1 exemplo prático.`;
    const href = gIA(prompt);
    ul.insertAdjacentHTML('beforeend', `
      <li class="item">
        <a class="title" href="${href}" target="_blank" rel="noopener">❓ ${esc(shorten(q, 140))}</a>
        <div class="desc">Google (modo IA)</div>
      </li>`);
  });

  pane.appendChild(box);
}

// ======================= TABS UX ==========================
$$('.tab').forEach(btn=>{
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(name){
  $$('.tab').forEach(t=>t.classList.toggle('is-active', t.dataset.tab===name));
  $$('.pane').forEach(p=>p.classList.toggle('is-active', p.id===`pane-${name}`));
}

// ====================== HELPERS ===========================
function shorten(s, n){ s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; }
