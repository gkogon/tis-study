// Renderer side of leg volumes: a row carrying legVolumes/movementEstimate
// prints the provenance line, the balanced matrix and the resolved appendix
// wording; a legacy row prints none of it (byte-identity is pinned by
// check:theme-default-identity, which must keep passing WITHOUT re-pinning).
// Run: node ./scripts/verify-leg-volumes-render.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pageTexts, orphanPages } from "./lib/pdf-text.mjs";
import { syntheticTheme } from "./lib/synthetic-theme.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

async function text(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out += tc.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  await doc.destroy();
  return out.replace(/\s+/g, " ");
}

const { mod, cleanup } = await loadRendererBundle(`export { DEFAULT_THEME } from "./report-theme/theme";`);
try {
  const fx = loadFixture("ny");
  const legacy = await text(await mod.renderStudyPdf(projectFromFixture(fx), { name: "Leg Render Check", logoUrl: null }));
  ok(!legacy.includes("Leg volumes:"), "legacy fixture prints no provenance line");
  ok(!legacy.includes("balanced to the exit legs"), "legacy fixture keeps the screening appendix wording");

  const injected = JSON.parse(JSON.stringify(fx));
  const row = injected.report.affectedIntersections[0];
  row.volumeSource = "network_estimate";
  row.legVolumes = [
    { direction: "NB", enteringVph: 1350, exitingVph: 1350, source: "signal_aadt", oneWay: null },
    { direction: "SB", enteringVph: 1350, exitingVph: 1350, source: "signal_aadt", oneWay: null },
    { direction: "EB", enteringVph: 350, exitingVph: 350, source: "class_default", oneWay: null },
    { direction: "WB", enteringVph: 350, exitingVph: 350, source: "class_default", oneWay: null },
  ];
  row.movementEstimate = {
    method: "ipf", iterations: 6, maxResidualVph: 0.3, imbalancePct: 0, exitsNormalized: false, constrainedExits: 4, legsDropped: 0,
    matrix: { NB: { NB: 0, SB: 1000, EB: 200, WB: 150 }, SB: { NB: 1000, SB: 0, EB: 150, WB: 200 }, EB: { NB: 100, SB: 50, EB: 0, WB: 200 }, WB: { NB: 50, SB: 100, EB: 200, WB: 0 } },
    shares: { NB: { L: 0.148, T: 0.741, R: 0.111 }, SB: { L: 0.148, T: 0.741, R: 0.111 }, EB: { L: 0.286, T: 0.571, R: 0.143 }, WB: { L: 0.286, T: 0.571, R: 0.143 } },
  };
  const t = await text(await mod.renderStudyPdf(projectFromFixture(injected), { name: "Leg Render Check", logoUrl: null }));
  ok(t.includes("Leg volumes: 2 of 4 from the signal's counted design hour"), "injected row prints the leg provenance line");
  ok(t.includes("balanced estimate (Furness/IPF, 6 iterations, residual 0.3 vph)"), "injected row prints the movement diagnostics");
  ok(t.includes("Balanced turning movements (vph)"), "injected row prints the 4×4 matrix table");
  ok(t.includes("balanced to the exit legs"), "appendix intro switches to the resolved wording when any row carries an estimate");
  ok(t.includes("half per direction, and half in the physical direction of a one-way carriageway"), "appendix intro states the per-direction and one-way carriageway rule");
  ok(!t.includes("A one-way carriageway carries half"), "two-way legs only: no one-way carriageway sentence on the worksheet");

  // A one-way pair (a divided arterial's two carriageways): the worksheet
  // says the leg carries half of the two-way count and names the couplet
  // limitation, so a reviewer at a downtown couplet knows the leg reads light.
  const oneWay = JSON.parse(JSON.stringify(injected));
  const owRow = oneWay.report.affectedIntersections[0];
  owRow.legVolumes = [
    { direction: "NB", enteringVph: 0, exitingVph: 1350, source: "signal_aadt", oneWay: "out" },
    { direction: "SB", enteringVph: 1350, exitingVph: 0, source: "signal_aadt", oneWay: "in" },
    { direction: "EB", enteringVph: 350, exitingVph: 350, source: "class_default", oneWay: null },
    { direction: "WB", enteringVph: 350, exitingVph: 350, source: "class_default", oneWay: null },
  ];
  const owText = await text(await mod.renderStudyPdf(projectFromFixture(oneWay), { name: "Leg Render Check", logoUrl: null }));
  ok(owText.includes("A one-way carriageway carries half of the two-way count in its direction (a one-way couplet street is understated)."),
    "one-way legs: the worksheet states the half-of-two-way rule and the couplet limitation");

  // A signal the analyzer never counted (its design hour IS the road-class
  // ladder): the main legs are signal_baseline and the worksheet must not
  // call them "counted".
  const baselineSig = JSON.parse(JSON.stringify(injected));
  for (const l of baselineSig.report.affectedIntersections[0].legVolumes) if (l.source === "signal_aadt") l.source = "signal_baseline";
  const bsText = await text(await mod.renderStudyPdf(projectFromFixture(baselineSig), { name: "Leg Render Check", logoUrl: null }));
  // (pdf.js joins a wrapped line with a space, so the assertion stops short of
  // the wrap; the second clause is checked on its own.)
  ok(bsText.includes("Leg volumes: 2 of 4 from the road-class baseline the analyzer assigned this signal (no compatible count); 2 of 4 from the")
    && bsText.includes("class baseline (no count on that leg). Turning movements: balanced estimate"),
    "signal_baseline legs: the worksheet names the analyzer's baseline, not a counted design hour");
  ok(!bsText.includes("counted design hour (half per direction)"), "signal_baseline legs: no leg is called counted");

  // Pagination under real data: the stored preview fixtures carry none of
  // the new fields, so check:appendix-worksheet-pages never exercises the
  // matrix table's keep-together budget. Inject the same estimate onto
  // EVERY row (not just row 0) and reuse the pagination check's own orphan
  // classifier so this assertion can never drift from that check's definition.
  const all = JSON.parse(JSON.stringify(fx));
  for (const r of all.report.affectedIntersections) { r.volumeSource = row.volumeSource; r.legVolumes = row.legVolumes; r.movementEstimate = row.movementEstimate; }
  const allBuf = await mod.renderStudyPdf(projectFromFixture(all), { name: "Leg Render Check", logoUrl: null });
  const orphans = orphanPages(await pageTexts(allBuf));
  ok(orphans.length === 0, `every-row injection: ${orphans.length} orphan page(s) — the matrix table keeps together with its heading`);
  for (const o of orphans) console.log(`      p${o.page} (${o.chars} chars): "${o.head}…"`);
  const allText = (await pageTexts(allBuf)).join(" ").replace(/\s+/g, " ");
  const n = all.report.affectedIntersections.length;
  ok((allText.match(/Balanced turning movements \(vph\)/g) ?? []).length >= n, `every-row injection: the matrix table prints on all ${n} worksheets`);

  // Themed render of the new blocks: verify-theme-render.mjs's synthetic
  // corporate theme exercises the report-theme layout path (not the default
  // PDFKit layout), which the render check above never touches.
  const themed = await mod.renderStudyPdf(projectFromFixture(all), { name: "Leg Render Check", logoUrl: null, firmId: "f1", reportTemplate: syntheticTheme(mod.DEFAULT_THEME) });
  const themedText = (await pageTexts(themed)).join(" ").replace(/\s+/g, " ");
  ok(themedText.includes("Leg volumes: 2 of 4 from the signal's counted design hour") && themedText.includes("Balanced turning movements (vph)"), "themed render prints the provenance line and the matrix table");
  ok(orphanPages(await pageTexts(themed)).length === 0, "themed render: no orphan pages with every row injected");
} finally {
  await cleanup();
}
console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
