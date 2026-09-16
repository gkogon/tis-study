// Themed render smoke: each preview fixture renders under a synthetic theme
// without throwing, embeds the theme's fonts, and keeps a sane page count;
// then every fixture renders through every extracted corpus theme with a
// margin guard (no body-page text outside the theme's text band) and a
// page-fill gate (no near-empty or stranded pages — the failure mode of
// layout code tuned to the default text box).
// Run: node ./scripts/verify-theme-render.mjs
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { FIXTURE_FAMILIES, loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pdfPageCount } from "./lib/pdf-norm.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

/**
 * How far down the text band each body page's ink reaches (0–1), with the
 * page's word count and whether it carries any figure/table ink. The cover
 * and the last page are excluded by the caller — both end wherever they end.
 */
function pageFill(sc, margins) {
  return sc.pages.slice(1).map((pg) => {
    const top = margins.top, bottom = pg.height - margins.bottom;
    const inBand = (y) => y > top - 2 && y < bottom + 2;
    let ink = top, words = 0, figInk = 0;
    for (const r of pg.runs) if (inBand(r.y)) { ink = Math.max(ink, r.y + r.h); words += r.str.trim().split(/\s+/).filter(Boolean).length; }
    for (const r of pg.rects ?? []) if (inBand(r.y)) { ink = Math.max(ink, r.y + r.h); figInk++; }
    for (const l of pg.lines ?? []) if (inBand(l.y1)) { ink = Math.max(ink, Math.max(l.y1, l.y2)); figInk++; }
    for (const im of pg.images ?? []) if (inBand(im.y)) { ink = Math.max(ink, im.y + im.h); figInk++; }
    return { page: pg.page, fill: (ink - top) / (bottom - top), words, figInk };
  });
}
/** Page-fill gate for one themed render: no near-empty page, no page under 35 % full, at most two under 55 %. */
function fillGate(label, sc, margins) {
  const interior = pageFill(sc, margins).slice(0, -1);
  const nearEmpty = interior.filter((p) => p.words < 40 && p.figInk === 0);
  const under35 = interior.filter((p) => p.fill < 0.35);
  const under55 = interior.filter((p) => p.fill < 0.55);
  const list = (xs) => xs.map((p) => `p${p.page}@${Math.round(p.fill * 100)}%`).join(", ");
  ok(nearEmpty.length === 0, `${label}: no near-empty body page (${nearEmpty.length}${nearEmpty.length ? `: ${list(nearEmpty)}` : ""})`);
  ok(under35.length === 0, `${label}: no body page under 35 % full (${under35.length}${under35.length ? `: ${list(under35)}` : ""})`);
  ok(under55.length <= 2, `${label}: at most two body pages under 55 % full (${under55.length}${under55.length ? `: ${list(under55)}` : ""})`);
}

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
      // Chapter-numbered captions ("Figure 5-2: …") in the sample's caption style, above the plot.
      figure: { caption: { position: "above", style: { font: "body", size: 9, color: "#1f3a5f", bold: true } }, label: "Figure", numbering: "chapter", separator: ": " },
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
      const sc = await mod.scanPdf(themedBuf, { maxPages: 120 });
      const p1 = sc.pages[0]?.runs.length ?? 0, p2 = sc.pages[1]?.runs.length ?? 0;
      ok(p1 <= 25 && p2 >= 15, `${fam}: cover is exactly one page (page 1: ${p1} runs, page 2: ${p2} runs)`);
      fillGate(fam, sc, SYNTH.theme.page.margins);
      // Figure captions follow the theme's convention: chapter-numbered here,
      // each figure numbered once (no duplicate "Figure 5-1"), no leftover
      // "Figure —" wording. The TX fixture carries every chart the renderer draws.
      if (fam === "tx") {
        const caps = sc.pages.flatMap((pg) => pg.runs.map((r) => r.str.trim())).filter((t) => /^Figure \d+-\d+: /.test(t));
        ok(caps.length >= 5, `${fam}: chapter-numbered figure captions drawn (${caps.length}: ${caps.slice(0, 3).map((c) => c.slice(0, 22)).join(" | ")}…)`);
        ok(new Set(caps.map((c) => c.split(":")[0])).size === caps.length, `${fam}: every figure number is unique`);
        const stale = sc.pages.flatMap((pg) => pg.runs.map((r) => r.str.trim())).filter((t) => /^Figure — /.test(t));
        ok(stale.length === 0, `${fam}: no unnumbered "Figure —" caption left under a numbered convention (${stale.length})`);
        const seq = await mod.renderStudyPdf(project, { name: "Render Check Firm", logoUrl: null, firmId: "f1", reportTemplate: { ...SYNTH, theme: { ...SYNTH.theme, figure: { ...SYNTH.theme.figure, numbering: "sequential", separator: " – " } } } });
        const scSeq = await mod.scanPdf(seq, { maxPages: 60 });
        const seqCaps = scSeq.pages.flatMap((pg) => pg.runs.map((r) => r.str.trim())).filter((t) => /^Figure \d+ – /.test(t));
        ok(seqCaps.length === caps.length && seqCaps[0]?.startsWith("Figure 1 – "), `${fam}: sequential convention numbers the same figures 1…${seqCaps.length} (first: ${seqCaps[0]?.slice(0, 30)})`);
      }
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
      const sc = await mod.scanPdf(buf, { maxPages: 120 });
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
      // Page-fill gate: a firm theme's smaller text box must not leave the
      // renderer's fixed-geometry layout stranding two lines of a worksheet,
      // or one figure, on a page of its own.
      fillGate(`${f} × ${fam}`, sc, stored.theme.page.margins);
      // Synonym guard (one whole-document scan): the diurnal chart caption
      // "Trip Distribution by Time of Day" maps to trip-distribution too, and
      // must not take the firm's one-per-render wording away from the real
      // section — so the caption appears in our wording (case per theme) and
      // the firm's trip-distribution synonym at most once.
      const syn = stored.theme.synonyms["trip-distribution"];
      if (f === "twisp-wa-2023.pdf" && fam === "tx" && syn) {
        const texts = sc.pages.flatMap((pg) => pg.runs.map((r) => r.str.trim().toLowerCase()));
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
