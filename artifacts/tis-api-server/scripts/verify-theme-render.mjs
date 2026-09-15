// Themed render smoke: each preview fixture renders under a synthetic theme
// without throwing, embeds the theme's fonts, and keeps a sane page count;
// then every fixture renders through every extracted corpus theme with a
// margin guard (no body-page text outside the theme's text band).
// Run: node ./scripts/verify-theme-render.mjs
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { FIXTURE_FAMILIES, loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pdfPageCount } from "./lib/pdf-norm.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const { mod, cleanup } = await loadRendererBundle(`export { DEFAULT_THEME } from "./report-theme/theme";
export { extractTheme } from "./report-theme/extract";
export { scanPdf } from "./report-theme/pdf-scan";`);
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
    {
      const sc = await mod.scanPdf(themedBuf, { maxPages: 2 });
      const p1 = sc.pages[0]?.runs.length ?? 0, p2 = sc.pages[1]?.runs.length ?? 0;
      ok(p1 <= 25 && p2 >= 15, `${fam}: cover is exactly one page (page 1: ${p1} runs, page 2: ${p2} runs)`);
    }
    if (BAND_FAMILIES.includes(fam)) {
      const plain = await mod.renderStudyPdf(project, { name: "Render Check Firm", logoUrl: null });
      const p0 = pdfPageCount(plain), p1 = pdfPageCount(themedBuf);
      ok(p1 >= p0 * 0.7 && p1 <= p0 * 1.6, `${fam}: page count sane (${p0} → ${p1})`);
    }
  }

  // UK smoke: a City-of-London site resolves to the built-in Velocity
  // template, so renderStudyPdf takes the declarative template-engine path
  // (report-template/engine.ts) rather than a hand-coded regional renderer.
  // That path must also honor the firm's theme.
  {
    const ukProject = { ...projectFromFixture(loadFixture("fl")), siteLat: "51.5136", siteLon: "-0.0866" };
    const plainBuf = await mod.renderStudyPdf(ukProject, { name: "Render Check Firm", logoUrl: null });
    const themedBuf = await mod.renderStudyPdf(ukProject, { name: "Render Check Firm", logoUrl: null, firmId: "f1", reportTemplate: SYNTH });
    ok(plainBuf.length > 10_000, `uk (template engine): plain render produced a PDF (${plainBuf.length} bytes)`);
    ok(themedBuf.length > 10_000, `uk (template engine): themed render produced a PDF (${themedBuf.length} bytes)`);
    ok(/\/BaseFont \/[A-Z]{6}\+Carlito/.test(themedBuf.toString("latin1")), "uk (template engine): Carlito embedded");
  }

  // Corpus themes: every fixture × every extracted real-world theme. Skips
  // (with a notice) when the corpus has not been fetched (fetch:tis-corpus).
  const corpusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/tis-corpus");
  const pdfs = existsSync(corpusDir) ? readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")).sort() : [];
  if (!pdfs.length) console.log("SKIP  corpus not fetched; corpus render checks skipped");
  const FONT_RE = { "carlito": /Carlito/, "liberation-sans": /LiberationSans/, "liberation-serif": /LiberationSerif/, "liberation-mono": /LiberationMono/, "caladea": /Caladea/, "gelasio": /Gelasio/, "open-sans": /OpenSans/, "roboto": /Roboto/, "lato": /Lato/, "montserrat": /Montserrat/, "source-sans-3": /SourceSans3/, "dejavu-sans": /DejaVuSans/ };
  for (const f of pdfs) {
    let stored;
    try { stored = await mod.extractTheme(readFileSync(path.join(corpusDir, f)), { firmName: "Corpus Firm", firmId: f.replace(/\.pdf$/, "") }); }
    catch (e) { ok(false, `${f}: extractTheme threw ${e.message}`); continue; }
    for (const fam of FIXTURE_FAMILIES) {
      const project = projectFromFixture(loadFixture(fam));
      let buf;
      try { buf = await mod.renderStudyPdf(project, { name: "Corpus Firm", logoUrl: null, firmId: "c", reportTemplate: stored }); }
      catch (e) { ok(false, `${f} × ${fam}: threw ${e.message}`); continue; }
      const txt = buf.toString("latin1");
      const famUsed = stored.theme.fonts.body.family;
      ok(FONT_RE[famUsed].test(txt), `${f} × ${fam}: body font ${famUsed} embedded`);
      const p = pdfPageCount(buf);
      ok(p >= 4 && p <= 120, `${f} × ${fam}: ${p} pages`);
      // Margin guard: nothing drawn outside the theme's text band on body pages
      // (cover excluded). A hit means a renderer call site still assumes 50 pt.
      // Ink extent (wInk), not the advance: a right-aligned wrapped line keeps
      // its trailing spaces past the box edge without painting anything there.
      const sc = await mod.scanPdf(buf, { maxPages: 12 });
      const L = stored.theme.page.margins.left;
      const R = (sc.pages[1]?.width ?? 612) - stored.theme.page.margins.right;
      const overflow = sc.pages.slice(1).flatMap((pg) => pg.runs.filter((r) => r.x < L - 2 || r.x + r.wInk > R + 2));
      ok(overflow.length === 0, `${f} × ${fam}: no text outside the margins (${overflow.length} runs${overflow[0] ? `, e.g. "${overflow[0].str.slice(0, 30)}" at x=${overflow[0].x} on page ${overflow[0].page}` : ""})`);
      // Cover guard: the themed cover must be exactly one page — a cover
      // element that paginates (PDFKit wraps past maxY) pushes the body to
      // page 3+, and a cover whose title character-wraps sprays runs. Page 1
      // carries a handful of runs; page 2 must already be the body.
      const p1 = sc.pages[0]?.runs.length ?? 0, p2 = sc.pages[1]?.runs.length ?? 0;
      ok(p1 <= 25 && p2 >= 15, `${f} × ${fam}: cover is exactly one page (page 1: ${p1} runs, page 2: ${p2} runs)`);
      // Synonym guard (one whole-document scan): the diurnal chart caption
      // "Trip Distribution by Time of Day" maps to trip-distribution too, and
      // must not take the firm's one-per-render wording away from the real
      // section — so the caption appears in our wording (case per theme) and
      // the firm's trip-distribution synonym at most once.
      const syn = stored.theme.synonyms["trip-distribution"];
      if (f === "twisp-wa-2023.pdf" && fam === "tx" && syn) {
        const full = await mod.scanPdf(buf, { maxPages: 80 });
        const texts = full.pages.flatMap((pg) => pg.runs.map((r) => r.str.trim().toLowerCase()));
        const caption = texts.filter((t) => t === "trip distribution by time of day").length;
        const synCount = texts.filter((t) => t.includes(syn.toLowerCase())).length;
        ok(caption >= 1, `${f} × ${fam}: the diurnal caption is drawn in our wording (${caption} run(s))`);
        ok(synCount <= 1, `${f} × ${fam}: the firm's trip-distribution wording "${syn}" appears at most once (${synCount})`);
      }
    }
  }
} finally { await cleanup(); }
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
