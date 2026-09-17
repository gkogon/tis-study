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

const { mod, cleanup } = await loadRendererBundle();
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
} finally {
  await cleanup();
}
console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
