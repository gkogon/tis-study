// Scanner checks on PDFKit-generated synthetic samples with known styling.
// Run: node ./scripts/verify-theme-scan.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { makeSyntheticTis } from "./lib/synthetic-pdf.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const { scanPdf, linesOf } = await import(path.resolve(here, "../src/lib/report-theme/pdf-scan.ts"));
const { imagePixelsToPngDataUrl } = await import(path.resolve(here, "../src/lib/report-theme/png.ts"));

const blue = await makeSyntheticTis("blue-sans");
const scan = await scanPdf(blue);
ok(scan.numPages === 6 && scan.pages.length === 6, `blue-sans: 6 pages scanned (${scan.pages.length})`);
ok(scan.warnings.length === 0, `no warnings (${scan.warnings.join("; ")})`);
ok(scan.fontsSeen.some((f) => /Carlito/.test(f)), `fontsSeen includes Carlito (${scan.fontsSeen.join(", ")})`);
const p2 = scan.pages[1];
ok(near(p2.width, 612, 0.5) && near(p2.height, 792, 0.5), "page 2 is Letter");
const h1 = p2.runs.find((r) => r.str.startsWith("1. Introduction"));
ok(!!h1, "H1 run found");
ok(h1 && near(h1.size, 16, 0.3), `H1 size 16 (${h1?.size})`);
ok(h1 && h1.color === "#1f4e79", `H1 colour #1f4e79 (${h1?.color})`);
ok(h1 && h1.bold, "H1 bold from font name");
ok(h1 && near(h1.x, 72, 1), `H1 x at left margin 72 (${h1?.x})`);
ok(h1 && h1.y > 72 && h1.y < 100, `H1 baseline just under the top margin (${h1?.y})`);
const body = p2.runs.filter((r) => near(r.size, 11, 0.3) && r.color === "#222222");
ok(body.length >= 3, `body runs at 11pt #222222 (${body.length})`);
ok(body.some((r) => r.w > 300), "a body run spans most of the text width");
const rule = p2.lines.find((l) => l.color === "#1f4e79" && near(l.y1, l.y2, 0.1) && l.x2 - l.x1 > 400 && l.y1 > 72 && l.y1 < 110);
ok(!!rule, "H1 underline rule captured as a horizontal stroke");
const headerRule = p2.lines.find((l) => near(l.y1, 44, 1));
ok(!!headerRule, "running-header rule at y=44");
const footer = p2.runs.find((r) => /Page 1 of 5/.test(r.str));
ok(!!footer && footer.y > 740, `footer text near the bottom (${footer?.y})`);
const p3 = scan.pages[2];
const hdrFill = p3.rects.find((r) => r.color === "#1f4e79" && near(r.h, 18, 0.5) && near(r.w, 400, 0.5));
ok(!!hdrFill, "table header fill rect 400×18 #1f4e79");
const rowRules = p3.lines.filter((l) => l.color === "#9dc3e6");
ok(rowRules.length === 3, `three row rules in the table rule colour (${rowRules.length})`);
const white = p3.runs.find((r) => r.str === "Intersection" && r.color === "#ffffff");
ok(!!white, "table header text is white");
const lines2 = linesOf(p2);
ok(lines2.some((l) => l.text === "1. Introduction" && l.uniform), "linesOf joins the H1 into one uniform line");
ok(lines2.some((l) => l.text.startsWith("Acme Traffic Engineering | Traffic Impact Study")), "header line joined");
const cover = scan.pages[0];
ok(cover.rects.some((r) => r.color === "#1f4e79" && near(r.w, 612, 0.5) && near(r.h, 140, 0.5) && near(r.y, 0, 0.5)), "cover band rect 612×140 at top");
ok(cover.runs.some((r) => r.str === "TRAFFIC IMPACT STUDY" && near(r.size, 30, 0.3) && r.color === "#ffffff"), "cover title 30pt white");

// Image pixel path: the cover logo is decoded (default imagePixelsOnPage = 1).
const logo = cover.images.find((i) => i.pixels);
ok(!!logo, `cover has an image placement with pixels (${cover.images.length} image(s))`);
ok(!!logo && logo.pixels.width === 48 && logo.pixels.height === 16, `logo pixels are 48×16 (${logo?.pixels?.width}×${logo?.pixels?.height})`);
ok(!!logo && (logo.pixels.kind === 2 || logo.pixels.kind === 3), `logo pixel kind is RGB or RGBA (${logo?.pixels?.kind})`);
ok(!!logo && (imagePixelsToPngDataUrl(logo.pixels) ?? "").startsWith("data:image/png;base64,"), "logo pixels encode to a PNG data URL");
ok(!!logo && near(logo.w, 96, 0.5) && near(logo.x, 72, 0.5) && near(logo.y, 20, 0.5), `logo placed 96 wide at (72, 20) (x ${logo?.x}, y ${logo?.y}, w ${logo?.w})`);
const p2img = p2.images[0];
ok(!!p2img && p2img.pixels === null, `page-2 image has no pixels under the default imagePixelsOnPage = 1 (${p2img?.objId})`);
// The page-2 logo shares the cover's XObject, so pdfjs promotes it to the
// global "g_" store; its pixels must resolve from commonObjs, promptly.
const t0 = Date.now();
const scanP2 = await scanPdf(blue, { imagePixelsOnPage: 2 });
const elapsed = Date.now() - t0;
const shared = scanP2.pages[1].images[0];
ok(!!shared && shared.objId.startsWith("g_"), `page-2 logo is a global-store image (${shared?.objId})`);
ok(!!shared && !!shared.pixels && shared.pixels.width === 48, `page-2 logo pixels resolve from commonObjs (pixels ${shared?.pixels ? "yes" : "no"})`);
ok(elapsed < 4000, `imagePixelsOnPage: 2 scan did not stall on the 5 s timeout (${elapsed} ms)`);
ok(scanP2.pages[0].images.every((i) => i.pixels === null), "cover images have no pixels when imagePixelsOnPage = 2");
// Text render mode 3 (invisible, the OCR-layer case) is not a text layer.
ok(!cover.runs.some((r) => /HIDDEN/.test(r.str)), "render-mode-3 text is not recorded as a run");
ok(cover.runs.some((r) => r.str === "Project No. 2025-041"), "visible text after the render-mode restore is recorded");
// linesOf: runs on one line with sub-point baseline jitter are joined in x order.
const mk = (str, x, y) => ({ page: 9, str, font: "F", size: 10, bold: false, italic: false, serif: false, mono: false, color: "#000000", x, y, w: 30, h: 10 });
const jag = linesOf({ page: 9, width: 612, height: 792, runs: [mk("Beta", 300, 100), mk("Alpha", 50, 100.4)], rects: [], lines: [], images: [] });
ok(jag.length === 1 && jag[0].text === "Alpha Beta" && near(jag[0].x, 50, 0.01), `linesOf joins jagged-baseline runs in x order ("${jag[0]?.text}", x ${jag[0]?.x})`);

const serif = await scanPdf(await makeSyntheticTis("serif-black"));
const s2 = serif.pages[1];
ok(near(s2.width, 595.28, 0.5) && near(s2.height, 841.89, 0.5), "serif-black is A4");
const sh1 = s2.runs.find((r) => r.str.startsWith("1.0 INTRODUCTION"));
ok(sh1 && sh1.serif === true, "serif flag set for Liberation Serif");
ok(sh1 && near(sh1.x, 90, 1), `serif left margin 90 (${sh1?.x})`);
const sc = serif.pages[0];
ok(sc.images.some((i) => i.pixels && i.pixels.width === 48 && near(i.x, 90, 0.5) && near(i.w, 96, 0.5)), "serif-black cover logo 96 wide at x=90 with pixels");
ok(!sc.runs.some((r) => /HIDDEN/.test(r.str)), "serif-black: render-mode-3 text is not recorded");

const typo2 = await import(path.resolve(here, "../src/lib/report-theme/derive/typography.ts"));
const b1 = typo2.bodyStyle(scan.pages);
ok(b1 && near(b1.size, 11, 0.3) && b1.color === "#222222" && /Carlito/.test(b1.font), `blue-sans body = Carlito 11 #222222 (${JSON.stringify(b1)})`);
const hl = typo2.detectHeadings(scan.pages, b1);
ok(hl.length >= 2, `blue-sans: ≥2 heading levels (${hl.length})`);
ok(hl[0] && near(hl[0].size, 16, 0.3) && hl[0].color === "#1f4e79" && hl[0].numbering === "1." && hl[0].rule, `blue-sans H1 16pt blue, "1." numbering, ruled (${JSON.stringify({ s: hl[0]?.size, c: hl[0]?.color, n: hl[0]?.numbering, r: !!hl[0]?.rule })})`);
ok(hl[1] && near(hl[1].size, 13, 0.3) && hl[1].numbering === "1", `blue-sans H2 13pt with x.y numbering (${hl[1]?.numbering})`);
const b2 = typo2.bodyStyle(serif.pages);
const hl2 = typo2.detectHeadings(serif.pages, b2);
ok(hl2[0] && hl2[0].numbering === "1.0" && hl2[0].upper, "serif-black H1 uses 1.0 UPPER");

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
