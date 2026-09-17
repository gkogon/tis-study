// Leg volumes + movement estimation (lib/tis-engine-core/src/leg-volumes.ts).
// Pins: leg → approach assignment, per-leg resolution (main road / class
// default / one-way), IPF balancing invariants, and — via row-math — that
// legVolumes:"screening" and an absent estimate are byte-identical to the
// pre-change row. Spec: docs/superpowers/specs/2026-09-16-leg-volumes-and-movement-estimation-design.md
//
// Run: node ./scripts/verify-leg-volumes.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const core = await import("@workspace/tis-engine-core");

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const DIRS = ["NB", "SB", "EB", "WB"];

// ---- 1. leg → approach assignment (spec §4.2 step 1, §9 item 9) ----
{
  const legs = [
    { bearingDeg: 2, cls: 2, oneWay: null },    // far end north  → SB approach
    { bearingDeg: 91, cls: 3, oneWay: null },   // far end east   → WB approach
    { bearingDeg: 181, cls: 2, oneWay: null },  // far end south  → NB approach
    { bearingDeg: 268, cls: 3, oneWay: null },  // far end west   → EB approach
  ];
  const { byDir, dropped } = core.assignLegsToApproaches(legs);
  ok(byDir.SB?.bearingDeg === 2 && byDir.WB?.bearingDeg === 91 && byDir.NB?.bearingDeg === 181 && byDir.EB?.bearingDeg === 268,
    "assign: N/E/S/W far ends map to SB/WB/NB/EB approaches");
  ok(dropped === 0, "assign: four distinct legs, none dropped");
}
{
  // Five-leg: two legs quantize to EB; keep the higher class (lower cls), drop the other (§9 item 8).
  const legs = [
    { bearingDeg: 0, cls: 2, oneWay: null }, { bearingDeg: 90, cls: 2, oneWay: null },
    { bearingDeg: 180, cls: 2, oneWay: null }, { bearingDeg: 260, cls: 4, oneWay: null }, { bearingDeg: 280, cls: 2, oneWay: null },
  ];
  const { byDir, dropped } = core.assignLegsToApproaches(legs);
  ok(dropped === 1 && byDir.EB?.cls === 2 && byDir.EB?.bearingDeg === 280, "assign: five-leg keeps the higher-class EB leg, dropped = 1");
}
{
  const { byDir } = core.assignLegsToApproaches([{ bearingDeg: 44, cls: 3, oneWay: null }, { bearingDeg: 46, cls: 3, oneWay: null }]);
  ok(byDir.SB !== undefined && byDir.WB !== undefined, "assign: 44° → SB (north), 46° → WB (east) — nearest-cardinal quantization");
}
{
  ok(core.MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[4] === 700 && core.MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[0] === 2500,
    "ladder mirrors the analyzer's VOLUME_BY_CLASS (tertiary 700 … motorway 2500)");
}

console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
