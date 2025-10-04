// meujus – app.js (ajustes 2025-10-04)
// ------------------------------
// Render helpers
// ------------------------------
function prefixAteDoisPontos(line){
const idx = line.indexOf(':');
if(idx>0) return line.slice(0, idx).trim();
// fallback: até o primeiro ponto final após número
const m = line.match(/^(Art\.?\s*\d+[A-Z\-]*)(?=\s)/i);
return m ? m[1] : line.slice(0, Math.min(40, line.length));
}


function buildJusBrasilURL(prefix){
const q = encodeURIComponent(prefix);
return `https://www.jusbrasil.com.br/legislacao/busca?q=${q}`;
}


function slugify(s){
return normalize(String(s)).toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
}


// ------------------------------
// Tema
// ------------------------------
async function loadTema(slug){
const titleEl = $('#themeTitle');
const listEl = $('#content');
listEl.innerHTML = 'Carregando…';


// descobrir arquivo do tema
const file = TEMA_MAP[slug];
if(!file){ listEl.textContent = 'Tema não encontrado.'; return; }


// carrega glossário em paralelo
await loadGlossario();


try{
const raw = await fetchText(file);
// cada linha é um item de artigo
const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);


// título
const tituloTema = slug.replace(/-/g,' ');
titleEl.textContent = tituloTema;


// botão IA
const btnIA = $('#btnIA');
btnIA.onclick = ()=>{
// Google Bard / IA. Apenas abre com o tema no query.
const prompt = `Estudar tema: ${tituloTema}`;
const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(prompt)}`;
window.open(url, '_blank', 'noopener');
};


// monta HTML
const html = lines.map((line)=>{
const prefix = prefixAteDoisPontos(line);
const href = buildJusBrasilURL(prefix);
const text = line; // corpo sem link
})();
