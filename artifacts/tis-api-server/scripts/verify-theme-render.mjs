// Themed render smoke: each preview fixture renders under a synthetic theme
// without throwing, embeds the theme's fonts, and keeps a sane page count.
// Run: node ./scripts/verify-theme-render.mjs
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { FIXTURE_FAMILIES, loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pdfPageCount } from "./lib/pdf-norm.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const { mod, cleanup } = await loadRendererBundle(`export { DEFAULT_THEME } from "./report-theme/theme";`);
try {
  const D = mod.DEFAULT_THEME;
  const SYNTH = {
    version: 2,
    theme: {
      ...D, id: "firm-synth",
      page: { size: "LETTER", orientation: "portrait", margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      fonts: { body: { family: "carlito", requested: "Calibri", exact: false }, heading: { family: "liberation-serif", requested: "Times New Roman", exact: false } },
      headings: [{ ...D.headings[0], style: { font: "heading", size: 15, color: "#1f3a5f", bold: true }, case: "title", numbering: "1.", rule: { color: "#1f3a5f", width: 0.75, gap: 2 } }, { ...D.headings[1], style: { font: "heading", size: 12, color: "#1f3a5f", bold: true }, numbering: "1." }, D.headings[2]],
      palette: { primary: "#1f3a5f", accent: "#c0392b", text: "#222222", muted: "#666666", rule: "#bbbbbb" },
      table: { ...D.table, header: { fill: "#1f3a5f", color: "#ffffff", bold: true, size: 9 }, rules: { color: "#bbbbbb", width: 0.5, mode: "grid" } },
      header: { segments: [{ align: "left", text: "{{firm.name}}" }, { align: "right", text: "{{documentType}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: { color: "#1f3a5f", width: 0.5 }, height: 40 },
      footer: { segments: [{ align: "center", text: "Page {{page}} of {{pages}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: null, height: 40 },
      cover: { background: { kind: "none" }, bands: [{ y0: 0, y1: 120, color: "#1f3a5f" }], logo: null, elements: [{ role: "documentType", x: 72, y: 300, w: 468, align: "left", style: { font: "heading", size: 28, color: "#1f3a5f", bold: true } }, { role: "projectName", x: 72, y: 350, w: 468, align: "left", style: { font: "body", size: 16, color: "#222222" } }], hasMetaBlock: false },
      charts: { series: ["#1f3a5f", "#c0392b"] },
      synonyms: { "trip-generation": "Site Trip Generation" },
    },
    source: { pages: 10, fontsSeen: [], extractedAt: "2026-09-14T00:00:00Z", warnings: [] },
  };
  // Page-count band only for the deterministic families (the identity guard's set): FL/GA/NY do live enrichment, so the plain render's page count varies run to run; the sibling renderers' remaining PAGE_MARGIN = 50 constants are threaded in the next task.
  const BAND_FAMILIES = ["tx", "nc", "sc"];
  for (const fam of FIXTURE_FAMILIES) {
    const project = projectFromFixture(loadFixture(fam));
    const themedBuf = await mod.renderStudyPdf(project, { name: "Render Check Firm", logoUrl: null, firmId: "f1", reportTemplate: SYNTH });
    const txt = themedBuf.toString("latin1");
    ok(themedBuf.length > 10_000, `${fam}: themed render produced a PDF (${themedBuf.length} bytes)`);
    ok(/\/BaseFont \/[A-Z]{6}\+Carlito/.test(txt), `${fam}: Carlito embedded`);
    ok(/\/BaseFont \/[A-Z]{6}\+LiberationSerif/.test(txt), `${fam}: Liberation Serif embedded`);
    if (BAND_FAMILIES.includes(fam)) {
      const plain = await mod.renderStudyPdf(project, { name: "Render Check Firm", logoUrl: null });
      const p0 = pdfPageCount(plain), p1 = pdfPageCount(themedBuf);
      ok(p1 >= p0 * 0.7 && p1 <= p0 * 1.6, `${fam}: page count sane (${p0} → ${p1})`);
    }
  }
} finally { await cleanup(); }
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
