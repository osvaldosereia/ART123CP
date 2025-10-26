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


// Simple custom select
function setupSelect(id, options) {
const root = $(id);
const list = $(root.getAttribute('aria-controls') ? `#${root.getAttribute('aria-controls')}` : null) || root.nextElementSibling;
function open() { if (list.children.length) { root.setAttribute('aria-expanded','true'); list.hidden = false; positionList(); } }
function close() { root.setAttribute('aria-expanded','false'); list.hidden = true; }
function positionList(){ const r = root.getBoundingClientRect(); list.style.position='absolute'; list.style.left = `${r.left}px`; list.style.top = `${r.bottom+2}px`; list.style.minWidth = `${r.width}px`; }
function fill(opts){ list.innerHTML=''; opts.forEach(o=>{ const li=document.createElement('li'); li.role='option'; li.textContent=o.label; li.dataset.val=o.value; list.appendChild(li); }); }


fill(options.get());
root.addEventListener('click', () => { list.hidden ? open() : close(); });
root.addEventListener('keydown', e => { if (e.key==='Enter' || e.key===' ') { e.preventDefault(); list.hidden?open():close(); } if (e.key==='Escape') close(); });
document.addEventListener('click', e => { if (!root.contains(e.target) && !list.contains(e.target)) close(); });
list.addEventListener('click', e => {
const li = e.target.closest('li'); if (!li) return;
options.onSelect(li.dataset.val);
$('.select-value', root).textContent = li.textContent;
})();
