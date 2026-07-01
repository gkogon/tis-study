/**
 * Golden-reference guard for the Caltran gravity model (caltran-gravity.ts).
 *
 * The reference is the hand-worked "Gravity Model Example" Caltran Engineering
 * provided for the Florida TIS standard. A proposed development at a site zone
 * distributes its trips to surrounding zones by MASS / DISTANCE:
 *
 *     term_i  = M_i / (d_i^beta · d_site)          (worked example: beta=1, d_site=1)
 *     share_i = term_i / Σ term                     (Σ shares = 100%)
 *
 * where M_i = gross attraction (population + employment + dwelling units) times
 * the zone's net developable fraction. Conceptually M/d² (Newtonian gravity);
 * the worked worksheet uses the linear product d_i·d_site with d_site = 1.
 *
 * Worked table (page 2): the ten zone terms sum to 1080 and yield the printed
 * development-to-zone trip percentages (page 3). Zone 9 is fully specified:
 * 1000 dwellings × 40% net ÷ (d=4 · d_site=1) = 100.
 *
 * Standalone node script (no test runner). Run: `pnpm run check:caltran-gravity`.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/caltran-gravity.ts"));
const { caltranGravityShares, zoneMass, rollupByCardinal, sectorPairs, bearingToCardinal, directionalMultipliers } = m;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const close = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// 1) Reproduces the worked worksheet: given the ten zone terms, normalization
//    yields the printed development-to-zone trip percentages.
// ---------------------------------------------------------------------------
// Construct zones at unit distance so term_i == mass_i (isolates normalization
// + the d_site=1 site-zone behavior), using the worksheet's ten terms.
const GOLDEN_TERMS = [250, 75, 25, 30, 100, 150, 100, 200, 100, 50]; // Σ = 1080
const GOLDEN_PCT = [23.15, 6.94, 2.31, 2.78, 9.26, 13.89, 9.26, 18.52, 9.26, 4.63];
const worksheet = caltranGravityShares(
  GOLDEN_TERMS.map((t, i) => ({ id: `Z${i + 1}`, mass: t, distanceMi: 1 })),
);
ok(worksheet.length === 10, "worksheet returns one row per zone");
ok(close(worksheet.reduce((s, z) => s + z.sharePct, 0), 100, 0.01), "shares sum to 100%");
for (let i = 0; i < 10; i++) {
  ok(
    close(worksheet[i].sharePct, GOLDEN_PCT[i]),
    `Z${i + 1} share = ${GOLDEN_PCT[i]}% (got ${worksheet[i].sharePct.toFixed(2)}%)`,
  );
}

// ---------------------------------------------------------------------------
// 2) The distance division: Zone 9 fully specified — 1000 DU × 40% net,
//    d=4, d_site=1, beta=1  ⇒  term = 400 / (4·1) = 100.
// ---------------------------------------------------------------------------
const z9mass = zoneMass({ dwellingUnits: 1000, netFraction: 0.4 });
ok(close(z9mass, 400, 1e-9), `zoneMass(1000 DU × 40% net) = 400 (got ${z9mass})`);
const oneZone = caltranGravityShares([{ id: "Z9", mass: 400, distanceMi: 4 }]);
ok(close(oneZone[0].term, 100, 1e-9), `Zone 9 term = 100 (got ${oneZone[0].term})`);

// ---------------------------------------------------------------------------
// 3) beta option: the conceptual M/d² form. mass=400, d=4, beta=2 ⇒ 400/16 = 25.
// ---------------------------------------------------------------------------
const betaTwo = caltranGravityShares([{ id: "Z", mass: 400, distanceMi: 4 }], { beta: 2 });
ok(close(betaTwo[0].term, 25, 1e-9), `beta=2 (M/d²): term = 25 (got ${betaTwo[0].term})`);

// ---------------------------------------------------------------------------
// 4) Site-zone distance floor: d=0 must not divide by zero — floored to d_site.
// ---------------------------------------------------------------------------
const atSite = caltranGravityShares([
  { id: "site", mass: 100, distanceMi: 0 },
  { id: "far", mass: 100, distanceMi: 10 },
]);
ok(Number.isFinite(atSite[0].term) && atSite[0].term > 0, `d=0 zone yields finite term (${atSite[0].term})`);
ok(atSite[0].sharePct > atSite[1].sharePct, "nearer zone gets a larger share than the far zone");

// ---------------------------------------------------------------------------
// 5) Cardinal rollup + Caltran sector pairs (NNE+ENE / ESE+SSE / SSW+WSW /
//    WNW+NNW), the four labels on the HCA aerial distribution figure.
// ---------------------------------------------------------------------------
ok(bearingToCardinal(0) === "NNE", `bearing 0° → NNE (got ${bearingToCardinal(0)})`);
ok(bearingToCardinal(90) === "ESE", `bearing 90° → ESE (got ${bearingToCardinal(90)})`);
ok(bearingToCardinal(200) === "SSW", `bearing 200° → SSW (got ${bearingToCardinal(200)})`);
ok(bearingToCardinal(300) === "WNW", `bearing 300° → WNW (got ${bearingToCardinal(300)})`);

const dirShares = caltranGravityShares([
  { id: "a", mass: 100, distanceMi: 1, bearingDeg: 30 }, // NNE
  { id: "b", mass: 100, distanceMi: 1, bearingDeg: 70 }, // ENE
  { id: "c", mass: 200, distanceMi: 1, bearingDeg: 160 }, // SSE
]);
const byDir = rollupByCardinal(dirShares);
ok(close(Object.values(byDir).reduce((s, v) => s + v, 0), 100, 0.01), "cardinal rollup sums to 100%");
ok(close(byDir.NNE, 25, 0.01) && close(byDir.ENE, 25, 0.01) && close(byDir.SSE, 50, 0.01), "trips land in the correct cardinal wedges");
const pairs = sectorPairs(byDir);
ok(close(pairs["NNE+ENE"], 50, 0.01), `NNE+ENE sector = 50% (got ${pairs["NNE+ENE"].toFixed(1)})`);
ok(close(pairs["ESE+SSE"], 50, 0.01), `ESE+SSE sector = 50% (got ${pairs["ESE+SSE"].toFixed(1)})`);

// ---------------------------------------------------------------------------
// 6) Directional loading multipliers — the anti-regression bridge. The gravity
//    distribution RE-ORIENTS per-intersection loading (trips concentrate toward
//    high-share directions) WITHOUT changing the overall loading scale: the
//    multipliers average to 1 across the intersections, so distance-decay near-
//    site concentration (trip-loading.ts) is preserved and the scope-collapse
//    regression is not reintroduced.
// ---------------------------------------------------------------------------
const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

// (a) Uniform surroundings ⇒ every multiplier is exactly 1 ⇒ identical to
//     today's decay-only loading (backward-compatible, no regression).
const uniform = directionalMultipliers([
  { id: "n", mass: 100, distanceMi: 1, bearingDeg: 30 },
  { id: "e", mass: 100, distanceMi: 1, bearingDeg: 100 },
  { id: "s", mass: 100, distanceMi: 1, bearingDeg: 190 },
  { id: "w", mass: 100, distanceMi: 1, bearingDeg: 280 },
]);
ok(uniform.every((z) => close(z.multiplier, 1, 1e-9)), "uniform surroundings ⇒ all multipliers = 1 (no regression)");

// (b) A dominant direction pulls MORE loading toward its intersections; a weak
//     direction less. Mean multiplier stays 1 (loading scale preserved).
const skewed = directionalMultipliers([
  { id: "nne", mass: 100, distanceMi: 1, bearingDeg: 30 },  // NNE, share 25
  { id: "ene", mass: 100, distanceMi: 1, bearingDeg: 70 },  // ENE, share 25
  { id: "sse", mass: 200, distanceMi: 1, bearingDeg: 160 }, // SSE, share 50 (dominant)
]);
const bySkew = Object.fromEntries(skewed.map((z) => [z.id, z.multiplier]));
ok(close(mean(skewed.map((z) => z.multiplier)), 1, 1e-9), "skewed surroundings ⇒ mean multiplier = 1 (scale preserved)");
ok(bySkew.sse > 1 && bySkew.nne < 1, `dominant SSE loads more (×${bySkew.sse.toFixed(2)}), weak NNE less (×${bySkew.nne.toFixed(2)})`);
ok(close(bySkew.sse, 1.5, 1e-6) && close(bySkew.nne, 0.75, 1e-6), "multipliers = dirShare / mean(dirShare) exactly");

console.log("");
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
