// app.js — usa pdfjsLib global (sem import ESM)

const { useEffect, useMemo, useState } = React;

const uniq = (a) => Array.from(new Set(a));
const normalizeSpaces = (s) => (s || "").replace(/\s+/g, " ").trim();
const slug = (s) =>
  (s || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function parseCategoriaTemas(line) {
  const gtIdx = line.indexOf(">"); if (gtIdx === -1) return { categoria: "", temas: [] };
  const right = normalizeSpaces(line.slice(gtIdx + 1));
  let categoria = "", temasRaw = "";
  const comma = right.indexOf(",");
  if (comma >= 0) { categoria = normalizeSpaces(right.slice(0, comma)); temasRaw = right.slice(comma + 1); }
  else { const parts = right.split(" "); categoria = parts.slice(0, 2).join(" ") || right; temasRaw = right.slice(categoria.length); }
  const temas = temasRaw.split(/,|\s{2,}|\s\,\s/).map((t) => normalizeSpaces(t)).filter(Boolean).map((t) => t.replace(/^>+/, ""));
  return { categoria: normalizeSpaces(categoria), temas };
}
function parseAlternativas(block) {
  const alts = []; const lines = block.split(/\n+/); const re = /^([A-E])\s*[\)\.\-]\s*(.*)$/i;
  for (const ln of lines) { const m = ln.match(re); if (m) alts.push({ label: m[1].toUpperCase(), text: normalizeSpaces(m[2]) }); }
  if (!alts.length) {
    const m2 = block.match(/\b([A-E])\)\s*([^A-E]+?)(?=(?:\s+[A-E]\)|$))/gis);
    if (m2) for (const seg of m2) { const m = seg.match(/^([A-E])\)\s*(.*)$/is); if (m) alts.push({ label: m[1].toUpperCase(), text: normalizeSpaces(m[2]) }); }
  }
  return alts;
}
function pickTipoFrom(alts, text) {
  const hasCE = /\bCerto\b|\bErrado\b/i.test(text);
  const hasVF = /(\bV\b\s*\/\s*\bF\b)|\bV\s*,\s*F|\bF\s*,\s*V/i.test(text);
  if (hasCE && !alts.length) return "CE";
  if (hasVF) return "VF";
  if (alts.length === 4) return "A-D";
  if (alts.length >= 5) return "A-E";
  return alts.length ? "A-D" : "ABERTA";
}
function guessIdFrom(header, idx) { const m = header.match(/\b(Q\d{5,})\b/); return m ? m[1] : `AUTO_${idx}`; }
function extractAnswerKey(fullText) {
  const m = new Map(); const keyBlockMatch = fullText.match(/GABARITO[\s\:]*([\s\S]+)/i);
  const block = keyBlockMatch ? keyBlockMatch[1] : fullText.slice(-4000);
  const lineRe = /^(\d{1,4})\s*[\.|\)|\-|\:]?\s*([A-E]|Certo|Errado|V|F|V\/F|F\/V|V,F|F,V|[VF](?:\s*,\s*[VF]){1,9})\s*$/gim;
  let match; while ((match = lineRe.exec(block))) { m.set(parseInt(match[1], 10), match[2].toUpperCase().replace(/\s+/g, "")); }
  return m;
}
async function parsePdfFromUrl(name, url) {
  const pdf = await pdfjsLib.getDocument({ url }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => (it.str ?? "")).join("\n");
    text += "\n" + pageText;
  }
  text = text.replace(/\u00ad/g, "");
  const answerKey = extractAnswerKey(text);
  const lines = text.split(/\n+/);
  const qIdx = [];
  lines.forEach((ln, i) => { if (/^\d+\s+Q\d{5,}\s*>/i.test(ln.trim())) qIdx.push(i); });
  if (!qIdx.length) lines.forEach((ln, i) => { if (/^Ano:\s*\d{4}/i.test(ln)) qIdx.push(i); });
  const out = [];
  for (let qi = 0; qi < qIdx.length; qi++) {
    const start = qIdx[qi]; const end = qi + 1 < qIdx.length ? qIdx[qi + 1] : lines.length;
    const block = normalizeSpaces(lines.slice(start, end).join("\n"));
    const header = lines[start] ?? "";
    const numberMatch = header.match(/^(\d{1,4})\b/);
    const ordinal = numberMatch ? parseInt(numberMatch[1], 10) : qi + 1;
    const { categoria, temas } = parseCategoriaTemas(header);
    const provaIdx = block.search(/\bProva\s*:/i);
    let working = provaIdx >= 0 ? block.slice(provaIdx + 6) : block;
    working = working.replace(/https?:\/\/\S+/g, " ").replace(/\s{2,}/g, " ").trim();
    const altCandidates = working.match(/([A-E]\s*[\)\.\-]\s*[^A-E]+)(?:\s+[A-E]\s*[\)\.\-]|$)/gis);
    let alternativas = altCandidates && altCandidates.length ? parseAlternativas(altCandidates.join("\n")) : [];
    let enunciado = working;
    const firstAlt = working.search(/\b[A-E]\s*[\)\.\-]\s*/);
    if (firstAlt > 0) enunciado = working.slice(0, firstAlt);
    const cePos = working.search(/\b(Certo|Errado)\b/i);
    if (!alternativas.length && cePos > 0) enunciado = working.slice(0, cePos);
    enunciado = normalizeSpaces(enunciado);
    const tipo = pickTipoFrom(alternativas, working);
    const gabarito = answerKey.get(ordinal);
    const id = guessIdFrom(header, qi + 1);
    out.push({ id, index: ordinal, categoria: categoria || "Direito Penal", temas: temas?.length ? temas : [], enunciado, alternativas, tipo, gabarito, fonte: name });
  }
  const byKey = new Map(); for (const q of out) { const key = q.id + "::" + slug(q.enunciado.slice(0, 80)); if (!byKey.has(key)) byKey.set(key, q); }
  return Array.from(byKey.values());
}

/* UI */
const Btn = ({ children, className = "", variant = "default", ...p }) => {
  const map = { default: "bg-black text-white hover:opacity-90", secondary: "bg-gray-200 text-gray-900 hover:bg-gray-300", outline: "bg-white text-gray-900 border border-gray-300 hover:bg-gray-50" };
  return <button className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm shadow-sm ${map[variant]} ${className}`} {...p}>{children}</button>;
};
const Badge = ({ children, variant = "default", className = "" }) => {
  const map = { default: "bg-gray-900 text-white", secondary: "bg-gray-200 text-gray-900", outline: "bg-transparent border border-gray-300 text-gray-800" };
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${map[variant]} ${className}`}>{children}</span>;
};
const Checkbox = ({ checked, onChange }) => <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={!!checked} onChange={(e) => onChange?.(e.currentTarget.checked)} />;
const Input = (props) => <input className="w-full rounded-2xl border px-3 py-2 text-sm bg-white" {...props} />;

function NonNativeSelect({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative w-full">
      <Btn variant="outline" className="w-full justify-between" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{value || label}</span>
        <svg width="16" height="16" viewBox="0 0 20 20"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor"/></svg>
      </Btn>
      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border bg-white shadow-xl max-h-72 overflow-auto">
          <div className="p-2 grid gap-1">
            <Btn variant="outline" className="justify-start" onClick={() => { onChange(undefined); setOpen(false); }}>Todas as categorias</Btn>
            {options.map((opt) => (
              <Btn key={opt} variant="outline" className="justify-start" onClick={() => { onChange(opt); setOpen(false); }}>{opt}</Btn>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function GoogleIA({ query }) {
  const [open, setOpen] = useState(false);
  const items = [{ k: "gabarito", q: `${query} gabarito` }, { k: "glossario", q: `${query} glossário direito penal` }, { k: "video", q: `${query} video aula` }];
  return (
    <div className="relative inline-block">
      <Btn variant="secondary" onClick={() => setOpen((v) => !v)}>Google modo IA</Btn>
      {open && (
        <div className="absolute right-0 mt-2 rounded-2xl border bg-white shadow-xl overflow-hidden">
          <div className="flex flex-col">
            {items.map((it) => (
              <a key={it.k} target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(it.q)}`} className="px-4 py-2 hover:bg-gray-50 text-sm">{it.k}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function VFInput({ onSubmit }) {
  const [v, setV] = useState(""); return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="V,F,V,F" />
      <Btn onClick={() => onSubmit(v)}>Responder</Btn>
    </div>
  );
}

function App() {
  const [allQuestions, setAllQuestions] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [categoria, setCategoria] = useState();
  const [temasSelected, setTemasSelected] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [savedName, setSavedName] = useState("");
  const [feedback, setFeedback] = useState(null);

  async function handleGithub() {
    try {
      setParsing(true);
      const r = await fetch("./data/index.json");
      if (!r.ok) throw new Error("index.json não encontrado em /data");
      const json = await r.json();
      const list = Array.isArray(json) ? json : (json.files || []);
      if (!list.length) throw new Error("index.json vazio");
      const parsed = [];
      for (const fname of list) {
        const url = `./data/${fname}`;
        try { parsed.push(...(await parsePdfFromUrl(fname, url))); }
        catch (e) { console.error("Falha ao processar", fname, e); }
      }
      setAllQuestions(parsed.map((q) => ({ ...q, temas: q.temas?.length ? q.temas : [] })));
      setCursor(0);
    } catch (e) {
      console.error(e);
      alert('Crie data/index.json com {"files":["prova1.pdf","prova2.pdf"]}');
    } finally { setParsing(false); }
  }

  function toggleTema(t) { setTemasSelected((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]); }
  const categorias = useMemo(() => uniq(allQuestions.map((q) => q.categoria).filter(Boolean)).sort((a, b) => a.localeCompare(b)), [allQuestions]);
  const temasByCategoria = useMemo(() => { const filtered = categoria ? allQuestions.filter((q) => q.categoria === categoria) : allQuestions; return uniq(filtered.flatMap((q) => q.temas)).filter(Boolean).sort((a, b) => a.localeCompare(b)); }, [allQuestions, categoria]);
  const filteredQuestions = useMemo(() => { let arr = allQuestions; if (categoria) arr = arr.filter((q) => q.categoria === categoria); if (temasSelected.length) arr = arr.filter((q) => q.temas.some((t) => temasSelected.includes(t))); return arr; }, [allQuestions, categoria, temasSelected]);
  useEffect(() => { setCursor(0); }, [categoria, temasSelected]);

  const current = filteredQuestions[cursor];

  function saveList() {
    const toSave = { id: `list_${Date.now()}`, name: savedName || `Lista ${new Date().toLocaleString()}`, createdAt: new Date().toISOString(), filters: { categoria, temas: temasSelected }, questionIds: filteredQuestions.map((q) => q.id) };
    const blob = new Blob([JSON.stringify(toSave, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = slug(toSave.name) + ".json"; a.click(); URL.revokeObjectURL(url);
  }

  function submitChoice(choice) {
    if (!current) return;
    const correct = current.gabarito ? current.gabarito.toUpperCase() : undefined;
    let ok = false;
    if (current.tipo === "CE") ok = !!correct && correct === choice.toUpperCase();
    else if (current.tipo === "VF") ok = !!correct && correct === choice.toUpperCase().replace(/\s+/g, "");
    else ok = !!correct && correct === choice.toUpperCase();
    setFeedback(ok ? "Acertou" : "Errou"); setTimeout(() => setFeedback(null), 1600);
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-semibold">Quiz Direito</h1>
          <div className="flex gap-2 flex-wrap">
            <Btn variant="outline" onClick={handleGithub}>Ler de /data do GitHub</Btn>
          </div>
        </header>

        <div className="grid md:grid-cols-3 gap-4 mt-4">
          <div className="rounded-2xl border bg-white shadow-sm md:col-span-1">
            <div className="p-4 border-b"><h2 className="text-lg font-semibold">Filtros</h2></div>
            <div className="p-4 grid gap-3">
              <NonNativeSelect label="Categoria" value={categoria} onChange={setCategoria} options={categorias} />
              <div>
                <div className="text-sm font-medium mb-2">Temas</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-72 overflow-auto pr-1">
                  {temasByCategoria.map((t) => (
                    <label key={t} className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-gray-50 cursor-pointer">
                      <Checkbox checked={temasSelected.includes(t)} onChange={() => toggleTema(t)} />
                      <span className="text-sm truncate" title={t}>{t}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex justify-end"><Btn>Buscar</Btn></div>
              </div>
              <div className="text-sm text-gray-600">Encontradas: <b>{filteredQuestions.length}</b></div>
              <div className="grid gap-2">
                <Input placeholder="Nome da lista" value={savedName} onChange={(e) => setSavedName(e.target.value)} />
                <Btn onClick={saveList}>Salvar lista</Btn>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white shadow-sm md:col-span-2">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Questão {filteredQuestions.length ? cursor + 1 : 0} / {filteredQuestions.length}
                {current?.categoria ? <span className="ml-2"><Badge variant="secondary">{current.categoria}</Badge></span> : null}
              </h2>
              {current ? <GoogleIA query={normalizeSpaces(current.enunciado).slice(0, 120)} /> : null}
            </div>
            <div className="p-4 grid gap-4">
              {parsing && <div className="text-sm">Lendo PDFs…</div>}
              {!parsing && !current && <div className="text-sm text-gray-600">Clique em “Ler de /data do GitHub”.</div>}
              {current && (
                <div className="grid gap-3">
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{current.enunciado}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap gap-2">
                    {current.temas.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
                  </div>

                  {current.tipo === "CE" && (
                    <div className="grid gap-2">
                      {["Certo", "Errado"].map((opt) => (
                        <Btn key={opt} variant="outline" className="justify-start" onClick={() => submitChoice(opt)}>{opt}</Btn>
                      ))}
                    </div>
                  )}

                  {current.tipo !== "CE" && current.alternativas.length > 0 && (
                    <div className="grid gap-2">
                      {current.alternativas.map((a) => (
                        <Btn key={a.label} variant="outline" className="justify-start text-left" onClick={() => submitChoice(a.label)}>
                          <span className="font-semibold mr-2">{a.label})</span> {a.text}
                        </Btn>
                      ))}
                    </div>
                  )}

                  {current.tipo === "VF" && (
                    <div className="grid gap-2">
                      <div className="text-sm text-gray-600">Digite sequência V/F separada por vírgulas. Ex: V,F,V,F</div>
                      <VFInput onSubmit={(seq) => submitChoice(seq)} />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <div className="text-xs text-gray-500">Gabarito: <b>{current.gabarito || "sem gabarito"}</b></div>
                    <div className="flex gap-2">
                      <Btn variant="secondary" onClick={() => setCursor((c) => Math.max(0, c - 1))}>Anterior</Btn>
                      <Btn onClick={() => setCursor((c) => Math.min(filteredQuestions.length - 1, c + 1))}>Próximo</Btn>
                    </div>
                  </div>

                  {feedback && (
                    <div className="text-sm">
                      {feedback === "Acertou" ? <Badge className="bg-green-600 text-white">Acertou</Badge> : <Badge className="bg-red-600 text-white">Errou</Badge>}
                    </div>
                  )}

                  <div className="text-xs text-gray-400">Fonte: {current.fonte} • ID: {current.id}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          Lê PDFs de <code>/data/*.pdf</code> via <code>data/index.json</code>.
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
