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

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
