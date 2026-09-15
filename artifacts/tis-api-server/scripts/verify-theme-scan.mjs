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

const serif = await scanPdf(await makeSyntheticTis("serif-black"));
const s2 = serif.pages[1];
ok(near(s2.width, 595.28, 0.5) && near(s2.height, 841.89, 0.5), "serif-black is A4");
const sh1 = s2.runs.find((r) => r.str.startsWith("1.0 INTRODUCTION"));
ok(sh1 && sh1.serif === true, "serif flag set for Liberation Serif");
ok(sh1 && near(sh1.x, 90, 1), `serif left margin 90 (${sh1?.x})`);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
