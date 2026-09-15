// Pure-function checks for the report-theme modules. No PDFs, no network.
// Run: node ./scripts/verify-theme-units.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

// ─── theme.ts ────────────────────────────────────────────────────────────────
const theme = await import(path.resolve(here, "../src/lib/report-theme/theme.ts"));
const { DEFAULT_THEME, parseStoredTheme, classifyStoredTemplate, isDefaultTheme, pageSizePoints, summarizeTheme, StoredThemeSchema, tint, luminance, chroma, hueDistance } = theme;

ok(isDefaultTheme(DEFAULT_THEME), "DEFAULT_THEME is the default");
eq(pageSizePoints(DEFAULT_THEME.page), [612, 792], "LETTER portrait is 612×792");
eq(pageSizePoints({ ...DEFAULT_THEME.page, orientation: "landscape" }), [792, 612], "landscape swaps");
eq(pageSizePoints({ ...DEFAULT_THEME.page, size: [500, 700] }), [500, 700], "custom size passes through");
ok(StoredThemeSchema.safeParse({ version: 2, theme: DEFAULT_THEME, source: { pages: 3, fontsSeen: [], extractedAt: "2026-01-01T00:00:00Z", warnings: [] } }).success, "DEFAULT_THEME validates under the schema");
eq(classifyStoredTemplate(null), "none", "null → none");
eq(classifyStoredTemplate({ id: "x", chapters: [] }), "legacy", "V1 object with chapters → legacy");
eq(classifyStoredTemplate({ version: 2, theme: DEFAULT_THEME, source: { pages: 1, fontsSeen: [], extractedAt: "x", warnings: [] } }), "v2", "valid v2 → v2");
eq(classifyStoredTemplate({ version: 2, theme: { id: "bad" } }), "invalid", "v2 that fails schema → invalid");
eq(classifyStoredTemplate("nope"), "invalid", "string → invalid");
ok(parseStoredTheme({ version: 2, theme: { ...DEFAULT_THEME, palette: { ...DEFAULT_THEME.palette, primary: "red" } }, source: { pages: 1, fontsSeen: [], extractedAt: "x", warnings: [] } }) === null, "bad hex rejected");
const stored = { version: 2, theme: { ...DEFAULT_THEME, id: "firm-1", header: null, footer: { segments: [{ align: "center", text: "Page {{page}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: null, height: 30 } }, source: { pages: 12, fontsSeen: ["ABCDEF+Calibri"], extractedAt: "2026-09-14T00:00:00Z", warnings: ["w1"] } };
const summary = summarizeTheme(parseStoredTheme(stored));
eq(summary.pageSize, "LETTER", "summary pageSize");
eq(summary.footer, "Page {{page}}", "summary footer joins segments");
eq(summary.header, null, "summary header null");
eq(summary.warnings, ["w1"], "summary warnings pass through");
eq(summary.fonts.map((f) => f.role), ["body", "heading"], "summary lists body + heading fonts");
eq(tint("#000000", 0.5), "#808080", "tint mixes toward white");
ok(Math.abs(luminance("#ffffff") - 255) < 0.01, "luminance white = 255");
eq(chroma("#808080"), 0, "grey has zero chroma");
ok(hueDistance("#ff0000", "#00ff00") > 100, "red vs green far apart");
ok(hueDistance("#ff0000", "#ff2010") < 15, "near-reds close");

// ─── fonts.ts ────────────────────────────────────────────────────────────────
const fonts = await import(path.resolve(here, "../src/lib/report-theme/fonts.ts"));
const { parsePostScriptName, matchFamily, fontPath } = fonts;
import { existsSync } from "node:fs";

eq(parsePostScriptName("ABCDEF+Calibri-Bold"), { family: "Calibri", bold: true, italic: false }, "subset prefix + Bold");
eq(parsePostScriptName("TimesNewRomanPSMT"), { family: "Times New Roman", bold: false, italic: false }, "PSMT suffix + camel split");
eq(parsePostScriptName("ArialMT"), { family: "Arial", bold: false, italic: false }, "MT suffix");
eq(parsePostScriptName("Arial,BoldItalic"), { family: "Arial", bold: true, italic: true }, "comma style");
eq(parsePostScriptName("Helvetica-BoldOblique"), { family: "Helvetica", bold: true, italic: true }, "Oblique = italic");
eq(parsePostScriptName("OpenSans-SemiBold"), { family: "Open Sans", bold: true, italic: false }, "SemiBold counts as bold");
eq(parsePostScriptName("SegoeUI"), { family: "Segoe UI", bold: false, italic: false }, "SegoeUI split");
eq(parsePostScriptName("Cambria"), { family: "Cambria", bold: false, italic: false }, "plain name");
eq(parsePostScriptName("Times-Roman"), { family: "Times", bold: false, italic: false }, "-Roman suffix strips to base");
eq(parsePostScriptName("Merit"), { family: "Merit", bold: false, italic: false }, "ordinary name ending in -it is untouched");
eq(parsePostScriptName("Exhibit-Regular"), { family: "Exhibit", bold: false, italic: false }, "ordinary name ending in -it, Regular suffix dropped");
eq(parsePostScriptName("Circuit-Bold"), { family: "Circuit", bold: true, italic: false }, "ordinary name ending in -it, Bold suffix dropped");
eq(parsePostScriptName("Bookman-Roman"), { family: "Bookman", bold: false, italic: false }, "-Roman suffix doesn't eat Book from Bookman");
eq(parsePostScriptName("NewCenturySchlbk-Roman"), { family: "New Century Schlbk", bold: false, italic: false }, "camel-split base + -Roman suffix");
eq(parsePostScriptName("Times New Roman,Bold"), { family: "Times New Roman", bold: true, italic: false }, "Roman kept when preceded by a non-style rest segment");
eq(parsePostScriptName("CalibriBold"), { family: "Calibri", bold: true, italic: false }, "trailing style word on unseparated base");
eq(parsePostScriptName("MinionPro-It"), { family: "Minion Pro", bold: false, italic: true }, "It suffix means italic, Pro kept");
eq(matchFamily(parsePostScriptName("Times-Roman").family), { family: "liberation-serif", exact: false }, "Times-Roman round-trips to Liberation Serif");
eq(matchFamily("Calibri"), { family: "carlito", exact: false }, "Calibri → Carlito");
eq(matchFamily("Times New Roman"), { family: "liberation-serif", exact: false }, "Times → Liberation Serif");
eq(matchFamily("Arial"), { family: "liberation-sans", exact: false }, "Arial → Liberation Sans");
eq(matchFamily("Open Sans"), { family: "open-sans", exact: true }, "Open Sans exact");
eq(matchFamily("Source Sans Pro"), { family: "source-sans-3", exact: true }, "Source Sans Pro → 3");
eq(matchFamily("Segoe UI"), { family: "open-sans", exact: false }, "Segoe UI → Open Sans");
eq(matchFamily("Garamond", { serif: true }), { family: "liberation-serif", exact: false }, "unknown serif → Liberation Serif");
eq(matchFamily("Futura"), { family: "liberation-sans", exact: false }, "unknown sans → Liberation Sans");
eq(matchFamily("Consolas", { mono: true }), { family: "liberation-mono", exact: false }, "unknown mono → Liberation Mono");
eq(matchFamily("DejaVu Sans"), { family: "dejavu-sans", exact: true }, "DejaVu exact");
eq(matchFamily(parsePostScriptName("ABCDEF+DejaVuSans-Bold").family), { family: "dejavu-sans", exact: true }, "DejaVuSans PostScript name round-trips");
eq(matchFamily(parsePostScriptName("SourceSans3-BoldIt").family), { family: "source-sans-3", exact: true }, "SourceSans3 PostScript name round-trips");
for (const fam of ["carlito", "liberation-serif", "open-sans"]) for (const st of ["regular", "bold", "italic", "bolditalic"]) ok(existsSync(fontPath(fam, st)), `fontPath(${fam}, ${st}) exists`);
ok(fontPath("dejavu-sans", "bold").endsWith("DejaVuSans-Bold.ttf"), "DejaVu bold maps to the existing file");
ok(fontPath("dejavu-sans", "italic").endsWith("DejaVuSans.ttf"), "DejaVu has no italic → regular");

// ─── active.ts / canonical.ts / draw.ts ─────────────────────────────────────
const active = await import(path.resolve(here, "../src/lib/report-theme/active.ts"));
const canonical = await import(path.resolve(here, "../src/lib/report-theme/canonical.ts"));
const draw = await import(path.resolve(here, "../src/lib/report-theme/draw.ts"));

eq(active.pageMargin(), 50, "default page margin is 50");
ok(active.isDefaultTheme(), "default theme active at start");
const T = { ...DEFAULT_THEME, id: "firm-x", page: { ...DEFAULT_THEME.page, margins: { top: 72, right: 72, bottom: 72, left: 72 } }, synonyms: { "trip-generation": "Site Trip Generation" } };
const inside = active.withTheme(T, () => [active.pageMargin(), active.isDefaultTheme(), active.takeSynonym("trip-generation"), active.takeSynonym("trip-generation")]);
eq(inside, [72, false, "Site Trip Generation", null], "withTheme sets margin, flags non-default, hands out a synonym once");
ok(active.isDefaultTheme() && active.pageMargin() === 50, "withTheme resets afterwards");
let threw = false; try { active.withTheme(T, () => { throw new Error("boom"); }); } catch { threw = true; }
ok(threw && active.isDefaultTheme(), "withTheme resets on throw");
let asyncRejected = false; try { active.withTheme(T, async () => 1); } catch { asyncRejected = true; }
ok(asyncRejected, "withTheme refuses an async fn");

eq(canonical.canonicalKey("4.0 TRIP GENERATION"), "trip-generation", "canonical: trip generation");
eq(canonical.canonicalKey("Level of Service Analysis"), "capacity-analysis", "canonical: LOS");
eq(canonical.canonicalKey("Conclusions and Recommendations"), "conclusions", "canonical: conclusions wins over recommendations");
eq(canonical.canonicalKey("Something Unrelated"), null, "canonical: unknown → null");
eq(canonical.stripNumbering("3.1 Gross Trip Generation"), "Gross Trip Generation", "stripNumbering dotted");
eq(canonical.stripNumbering("Section 2 – Existing Conditions"), "Existing Conditions", "stripNumbering Section N –");

eq(draw.splitHeading("3.0 STUDY NETWORK"), { parts: [3], text: "STUDY NETWORK" }, "3.0 is a level-1 number");
eq(draw.splitHeading("3.1 Gross Trip Generation"), { parts: [3, 1], text: "Gross Trip Generation" }, "3.1 split");
eq(draw.splitHeading("EXECUTIVE SUMMARY"), { parts: [], text: "EXECUTIVE SUMMARY" }, "no number");
eq(draw.formatNumber([3], "1.0"), "3.0", "1.0 style");
eq(draw.formatNumber([3, 1], "1.0"), "3.1", "1.0 style level 2");
eq(draw.formatNumber([3], "1."), "3.", "1. style");
eq(draw.formatNumber([3, 1], "1."), "3.1", "1. style level 2");
eq(draw.formatNumber([3], "1"), "3", "bare style");
eq(draw.formatNumber([3], "section"), "Section 3", "section style");
eq(draw.formatNumber([2], "letter"), "B.", "letter style");
eq(draw.formatNumber([3], "none"), "", "none drops");
eq(draw.applyCase("STUDY NETWORK", "title"), "Study Network", "title case");
eq(draw.applyCase("trip distribution and assignment", "title"), "Trip Distribution and Assignment", "title case keeps small words");
eq(draw.applyCase("Study Network", "upper"), "STUDY NETWORK", "upper");
const T2 = { ...DEFAULT_THEME, headings: [{ ...DEFAULT_THEME.headings[0], case: "title", numbering: "1." }, { ...DEFAULT_THEME.headings[1], case: "asis", numbering: "1." }, DEFAULT_THEME.headings[2]] };
eq(draw.formatHeading("4.0 TRIP GENERATION", 1, T2, (k) => (k === "trip-generation" ? "Site Trip Generation" : null)), "4.  Site Trip Generation", "formatHeading: number restyled, firm wording, title case");
eq(draw.formatHeading("4.0 TRIP GENERATION", 1, T2, () => null), "4.  Trip Generation", "formatHeading without synonym");
eq(draw.formatHeading("EXECUTIVE SUMMARY", 1, { ...T2, headings: [{ ...T2.headings[0], numbering: "none" }, T2.headings[1], T2.headings[2]] }, () => null), "Executive Summary", "unnumbered heading");
eq(draw.scaleWidths([200, 200, 200], 468), [156, 156, 156], "scaleWidths shrinks proportionally");
eq(draw.scaleWidths([100, 100], 468), [100, 100], "scaleWidths leaves fitting widths alone");
eq(draw.interpolate("{{firm.name}} · {{documentType}} · Page {{page}} of {{pages}}", { firmName: "Acme", projectName: "P", address: "", dateLabel: "", documentType: "Traffic Impact Study", client: "" }, 3, 12), "Acme · Traffic Impact Study · Page 3 of 12", "interpolate tokens");

// Render a small themed PDF uncompressed and look for the font + colour ops.
import PDFDocument from "pdfkit";
const RED = { ...DEFAULT_THEME, id: "firm-red", fonts: { body: { family: "carlito", requested: "Calibri", exact: false }, heading: { family: "liberation-serif", requested: "Times New Roman", exact: false } }, headings: [{ ...DEFAULT_THEME.headings[0], style: { font: "heading", size: 16, color: "#c0392b", bold: true }, rule: { color: "#c0392b", width: 1, gap: 2 } }, DEFAULT_THEME.headings[1], DEFAULT_THEME.headings[2]], table: { ...DEFAULT_THEME.table, header: { fill: "#1f3a5f", color: "#ffffff", bold: true, size: 9 }, rules: { color: "#1f3a5f", width: 0.75, mode: "grid" } }, footer: { segments: [{ align: "center", text: "Page {{page}} of {{pages}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: null, height: 30 } };
let footerText = null;
const pdfBytes = await new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 50, bottom: 50, left: 50, right: 50 }, compress: false, bufferPages: true });
  fonts.registerThemeFonts(doc, RED);
  const chunks = []; doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
  active.withTheme(RED, () => {
    draw.heading(doc, 1, "1.0 INTRODUCTION");
    draw.table(doc, { headers: ["A", "B"], widths: [300, 300], rows: [["1", "2"], ["3", "4"]] });
    draw.rows(doc, [["Label", "Value"]]);
    draw.metricStrip(doc, [{ label: "trips", value: "1,234" }]);
    // PDFKit embeds our bundled OFL fonts as Identity-H CID fonts (verified against
    // pdfkit@0.15.2's EmbeddedFont class), so drawn glyphs never appear as literal
    // ASCII in the content stream — only the /BaseFont name and colour operators do
    // (checked below via pdfText). Capture the exact string handed to doc.text()
    // instead of scanning bytes for text that Identity-H encoding cannot produce.
    const origText = doc.text.bind(doc);
    doc.text = (str, ...rest) => { if (footerText === null) footerText = str; return origText(str, ...rest); };
    draw.pageFooter(doc, { firmName: "F", projectName: "P", address: "", dateLabel: "", documentType: "D", client: "" }, 1, 1);
    doc.text = origText;
    doc.end();
  });
});
const pdfText = pdfBytes.toString("latin1");
// PDFKit writes colours as `r g b scn` / `SCN` under /DeviceRGB with full JS precision (verified on 0.15).
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).join(" ");
ok(/\/BaseFont \/[A-Z]{6}\+LiberationSerif-Bold/.test(pdfText), "heading embeds Liberation Serif Bold");
ok(/\/BaseFont \/[A-Z]{6}\+Carlito/.test(pdfText), "body embeds Carlito");
ok(pdfText.includes(`${rgb("#c0392b")} scn`), "heading colour op present");
ok(pdfText.includes(`${rgb("#1f3a5f")} scn`), "table header fill op present");
ok(pdfText.includes(`${rgb("#1f3a5f")} SCN`), "grid rule stroke op present");
eq(footerText, "Page 1 of 1", "footer interpolated");

// ─── derive/typography.ts ────────────────────────────────────────────────────
const typo = await import(path.resolve(here, "../src/lib/report-theme/derive/typography.ts"));
eq(typo.detectNumbering(["1.0 INTRO", "2.0 METHODS", "3.0 RESULTS"]), "1.0", "numbering 1.0");
eq(typo.detectNumbering(["1. Intro", "2. Methods"]), "1.", "numbering 1.");
eq(typo.detectNumbering(["1 Intro", "2 Methods"]), "1", "numbering bare");
eq(typo.detectNumbering(["Section 1 – Intro", "Section 2: Methods"]), "section", "numbering section");
eq(typo.detectNumbering(["A. Intro", "B. Methods"]), "letter", "numbering letter");
eq(typo.detectNumbering(["Introduction", "Methods", "3. Results"]), "none", "numbering none when < 50%");
eq(typo.median([5, 1, 3]), 3, "median odd");
eq(typo.median([1, 2, 3, 4]), 2.5, "median even");
eq(typo.mode([1, 2, 2, 3]), 2, "mode");
// Synthetic pages: body 10pt black; H1 14pt blue bold ×3; H2 12pt bold ×2; one 30pt cover-ish run on page 1 (ignored).
const run = (page, str, size, color, x, y, w, extra = {}) => ({ page, str, font: extra.bold ? "ABCDEF+Arial-Bold" : "ABCDEF+Arial", size, bold: !!extra.bold, italic: false, serif: false, mono: false, color, x, y, w, h: size });
const mkPage = (n, runs, lines = [], rects = []) => ({ page: n, width: 612, height: 792, runs, rects, lines, images: [] });
const pagesA = [
  mkPage(1, [run(1, "BIG TITLE", 30, "#1a5276", 72, 300, 300, { bold: true })]),
  mkPage(2, [run(2, "1.0 INTRODUCTION", 14, "#1a5276", 72, 100, 200, { bold: true }), run(2, "Body text line one that is long enough to count as a paragraph line.", 10, "#000000", 72, 124, 460), run(2, "Second body line of similar length to the first one here.", 10, "#000000", 72, 138, 440), run(2, "1.1 Study Area", 12, "#000000", 72, 170, 120, { bold: true }), run(2, "Third body line again with enough words to be a paragraph.", 10, "#000000", 72, 190, 450)], [{ page: 2, x1: 72, y1: 104, x2: 540, y2: 104, color: "#1a5276", width: 1 }]),
  mkPage(3, [run(3, "2.0 EXISTING CONDITIONS", 14, "#1a5276", 72, 100, 240, { bold: true }), run(3, "Body body body body body body body body body body body.", 10, "#000000", 72, 124, 430), run(3, "2.1 Roadways", 12, "#000000", 72, 160, 100, { bold: true }), run(3, "More body text of typical paragraph length for the page.", 10, "#000000", 72, 180, 445)], [{ page: 3, x1: 72, y1: 104, x2: 540, y2: 104, color: "#1a5276", width: 1 }]),
  mkPage(4, [run(4, "3.0 CONCLUSIONS", 14, "#1a5276", 72, 100, 200, { bold: true }), run(4, "Closing body text that wraps like any other paragraph line.", 10, "#000000", 72, 124, 455)], [{ page: 4, x1: 72, y1: 104, x2: 540, y2: 104, color: "#1a5276", width: 1 }]),
];
const bodyA = typo.bodyStyle(pagesA);
eq(bodyA && [bodyA.size, bodyA.color, bodyA.bold], [10, "#000000", false], "bodyStyle picks 10pt black");
const heads = typo.detectHeadings(pagesA, bodyA);
eq(heads.map((h) => [h.size, h.color, h.numbering, h.upper]), [[14, "#1a5276", "1.0", true], [12, "#000000", "1", false]], "two heading levels, numbering and case per level");
ok(heads[0].rule && heads[0].rule.color === "#1a5276" && heads[0].rule.width === 1, "H1 rule detected");
ok(heads[1].rule === null, "H2 has no rule");
ok(heads[0].spaceAfter >= 8 && heads[0].spaceAfter <= 20, `H1 spaceAfter measured (${heads[0].spaceAfter})`);

// ─── running header/footer excluded by recurrence, not position ────────────
// A 1-inch (72pt) margin can put a running header's baseline at y=48 — well
// inside the band a position-based cutoff would need to exclude real
// headers, yet close enough to a genuine heading's own baseline that a
// position rule can't tell them apart. Recurrence can: a running header
// repeats the same (digit-normalised) text at nearly the same baseline on
// most interior pages; a heading's text does not.
const header = (page, text) => run(page, text, 9, "#1a5276", 72, 48, 260, { bold: true });
const h1B = (page, text) => run(page, text, 14, "#000000", 72, 84, 200, { bold: true });
const bodyLineB = (page, text) => run(page, text, 8, "#000000", 72, 110, 400);
const bodyTextsB = [
  "Body text line one that is long enough to count as a paragraph line for this fixture.",
  "Second body line of similar length appearing on this page for the same fixture here.",
  "Third body line again with enough words to be a paragraph for this test fixture too.",
  "Fourth body line closing out the section with enough length to match the others here.",
];
const h1TextsB = ["1.0 ONE", "2.0 TWO", "3.0 THREE", "4.0 FOUR"];
const pageNumsB = [2, 3, 4, 5];

// Fixture 1: the header text is IDENTICAL on every page (a real running
// header) at y=48 — it must be excluded even though that baseline sits
// nowhere a page-height percentage or an absolute edge band could safely cut.
const pagesB = pageNumsB.map((n, i) => mkPage(n, [header(n, "Acme Engineering | Traffic Impact Study"), h1B(n, h1TextsB[i]), bodyLineB(n, bodyTextsB[i])]));
const bodyB = typo.bodyStyle(pagesB);
eq(bodyB && [bodyB.size, bodyB.color, bodyB.bold], [8, "#000000", false], "bodyStyle for the recurring-header fixture");
const headsB = typo.detectHeadings(pagesB, bodyB);
eq(headsB.map((h) => h.size), [14], "recurring same-text header at y=48 excluded; only the 14pt H1 remains");

// Fixture 2: same style and the same y=48 position, but the header text
// differs on every page (no real running header repeats different words per
// page). Recurrence no longer sees it as a header, so position alone must
// not exclude it either — it is picked up as its own heading level under the
// ordinary style rules. Pinned explicitly so this behaviour is intended.
const pagesC = pageNumsB.map((n, i) => mkPage(n, [header(n, ["Northbound Corridor", "Southbound Corridor", "Eastbound Corridor", "Westbound Corridor"][i]), h1B(n, h1TextsB[i]), bodyLineB(n, bodyTextsB[i])]));
const bodyC = typo.bodyStyle(pagesC);
const headsC = typo.detectHeadings(pagesC, bodyC);
eq(headsC.map((h) => [h.size, h.color]), [[14, "#000000"], [9, "#1a5276"]], "non-recurring header-styled line at the same position is not excluded by position alone");

// ─── derive/header-footer.ts + derive/page.ts ────────────────────────────────
const hf = await import(path.resolve(here, "../src/lib/report-theme/derive/header-footer.ts"));
const CTX = { firmName: "Acme Traffic Engineering, Inc.", coverTitle: "Maple Grove Mixed-Use Development" };
eq(hf.classifyRunningText("Page 3 of 12", CTX), "Page {{page}} of {{pages}}", "page N of M");
eq(hf.classifyRunningText("Page 7", CTX), "Page {{page}}", "page N");
eq(hf.classifyRunningText("- 7 -", CTX), "{{page}}", "dashed number");
eq(hf.classifyRunningText("12", CTX), "{{page}}", "bare number");
eq(hf.classifyRunningText("Acme Traffic Engineering Inc", CTX), "{{firm.name}}", "firm name (punctuation-insensitive)");
eq(hf.classifyRunningText("Traffic Impact Study", CTX), "{{documentType}}", "document type");
eq(hf.classifyRunningText("Transport Assessment", CTX), "{{documentType}}", "UK document type");
eq(hf.classifyRunningText("March 2025", CTX), "{{project.dateLabel}}", "month year");
eq(hf.classifyRunningText("03/14/2025", CTX), "{{project.dateLabel}}", "numeric date");
eq(hf.classifyRunningText("Maple Grove Mixed-Use Development", CTX), "{{project.projectName}}", "cover title → project name");
eq(hf.classifyRunningText("Prepared for Maple Grove Partners LLC", CTX), null, "client line dropped");
eq(hf.tokenizeSegment("Acme Traffic Engineering, Inc. | Traffic Impact Study | Page 3", CTX), { text: "{{firm.name}} | {{documentType}} | Page {{page}}", dropped: [] }, "pipe-separated segment tokenised");
eq(hf.tokenizeSegment("Maple Grove Partners LLC  –  Page 3 of 9", CTX), { text: "Page {{page}} of {{pages}}", dropped: ["Maple Grove Partners LLC"] }, "unclassified part dropped, separator collapsed");
// §5.3 leak: a page marker matching INSIDE a larger, separator-free run of
// text must still yield only the token — never the surrounding sample text —
// and the surrounding text must be recoverable as dropped, not silently kept.
eq(hf.classifyRunningText("Maple Grove Partners LLC Traffic Impact Study Page 3 of 12", CTX), "Page {{page}} of {{pages}}", "page pattern wins even when embedded in surrounding text, and returns only the token");
const leak = hf.tokenizeSegment("Maple Grove Partners LLC Traffic Impact Study Page 3 of 12", CTX);
ok(leak.text === "Page {{page}} of {{pages}}" && leak.dropped.some((d) => d.includes("Maple Grove Partners LLC")), `tokenizeSegment drops the remainder around an embedded page marker (${JSON.stringify(leak)})`);
// Zones: 4 interior pages with a right-aligned header and a centred footer, one page missing the header.
const zrun = (page, str, x, y, w, size = 8, color = "#666666") => ({ page, str, font: "ABCDEF+Arial", size, bold: false, italic: false, serif: false, mono: false, color, x, y, w, h: size });
const bodyRun = (page, y) => ({ page, str: "Body text that is long enough to be a paragraph line for margins.", font: "ABCDEF+Arial", size: 10, bold: false, italic: false, serif: false, mono: false, color: "#000000", x: 72, y, w: 460, h: 10 });
const zpage = (n, withHeader) => ({ page: n, width: 612, height: 792, runs: [...(withHeader ? [zrun(n, "Acme Traffic Engineering, Inc. | Traffic Impact Study", 300, 34, 232)] : []), zrun(n, `Page ${n - 1} of 4`, 280, 760, 52), bodyRun(n, 90), bodyRun(n, 104), bodyRun(n, 700)], rects: [], lines: withHeader ? [{ page: n, x1: 72, y1: 44, x2: 540, y2: 44, color: "#1f4e79", width: 0.5 }] : [], images: [] });
const zpages = [{ page: 1, width: 612, height: 792, runs: [], rects: [], lines: [], images: [] }, zpage(2, true), zpage(3, true), zpage(4, false), zpage(5, true)];
const zbody = { font: "ABCDEF+Arial", size: 10, color: "#000000", serif: false, mono: false, bold: false };
const zones = hf.detectRunningZones(zpages, zbody, null, CTX);
ok(zones.header && zones.header.segments.length === 1 && zones.header.segments[0].align === "right" && zones.header.segments[0].text === "{{firm.name}} | {{documentType}}", `header detected on 3/4 pages, right-aligned, tokenised (${JSON.stringify(zones.header?.segments)})`);
ok(zones.header && zones.header.rule && zones.header.rule.color === "#1f4e79", "header rule detected");
ok(zones.header && zones.header.height >= 46 && zones.header.height <= 52, `header height uses the rule's own y, not a full line-height guess (${zones.header?.height})`);
ok(zones.footer && zones.footer.segments[0].align === "center" && zones.footer.segments[0].text === "Page {{page}} of {{pages}}", `footer centred + tokenised (${JSON.stringify(zones.footer?.segments)})`);
ok(zones.footer && zones.footer.style.size === 8 && zones.footer.style.color === "#666666", "footer style captured");
ok(zones.footer && zones.footer.edge > 740 && zones.footer.edge < 760, `footer edge (${zones.footer?.edge})`);
const pg = await import(path.resolve(here, "../src/lib/report-theme/derive/page.ts"));
const geom = pg.pageGeometry(zpages, zbody, { headerBottom: zones.header?.edge ?? null, footerTop: zones.footer?.edge ?? null });
eq(geom && geom.size, "LETTER", "geometry snaps to LETTER");
eq(geom && geom.margins.left, 76, "symmetric margin = mean(72, 612-532=80) = 76");
ok(geom && geom.margins.top >= 76 && geom.margins.top <= 84, `top margin from first body line (${geom?.margins.top})`);
ok(geom && geom.margins.bottom >= 88 && geom.margins.bottom <= 96, `bottom margin from last body line (${geom?.margins.bottom})`);

// Tab-stop footer: one Word-style footer line built from THREE separate runs
// far apart in x (a real tab-stopped Word footer), which the scanner's
// linesOf joins into a single TextLine.text with plain single spaces — the
// gap-based split inside detectZone must still recover each column from the
// underlying runs' x/w and classify (or drop) each one independently.
const tabRun = (page, str, x, w, y = 760, size = 8) => ({ page, str, font: "ABCDEF+Arial", size, bold: false, italic: false, serif: false, mono: false, color: "#666666", x, y, w, h: size });
const tabPage = (n) => ({ page: n, width: 612, height: 792, runs: [tabRun(n, "Maple Grove Partners LLC", 72, 150), tabRun(n, "Traffic Impact Study", 280, 140), tabRun(n, `Page ${n - 1} of 3`, 480, 90)], rects: [], lines: [], images: [] });
const tabPages = [{ page: 1, width: 612, height: 792, runs: [], rects: [], lines: [], images: [] }, tabPage(2), tabPage(3), tabPage(4)];
const tabCtx = { firmName: "Acme", coverTitle: null };
const tabZones = hf.detectRunningZones(tabPages, zbody, null, tabCtx);
const docSeg = tabZones.footer?.segments.find((s) => s.text === "{{documentType}}");
const pageSeg = tabZones.footer?.segments.find((s) => s.text === "Page {{page}} of {{pages}}");
ok(!!docSeg, `tab-stop footer: doctype column tokenised (${JSON.stringify(tabZones.footer?.segments)})`);
ok(!!pageSeg, `tab-stop footer: page column tokenised (${JSON.stringify(tabZones.footer?.segments)})`);
ok(docSeg && docSeg.align === "center", `tab-stop footer: doctype column gets its own (centred) alignment (${docSeg?.align})`);
ok(pageSeg && pageSeg.align === "right", `tab-stop footer: page column gets its own (right) alignment (${pageSeg?.align})`);
ok(!tabZones.footer?.segments.some((s) => /Maple Grove/.test(s.text)), "tab-stop footer: client column never reaches a segment");
ok(tabZones.warnings.some((w) => w.includes("Maple Grove Partners LLC")), `tab-stop footer: client column dropped with a warning naming it (${JSON.stringify(tabZones.warnings)})`);

// Mixed page sizes: a rogue landscape interior page (e.g. an oversize plan
// sheet inserted into an otherwise-uniform report) recurs the SAME
// (digit-normalised) footer text at y=590 — near ITS OWN bottom edge (page
// height 612) but nowhere near the real pages' bottom edge (792) — and must
// not be allowed to corrupt the zone/geometry derived from the report's
// real (modal) page size.
const rogue = { page: 6, width: 792, height: 612, runs: [zrun(6, "Page 5 of 4", 280, 590, 52)], rects: [], lines: [], images: [] };
const zpagesMixed = [...zpages, rogue];
const zonesMixed = hf.detectRunningZones(zpagesMixed, zbody, null, CTX);
eq(zonesMixed.header?.segments, zones.header?.segments, "mixed page sizes: header segments unaffected by a rogue landscape page");
eq(zonesMixed.footer?.segments, zones.footer?.segments, "mixed page sizes: footer segments unaffected by a rogue landscape page");
eq(zonesMixed.footer?.edge, zones.footer?.edge, "mixed page sizes: footer edge unaffected by a rogue landscape page");
const geomMixed = pg.pageGeometry(zpagesMixed, zbody, { headerBottom: zonesMixed.header?.edge ?? null, footerTop: zonesMixed.footer?.edge ?? null });
eq(geomMixed, geom, "mixed page sizes: geometry unaffected by a rogue landscape page");

// Minor: an unsnapped size must be stored portrait-normalised ([pw, ph]), not
// as the raw (possibly landscape-ordered) [w, h] — pageSizePoints (theme.ts)
// swaps the tuple for a landscape page, so storing it pre-swapped would swap
// it a second time and hand back the wrong dimensions.
const wideRun = (page, y) => ({ page, str: "Body text that is long enough to be a paragraph line for margins.", font: "ABCDEF+Arial", size: 10, bold: false, italic: false, serif: false, mono: false, color: "#000000", x: 40, y, w: 600, h: 10 });
const widePage = (n) => ({ page: n, width: 700, height: 500, runs: [wideRun(n, 60), wideRun(n, 74), wideRun(n, 440)], rects: [], lines: [], images: [] });
const widePages = [{ page: 1, width: 700, height: 500, runs: [], rects: [], lines: [], images: [] }, widePage(2), widePage(3)];
const wideBody = { font: "ABCDEF+Arial", size: 10, color: "#000000", serif: false, mono: false, bold: false };
const geomWide = pg.pageGeometry(widePages, wideBody, { headerBottom: null, footerTop: null });
eq(geomWide && geomWide.orientation, "landscape", "unsnapped 700×500 page is landscape");
eq(geomWide && geomWide.size, [500, 700], "unsnapped landscape size is stored portrait-normalised [500, 700], not raw [700, 500]");

// ─── derive/palette.ts + derive/tables.ts ────────────────────────────────────
const pal = await import(path.resolve(here, "../src/lib/report-theme/derive/palette.ts"));
const palette = pal.derivePalette(pagesA, bodyA, heads, ["#6b7280"]);
eq(palette.primary, "#1a5276", "primary = heading blue");
eq(palette.text, "#000000", "text = body colour");
eq(palette.rule, "#1a5276", "rule = most common stroke colour");
eq(palette.muted, "#6b7280", "muted from candidates");
const tbl = await import(path.resolve(here, "../src/lib/report-theme/derive/tables.ts"));
// A table on page 3: header fill + 3 row rules + a caption above; vertical grid lines.
const tp = mkPage(3, [
  run(3, "Table 2-1: Level of Service Summary", 9, "#6b7280", 72, 296, 200, { bold: true }),
  run(3, "Intersection", 9, "#ffffff", 76, 313, 60, { bold: true }), run(3, "AM", 9, "#ffffff", 276, 313, 20, { bold: true }),
  run(3, "Main St", 9, "#000000", 76, 331, 40), run(3, "B", 9, "#000000", 276, 331, 8),
  run(3, "Oak Rd", 9, "#000000", 76, 349, 40), run(3, "C", 9, "#000000", 276, 349, 8),
  run(3, "Body paragraph text that is long enough to be a real line of text here.", 10, "#000000", 72, 420, 450),
], [
  { page: 3, x1: 72, y1: 320, x2: 372, y2: 320, color: "#9dc3e6", width: 0.5 }, { page: 3, x1: 72, y1: 338, x2: 372, y2: 338, color: "#9dc3e6", width: 0.5 }, { page: 3, x1: 72, y1: 356, x2: 372, y2: 356, color: "#9dc3e6", width: 0.5 },
  { page: 3, x1: 72, y1: 302, x2: 72, y2: 356, color: "#9dc3e6", width: 0.5 }, { page: 3, x1: 272, y1: 302, x2: 272, y2: 356, color: "#9dc3e6", width: 0.5 }, { page: 3, x1: 372, y1: 302, x2: 372, y2: 356, color: "#9dc3e6", width: 0.5 },
], [{ page: 3, x: 72, y: 302, w: 300, h: 18, color: "#1f4e79" }]);
const tres = tbl.detectTables([pagesA[0], pagesA[1], tp], bodyA, null);
ok(tres.count === 1, `one table region found (${tres.count})`);
ok(tres.style && tres.style.header.fill === "#1f4e79" && tres.style.header.color === "#ffffff" && tres.style.header.bold, `header fill/colour/bold (${JSON.stringify(tres.style?.header)})`);
ok(tres.style && tres.style.rules.mode === "grid" && tres.style.rules.color === "#9dc3e6", `grid rules in #9dc3e6 (${JSON.stringify(tres.style?.rules)})`);
ok(tres.style && tres.style.body.size === 9, "body size 9");
ok(tres.style && tres.style.caption.position === "above" && tres.style.caption.style.bold === true, `caption above, bold (${JSON.stringify(tres.style?.caption)})`);
ok(tres.style && tres.style.padX >= 2 && tres.style.padX <= 6, `padX ≈ 4 (${tres.style?.padX})`);
const fp = mkPage(4, [run(4, "Figure 3-1: Site Location Map", 9, "#6b7280", 72, 520, 200, { bold: true })], [], []);
fp.images.push({ page: 4, x: 72, y: 300, w: 468, h: 200, objId: "img1", pixels: null });
const fig = tbl.detectFigureCaption([pagesA[0], fp], bodyA);
ok(fig && fig.position === "below", `figure caption below the image (${JSON.stringify(fig)})`);

// ─── tables.ts: merge tolerance is directional, not symmetric ──────────────
// Two tables on one page sharing the same left/right columns, stacked 30pt
// apart (table 1's last rule at y=374, table 2's header fill at y=404): the
// widened "header sits above its region" tolerance must not also let a
// second table's header fill — or a shaded note box — fuse in from BELOW a
// region just because it is close. Each table keeps its own header fill.
const stacked = mkPage(5, [
  run(5, "Intersection", 9, "#ffffff", 76, 313, 60, { bold: true }), run(5, "AM", 9, "#ffffff", 276, 313, 20, { bold: true }),
  run(5, "Main St", 9, "#000000", 76, 331, 40), run(5, "B", 9, "#000000", 276, 331, 8),
  run(5, "Oak Rd", 9, "#000000", 76, 349, 40), run(5, "C", 9, "#000000", 276, 349, 8),
  run(5, "Intersection", 9, "#ffffff", 76, 415, 60, { bold: true }), run(5, "AM", 9, "#ffffff", 276, 415, 20, { bold: true }),
  run(5, "Pine St", 9, "#000000", 76, 433, 40), run(5, "B", 9, "#000000", 276, 433, 8),
  run(5, "Cedar Rd", 9, "#000000", 76, 451, 40), run(5, "C", 9, "#000000", 276, 451, 8),
], [
  { page: 5, x1: 72, y1: 320, x2: 372, y2: 320, color: "#9dc3e6", width: 0.5 }, { page: 5, x1: 72, y1: 338, x2: 372, y2: 338, color: "#9dc3e6", width: 0.5 }, { page: 5, x1: 72, y1: 356, x2: 372, y2: 356, color: "#9dc3e6", width: 0.5 },
  { page: 5, x1: 72, y1: 422, x2: 372, y2: 422, color: "#9dc3e6", width: 0.5 }, { page: 5, x1: 72, y1: 440, x2: 372, y2: 440, color: "#9dc3e6", width: 0.5 }, { page: 5, x1: 72, y1: 458, x2: 372, y2: 458, color: "#9dc3e6", width: 0.5 },
], [
  { page: 5, x: 72, y: 302, w: 300, h: 18, color: "#1f4e79" },
  { page: 5, x: 72, y: 404, w: 300, h: 18, color: "#1f4e79" },
]);
const stackedRes = tbl.detectTables([pagesA[0], stacked], bodyA, null);
ok(stackedRes.count === 2, `two same-column tables stacked 30pt apart stay separate (${stackedRes.count})`);
ok(stackedRes.style && stackedRes.style.header.fill === "#1f4e79", `each table's header fill still found after the directional fix (${stackedRes.style?.header.fill})`);

// ─── tables.ts: a bold first row identifies a header with no fill at all ───
// A rule-only table (no header fill; the luminance guard would also skip a
// white one) whose 3 rules (20pt apart: 340, 360, 380) sit only between BODY
// rows — never under the header itself — used to compute headerBottom at the
// row1/row2 rule (the same off-by-one-row bug the fill-based fix addressed).
// Per spec §5.2 ("header row = first row with bold runs OR on a fill"), the
// first bold baseline above the region (here 25pt above g.yTop, within the
// row-pitch-scaled 1.5×20=30pt reach) is the header instead. Header and body
// share the same 9pt size but different colours, so a leak either way shows.
const ruleOnly = mkPage(6, [
  run(6, "Movement", 9, "#000000", 76, 315, 60, { bold: true }), run(6, "Delay (s)", 9, "#000000", 276, 315, 20, { bold: true }),
  run(6, "EB Left", 9, "#333333", 76, 350, 40), run(6, "12.3", 9, "#333333", 276, 350, 20),
  run(6, "WB Left", 9, "#333333", 76, 365, 40), run(6, "15.7", 9, "#333333", 276, 365, 20),
  run(6, "NB Thru", 9, "#333333", 76, 378, 40), run(6, "9.1", 9, "#333333", 276, 378, 20),
], [
  { page: 6, x1: 72, y1: 340, x2: 372, y2: 340, color: "#000000", width: 0.75 }, { page: 6, x1: 72, y1: 360, x2: 372, y2: 360, color: "#000000", width: 0.75 }, { page: 6, x1: 72, y1: 380, x2: 372, y2: 380, color: "#000000", width: 0.75 },
]);
const roRes = tbl.detectTables([pagesA[0], ruleOnly], bodyA, null);
ok(roRes.style && roRes.style.header.fill === null, `rule-only table: no header fill (${roRes.style?.header.fill})`);
ok(roRes.style && roRes.style.header.bold === true, `rule-only table: bold first row identifies the header (${roRes.style?.header.bold})`);
ok(roRes.style && roRes.style.header.size === 9, `rule-only table: header size 9 (${roRes.style?.header.size})`);
ok(roRes.style && roRes.style.body.size === 9, `rule-only table: body size 9 (${roRes.style?.body.size})`);
ok(roRes.style && roRes.style.body.color === "#333333", `rule-only table: body colour from the body runs, not the header's (${roRes.style?.body.color})`);

// ─── tables.ts: the header search skips a caption sitting above it ─────────
// Round-2 regression: a rule-only table (3 rules 20pt apart: 340, 360, 380 —
// rowPitch 20, reach 1.5×20=30pt above g.yTop) whose bold black 9pt header
// sits 25pt above g.yTop, with a bold grey "Table N" caption a further 14pt
// above the header (39pt above g.yTop — inside the same 30pt reach, so
// without the caption exclusion this caption, being the topmost bold run in
// the window and not close enough to the header's own baseline to cluster
// with it, becomes "the first row" outright and its grey leaks into
// header.color). The caption itself must still be found and placed "above".
const captionPage = mkPage(7, [
  run(7, "Table 4-2: Queue Summary", 9, "#6b7280", 72, 310, 200, { bold: true }),
  run(7, "Movement", 9, "#000000", 76, 324, 60, { bold: true }), run(7, "Delay (s)", 9, "#000000", 276, 324, 20, { bold: true }),
  run(7, "EB Left", 9, "#333333", 76, 350, 40), run(7, "12.3", 9, "#333333", 276, 350, 20),
  run(7, "WB Left", 9, "#333333", 76, 365, 40), run(7, "15.7", 9, "#333333", 276, 365, 20),
  run(7, "NB Thru", 9, "#333333", 76, 378, 40), run(7, "9.1", 9, "#333333", 276, 378, 20),
], [
  { page: 7, x1: 72, y1: 340, x2: 372, y2: 340, color: "#000000", width: 0.75 }, { page: 7, x1: 72, y1: 360, x2: 372, y2: 360, color: "#000000", width: 0.75 }, { page: 7, x1: 72, y1: 380, x2: 372, y2: 380, color: "#000000", width: 0.75 },
]);
const capRes = tbl.detectTables([pagesA[0], captionPage], bodyA, null);
ok(capRes.style && capRes.style.header.color === "#000000", `caption above a fill-less header is excluded from it (${capRes.style?.header.color})`);
ok(capRes.style && capRes.style.header.bold === true, `caption regression: header still identified as bold (${capRes.style?.header.bold})`);
ok(capRes.style && capRes.style.caption.position === "above", `caption regression: the caption itself is still found, above the table (${JSON.stringify(capRes.style?.caption)})`);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
