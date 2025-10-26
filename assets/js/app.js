// meujus — minimal, data-efficient quiz
(() => {
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const app = $('#app');
const tplIntro = $('#tpl-intro');
const tplReady = $('#tpl-ready');
const tplQ = $('#tpl-question');


// State kept minimal
const state = {
disc: null,
tema: null,
provas: [], // ["p1","p3",...]
cursor: -1, // index into provas embaralhadas
provaId: null, // e.g., "p3"
questions: null, // lazy array of questions
i: 0, // current question index
answered: new Map(), // i -> { pickedIdx, correctIdx }
};


// Config: list of disciplinas and temas (tiny to avoid extra fetch). Extend as needed.
const DB = {
direitopenal: {
label: 'Direito Penal',
temas: { calunia: 'Calúnia' }
},
// adicione outras disciplinas aqui
};


// URL helpers
const params = new URLSearchParams(location.search);
function syncURL() {
const p = new URLSearchParams();
if (state.disc) p.set('disc', state.disc);
if (state.tema) p.set('tema', state.tema);
if (state.provaId) p.set('prova', state.provaId);
history.replaceState(null, '', `?${p.toString()}`);
}


function createSelect(btn, getOptions, onSelect){
  const list = document.getElementById(btn.getAttribute('aria-controls')) || btn.nextElementSibling;
  function open(){ const opts=getOptions(); if(!opts.length) return;
    list.innerHTML='';
    opts.forEach(o=>{ const li=document.createElement('li'); li.role='option'; li.textContent=o.label; li.dataset.val=o.value; list.appendChild(li); });
    const r=btn.getBoundingClientRect();
    list.style.position='absolute'; list.style.left=`${r.left+scrollX}px`; list.style.top=`${r.bottom+2+scrollY}px`; list.style.minWidth=`${r.width}px`;
    btn.setAttribute('aria-expanded','true'); list.hidden=false;
  }
  function close(){ btn.setAttribute('aria-expanded','false'); list.hidden=true; }
  btn.addEventListener('click',()=> list.hidden?open():close());
  document.addEventListener('click',e=>{ if(!btn.contains(e.target)&&!list.contains(e.target)) close(); });
  list.addEventListener('click',e=>{ const li=e.target.closest('li'); if(!li) return;
    onSelect(li.dataset.val, li.textContent);
    btn.querySelector('.select-value').textContent=li.textContent;
    close();
  });
}

