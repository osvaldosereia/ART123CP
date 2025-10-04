// === Autocomplete básico ===
let temas = [];
const elSug = document.getElementById('sugestoes');
const elBusca = document.getElementById('busca');
const elMain  = document.getElementById('conteudo');

fetch('temas.json').then(r=>r.json()).then(j=>temas=j);

const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
elBusca.addEventListener('input', () => {
  const termo = norm(elBusca.value);
  const res = temas.filter(t => norm(t.nome).includes(termo)).slice(0,10);
  elSug.innerHTML = res.map(r=>`<li data-pasta="${r.pasta}" data-arquivo="${r.arquivo}">${r.nome}</li>`).join('');
  elSug.style.display = res.length ? 'block' : 'none';
});
elSug.addEventListener('click', e => {
  if(e.target.tagName!=='LI') return;
  const { pasta, arquivo } = e.target.dataset; const nome = e.target.textContent;
  elBusca.value = nome; elSug.style.display='none';
  carregarFicha(pasta, arquivo, nome);
});

// === Carregar TXT e renderizar como ficha ===
async function carregarFicha(pasta, arquivo, nome){
  const txt = await fetch(`data/${pasta}/${arquivo}`).then(r=>r.text());
  const ficha = parseTxtParaFicha(txt, nome);
  renderFicha(ficha);
}

// Parser minimalista para o formato do seu TXT
function parseTxtParaFicha(txt, nome){
  const out = { tema: nome, secoes: [] };
  // quebra por títulos "### **..." ou linhas 100% maiúsculas
  const linhas = txt.split(/\r?\n/);
  let atual = null;

  const ehTitulo = (l) =>
    /^###\s*\*\*/.test(l) ||
    (/^[A-ZÀ-Ú0-9 ().:/-]{8,}$/.test(l.trim()) && !l.trim().startsWith('*') && !l.trim().match(/https?:\/\//));

  for(const l of linhas){
    if(ehTitulo(l)){
      const t = l.replace(/^###\s*\*\*/,'').replace(/\*\*$/,'').trim();
      atual = { titulo: t || l.trim(), itens: [] };
      out.secoes.push(atual);
      continue;
    }
    if(!atual){ // cabeçalho inicial
      atual = { titulo: 'Introdução', itens: [] };
      out.secoes.push(atual);
    }
    if(l.trim().startsWith('* ')){
      atual.itens.push({ tipo: 'bullet', texto: l.trim().slice(2) });
    } else if (/^\d+\.\s/.test(l.trim())){
      atual.itens.push({ tipo: 'num', texto: l.trim().replace(/^\d+\.\s/,'') });
    } else if (l.trim().length){
      // linhas simples (descrição)
      atual.itens.push({ tipo: 'texto', texto: l.trim() });
    }
  }
  return out;
}

// Render com chips para filtrar seções
function renderFicha(f){
  const chips = f.secoes.map((s,i)=>`<button class="chip" data-i="${i}">${esc(s.titulo)}</button>`).join('');
  const blocos = f.secoes.map((s,i)=>`
    <section class="bloco" data-i="${i}">
      <h2>${esc(s.titulo)}</h2>
      <ul class="lista">
        ${s.itens.map(it => `<li class="${it.tipo}">${linkify(esc(it.texto))}</li>`).join('')}
      </ul>
    </section>
  `).join('');

  elMain.innerHTML = `
    <h1>${esc(f.tema)}</h1>
    <nav class="chips">${chips}</nav>
    <div class="blocos">${blocos}</div>
  `;

  // interação chips
  const allChips = elMain.querySelectorAll('.chip');
  const allBlocos = elMain.querySelectorAll('.bloco');
  function ativar(i){
    allChips.forEach((c,idx)=>c.classList.toggle('ativo', idx==i));
    allBlocos.forEach((b)=>b.style.display = (b.dataset.i==i? 'block':'none'));
  }
  allChips.forEach(c=>c.addEventListener('click',()=>ativar(+c.dataset.i)));
  ativar(0); // abre primeira seção
}

// Helpers
function esc(s){ return s.replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function linkify(s){
  return s.replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// Carrega um padrão (se desejar)
if(temas.length===0){
  // fallback ao arquivo de exemplo do pacote
  carregarFicha('codigo-penal','inquerito-policial.txt','Inquérito Policial');
}
