// Regression check for the movement-derived per-approach project loading —
// the reconciliation of buildAffectedRow's +Trips / futureVol / v/c inputs
// with the geometric turning-movement assignment (movement-assignment.ts).
//
// Prior behavior (legacy, still the fallback when no distribution ran):
// cosine-similarity split with a 0.10 floor on EVERY approach + outbound
// volume lumped onto the approach opposite the inbound origin. That could
// disagree with the printed Affected-movements table per approach (e.g.
// +Trips NB 43 / SB 43 / EB 7 / WB 7 vs movements NB-T 50 / SB-T 50 only) —
// PR #74 disclosed the inconsistency in a worksheet footnote as a stopgap.
//
// New behavior under test: with distribution octants, the per-approach load
// aggregates the EXACT geometric movement loads by ENTERING approach
// (approachAddedTripsFromMovements), and the printed +Trips integers are the
// per-approach sums of the printed movements table, so the two reconcile
// approach-by-approach and cross-foot with the junction total.
//
// Run: node ./scripts/verify-movement-loading.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { assignMovements, assignMovementLoadsExact, approachAddedTripsFromMovements } =
  await import(path.resolve(here, "../src/lib/movement-assignment.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const octants = (over) => ({ NNE: 0, ENE: 0, ESE: 0, SSE: 0, SSW: 0, WSW: 0, WNW: 0, NNW: 0, ...over });
const DIRS = ["NB", "SB", "EB", "WB"];
const sum = (rec) => DIRS.reduce((s, d) => s + rec[d], 0);
const fmtByDir = (rec, dp = 2) => DIRS.map((d) => `${d}:${rec[d].toFixed(dp)}`).join(" ");

// Faithful replica of the LEGACY cosine+0.10-floor split in tis.ts
// (approachAddedTripShares + the in/opposite-out lumping in buildAffectedRow),
// kept here only to print the legacy-vs-geometric comparison and to pin the
// behavioral delta this change ships. Keep in sync with tis.ts if the
// fallback ever changes.
const APPROACH_ORIGIN_BEARING = { NB: 180, SB: 0, EB: 270, WB: 90 };
const OPPOSITE = { NB: "SB", SB: "NB", EB: "WB", WB: "EB" };
function legacyApproachAdded(bearingSignalToProject, addedTrips, inFraction) {
  const raw = {}; let total = 0;
  for (const d of DIRS) {
    const diff = ((APPROACH_ORIGIN_BEARING[d] - bearingSignalToProject + 540) % 360) - 180;
    raw[d] = Math.max(0.10, Math.cos((diff * Math.PI) / 180) + 0.10);
    total += raw[d];
  }
  const shares = {}; for (const d of DIRS) shares[d] = raw[d] / total;
  const out = {};
  for (const d of DIRS) {
    out[d] = addedTrips * inFraction * shares[d]
      + addedTrips * (1 - inFraction) * shares[OPPOSITE[d]];
  }
  return out;
}

// Fixture geometry: intersection due NORTH of the site → bearing
// intersection→site = 180, bearing site→intersection (signal→project mirror
// used by the legacy split) = ... legacy uses bearing SIGNAL→PROJECT = 180.
const B_INT_TO_SITE = 180;
const B_SIG_TO_PROJ = 180; // same vector: signal→project points south

// ---------------------------------------------------------------------------
// 1. The adversarial example that motivated this change: a through-dominant
//    N-S corridor (zones straight beyond the intersection). Geometric loading
//    puts trips on NB/SB ONLY; the legacy floor smeared ~7 trips onto EB/WB.
{
  const oct = octants({ NNE: 60, NNW: 40 });
  const added = 100, inF = 0.5;
  const geo = approachAddedTripsFromMovements(B_INT_TO_SITE, oct, added, inF);
  const leg = legacyApproachAdded(B_SIG_TO_PROJ, added, inF);
  console.log(`   geometric: ${fmtByDir(geo)}`);
  console.log(`   legacy:    ${fmtByDir(leg)}`);
  ok(close(sum(geo), added), `geometric loads cross-foot with the junction total (Σ=${sum(geo)})`);
  ok(geo.EB === 0 && geo.WB === 0, "no floor smear: EB/WB carry zero on a pure N-S corridor");
  ok(geo.NB > 0 && geo.SB > 0, "both N-S approaches loaded (outbound NB, inbound SB)");
  ok(leg.EB > 5 && leg.WB > 5, "legacy replica floors EB/WB > 5 trips (the disclosed inconsistency)");
  const mv = assignMovements(B_INT_TO_SITE, oct, added, inF);
  ok(mv.every((m) => m.movement === "T" && (m.approach === "NB" || m.approach === "SB")),
    "movements table is NB-T/SB-T only — reconciles with the +Trips approaches");
}

// ---------------------------------------------------------------------------
// 2. Entering-approach attribution on a turning case: zones EAST of a
//    north-of-site intersection. Outbound = NB-Right (enters NB on the site
//    leg), inbound = WB-Left (enters WB from the east). +Trips must show the
//    load on NB and WB — NOT on the EB exit leg.
{
  const oct = octants({ ENE: 100 });
  const geo = approachAddedTripsFromMovements(B_INT_TO_SITE, oct, 20, 0.35);
  ok(close(geo.NB, 20 * 0.65) && close(geo.WB, 20 * 0.35) && geo.EB === 0 && geo.SB === 0,
    `turning case loads entering approaches (NB=out 13, WB=in 7): ${fmtByDir(geo)}`);
  const mv = assignMovements(B_INT_TO_SITE, oct, 20, 0.35);
  for (const d of DIRS) {
    const mvSum = mv.reduce((s, m) => s + (m.approach === d ? m.trips : 0), 0);
    ok(Math.abs(mvSum - geo[d]) < 1, `approach ${d}: integer movements (${mvSum}) ≈ exact load (${geo[d].toFixed(2)})`);
  }
}

// ---------------------------------------------------------------------------
// 3. Exact per-approach aggregation ≡ Σ exact movement loads by approach, on a
//    mixed realistic distribution + rotated geometry.
{
  const oct = octants({ NNE: 22, ENE: 18, ESE: 9, SSE: 6, SSW: 5, WSW: 11, WNW: 17, NNW: 12 });
  for (const bearing of [180, 270, 45, 0]) {
    const geo = approachAddedTripsFromMovements(bearing, oct, 37.4, 0.42);
    const manual = { NB: 0, SB: 0, EB: 0, WB: 0 };
    for (const l of assignMovementLoadsExact(bearing, oct, 37.4, 0.42)) manual[l.approach] += l.exact;
    ok(DIRS.every((d) => close(geo[d], manual[d])) && close(sum(geo), 37.4),
      `bearing ${bearing}°: per-approach aggregation matches exact loads and Σ=37.4`);
  }
}

// ---------------------------------------------------------------------------
// 4. London sub-1-trip path: a fractional junction load must NOT zero out of
//    the capacity math even though the printed movements table is omitted.
{
  const oct = octants({ NNE: 100 });
  const added = 0.4;
  ok(assignMovements(B_INT_TO_SITE, oct, added, 0.5).length === 0,
    "sub-vehicle load still omits the integer movements table");
  const exact = assignMovementLoadsExact(B_INT_TO_SITE, oct, added, 0.5);
  ok(exact.length > 0 && close(exact.reduce((s, l) => s + l.exact, 0), added),
    `exact movement loads survive (Σ=${exact.reduce((s, l) => s + l.exact, 0)})`);
  const geo = approachAddedTripsFromMovements(B_INT_TO_SITE, oct, added, 0.5);
  ok(close(sum(geo), added) && geo.NB > 0 && geo.SB > 0,
    `fractional per-approach loads survive for the capacity math: ${fmtByDir(geo, 3)}`);
}

// ---------------------------------------------------------------------------
// 5. Degenerate distribution (all octants behind the intersection) falls back
//    to through along the site axis — both axis approaches loaded, no others.
{
  const geo = approachAddedTripsFromMovements(B_INT_TO_SITE, octants({ SSW: 60, SSE: 40 }), 10, 0.5);
  ok(close(geo.NB, 5) && close(geo.SB, 5) && geo.EB === 0 && geo.WB === 0,
    `zones-behind fallback loads the site axis only: ${fmtByDir(geo)}`);
}

// ---------------------------------------------------------------------------
// 6. Directional-split edges: all-inbound and all-outbound both cross-foot.
{
  const oct = octants({ ENE: 50, WNW: 50 });
  for (const inF of [0, 1]) {
    const geo = approachAddedTripsFromMovements(B_INT_TO_SITE, oct, 30, inF);
    ok(close(sum(geo), 30), `inFraction=${inF}: Σ=${sum(geo)} === 30`);
  }
  // all-outbound enters on the site leg only → NB carries everything
  const outOnly = approachAddedTripsFromMovements(B_INT_TO_SITE, oct, 30, 0);
  ok(close(outOnly.NB, 30) && outOnly.SB === 0,
    `all-outbound loads the site-facing approach (NB): ${fmtByDir(outOnly)}`);
}

// ---------------------------------------------------------------------------
// 7. Legacy-vs-geometric behavioral delta summary (for the PR description):
//    same junction total on every fixture; the split moves from floor-smeared
//    to geometry-concentrated (worst-approach load is ≥ legacy's).
{
  const cases = [
    ["N-S corridor", octants({ NNE: 60, NNW: 40 }), 100, 0.5],
    ["east-heavy", octants({ ENE: 70, ESE: 30 }), 50, 0.4],
    ["mixed", octants({ NNE: 22, ENE: 18, ESE: 9, SSE: 6, SSW: 5, WSW: 11, WNW: 17, NNW: 12 }), 37.4, 0.42],
  ];
  console.log("\n   legacy vs geometric per-approach loads (same junction totals):");
  for (const [label, oct, added, inF] of cases) {
    const geo = approachAddedTripsFromMovements(B_INT_TO_SITE, oct, added, inF);
    const leg = legacyApproachAdded(B_SIG_TO_PROJ, added, inF);
    console.log(`   ${label.padEnd(14)} legacy    ${fmtByDir(leg)}`);
    console.log(`   ${" ".repeat(14)} geometric ${fmtByDir(geo)}`);
    ok(close(sum(geo), sum(leg), 1e-6), `${label}: both models assign the same junction total`);
    const worst = (rec) => Math.max(...DIRS.map((d) => rec[d]));
    ok(worst(geo) >= worst(leg) - 1e-9,
      `${label}: geometric worst-approach load (${worst(geo).toFixed(1)}) ≥ legacy's (${worst(leg).toFixed(1)}) — critical-approach screening stays conservative`);
  }
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
