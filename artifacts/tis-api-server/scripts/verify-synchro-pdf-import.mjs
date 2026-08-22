// Regression check for the Synchro REPORT PDF reader (synchro-pdf-import.ts).
//
// Two fixture families:
//
//  1. REAL PAGES — scripts/fixtures/synchro-report-hca-4pages.pdf: four
//     pages extracted from a filed Caltran Engineering Synchro 12 report
//     (HCA Westside TIS appendix, Plantation FL), diagonal DRAFT watermark
//     included. They cover: a Timings page whose legs are ALL diagonal
//     (SEL/NWT/… — must warn, never silently import), a standard Timings
//     page (12 exact volumes ground-truthed against pdftotext -layout), an
//     HCM 7th Signalized page, an HCM 7th TWSC page, and TWO scenarios
//     ("Scenario 1 - PM" Timings + "Scenario 1 - AM" HCM/TWSC) so scenario
//     grouping is exercised on real footers.
//
//  2. SYNTHETIC PAGES — built here with pdfkit at controlled coordinates:
//     a "Lanes, Volumes, Timings" page (volumes + PHF + HV% + storage +
//     cycle + rotated watermark), a Timings page, an HCM 7th TWSC page with
//     "92"-style PHF and "-" storage cells, an AM-scenario duplicate that
//     must LOSE to PM, and a non-Synchro PDF that must parse to zero blocks
//     with a clear warning (never a crash).
//
// Run: node ./scripts/verify-synchro-pdf-import.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { parseSynchroPdf, isPdfBytes } = await import(path.resolve(here, "../src/lib/synchro-pdf-import.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// ---------------------------------------------------------------------------
// pdfkit page builders for the synthetic family
// ---------------------------------------------------------------------------
const { default: PDFDocument } = await import(path.resolve(here, "../node_modules/pdfkit/js/pdfkit.js"));

const COLS_STD = ["EBL", "EBT", "EBR", "WBL", "WBT", "WBR", "NBL", "NBT", "NBR", "SBL", "SBT", "SBR"];
const COL_X0 = 150;
const COL_DX = 35;

function drawRow(doc, y, label, cells) {
  doc.fontSize(7.5).text(label, 54, y, { lineBreak: false });
  cells.forEach((c, i) => {
    if (c === undefined || c === null) return;
    doc.text(String(c), COL_X0 + i * COL_DX, y, { lineBreak: false });
  });
}

function drawHeaderBlock(doc, { title, intLine, headerLabel, cols }) {
  doc.fontSize(11).text(title, 54, 46, { lineBreak: false });
  doc.fontSize(9).text(intLine, 54, 60, { lineBreak: false });
  drawRow(doc, 90, headerLabel, cols);
}

function drawFooter(doc, scenario) {
  doc.fontSize(8).text(scenario, 54, 720, { lineBreak: false });
  doc.text("Synchro 11 Report", 440, 720, { lineBreak: false });
}

function drawWatermark(doc) {
  doc.save();
  doc.rotate(-45, { origin: [306, 396] });
  doc.fontSize(48).fillOpacity(0.2).text("DRAFT COPY", 100, 380, { lineBreak: false });
  doc.restore();
  doc.fillOpacity(1);
}

function buildPdf(build) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 36 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    build(doc);
    doc.end();
  });
}

// Synthetic report: LVT page (int 5, PM) + Timings page (int 7, PM) + TWSC
// page (int 9, PM) + an AM Timings duplicate of int 5 with DIFFERENT volumes
// that must lose the scenario pick.
const LVT_VOLS = [45, 505, 50, 60, 610, 35, 25, 150, 20, 30, 140, 25]; // Σ 1695
const AM_VOLS = LVT_VOLS.map((v) => v * 10); // wrong-if-imported sentinel
const syntheticPdf = await buildPdf((doc) => {
  // Page 1 — Lanes, Volumes, Timings (PM), with watermark
  drawWatermark(doc);
  drawHeaderBlock(doc, {
    title: "Lanes, Volumes, Timings",
    intLine: "5: Main St & First Ave",
    headerLabel: "Lane Group",
    cols: COLS_STD,
  });
  drawRow(doc, 104, "Traffic Volume (vph)", LVT_VOLS);
  drawRow(doc, 116, "Future Volume (vph)", AM_VOLS); // must be ignored
  drawRow(doc, 128, "Peak Hour Factor", COLS_STD.map(() => "0.92"));
  drawRow(doc, 140, "Heavy Vehicles (%)", COLS_STD.map(() => "3"));
  drawRow(doc, 152, "Storage Length (ft)", [150, 0, 100, 175, 0, 0, 80, 0, 0, 90, 0, 0]);
  doc.fontSize(8).text("Cycle Length: 110", 54, 200, { lineBreak: false });
  doc.text("Actuated Cycle Length: 104.2", 54, 212, { lineBreak: false });
  drawFooter(doc, "Existing PM");

  // Page 2 — Timings (PM), second intersection
  doc.addPage();
  drawHeaderBlock(doc, {
    title: "Timings",
    intLine: "7: Second Ave & Oak St",
    headerLabel: "Lane Group",
    cols: COLS_STD,
  });
  drawRow(doc, 104, "Traffic Volume (vph)", [0, 400, 0, 0, 300, 0, 0, 200, 0, 0, 100, 0]);
  doc.fontSize(8).text("Cycle Length: 120", 54, 200, { lineBreak: false });
  drawFooter(doc, "Existing PM");

  // Page 3 — HCM 7th TWSC (PM): "92"-style PHF, "-" storage cells
  doc.addPage();
  drawHeaderBlock(doc, {
    title: "HCM 7th TWSC",
    intLine: "9: Main St & Stop Ln",
    headerLabel: "Movement",
    cols: COLS_STD,
  });
  drawRow(doc, 104, "Traffic Vol, veh/h", [10, 0, 86, 0, 0, 18, 11, 877, 55, 41, 900, 21]);
  drawRow(doc, 116, "Peak Hour Factor", COLS_STD.map(() => "92"));
  drawRow(doc, 128, "Heavy Vehicles, %", COLS_STD.map(() => "2"));
  drawRow(doc, 140, "Storage Length", ["-", "-", "0", "-", "-", "0", "240", "-", "-", "250", "-", "-"]);
  drawFooter(doc, "Existing PM");

  // Page 4 — AM duplicate of int 5: the scenario pick must skip it.
  doc.addPage();
  drawHeaderBlock(doc, {
    title: "Timings",
    intLine: "5: Main St & First Ave",
    headerLabel: "Lane Group",
    cols: COLS_STD,
  });
  drawRow(doc, 104, "Traffic Volume (vph)", AM_VOLS);
  doc.fontSize(8).text("Cycle Length: 90", 54, 200, { lineBreak: false });
  drawFooter(doc, "Existing AM");
});

const proseOnlyPdf = await buildPdf((doc) => {
  doc.fontSize(14).text("Quarterly Invoice", 54, 46, { lineBreak: false });
  doc.fontSize(10).text("This document is definitely not a Synchro report.", 54, 80, { lineBreak: false });
});

// ---------------------------------------------------------------------------
// 1. Magic bytes
// ---------------------------------------------------------------------------
ok(isPdfBytes(syntheticPdf) === true, "isPdfBytes: real PDF bytes recognized");
ok(isPdfBytes(new TextEncoder().encode("[Nodes]\nINTID")) === false, "isPdfBytes: UTDF text rejected");

// ---------------------------------------------------------------------------
// 2. Synthetic report — full parse
// ---------------------------------------------------------------------------
{
  const r = await parseSynchroPdf(syntheticPdf);
  const d = r.doc;
  ok(r.pageCount === 4 && r.synchroPages === 4, `synthetic: 4 pages, 4 Synchro blocks (${r.pageCount}/${r.synchroPages})`);
  ok(r.scenarioUsed === "Existing PM", `synthetic: PM scenario chosen ("${r.scenarioUsed}")`);
  ok(r.scenariosSkipped.length === 1 && r.scenariosSkipped[0] === "Existing AM",
    `synthetic: AM scenario skipped (${JSON.stringify(r.scenariosSkipped)})`);
  ok(d.warnings.some((w) => /scenario/i.test(w) && w.includes("Existing AM")),
    "synthetic: scenario skip warning names the AM scenario");
  ok(d.warnings.some((w) => /rotated/.test(w)), "synthetic: watermark drop disclosed");
  ok(d.nodes.length === 3, `synthetic: 3 intersections in the PM scenario (${d.nodes.length})`);
  ok(d.nodes.every((n) => n.latitude === undefined && n.longitude === undefined),
    "synthetic: report nodes carry NO coordinates");

  const v5 = d.volumes.find((v) => v.intId === 5);
  ok(v5 !== undefined, "synthetic: int 5 volumes present");
  ok(COLS_STD.every((mv, i) => v5?.movements[mv] === LVT_VOLS[i]),
    `synthetic: int 5 volumes exact (PM row, not Future/AM) — ${JSON.stringify(v5?.movements)}`);
  ok(v5?.phf?.EBL === 0.92, `synthetic: LVT PHF carried (${v5?.phf?.EBL})`);
  ok(v5?.heavyVehiclesPct?.NBT === 3, "synthetic: LVT HV% carried");
  const l5 = d.lanes.find((l) => l.intId === 5);
  ok(l5?.movements?.EBL?.storageFt === 150 && l5?.movements?.NBL?.storageFt === 80,
    "synthetic: storage lengths carried (zero-ft cells omitted)");
  ok(l5?.movements?.EBT?.storageFt === undefined, "synthetic: 0-ft storage omitted, not imported as 0");
  const t5 = d.timings.find((t) => t.intId === 5);
  ok(t5?.cycleLengthS === 110, `synthetic: cycle from "Cycle Length:" not "Actuated..." (${t5?.cycleLengthS})`);

  const v7 = d.volumes.find((v) => v.intId === 7);
  ok(v7?.movements?.EBT === 400 && v7?.movements?.SBT === 100, "synthetic: Timings-page volumes carried");
  ok(d.timings.find((t) => t.intId === 7)?.cycleLengthS === 120, "synthetic: Timings-page cycle carried");

  const v9 = d.volumes.find((v) => v.intId === 9);
  ok(v9?.movements?.NBT === 877 && v9?.movements?.EBR === 86, "synthetic: TWSC volumes carried");
  ok(v9?.phf?.NBT === 0.92, `synthetic: TWSC "92"-style PHF normalized to 0.92 (${v9?.phf?.NBT})`);
  const l9 = d.lanes.find((l) => l.intId === 9);
  ok(l9?.movements?.NBL?.storageFt === 240 && l9?.movements?.SBL?.storageFt === 250,
    'synthetic: TWSC storage carried; "-" cells skipped');
}

// ---------------------------------------------------------------------------
// 3. Non-Synchro PDF — graceful zero-block result
// ---------------------------------------------------------------------------
{
  const r = await parseSynchroPdf(proseOnlyPdf);
  ok(r.synchroPages === 0 && r.doc.nodes.length === 0, "prose PDF: zero Synchro blocks, zero nodes");
  ok(r.doc.warnings.some((w) => /no Synchro report blocks recognized/.test(w)),
    `prose PDF: clear warning (${JSON.stringify(r.doc.warnings)})`);
}

// ---------------------------------------------------------------------------
// 4. Truncated/corrupt bytes — warning, never a crash
// ---------------------------------------------------------------------------
{
  const r = await parseSynchroPdf(syntheticPdf.slice(0, 600));
  ok(r.doc.nodes.length === 0 && r.doc.warnings.some((w) => /could not read the PDF/.test(w)),
    "corrupt PDF: 'could not read' warning, no crash");
}

// ---------------------------------------------------------------------------
// 5. REAL pages — Caltran Synchro 12 report (watermarked)
// ---------------------------------------------------------------------------
{
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(here, "fixtures/synchro-report-hca-4pages.pdf")));
  const r = await parseSynchroPdf(bytes);
  const d = r.doc;
  ok(r.pageCount === 4 && r.synchroPages === 4, `real: 4 pages all recognized (${r.synchroPages})`);
  ok(r.scenarioUsed === "Scenario 1 - PM", `real: PM scenario chosen ("${r.scenarioUsed}")`);
  ok(r.scenariosSkipped.includes("Scenario 1 - AM"), "real: AM scenario skipped and disclosed");
  ok(d.warnings.some((w) => /rotated/.test(w)), "real: DRAFT watermark dropped and disclosed");

  // Int 2 (standard legs): ground truth from pdftotext -layout of the page.
  const v2 = d.volumes.find((v) => v.intId === 2);
  const TRUTH = { EBL: 312, EBT: 17, EBR: 272, WBL: 7, WBT: 9, NBL: 323, NBT: 1832, NBR: 23, SBL: 17, SBT: 1619, SBR: 446 };
  ok(v2 !== undefined, "real: University Dr & Cleary Blvd volumes present");
  ok(Object.entries(TRUTH).every(([mv, want]) => v2?.movements[mv] === want),
    `real: all 11 volumes byte-exact vs pdftotext ground truth (${JSON.stringify(v2?.movements)})`);
  ok(v2?.movements?.WBR === undefined, "real: absent WBR column stays absent (not fabricated)");
  ok(d.timings.find((t) => t.intId === 2)?.cycleLengthS === 160, "real: 160 s cycle carried");

  // Int 1 (ALL diagonal legs SEL/NWT/NEL/SWR…): must warn with the vph at
  // stake and import nothing — the silent-skip failure mode this module
  // exists to prevent.
  ok(d.volumes.find((v) => v.intId === 1) === undefined, "real: all-diagonal intersection imports NO volumes");
  const diagWarn = d.warnings.find((w) => w.includes("Cleary Blvd & N Pine Island Rd") && /not mappable to a 4-leg model/.test(w));
  ok(diagWarn !== undefined && /\d+ vph NOT imported/.test(diagWarn),
    `real: diagonal-leg warning names the columns AND the vph at stake (${diagWarn})`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
