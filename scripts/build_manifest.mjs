// Copia data/**.txt para site/data/** e gera site/manifest.json; copia frases.txt
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const SRC = "data";
const OUT = "site";
const OUT_DATA = path.join(OUT, "data");
const MANIFEST = path.join(OUT, "manifest.json");
const FRASES_SRC = path.join(SRC, "frases.txt");
const FRASES_OUT = path.join(OUT, "frases.txt");

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
async function copyFile(src, dst) { await ensureDir(path.dirname(dst)); await fsp.copyFile(src, dst); }

async function main() {
  if (!fs.existsSync(SRC)) { console.error(`Pasta '${SRC}' não encontrada.`); process.exit(1); }
  await ensureDir(OUT_DATA);

  const items = [];
  for (const abs of walk(SRC)) {
    if (!abs.toLowerCase().endsWith(".txt")) continue;
    const rel = path.relative(SRC, abs).replaceAll("\\", "/");
    const st = await fsp.stat(abs);
    if (rel === "frases.txt") continue; // copia separada
    items.push({ path: rel, size: st.size, mtime: Math.floor(st.mtimeMs) });
    await copyFile(abs, path.join(OUT_DATA, rel));
  }

  if (fs.existsSync(FRASES_SRC)) await copyFile(FRASES_SRC, FRASES_OUT);

  await fsp.writeFile(MANIFEST, JSON.stringify({ generatedAt: Date.now(), items }, null, 2));
  console.log(`Manifest com ${items.length} arquivos -> ${MANIFEST}`);
}
main().catch(e => { console.error(e); process.exit(1); });
