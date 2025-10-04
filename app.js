
let temas = [];
let sugestoesEl = document.getElementById('sugestoes');
let inputBusca = document.getElementById('busca');
let conteudo = document.getElementById('conteudo');

fetch('temas.json')
  .then(res => res.json())
  .then(json => temas = json);

inputBusca.addEventListener('input', () => {
  const termo = inputBusca.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const resultados = temas.filter(t =>
    t.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(termo)
  ).slice(0, 10);

  sugestoesEl.innerHTML = resultados.map(r => `<li data-pasta="${r.pasta}" data-arquivo="${r.arquivo}">${r.nome}</li>`).join("");
  sugestoesEl.style.display = resultados.length ? "block" : "none";
});

sugestoesEl.addEventListener('click', e => {
  if (e.target.tagName === 'LI') {
    const pasta = e.target.dataset.pasta;
    const arquivo = e.target.dataset.arquivo;
    const nome = e.target.textContent;
    inputBusca.value = nome;
    sugestoesEl.style.display = "none";
    carregarFicha(pasta, arquivo, nome);
  }
});

function carregarFicha(pasta, arquivo, nome) {
  fetch(`data/${pasta}/${arquivo}`)
    .then(res => res.text())
    .then(texto => {
      conteudo.innerHTML = `<h1>${nome}</h1><pre>${texto}</pre>`;
    });
}
