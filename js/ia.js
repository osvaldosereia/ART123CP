import { CONFIG } from './config.js';

export function linkIA(texto, tipo='estudar'){
  const base = CONFIG.urlIA;
  const prompt = (tipo==='questoes'? CONFIG.promptQuestoes : CONFIG.promptEstudar) + texto;
  return base + encodeURIComponent(prompt);
}
export function linkJuris(term){ return CONFIG.urlJus + encodeURIComponent(term); }
export function linkYT(title){ return CONFIG.urlYT + encodeURIComponent(title); }
