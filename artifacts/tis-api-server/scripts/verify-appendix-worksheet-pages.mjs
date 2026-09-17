// Appendix worksheet pagination: no orphan pages.
//
// renderCapacityAppendix opens every worksheet with an unconditional
// doc.addPage() ("one intersection per page") but never measures the page.
// Content added below the diagrams since that assumption was made (the
// Affected-movements table, its Source line, the cross-foot disclosure) can
// run 2–4 lines past the bottom margin; PDFKit flows those lines onto a new
// page and the next worksheet's addPage() strands them there. The live
// Allegheny County sample shipped with 16 such pages: two orphan lines of an
// 8-pt note and the footer, nothing else.
//
// This check renders every preview fixture through the real renderStudyPdf
// and reads each page's text back with pdfjs. A page FAILS when it carries
// almost no body text AND its first words continue the previous page's last
// paragraph mid-sentence (lower-case opener, no heading). A genuinely short
// page — the cover, a signature block, a short table — starts with a heading
// or a capitalised line and passes.
//
// Run: node ./scripts/verify-appendix-worksheet-pages.mjs [--pdf <file>]
//   --pdf <file>  also check one PDF on disk (e.g. a regenerated sample)
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { FIXTURE_FAMILIES, loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pageTexts, orphanPages } from "./lib/pdf-text.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

async function checkBuffer(label, buf) {
  const texts = await pageTexts(buf);
  const orphans = orphanPages(texts);
  ok(orphans.length === 0, `${label}: ${texts.length} pages, ${orphans.length} orphan page(s)`);
  for (const o of orphans) console.log(`      p${o.page} (${o.chars} chars): "${o.head}…"`);
}

const { mod, cleanup } = await loadRendererBundle();
try {
  for (const fam of FIXTURE_FAMILIES) {
    const fx = loadFixture(fam);
    const buf = await mod.renderStudyPdf(projectFromFixture(fx), { name: "Worksheet Check Firm", logoUrl: null });
    await checkBuffer(`fixture ${fam} (${fx.report?.affectedIntersections?.length ?? "?"} intersections)`, buf);
  }
  const argi = process.argv.indexOf("--pdf");
  if (argi !== -1) {
    const p = path.resolve(process.argv[argi + 1] ?? "");
    ok(existsSync(p), `--pdf ${p} exists`);
    if (existsSync(p)) await checkBuffer(`pdf ${path.basename(p)}`, readFileSync(p));
  }
} finally {
  await cleanup();
}

console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
