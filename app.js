"use strict";

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
function toast(msg, t=2000){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),t);}

let DATA={}, QUESTOES=[], filtroTemas=new Set(), loaded=0;

document.addEventListener("DOMContentLoaded",()=>{
  carregarDisciplinas();
  $("#disciplinaSelect").addEventListener("change", carregarQuestoes);
});

async function carregarDisciplinas(){
  const disciplinas=["direito-penal","direito-civil"];
  const select=$("#disciplinaSelect");
  select.innerHTML=disciplinas.map(d=>`<option value="${d}">${d.replace("direito-","Direito ")}</option>`).join("");
  carregarQuestoes();
}

async function carregarQuestoes(){
  const disc=$("#disciplinaSelect").value;
  const path=`data/${disc}/${disc.split("-")[1]}1.txt`;
  const txt=await fetch(path).then(r=>r.text());
  QUESTOES=parseTXT(txt);
  toast(`${QUESTOES.length} questões carregadas`);
  montarTemas();
  render(0,3);
  observerSetup();
}

function parseTXT(txt){
  const blocos=txt.split("-----").map(b=>b.trim()).filter(Boolean);
  return blocos.map(b=>{
    const ano=(b.match(/Ano:\s*(\d{4})/)||[])[1]||"";
    const banca=(b.match(/Banca:\s*(.*?)\|/)||[])[1]||"";
    const orgao=(b.match(/\|\s*Órgão:\s*(.*)/)||[])[1]||"";
    const enunciado=(b.match(/\*[\s\S]*?(?=\*\*)/)||[""])[0].replace(/\*/g,"").trim();
    const alternativas=[...b.matchAll(/\*\*\s*([A-E])\)\s*(.*)/g)].map(m=>({letra:m[1],texto:m[2]}));
    const gabarito=(b.match(/\*\*\*\s*Gabarito:\s*(.*)/)||[])[1]||"";
    const tema=(b.match(/\*\*\*\*\s*(.*)/)||[])[1]||"";
    return {ano,banca,orgao,enunciado,alternativas,gabarito,tema};
  });
}

function montarTemas(){
  const temas=[...new Set(QUESTOES.map(q=>q.tema).filter(Boolean))].sort();
  const nav=$("#temas");
  nav.innerHTML=temas.map(t=>`<button>${t}</button>`).join("");
  nav.onclick=e=>{
    if(e.target.tagName!=="BUTTON")return;
    const t=e.target.textContent;
    e.target.classList.toggle("active");
    filtroTemas.has(t)?filtroTemas.delete(t):filtroTemas.add(t);
    render(0,3,true);
  };
}

function render(start=0,count=3,reset=false){
  const area=$("#quiz");
  if(reset){area.innerHTML="";loaded=0;}
  const list=filtroTemas.size?[...QUESTOES].filter(q=>filtroTemas.has(q.tema)):QUESTOES;
  const slice=list.slice(start,start+count);
  slice.forEach(q=>{
    const card=document.createElement("div");
    card.className="quiz-card";
    card.innerHTML=`
      <h4>Ano: ${q.ano} | Banca: ${q.banca} | Órgão: ${q.orgao}</h4>
      <p>${q.enunciado}</p>
      <div class="options">${q.alternativas.map(a=>`<button>${a.letra}) ${a.texto}</button>`).join("")}</div>
      <div class="actions">
        <button class="ia">Google I.A.</button>
        <button class="share">Compartilhar</button>
      </div>`;
    area.appendChild(card);

    const opts=card.querySelectorAll(".options button");
    opts.forEach(btn=>{
      btn.onclick=()=>{
        opts.forEach(b=>b.disabled=true);
        if(btn.textContent.startsWith(q.gabarito)) btn.classList.add("correct");
        else btn.classList.add("wrong");
      };
    });
  });
  loaded+=slice.length;
}

function observerSetup(){
  const sentinel=document.createElement("div");
  sentinel.id="sentinel";$("#quiz").appendChild(sentinel);
  const obs=new IntersectionObserver(entries=>{
    if(entries[0].isIntersecting){
      render(loaded,3);
    }
  });
  obs.observe(sentinel);
}
