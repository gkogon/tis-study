// Regression check for the AADT → signal join's functional-class compatibility.
//
// The bug: fetch-aadt-by-signal.ts snaps each signal to the NEAREST AADT
// feature inside a per-source radius (200 m for WSDOT polylines) with no
// check that the counted facility is the one the signal actually sits on.
// Where a surface arterial parallels a freeway inside that radius the signal
// inherits the freeway mainline count.
//
// Observed live (tacoma_metro, 47.1900/-122.4600, 1.0 mi, full tier): seven of
// thirteen study intersections on S Hosmer St / Tacoma Mall Blvd — OSM class 2
// (primary) and 3 (secondary) surface streets — carried WSDOT AADT 163,000 and
// 171,000, i.e. I-5 mainline magnitude, snapped from 51–158 m away. Those
// became totalVolume 14,670 / 15,390 vph, which the engine divided by its
// 810 vph single-critical-lane capacity for v/c 8.15 / 8.55 and 95th-percentile
// queues of 4,336–5,417 ft. The study rendered 37 pages of LOS F without a
// single warning, and the repeated AADT segments produced byte-identical
// delay/queue values at physically distinct signals.
//
// The invariant this guards: an AT-GRADE SIGNALIZED intersection may never be
// assigned an AADT above what its road class can physically carry through a
// signal. A record above that ceiling describes some other facility — a
// freeway mainline — and must fall back to the road-class baseline rather than
// silently becoming a design-hour volume.
//
// Run: node ./scripts/verify-aadt-class-join.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
// ts-loader lives in the sibling package; api-server has no scripts harness.
register(pathToFileURL(path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs")).href, import.meta.url);

const { maxPlausibleSignalAadt, MAX_SIGNAL_AADT_BY_ROAD_CLASS, REJECTED_VOLUME_SOURCE } = await import(
  path.resolve(here, "../src/lib/aadt-plausibility.ts")
);
const { loadRegionalIntersections } = await import(path.resolve(here, "../src/lib/regional-intersections.ts"));
const { getSignalNamesForRegion } = await import(path.resolve(here, "../src/lib/regional-signal-naming.ts"));

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else console.log("ok:", msg);
};

// The engine's screening capacity model, mirrored here so this check states
// the user-visible consequence (v/c) rather than only the input (vph).
// signal-delay.ts: SATURATION_FLOW_VPH 1800 × G_OVER_C 0.45 = 810 vph, and
// CRITICAL_MOVEMENT_FRACTION 0.45 of the intersection total is the critical
// movement. Implied v/c = totalVolume × 0.45 / 810.
const impliedVc = (totalVolume) => (totalVolume * 0.45) / 810;

// ---------------------------------------------------------------------------
// 1. The ceiling table is ordered and finite
// ---------------------------------------------------------------------------
ok(
  typeof maxPlausibleSignalAadt === "function",
  "aadt-plausibility exports maxPlausibleSignalAadt()",
);
const c0 = maxPlausibleSignalAadt(0);
const c2 = maxPlausibleSignalAadt(2);
const c3 = maxPlausibleSignalAadt(3);
const c4 = maxPlausibleSignalAadt(4);
ok(Number.isFinite(c0) && c0 > 0, `motorway-class ceiling is finite (${c0})`);
ok(c2 > c3 && c3 > c4, `ceilings decrease with road class (primary ${c2} > secondary ${c3} > tertiary ${c4})`);
ok(
  maxPlausibleSignalAadt(-1) > 0 && Number.isFinite(maxPlausibleSignalAadt(-1)),
  `unknown class (-1) gets a finite conservative ceiling (${maxPlausibleSignalAadt(-1)})`,
);
// Classes beyond the base 0..4 table exist in denser road extracts
// (miami-dade, new-york, chicago ship class 5/6 ways). Those are SMALLER
// roads, so they must not fall through to a larger ceiling.
ok(
  maxPlausibleSignalAadt(6) <= c4,
  `class 6 (smaller than tertiary) ceiling ${maxPlausibleSignalAadt(6)} <= tertiary ${c4}`,
);
ok(
  MAX_SIGNAL_AADT_BY_ROAD_CLASS && typeof MAX_SIGNAL_AADT_BY_ROAD_CLASS === "object",
  "MAX_SIGNAL_AADT_BY_ROAD_CLASS table is exported for reuse by the builder",
);

// ---------------------------------------------------------------------------
// 2. Tacoma: the reported signals no longer carry I-5 volume
// ---------------------------------------------------------------------------
// The seven signals from the live repro, by OSM id. All are S Hosmer St /
// Tacoma Mall Blvd surface-street signals; none is on a limited-access road.
const TACOMA_BAD_IDS = [251, 233, 385, 626, 260, 852, 1160];
const tacoma = loadRegionalIntersections("tacoma_metro");
const tacomaById = new Map(tacoma.map((i) => [i.id, i]));
const tacomaNames = getSignalNamesForRegion("tacoma_metro");

for (const osmId of TACOMA_BAD_IDS) {
  const ix = tacomaById.get(`tacoma-${osmId}`);
  if (!ix) {
    ok(false, `tacoma-${osmId} present in the inventory`);
    continue;
  }
  const classCode = tacomaNames.get(osmId)?.roadClassCode ?? -1;
  const ceiling = maxPlausibleSignalAadt(classCode);
  const vc = impliedVc(ix.totalVolume);
  // totalVolume is AADT × K/100; at the WSDOT K of 9 the ceiling in vph is
  // ceiling × 0.09. Assert on the user-visible quantity instead: v/c.
  ok(
    vc <= 2.5,
    `tacoma-${osmId} (${ix.name}, class ${classCode}, ceiling ${ceiling}) implied v/c ${vc.toFixed(2)} <= 2.5 (was 8.15/8.55)`,
  );
  ok(
    ix.volumeSource !== "wsdot",
    `tacoma-${osmId} no longer claims measured wsdot provenance (got "${ix.volumeSource}")`,
  );
}

// Region-wide invariant: no signal anywhere in the region may KEEP an AADT
// record above its road class's ceiling. Checked against the raw dataset so
// this asserts the join's contract, not a derived quantity.
//
// Note this is deliberately narrower than "no signal implies a sane v/c".
// A class-0 (interchange cross-street) signal legitimately carrying 100,000
// AADT still implies v/c ~5 under the engine's flat 810 vph single-critical-
// lane screening capacity — that is the capacity model's known coarseness,
// not a join defect, and it is what the render-time plausibility guard
// (verify-vc-plausibility-guard.mjs) exists to surface.
{
  const rawAadt = JSON.parse(
    fs.readFileSync(path.resolve(here, "../src/data/tacoma-aadt.json"), "utf8"),
  );
  const kept = [];
  for (const ix of tacoma) {
    if (!ix.volumeSource || ix.volumeSource === "road_class_baseline") continue;
    if (ix.volumeSource === REJECTED_VOLUME_SOURCE) continue;
    const osmId = Number(String(ix.id).replace(/^tacoma-(cdot-)?/, ""));
    const rec = rawAadt[String(osmId)];
    if (!rec) continue;
    const classCode = tacomaNames.get(osmId)?.roadClassCode ?? -1;
    const ceiling = maxPlausibleSignalAadt(classCode);
    if (rec.aadt > ceiling) {
      kept.push(`${ix.id} ${ix.name} class=${classCode} aadt=${rec.aadt} > ceiling=${ceiling}`);
    }
  }
  ok(
    kept.length === 0,
    `tacoma keeps no AADT record above its class ceiling (${kept.length} offenders)${kept.length ? "\n    " + kept.slice(0, 8).join("\n    ") : ""}`,
  );
}

// The join fix BOUNDS the damage; it does not by itself make every v/c
// plausible. Once no signal can hold more than its class ceiling (100,000 AADT
// at the most permissive class), the worst implied v/c a region can produce is
// ceiling × K/100 × 0.45 / 810 — about 5.0 at the K=9 these datasets carry.
// Tacoma printed 8.55 before the fix, which was only reachable by holding a
// freeway mainline count. Assert the bound holds; residual high-but-bounded
// values are the render guard's responsibility to disclose.
{
  const worst = tacoma.reduce(
    (m, ix) => (impliedVc(ix.totalVolume) > m.vc ? { vc: impliedVc(ix.totalVolume), ix } : m),
    { vc: 0, ix: null },
  );
  ok(
    worst.vc < 8.15,
    `tacoma worst implied v/c ${worst.vc.toFixed(2)} is below the pre-fix 8.15 (${worst.ix?.name ?? "n/a"})`,
  );
  ok(
    worst.vc <= 5.05,
    `tacoma worst implied v/c ${worst.vc.toFixed(2)} within the class-ceiling bound (~5.0)`,
  );
}

// ---------------------------------------------------------------------------
// 3. Sacramento must not regress — the clean region keeps its measured data
// ---------------------------------------------------------------------------
// The reference study site (38.7016, -121.2733) returns v/c 0.21–0.95 today.
// Signals in that neighbourhood are legitimately joined and must keep BOTH
// their measured volume and their measured provenance.
{
  const sac = loadRegionalIntersections("sacramento_metro");
  ok(sac.length > 0, `sacramento inventory loads (${sac.length} signals)`);
  const near = sac.filter(
    (i) => Math.abs(i.latitude - 38.7016) < 0.02 && Math.abs(i.longitude + 121.2733) < 0.02,
  );
  ok(near.length > 0, `sacramento reference site has signals within ~1.4 mi (${near.length})`);
  const measured = near.filter(
    (i) =>
      i.volumeSource &&
      i.volumeSource !== "road_class_baseline" &&
      i.volumeSource !== REJECTED_VOLUME_SOURCE,
  );
  ok(
    measured.length > 0,
    `sacramento reference site keeps measured AADT provenance on ${measured.length}/${near.length} signals`,
  );
  const worst = near.reduce((m, i) => Math.max(m, impliedVc(i.totalVolume)), 0);
  ok(worst <= 2.5, `sacramento reference site worst implied v/c ${worst.toFixed(2)} <= 2.5`);
}

// ---------------------------------------------------------------------------
// 4. Measured data survives where it is plausible (no blanket wipe)
// ---------------------------------------------------------------------------
{
  const isMeasured = (i) =>
    i.volumeSource &&
    i.volumeSource !== "road_class_baseline" &&
    i.volumeSource !== REJECTED_VOLUME_SOURCE;
  const measured = tacoma.filter(isMeasured);
  const pct = (measured.length / tacoma.length) * 100;
  ok(
    pct > 50,
    `tacoma retains measured provenance on the majority of signals (${measured.length}/${tacoma.length} = ${pct.toFixed(1)}%)`,
  );
}

console.log(fails === 0 ? "\nAll AADT class-join checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
