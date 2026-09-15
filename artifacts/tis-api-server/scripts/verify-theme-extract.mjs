// Accuracy gate: extractTheme over the public corpus vs hand-verified expectations.
// Skips (with a notice, exit 0) when the corpus has not been fetched.
// Run: node ./scripts/fetch-tis-corpus.mjs && node ./scripts/verify-theme-extract.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const { extractTheme } = await import(path.resolve(here, "../src/lib/report-theme/extract.ts"));
const { hexToRgb } = await import(path.resolve(here, "../src/lib/report-theme/theme.ts"));
const dir = path.resolve(here, "fixtures/tis-corpus");
const expectedDir = path.join(dir, "expected");
const names = readdirSync(expectedDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const present = names.filter((n) => existsSync(path.join(dir, `${n}.pdf`)));
if (!present.length) { console.log("SKIP  corpus not fetched (node ./scripts/fetch-tis-corpus.mjs)"); process.exit(0); }
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const dE = (a, b) => { const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b); return Math.hypot(r1 - r2, g1 - g2, b1 - b2) / 2.55; };
for (const name of present) {
  const exp = JSON.parse(readFileSync(path.join(expectedDir, `${name}.json`), "utf8"));
  const t0 = Date.now();
  let stored;
  try { stored = await extractTheme(readFileSync(path.join(dir, `${name}.pdf`)), { firmName: exp.firmName ?? "Unknown Firm", firmId: name }); }
  catch (e) { ok(false, `${name}: extractTheme threw: ${e.message}`); continue; }
  const t = stored.theme;
  ok(Date.now() - t0 < 20_000, `${name}: extracted in ${Date.now() - t0} ms`);
  ok(t.fonts.body.family === exp.bodyFamily, `${name}: body family ${t.fonts.body.family} (expected ${exp.bodyFamily}; requested "${t.fonts.body.requested}")`);
  ok(Math.abs(t.text.body.size - exp.bodySize) <= 0.5, `${name}: body size ${t.text.body.size} (expected ${exp.bodySize})`);
  ok(Math.abs(t.headings[0].style.size - exp.h1Size) <= 1, `${name}: H1 size ${t.headings[0].style.size} (expected ${exp.h1Size})`);
  ok(dE(t.headings[0].style.color, exp.h1Color) < 8, `${name}: H1 colour ${t.headings[0].style.color} (expected ${exp.h1Color})`);
  ok(dE(t.palette.primary, exp.primary) < 8, `${name}: primary ${t.palette.primary} (expected ${exp.primary})`);
  ok(String(t.page.size) === String(exp.pageSize), `${name}: page size ${t.page.size} (expected ${exp.pageSize})`);
  ok(Math.abs(t.page.margins.left - exp.marginLeft) <= 4, `${name}: left margin ${t.page.margins.left} (expected ${exp.marginLeft} ± 4)`);
  ok(Math.abs(t.page.margins.bottom - exp.marginBottom) <= 6, `${name}: bottom margin ${t.page.margins.bottom} (expected ${exp.marginBottom} ± 6)`);
  ok(t.headings[0].numbering === exp.numbering, `${name}: numbering ${t.headings[0].numbering} (expected ${exp.numbering})`);
  ok(!!t.footer?.segments.some((s) => s.text.includes("{{page}}")) === exp.footerHasPage, `${name}: footer page token ${exp.footerHasPage ? "present" : "absent"}`);
  ok((t.header !== null) === exp.headerPresent, `${name}: header ${exp.headerPresent ? "present" : "absent"}`);
  if (exp.tableHeaderFill !== undefined) ok((t.table.header.fill === null) === (exp.tableHeaderFill === null) && (exp.tableHeaderFill === null || dE(t.table.header.fill, exp.tableHeaderFill) < 8), `${name}: table header fill ${t.table.header.fill} (expected ${exp.tableHeaderFill})`);
  const leaked = stored.source.warnings.filter((w) => /^Dropped/.test(w));
  console.log(`      ${name}: ${stored.source.warnings.length} warning(s), ${leaked.length} dropped segment(s)`);
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
