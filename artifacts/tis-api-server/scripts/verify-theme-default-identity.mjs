// Byte-identity guard: with no firm theme, renderStudyPdf must produce exactly
// the bytes it produced before the theme layer existed (after masking PDFKit's
// clock-derived CreationDate/ID). Fixtures are the three whose regional
// renderer does no network enrichment (TX, NC, SC) so the hash is stable
// offline. `--pin` re-baselines (only when a deliberate render change lands).
// Run: node ./scripts/verify-theme-default-identity.mjs [--pin]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pdfHash } from "./lib/pdf-norm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.resolve(here, "fixtures/theme-identity-baseline.json");
const FAMILIES = ["tx", "nc", "sc"];
const pin = process.argv.includes("--pin");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const { mod, cleanup } = await loadRendererBundle();
try {
  const firm = { name: "Identity Check Firm", logoUrl: null };
  const hashes = {};
  for (const fam of FAMILIES) {
    const project = projectFromFixture(loadFixture(fam));
    const a = pdfHash(await mod.renderStudyPdf(project, firm));
    const b = pdfHash(await mod.renderStudyPdf(project, firm));
    ok(a === b, `${fam}: two renders are identical (deterministic)`);
    hashes[fam] = a;
  }
  if (pin) {
    writeFileSync(BASELINE, JSON.stringify(hashes, null, 2) + "\n");
    console.log(`pinned ${BASELINE}`);
  } else {
    ok(existsSync(BASELINE), "baseline file exists (run with --pin once)");
    const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
    for (const fam of FAMILIES) ok(hashes[fam] === base[fam], `${fam}: matches pinned baseline`);
  }
} finally { await cleanup(); }
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
