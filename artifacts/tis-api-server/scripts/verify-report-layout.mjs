// Default-theme reports must keep every line of text inside the right margin
// and must not overprint themselves. Faults this check caught:
// - the states renderer's tbl (§8.1 was 575 pt on a 512 pt text block, so
//   "Q95 (ft)" printed as "Q95 (f"; fixed 16 pt rows let a wrapped name print
//   over the row below);
// - the shared table() helpers in pdf-export.ts and pdf-export-distribution.ts
//   (the zone worksheet was 525 pt, the trip-assignment table 520 pt);
// - pdf-charts.ts line charts (a label centred on the last point spilled past
//   the margin, "23" / "0.99"; the first collided with the y-axis "0");
// - pdf-charts.ts column charts (a wrapped category label, "Cul…", printed
//   over the next figure's title).
//
// Renders every preview fixture with fetch stubbed offline, plus the tx
// fixture relocated to Pittsburgh (the generic states renderer) with long
// two-street names and a four-digit queue, and checks every horizontal text
// item on every page.
//
// NY is not checked: its own renderer (pdf-export-ny.ts) still has faults of
// its own (TOC entries and §-tables overprinting, columns past the margin).
// Add it here when those are fixed.
// Run: node ./scripts/verify-report-layout.mjs
import { createRequire } from "node:module";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture, FIXTURE_FAMILIES } from "./lib/fixture-project.mjs";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const MARGIN = 50;   // default theme, report-theme/active.ts pageMargin()
const SLACK = 0.5;   // pt: glyph-metric rounding between PDFKit and pdf.js
const KNOWN_FAULTY = new Set(["ny"]);

const LONG_NAMES = [
  "Babcock Boulevard & Rochester Road",
  "Siebert Road & McKnight Road",
  "Cemetery Lane & Babcock Boulevard",
  "Perry Highway & West View Park Drive",
  "McKnight Road & Ross Park Mall Drive",
];

function pittsburgh() {
  const fx = JSON.parse(JSON.stringify(loadFixture("tx")));
  fx.latitude = 40.5250; fx.longitude = -80.0130;
  fx.report.request = { ...fx.report.request, latitude: 40.5250, longitude: -80.0130 };
  const rows = fx.report.affectedIntersections;
  rows.forEach((row, i) => { row.name = LONG_NAMES[i % LONG_NAMES.length]; });
  rows[0].queue95thFt = 1190;
  rows[0].existingStorageFt = 250; // puts a row in the §9.4 storage table too
  return fx;
}

/** Every horizontal text item on every page, as a box in top-left page coordinates. */
async function pagesOf(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const [, , w, h] = page.view;
    const items = (await page.getTextContent()).items
      // Rotated text (chart y-axis titles) has no horizontal extent to test.
      .filter((it) => "str" in it && it.str.trim() !== "" && Math.abs(it.transform[1]) < 1e-6)
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

const overlap = (a, b) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > SLACK &&
  Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > SLACK;

function layoutFaults(pages) {
  const overflow = [], overprint = [];
  for (const { page, width, items } of pages) {
    for (const it of items) if (it.x1 > width - MARGIN + SLACK) overflow.push(`p${page} "${it.str}" ends at ${it.x1.toFixed(1)} > ${width - MARGIN}`);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (overlap(items[i], items[j])) overprint.push(`p${page} "${items[i].str}" × "${items[j].str}"`);
  }
  return { overflow, overprint };
}

function assertClean(label, pages) {
  const { overflow, overprint } = layoutFaults(pages);
  ok(overflow.length === 0, `${label}: no text crosses the right margin${overflow.length ? ` (${overflow.length}): ${overflow.slice(0, 6).join("; ")}` : ""}`);
  ok(overprint.length === 0, `${label}: no two text items overlap${overprint.length ? ` (${overprint.length}): ${overprint.slice(0, 6).join("; ")}` : ""}`);
}

const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error("report-layout check: network disabled"));
const { mod, cleanup } = await loadRendererBundle();
const render = async (fx) => pagesOf(await mod.renderStudyPdf(projectFromFixture(fx), { name: "Layout Check", logoUrl: null }));
try {
  // The generic states renderer, with the inputs that broke its tables.
  const pa = await render(pittsburgh());
  const text = pa.flatMap((p) => p.items.map((it) => it.str)).join(" ");
  ok(text.includes("Pennsylvania Department of Transportation (PennDOT)"), "PA: rendered by the generic states renderer as PennDOT");
  ok(text.includes("8.1 Intersection Level of Service"), "PA: §8.1 table is present");
  ok(/Q95\s*\(ft\)/.test(text), "PA: §8.1 header prints \"Q95 (ft)\" in full");
  ok(text.includes("Rochester Road"), "PA: a wrapped name's second line is printed");
  ok(text.includes("Trip share") && text.includes("Share of project"), "PA: both distribution tables are present");
  ok(text.includes("Figure — Project Trip Share by Study-Area Zone") && /Figure — Trip Share vs\. Distance/.test(text), "PA: zone-share and distance-decay figures are present");
  assertClean("PA", pa);

  for (const fam of FIXTURE_FAMILIES) {
    if (KNOWN_FAULTY.has(fam)) { console.log(`SKIP  ${fam}: known renderer faults, see header`); continue; }
    assertClean(fam.toUpperCase(), await render(loadFixture(fam)));
  }
} finally {
  globalThis.fetch = realFetch;
  await cleanup();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
