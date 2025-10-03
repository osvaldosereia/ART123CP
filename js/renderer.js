import { linkIA, linkJuris, linkYT } from './ia.js';

export function renderChips(container, lista, onSelect){
  container.innerHTML='';
  lista.forEach((a,idx)=>{
    const b=document.createElement('button');
    b.className='chip'; b.textContent=`Art. ${a.artigo}`;
    b.setAttribute('aria-selected', idx===0?'true':'false');
    b.addEventListener('click',()=>{
      [...container.children].forEach(c=>c.setAttribute('aria-selected','false'));
      b.setAttribute('aria-selected','true'); onSelect(a);
    });
    container.appendChild(b);
  });
}

export function renderFicha(el, artigo, extras, openIAMenu){
  el.innerHTML='';
  const card = document.createElement('article'); card.className='card';

  const h = document.createElement('h1'); h.className='article-title';
  h.innerHTML = `<span>Art. ${artigo.artigo}</span> ${artigo.epigrafe?`<span class="badge">${artigo.epigrafe}</span>`:''}`;
  card.appendChild(h);

  el.appendChild(card);
  const wrap = document.createElement('div'); wrap.className='block'; card.appendChild(wrap);

  const renderParte = (label, texto, rel, idParte)=>{
    const cont = document.createElement('section'); cont.className='section';
    const head = document.createElement('div'); head.className='acc-head';
    head.innerHTML = `<div>${label}</div><button class="btn-ia" title="I.A." aria-haspopup="true">🧠</button>`;
    cont.appendChild(head);

    const body = document.createElement('div'); body.className='acc-body'; body.textContent = texto;
    cont.appendChild(body);

    if(rel?.length){
      const relWrap = document.createElement('div'); relWrap.className='block';
      rel.forEach(r=>{
        const chip = document.createElement('span'); chip.className='rel-inline';
        const txt = r.texto || r;
        chip.innerHTML = `
          <span>🔗 ${txt}</span>
          <span class="rel-actions">
            <a class="link-ia" href="${linkIA(txt,'estudar')}" target="_blank" rel="noopener">IA</a>
            <a class="link-ext" href="${linkJuris(txt)}" target="_blank" rel="noopener">Buscar</a>
          </span>`;
        relWrap.appendChild(chip);
      });
      cont.appendChild(relWrap);
    }

    const btn = head.querySelector('.btn-ia');
    btn.addEventListener('click',(ev)=>openIAMenu(ev.currentTarget, {id:idParte, label, texto}));
    return cont;
  };

  if(artigo.partes.some(p=>p.tipo==='caput')){
    const cap = artigo.partes.find(p=>p.tipo==='caput');
    wrap.appendChild(renderParte('Caput', cap.texto, cap.rel, 'caput'));
  }
  artigo.partes.filter(p=>p.tipo!=='caput').forEach(p=>{
    wrap.appendChild(renderParte(`${p.id}`, p.texto, p.rel, p.id));
  });

  const { glossario, artigos:arts, videos, livros } = extras || {};
  if(glossario?.length){
    const s = document.createElement('section'); s.className='section';
    s.innerHTML = `<h2>Glossário</h2>`;
    glossario.forEach(t=>{
      const a = document.createElement('a'); a.className='link-ia'; a.href=linkIA(t,'estudar'); a.target='_blank'; a.textContent=t;
      s.appendChild(a); s.append(' ');
    });
    card.appendChild(s);
  }

  if(arts?.length){
    const s = document.createElement('section'); s.className='section';
    s.innerHTML = `<h2>Artigos</h2>`;
    arts.forEach(t=>{
      const a = document.createElement('a'); a.className='link-ia'; a.href=linkIA(t,'estudar'); a.target='_blank'; a.textContent=t;
      s.appendChild(a); s.append(' ');
    });
    card.appendChild(s);
  }

  if(videos?.length){
    const s = document.createElement('section'); s.className='section';
    s.innerHTML = `<h2>Vídeos</h2>`;
    videos.forEach(t=>{
      const a = document.createElement('a'); a.className='link-ext'; a.href=linkYT(t); a.target='_blank'; a.textContent=t;
      s.appendChild(a); s.append(' ');
    });
    card.appendChild(s);
  }

  if(livros?.length){
    const s = document.createElement('section'); s.className='section';
    s.innerHTML = `<h2>Livros</h2>`;
    livros.forEach(l=>{
      const a = document.createElement('a'); a.className='link-ext'; a.href=l.link; a.target='_blank'; a.textContent=l.titulo;
      s.appendChild(a); s.append(' ');
    });
    card.appendChild(s);
  }
}
