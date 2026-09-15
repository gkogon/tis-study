// Downloads the corpus listed in CORPUS.md (gitignored PDFs). Run: node ./scripts/fetch-tis-corpus.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "fixtures/tis-corpus");
const rows = readFileSync(path.join(dir, "CORPUS.md"), "utf8").split("\n").filter((l) => /^\|\s*[a-z0-9-]+\s*\|\s*https?:/.test(l)).map((l) => l.split("|").map((c) => c.trim()));
let failures = 0;
for (const [, name, url] of rows) {
  const dest = path.join(dir, `${name}.pdf`);
  if (existsSync(dest)) { console.log(`keep  ${name}.pdf`); continue; }
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "tis-study-corpus-fetch/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.subarray(0, 1024).includes("%PDF-")) throw new Error("not a PDF");
    writeFileSync(dest, buf);
    console.log(`fetch ${name}.pdf (${Math.round(buf.length / 1024)} KB)`);
  } catch (e) { console.error(`FAIL  ${name}: ${e.message}`); failures++; }
}
if (failures) process.exit(1);
