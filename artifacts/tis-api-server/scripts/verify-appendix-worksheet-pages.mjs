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
import { createRequire } from "node:module";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { FIXTURE_FAMILIES, loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");

const FOOTER_RE = /Screening estimate — not for design submittal.*?disclaimer\./s;
const MIN_BODY_CHARS = 600;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

async function pageTexts(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Items arrive in content-stream order; join with a space and collapse.
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim());
  }
  await doc.destroy();
  return out;
}

/** An orphan page: nearly empty, and its body opens mid-sentence. */
function orphanPages(texts) {
  const orphans = [];
  texts.forEach((t, idx) => {
    const body = t.replace(FOOTER_RE, "").trim();
    if (body.replace(/\s+/g, "").length >= MIN_BODY_CHARS) return;
    const opener = body.slice(0, 1);
    if (!opener || opener !== opener.toLowerCase() || !/[a-z]/.test(opener)) return;
    orphans.push({ page: idx + 1, chars: body.length, head: body.slice(0, 60) });
  });
  return orphans;
}

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
