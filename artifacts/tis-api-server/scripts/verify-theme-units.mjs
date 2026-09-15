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

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
