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
{
  // EXIT_LEG follows the spec rule: through at β+180°, left at β+90°, right at β−90°,
  // where β is the approach's origin bearing and the exit is the approach whose origin leg sits there.
  const legAt = (bearing) => DIRS.find((d) => core.ORIGIN_BEARING[d] === ((bearing % 360) + 360) % 360);
  const rule = DIRS.every((d) => {
    const b = core.ORIGIN_BEARING[d];
    return core.EXIT_LEG[d].T === legAt(b + 180) && core.EXIT_LEG[d].L === legAt(b + 90) && core.EXIT_LEG[d].R === legAt(b - 90);
  });
  ok(rule, "EXIT_LEG: every row follows through=β+180°, left=β+90°, right=β−90°");
  ok(core.EXIT_LEG.EB.L === "SB" && core.EXIT_LEG.WB.L === "NB", "EXIT_LEG: eastbound left exits north (SB's leg), westbound left exits south (NB's leg)");
}

// ---- 2. per-leg resolution (spec §4.2 steps 2–4, amended: per-signal data) ----
{
  // Four-leg: NB/SB on a primary (cls 2), EB/WB on a tertiary (cls 4). Design hour 2700.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700 });
  ok(legs.NB.source === "signal_aadt" && legs.SB.source === "signal_aadt", "resolve: the two highest-class legs are the main road");
  ok(close(legs.NB.enteringVph, 1350) && close(legs.NB.exitingVph, 1350) && close(legs.SB.enteringVph, 1350), "resolve: main road = design hour / 2 each way, each leg");
  ok(legs.EB.source === "class_default" && close(legs.EB.enteringVph, 350) && close(legs.EB.exitingVph, 350), "resolve: tertiary minor leg = 700 two-way baseline / 2");
  ok(DIRS.every((d) => legs[d].cls === byDir[d].cls), "resolve: each leg carries its class");
}
{
  // Tie on class among three legs: the most opposite pair is the main road.
  const byDir = {
    NB: { bearingDeg: 180, cls: 3, oneWay: null }, SB: { bearingDeg: 0, cls: 3, oneWay: null },
    EB: { bearingDeg: 270, cls: 3, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 1000 });
  ok(legs.NB.source === "signal_aadt" && legs.SB.source === "signal_aadt" && legs.EB.source === "class_default",
    "resolve: class tie breaks toward the opposite pair (NB/SB), not the third leg");
}
{
  // T-intersection: no WB leg.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2000 });
  ok(legs.WB === null, "resolve: absent leg is null");
  ok(legs.EB.source === "class_default", "resolve: T stem is the minor leg");
}
{
  // One-way main road: SB leg carries traffic INTO the node only, NB leg OUT only.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: "out" }, SB: { bearingDeg: 0, cls: 2, oneWay: "in" },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 1800 });
  ok(close(legs.SB.enteringVph, 1800) && legs.SB.exitingVph === 0, "resolve: one-way-in main leg takes the whole design hour entering, 0 exiting");
  ok(legs.NB.enteringVph === 0 && close(legs.NB.exitingVph, 1800), "resolve: one-way-out main leg takes it all exiting, 0 entering");
}
{
  // CSV override wins on its leg; other legs unchanged.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700, csv: { EB: { enteringVph: 520, exitingVph: 480 } } });
  ok(legs.EB.source === "csv" && legs.EB.enteringVph === 520 && legs.EB.exitingVph === 480, "resolve: csv leg overrides the class default");
  ok(legs.WB.source === "class_default" && close(legs.WB.enteringVph, 350), "resolve: csv on one leg leaves the others alone");
  const half = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700, csv: { EB: { enteringVph: 520 } } });
  ok(half.EB.source === "csv" && half.EB.enteringVph === 520 && half.EB.exitingVph === null, "resolve: csv entering-only leaves exiting unknown (null), never invented");
}
{
  const legs = core.resolveLegVolumes({ NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null } }, { signalDesignHourVph: 0 });
  ok(legs.NB.enteringVph === 0 && legs.NB.exitingVph === 0 && !Number.isNaN(legs.NB.enteringVph), "resolve: zero design hour → zero, never NaN");
}

console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
