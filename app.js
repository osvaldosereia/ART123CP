/* =========================
   MeuJus – app.js
   Lógica do quiz jurídico
   ========================= */

(() => {
  'use strict';

  /* ===== Utilidades ===== */
  const $  = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

  const homeScreen   = $('#home-screen');
  const quizScreen   = $('#quiz-screen');
  const modal        = $('#modal');
  const modalTitle   = $('#modal-title');
  const modalOpts    = $('#modal-options');
  const quizContainer = $('#quiz-container');
  const btnCategory  = $('#btn-category');
  const btnIA        = $('#btn-ia');
  const btnModalClose = $('#modal-close');

  /* ===== Estado ===== */
  let currentCategory = null;
  let currentTheme = null;
  let questions = [];
  let questionIndex = 0;
  let observer = null;

  /* ===== Dados simulados (estrutura base) ===== */
  const DATA = {
    'Direito Constitucional': ['Direitos Fundamentais', 'Organização do Estado'],
    'Direito Civil': ['Contratos', 'Família'],
    'Direito Penal': ['Crimes Contra a Pessoa', 'Crimes Contra o Patrimônio']
  };

  /* ===== Inicialização ===== */
  document.addEventListener('DOMContentLoaded', () => {
    renderCategories();
    setupListeners();
  });

  /* ===== Renderização da Home ===== */
  function renderCategories() {
    const container = $('#category-list');
    container.innerHTML = '';
    Object.keys(DATA).forEach(cat => {
      const btn = document.createElement('button');
      btn.textContent = cat;
      btn.onclick = () => openModal(cat);
      container.appendChild(btn);
    });
  }

  /* ===== Modal ===== */
  function openModal(category) {
    currentCategory = category;
    modalTitle.textContent = `Escolha um tema de ${category}`;
    modalOpts.innerHTML = '';
    DATA[category].forEach(theme => {
      const btn = document.createElement('button');
      btn.textContent = theme;
      btn.onclick = () => {
        currentTheme = theme;
        closeModal();
        loadQuestions(category, theme);
      };
      modalOpts.appendChild(btn);
    });
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  btnModalClose.onclick = closeModal;

  /* ===== Transições ===== */
  function showScreen(screen) {
    $$('.screen').forEach(s => s.classList.add('hidden'));
    screen.classList.remove('hidden');
  }

  /* ===== Carregamento de Questões ===== */
  async function loadQuestions(category, theme) {
    showScreen(quizScreen);
    quizContainer.innerHTML = '<p style="text-align:center;color:#777;margin-top:2rem;">Carregando questões...</p>';

    // Corrige o caminho base automaticamente (funciona no GitHub Pages e local)
    const base = `${window.location.origin}${window.location.pathname.split('/').slice(0, -1).join('/')}`;
    const file = `${base}/data/${category.toLowerCase().replace(/\s+/g,'-')}/${theme.toLowerCase().replace(/\s+/g,'-')}.json`;

    try {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      questions = data.questoes || data; // aceita formato com chave ou direto
    } catch (err) {
      console.warn('⚠️ Erro ao carregar JSON:', err);
      quizContainer.innerHTML = `
        <div style="text-align:center;margin-top:2rem;color:#a00;">
          <p><strong>⚠️ Não foi possível carregar as questões.</strong></p>
          <p style="font-size:.9rem;word-break:break-all;">Arquivo tentado:<br><code>${file}</code></p>
        </div>`;
      return;
    }

    quizContainer.innerHTML = '';
    questionIndex = 0;
    renderQuestionsBatch();
    setupInfiniteScroll();
  }

  /* ===== Renderização de Questões ===== */
  function renderQuestionsBatch(batchSize = 3) {
    const frag = document.createDocumentFragment();

    for (let i = 0; i < batchSize && questionIndex < questions.length; i++) {
      const q = questions[questionIndex++];
      const el = createQuestionElement(q);
      frag.appendChild(el);

      if (questionIndex % 3 === 0) frag.appendChild(createAdPlaceholder());
    }

    quizContainer.appendChild(frag);
  }

  function createQuestionElement(q) {
    const div = document.createElement('div');
    div.className = 'question';

    const title = document.createElement('h3');
    title.textContent = q.enunciado;
    div.appendChild(title);

    const opts = document.createElement('div');
    opts.className = 'options';

    q.opcoes.forEach(op => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.textContent = op;
      btn.onclick = () => handleAnswer(btn, op, q);
      opts.appendChild(btn);
    });

    div.appendChild(opts);
    return div;
  }

  function createAdPlaceholder() {
    const tpl = $('#ad-template').content.cloneNode(true);
    const div = tpl.querySelector('.ad-placeholder');
    div.textContent = 'Publicidade';
    return tpl;
  }

  /* ===== Lógica de resposta ===== */
  function handleAnswer(btn, selected, q) {
    const options = btn.parentElement.querySelectorAll('.option');
    options.forEach(o => o.disabled = true);

    if (selected.startsWith(q.correta)) {
      btn.classList.add('correct');
      addComment(btn, "✅ Correto!");
    } else {
      btn.classList.add('wrong');
      const correct = Array.from(options).find(o => o.textContent.startsWith(q.correta));
      if (correct) correct.classList.add('correct');
      addComment(btn, `❌ ${q.comentario}`);
    }
  }

  function addComment(btn, text) {
    const c = document.createElement('p');
    c.className = 'comment';
    c.textContent = text;
    btn.parentElement.after(c);
  }

  /* ===== Scroll Infinito ===== */
  function setupInfiniteScroll() {
    if (observer) observer.disconnect();
    const sentinel = document.createElement('div');
    sentinel.id = 'sentinel';
    quizContainer.appendChild(sentinel);

    observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) renderQuestionsBatch();
    });
    observer.observe(sentinel);
  }

  /* ===== Botão de Categoria (topbar) ===== */
  function setupListeners() {
    btnCategory.onclick = () => openModal(currentCategory || 'Direito Constitucional');
  }

  /* ===== IA ===== */
  btnIA.onclick = () => {
    const last = questions[questionIndex - 1];
    if (!last) return;
    const query = encodeURIComponent(`${last.enunciado}\nResposta correta: ${last.correta}\nExplique detalhadamente.`);
    const url = `https://www.google.com/search?q=${query}&udm=50`;
    window.open(url, '_blank');
  };

})();
