// The generic states renderer's default-theme tables (renderTisState — every US
// state without a dedicated renderer, Pennsylvania included) must stay on the
// page and must not overprint themselves. Before this check the Allegheny
// sample's §8.1 table was 575 pt wide on a 512 pt text block, so "Q95 (ft)"
// printed as "Q95 (f" and 1,190 as "1,19"; and every row was drawn at a fixed
// 16 pt, so a name that wrapped to a second line ("Babcock Boulevard &" /
// "Rochester Road") printed over the row below.
//
// Renders the tx fixture relocated to Pittsburgh with fetch stubbed offline,
// with long two-street names and a four-digit queue injected, then checks every
// text item in the subsections whose tables this renderer's tbl helper draws
// (§4.3, §5.1, §8.1, §9.4): none may cross the right margin, and no two may
// overlap. Charts and the §6 distribution tables (pdf-export-distribution.ts)
// are drawn elsewhere and are out of scope here.
// Run: node ./scripts/verify-states-table-layout.mjs
import { createRequire } from "node:module";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const MARGIN = 50;   // default theme, report-theme/active.ts pageMargin()
const SLACK = 0.5;   // pt: glyph-metric rounding between PDFKit and pdf.js

const LONG_NAMES = [
  "Babcock Boulevard & Rochester Road",
  "Siebert Road & McKnight Road",
  "Cemetery Lane & Babcock Boulevard",
  "Perry Highway & West View Park Drive",
  "McKnight Road & Ross Park Mall Drive",
];

function study() {
  const fx = JSON.parse(JSON.stringify(loadFixture("tx")));
  fx.latitude = 40.5250; fx.longitude = -80.0130;
  fx.report.request = { ...fx.report.request, latitude: 40.5250, longitude: -80.0130 };
  const rows = fx.report.affectedIntersections;
  rows.forEach((row, i) => { row.name = LONG_NAMES[i % LONG_NAMES.length]; });
  rows[0].queue95thFt = 1190;
  rows[0].existingStorageFt = 250; // puts a row in the §9.4 storage table too
  return fx;
}

/** Every text item on every page, as a box in top-left page coordinates. */
async function boxes(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const [, , w, h] = page.view;
    const items = (await page.getTextContent()).items
      .filter((it) => "str" in it && it.str.trim() !== "")
      .map((it) => {
        const size = Math.hypot(it.transform[2], it.transform[3]);
        const x0 = it.transform[4], base = h - it.transform[5];
        return { str: it.str, x0, x1: x0 + it.width, y0: base - size * 0.75, y1: base + size * 0.2 };
      });
    pages.push({ page: p, width: w, items });
  }
  await doc.destroy();
  return pages;
}

/** Subsections whose tables come from this renderer's own tbl helper. */
const IN_SCOPE = new Set(["4.3", "5.1", "8.1", "9.4"]);
const HEADING = /^(\d{1,2}\.\d) [A-Z]/;
/** Shared figures drawn inside a subsection (pdf-charts.ts renderDiurnalCharts after §5.1). */
const FIGURE = /^Trip Distribution by Time of Day$|^Figure — /;

const overlap = (a, b) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > SLACK &&
  Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > SLACK;

const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error("states-table-layout check: network disabled"));
const { mod, cleanup } = await loadRendererBundle();
try {
  const pdf = await mod.renderStudyPdf(projectFromFixture(study()), { name: "Table Layout Check", logoUrl: null });
  const pages = await boxes(pdf);
  const all = pages.flatMap((p) => p.items.map((it) => it.str)).join(" ");
  ok(all.includes("Pennsylvania Department of Transportation (PennDOT)"), "rendered by the generic states renderer as PennDOT");
  ok(all.includes("8.1 Intersection Level of Service"), "§8.1 table is present");
  ok(/Q95\s*\(ft\)/.test(all), "§8.1 header prints \"Q95 (ft)\" in full");
  ok(all.includes("1,190"), "a four-digit queue prints in full");
  ok(all.includes("Rochester Road"), "a wrapped name's second line is printed");

  // Tag each item with the subsection it falls in, by content order.
  let section = "0.0";
  for (const p of pages) for (const it of p.items) {
    const m = HEADING.exec(it.str);
    if (m) section = m[1];
    else if (FIGURE.test(it.str)) section = "figure";
    it.section = section;
  }
  for (const sub of IN_SCOPE) ok(pages.some((p) => p.items.some((it) => it.section === sub)), `§${sub} is present and tagged`);

  const overflow = [], overprint = [];
  for (const { page, width, items: all } of pages) {
    const items = all.filter((it) => IN_SCOPE.has(it.section));
    for (const it of items) if (it.x1 > width - MARGIN + SLACK) overflow.push(`p${page} "${it.str}" ends at ${it.x1.toFixed(1)} > ${width - MARGIN}`);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (overlap(items[i], items[j])) overprint.push(`p${page} "${items[i].str}" × "${items[j].str}"`);
  }
  ok(overflow.length === 0, `no text crosses the right margin${overflow.length ? `: ${overflow.slice(0, 6).join("; ")}` : ""}`);
  ok(overprint.length === 0, `no two text items overlap${overprint.length ? `: ${overprint.slice(0, 6).join("; ")}` : ""}`);
} finally {
  globalThis.fetch = realFetch;
  await cleanup();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
