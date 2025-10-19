/* app.js — Parser exclusivo para TXT no formato especificado. Sem legado. */
"use strict";

/** ========================= Núcleo de parsing ========================= **/

/**
 * Converte o conteúdo TXT no formato padronizado em uma lista de questões.
 * Regras:
 * - Blocos separados por linha contendo apenas traços: `-----` (com ou sem espaços).
 * - Enunciado: linhas iniciando com `* `, podem ser múltiplas e intercaladas com linhas em branco.
 * - Alternativas: linhas iniciando com `** X) ` onde X ∈ {A,B,C,D,E}.
 * - Gabarito: linha única `*** Gabarito: X` onde X ∈ {A,B,C,D,E}.
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

  let cur = resetCurrent();

  const pushIfComplete = () => {
    if (!cur.hasData) return;
    const q = finalizeCurrent(cur);
    validateQuestion(q, warnings);
    out.push(q);
    cur = resetCurrent();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Separador de blocos
    if (isSeparator(line)) {
      pushIfComplete();
      continue;
    }

    // Linha vazia: preserva como parágrafo do enunciado enquanto em "stem"
    if (line.trim() === "") {
      if (cur.stage === "stem") {
        cur.stem.push("");
        cur.hasData = true;
      }
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
      if (cur.options.some(o => o.key === alt.key)) {
        warnings.push(warn(i + 1, `Alternativa "${alt.key}" repetida; linha ignorada.`));
      } else {
        cur.options.push(alt);
      }
      cur.stage = "options";
      cur.hasData = true;
      continue;
    }

    // Enunciado
    const stemLine = parseStemLine(line);
    if (stemLine !== null) {
      cur.stem.push(stemLine);
      cur.stage = "stem";
      cur.hasData = true;
      continue;
    }

    // Ruído: agrega ao enunciado se só houver enunciado; do contrário avisa e ignora
    if (cur.stage === "stem" || !cur.hasData) {
      cur.stem.push(line);
      cur.hasData = true;
      continue;
    } else if (cur.stage === "options") {
      warnings.push(warn(i + 1, "Linha ignorada: conteúdo fora do padrão após alternativas."));
      continue;
    } else if (cur.stage === "answer") {
      warnings.push(warn(i + 1, "Linha ignorada: conteúdo após gabarito."));
      continue;
    }
  }

  // Fim do arquivo
  pushIfComplete();

  // Filtra questões sem enunciado útil
  const questions = out.filter(q => q.stem.trim().length > 0);
  return { questions, warnings };
}

/** ========================= Utilidades ========================= **/

/** @typedef {{ id: string, stem: string, stemLines: string[], options: {key: string, text: string}[], answer: string }} ParsedQuestion */

function normalizeNewlines(s) {
  return s.replace(/\r\n?/g, "\n");
}
function isSeparator(line) {
  return /^-+\s*$/.test(line);
}
function parseStemLine(line) {
  return line.startsWith("* ") ? line.slice(2) : null;
}
function parseAlternativa(line) {
  // ** A) Texto...
  const m = /^\*\*\s*([A-E])\)\s*(.+)$/.exec(line);
  if (!m) return null;
  return { key: m[1], text: m[2].trim() };
}
function parseGabarito(line) {
  const m = /^\*\*\*\s*Gabarito:\s*([A-E])\s*$/.exec(line);
  return m ? m[1] : null;
}
function resetCurrent() {
  return {
    hasData: false,
    stage: "empty", // "empty" | "stem" | "options" | "answer"
    stem: [],
    options: [],
    answer: null,
  };
}
function finalizeCurrent(cur) {
  const stemLines = trimEmptyEdges(cur.stem);
  /** @type {ParsedQuestion} */
  return {
    id: cryptoId(),
    stemLines,
    stem: joinStem(stemLines),
    options: cur.options.slice(),
    answer: cur.answer ?? "",
  };
}
function joinStem(lines) {
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
  for (const k of ["A", "B", "C", "D", "E"]) if (!keys.has(k)) missing.push(k);
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
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return "q_" + Math.random().toString(36).slice(2, 10);
}

/** ========================= API pública ========================= **/

/**
 * Retorna apenas as questões.
 * @param {string} txt
 * @returns {ParsedQuestion[]}
 */
function parseQuestions(txt) {
  return parseTxt(txt).questions;
}

/**
 * Retorna questões e avisos.
 * @param {string} txt
 * @returns {{questions: ParsedQuestion[], warnings: string[]}}
 */
function parseWithWarnings(txt) {
  return parseTxt(txt);
}

/**
 * Serializa em JSON estável.
 * @param {ParsedQuestion[]} questions
 * @returns {string}
 */
function toJSON(questions) {
  return JSON.stringify({ version: 1, format: "txt:v1", count: questions.length, questions }, null, 2);
}

/** ========================= UI opcional (progressive enhancement) =========================
 * IDs esperados no HTML, caso existam:
 *  - #filePicker (input[type=file])
 *  - #txtInput (textarea)
 *  - #parseBtn (button)
 *  - #downloadJsonBtn (button)
 *  - #warnings (pre)
 *  - #questionsContainer (div)
 */
document.addEventListener("DOMContentLoaded", () => {
  try {
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
      console.debug("[QuestionsTxt] parsed", { count: questions.length, warnings });
    };

    if ($file) {
      $file.addEventListener("change", async (e) => {
        try {
          const input = /** @type {HTMLInputElement} */ (e.target);
          const f = input.files && input.files[0];
          if (!f) return;
          const txt = await f.text();
          doParse(txt);
        } catch (err) {
          console.error("[QuestionsTxt] erro lendo arquivo:", err);
          alert("Erro ao ler o arquivo selecionado.");
        }
      });
    }

    if ($parse && $txt) {
      $parse.addEventListener("click", () => {
        try {
          doParse($txt.value || "");
        } catch (err) {
          console.error("[QuestionsTxt] erro no parse:", err);
          alert("Erro no parse. Veja o console para detalhes.");
        }
      });
    }

    if ($dl) {
      $dl.addEventListener("click", () => {
        try {
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
        } catch (err) {
          console.error("[QuestionsTxt] erro no download:", err);
          alert("Erro ao preparar o download do JSON.");
        }
      });
    }

    // Autoteste opcional: cria uma função global para você colar o texto e ver o resultado no console
    window.debugParse = function (sampleTxt) {
      const res = parseWithWarnings(sampleTxt);
      console.log("[debugParse] resultado:", res);
      return res;
    };
  } catch (err) {
    console.error("[QuestionsTxt] falha na inicialização da UI:", err);
  }
});

/** ========================= Exposição global e Node ========================= **/
const api = { parseQuestions, parseWithWarnings, toJSON };
if (typeof window !== "undefined") {
  window.QuestionsTxt = api;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

/** ========================= Tipos JSDoc ========================= **/
/**
 * @typedef {Object} ParsedQuestion
 * @property {string} id
 * @property {string} stem
 * @property {string[]} stemLines
 * @property {{key:string,text:string}[]} options
 * @property {string} answer
 */
