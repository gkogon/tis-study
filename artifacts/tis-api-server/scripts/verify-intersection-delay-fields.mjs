// Verifies the response-boundary fix for Christopher Peralta's "LOS F with no
// delay" report: the scenario delay/LOS fields (currentDelaySec, currentLos,
// designNoBuild*, designBuild*, turboLane) must SURVIVE GenerateTisResponse
// zod validation — previously they were stripped, which killed the design-year
// table and collapsed the Existing scenario. Also sanity-checks that the
// screening delay model yields >80 s at an oversaturated v/c (so LOS F can
// never legitimately print 0 s).
//
// Run: node ./scripts/verify-intersection-delay-fields.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { GenerateTisResponse } = await import(
  path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts")
);
const { vcToDelay, delayToLos } = await import(
  path.resolve(here, "../src/lib/signal-delay.ts")
);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// Minimal valid GenerateTisResponse fixture with ONE affected intersection that
// carries every scenario field including the ones that used to be stripped.
const intersection = {
  signalId: "s1", name: "NW 7 Ave & NW 79 St", zone: "z", latitude: 25.847, longitude: -80.209,
  distanceMi: 0.2,
  currentVc: 1.05, currentDelaySec: 128.4, currentLos: "F",
  existingVc: 1.1, addedTripsPmPeak: 6, futureVc: 1.12,
  existingDelaySec: 131.0, futureDelaySec: 131.6, existingLos: "F", futureLos: "F",
  designNoBuildVc: 1.3, designNoBuildDelaySec: 120, designNoBuildLos: "F",
  designBuildVc: 1.32, designBuildDelaySec: 120, designBuildLos: "F",
  losChanged: false, mitigation: "", mitigationSeverity: "none",
  approaches: [], queue95thFt: 210,
  turboLane: { candidate: true, turboType: "A", capacityGainPct: 22 },
};

// Validate ONLY the affected-intersection element schema — this is exactly the
// object that the boundary strip mangles, and it exercises the real generated
// zod (same strip/keep behavior as GenerateTisResponse.parse).
const itemSchema = GenerateTisResponse.shape.affectedIntersections.element;
let it;
try {
  it = itemSchema.parse(intersection);
} catch (e) {
  console.error("PARSE ERROR on intersection element schema:");
  console.error(String(e).split("\n").slice(0, 12).join("\n"));
  process.exit(2);
}
ok(it.currentDelaySec === 128.4, "currentDelaySec survives validation (was stripped)");
ok(it.currentLos === "F", "currentLos survives validation");
ok(it.designBuildLos === "F", "designBuildLos survives validation (revives 4-scenario table)");
ok(it.designNoBuildDelaySec === 120, "designNoBuildDelaySec survives validation");
ok(it.turboLane && it.turboLane.turboType === "A", "turboLane passthrough survives validation");
ok(it.existingDelaySec === 131.0 && it.futureLos === "F", "existing/future fields intact");

// Delay model sanity: LOS is DERIVED from delay, so LOS F can never be 0 s.
// Assert the invariant directly across a v/c sweep, then confirm a genuinely
// oversaturated approach lands in LOS F with a non-zero delay (unclamped at
// v/c 1.5 now that the screening ceiling is 300 s).
let invariantHeld = true;
for (let vc = 0; vc <= 2.0; vc += 0.05) {
  const d = vcToDelay(vc, 810);
  if (delayToLos(d) === "F" && d <= 80) invariantHeld = false;
}
ok(invariantHeld, "invariant: delayToLos(d)==='F' always implies delay > 80 s (F can never print 0)");
const dOversat = vcToDelay(1.5, 810);
ok(dOversat > 80 && delayToLos(dOversat) === "F", `oversaturated v/c=1.5 delay ${dOversat.toFixed(1)}s → LOS ${delayToLos(dOversat)}`);
const dLow = vcToDelay(0.2, 810);
ok(dLow >= 10 && dLow < 20, `low v/c=0.2 delay ${dLow.toFixed(1)}s is a real small delay, not 0`);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
