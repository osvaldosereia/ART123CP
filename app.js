/* app.js — parser único para TXT no formato especificado. Sem suporte a formatos antigos. */
"use strict";

/** ========= Núcleo de parsing ========= **/

/**
 * Converte um texto .txt no formato especificado em uma lista de questões.
 * Regras:
 * - Blocos separados por linhas que contenham apenas `-----` (com ou sem espaços).
 * - Enunciado: uma ou mais linhas iniciadas por `* ` (um asterisco e espaço).
 * - Alternativas: linhas iniciadas por `** X) ` onde X ∈ {A,B,C,D,E}.
 * - Gabarito: linha única iniciada por `*** Gabarito: ` seguida por uma letra válida.
 * @param {string} rawTxt
 * @returns {{questions: ParsedQuestion[], warnings: string[]}}
 */
function parseTxt(rawTxt) {
  if (typeof rawTxt !== "string") {
    throw new TypeError("Entrada deve ser string");
  }

  const lines = normalizeNewlines(rawTxt).split("\n");

  /** @type {ParsedQuestion[]} */
  const out = [];
  /** @type {string[]} */
  const warnings = [];

  /** Estado do bloco em construção */
  let cur = resetCurrent();

  const pushIfComplete = () => {
    if (!cur.hasData) return;

    const q = finalizeCurrent(cur);
    validateQuestion(q, warnings);
    out.push(q);
    cur = resetCurrent();
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trimEnd();

    // Separador de blocos
    if (isSeparator(line)) {
      pushIfComplete();
      continue;
    }

    // Linha vazia entre partes do mesmo bloco
    if (line.trim() === "") {
      // preserva linhas em branco do enunciado, se já estamos em enunciado e ainda não iniciamos alternativas
      if (cur.stage === "stem") cur.stem.push("");
      continue;
    }

    // Gabarito
    const g = parseGabarito(line);
    if (g) {
      cur.answer = g;
      cur.stage = "answer";
      cur.hasData = true;
      continue;
    }

    // Alternativa
    const alt = parseAlternativa(line);
    if (alt) {
      cur.options.push(alt);
      cur.stage = "options";
      cur.hasData = true;
      continue;
    }

    // Enunciado: linha começando com "* "
    const stemLine = parseStemLine(line);
    if (stemLine !== null) {
      cur.stem.push(stemLine);
      cur.stage = "stem";
      cur.hasData = true;
      continue;
    }

    // Se cair aqui, é ruído dentro do bloco: anexar ao enunciado se nada além do enunciado foi iniciado
    if (cur.stage === "stem" || !cur.hasData) {
      cur.stem.push(line);
      cur.hasData = true;
      continue;
    } else if (cur.stage === "options") {
      // Texto solto após alternativas não é permitido pelo formato. Aviso e ignorar.
      warnings.push(warn(idx + 1, "Linha ignorada: conteúdo fora do padrão após alternativas."));
      continue;
    } else if (cur.stage === "answer") {
      warnings.push(warn(idx + 1, "Linha ignorada: conteúdo após gabarito."));
      continue;
    }
  }

  // Final do arquivo: empurrar último bloco
  pushIfComplete();

  // Filtrar questões vazias ocasionais
  const filtered = out.filter(q => q.stem.trim().length > 0);

  return { questions: filtered, warnings };
}

/** ========= Utilidades de parsing ========= **/

/** @typedef {{ id: string, stem: string, stemLines: string[], options: {key: string, text: string}[], answer: string }} ParsedQuestion */

function normalizeNewlines(s) {
  return s.replace(/\r\n?/g, "\n");
}
function isSeparator(line) {
  return /^-+\s*$/.test(line);
}
function parseStemLine(line) {
  // aceita "* " no início exato
  if (line.startsWith("* ")) return line.slice(2);
  return null;
}
function parseAlternativa(line) {
  // ** A) Texto
  const m = /^\*\*\s*([A-E])\)\s*(.+)$/.exec(line);
  if (!m) return null;
  return { key: m[1], text: m[2].trim() };
}
function parseGabarito(line) {
  // *** Gabarito: C
  const m = /^\*\*\*\s*Gabarito:\s*([A-E])\s*$/.exec(line);
  return m ? m[1] : null;
}
function resetCurrent() {
  return /** @type {{hasData:boolean, stage:"empty"|"stem"|"options"|"answer", stem:string[], options:{key:string,text:string}[], answer:string|null}} */ ({
    hasData: false,
    stage: "empty",
    stem: [],
    options: [],
    answer: null,
  });
}
function finalizeCurrent(cur) {
  /** @type {ParsedQuestion} */
  const q = {
    id: cryptoId(),
    stemLines: trimEmptyEdges(cur.stem),
    stem: joinStem(trimEmptyEdges(cur.stem)),
    options: cur.options.slice(),
    answer: cur.answer ?? "",
  };
  return q;
}
function joinStem(lines) {
  // Preserva parágrafos conforme linhas, unindo por "\n"
  return lines.join("\n").trim();
}
function trimEmptyEdges(lines) {
  let a = 0, b = lines.length;
  while (a < b && lines[a].trim() === "") a++;
  while (b > a && lines[b - 1].trim() === "") b--;
  return lines.slice(a, b);
}
function validateQuestion(q, warnings) {
  const keys = new Set(q.options.map(o => o.key));
  const missing = [];
  for (const k of ["A", "B", "C", "D", "E"]) {
    if (!keys.has(k)) missing.push(k);
  }
  if (missing.length > 0) {
    warnings.push(`Questão "${shorten(q.stem)}": alternativas ausentes: ${missing.join(", ")}.`);
  }
  if (!q.answer) {
    warnings.push(`Questão "${shorten(q.stem)}": gabarito ausente.`);
  } else if (!keys.has(q.answer)) {
    warnings.push(`Questão "${shorten(q.stem)}": gabarito "${q.answer}" não corresponde a alternativa existente.`);
  }
}
function warn(lineNumber, msg) {
  return `L${lineNumber}: ${msg}`;
}
function shorten(s, n = 80) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}
function cryptoId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "q_" + Math.random().toString(36).slice(2, 10);
}

/** ========= API pública ========= **/

/**
 * Faz o parse e retorna apenas as questões.
 * @param {string} txt
 * @returns {ParsedQuestion[]}
 */
function parseQuestions(txt) {
  return parseTxt(txt).questions;
}

/**
 * Faz o parse e retorna resultado com warnings.
 * @param {string} txt
 * @returns {{questions: ParsedQuestion[], warnings: string[]}}
 */
function parseWithWarnings(txt) {
  return parseTxt(txt);
}

/**
 * Exporta em JSON estável para salvar.
 * @param {ParsedQuestion[]} questions
 * @returns {string}
 */
function toJSON(questions) {
  return JSON.stringify({ version: 1, format: "txt:v1", count: questions.length, questions }, null, 2);
}

/** ========= UI opcional, ativada se elementos existirem ========= **/

/* IDs suportados no HTML (opcional):
   - #filePicker (input[type=file])
   - #txtInput (textarea)       // alternativa ao file
   - #parseBtn (button)         // dispara parse do textarea
   - #downloadJsonBtn (button)  // baixa JSON
   - #warnings (pre)            // exibe avisos
   - #questionsContainer (div)  // render das questões
*/

document.addEventListener("DOMContentLoaded", () => {
  const $file = document.getElementById("filePicker");
  const $txt = document.getElementById("txtInput");
  const $parse = document.getElementById("parseBtn");
  const $dl = document.getElementById("downloadJsonBtn");
  const $warn = document.getElementById("warnings");
  const $list = document.getElementById("questionsContainer");

  /** @type {ParsedQuestion[]} */
  let lastQuestions = [];

  const renderWarnings = (warnings) => {
    if (!$warn) return;
    $warn.textContent = warnings.length ? warnings.join("\n") : "";
  };

  const renderQuestions = (questions) => {
    if (!$list) return;
    $list.innerHTML = "";
    questions.forEach((q, i) => {
      const card = document.createElement("div");
      card.className = "qcard";
      card.style.border = "1px solid #ddd";
      card.style.borderRadius = "12px";
      card.style.padding = "12px";
      card.style.margin = "10px 0";

      const h = document.createElement("div");
      h.textContent = `Q${i + 1}`;
      h.style.fontWeight = "600";
      h.style.marginBottom = "8px";
      card.appendChild(h);

      const stem = document.createElement("pre");
      stem.textContent = q.stem;
      stem.style.whiteSpace = "pre-wrap";
      stem.style.margin = "0 0 8px 0";
      card.appendChild(stem);

      const ul = document.createElement("ul");
      ul.style.margin = "0 0 8px 16px";
      for (const opt of q.options) {
        const li = document.createElement("li");
        li.textContent = `${opt.key}) ${opt.text}`;
        ul.appendChild(li);
      }
      card.appendChild(ul);

      const ans = document.createElement("div");
      ans.textContent = `Gabarito: ${q.answer || "—"}`;
      ans.style.fontFamily = "monospace";
      card.appendChild(ans);

      $list.appendChild(card);
    });
  };

  const doParse = (txt) => {
    const { questions, warnings } = parseWithWarnings(txt);
    lastQuestions = questions;
    renderWarnings(warnings);
    renderQuestions(questions);
  };

  if ($file) {
    $file.addEventListener("change", async (e) => {
      const f = /** @type {HTMLInputElement} */(e.target).files?.[0];
      if (!f) return;
      const txt = await f.text();
      doParse(txt);
    });
  }

  if ($parse && $txt) {
    $parse.addEventListener("click", () => {
      doParse($txt.value || "");
    });
  }

  if ($dl) {
    $dl.addEventListener("click", () => {
      const blob = new Blob([toJSON(lastQuestions)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `questions-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    });
  }
});

/** ========= Exposição global para uso externo ========= **/
window.QuestionsTxt = {
  parseQuestions,
  parseWithWarnings,
  toJSON,
};

/** ========= Tipos JSDoc ========= **/
/**
 * @typedef {Object} ParsedQuestion
 * @property {string} id
 * @property {string} stem
 * @property {string[]} stemLines
 * @property {{key:string,text:string}[]} options
 * @property {string} answer
 */

