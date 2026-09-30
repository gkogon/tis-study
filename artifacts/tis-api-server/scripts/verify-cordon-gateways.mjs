// Regression check for cordon-gateway selection + conserved through-flow.
//
// WHY: destinations have always been the study signals themselves, so every
// routed path TERMINATED at a study intersection — the arriving link had no
// departing pair, which is exactly the turn the report needs. Gateways sit on
// the outer ring of the fetched graph; trips pass THROUGH the studied
// intersections on the way out, so a turn exists at every one of them.
//
// This slice was flagged the RISKIEST in the design: which nodes count as
// gateways, how an octant's share splits, and what happens to an octant with
// no candidates are judgement calls that silently steer every downstream
// number. So the fixtures here are hand-checkable: the right answer is
// computable on paper before the code runs.
//
// Run: node ./scripts/verify-cordon-gateways.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { selectCordonGateways } = await import(path.resolve(here, "../src/lib/cordon-gateways.ts"));
const { buildGraph, assignRoutesWithTurns, directedReachability } = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
const { roadSegmentsNear } = await import(path.resolve(here, "../../api-server/src/lib/regional-roads.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const dist = (a, b, c, d) => {
  const R = 3958.8, p = Math.PI / 180;
  const s = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const evenDirs = { NNE: 12.5, ENE: 12.5, ESE: 12.5, SSE: 12.5, SSW: 12.5, WSW: 12.5, WNW: 12.5, NNW: 12.5 };

// 0.01° lat ≈ 0.69 mi. Cross of four arms, each reaching ~0.69 mi from center.
const LAT = 33.75, LON = -84.39, ARM = 0.01;
const seg = (aLat, aLon, bLat, bLon, cls = 2) => [cls, aLat, aLon, bLat, bLon, 2, 30, "X", 0];
const crossSegments = [
  seg(LAT, LON, LAT, LON + ARM), // E
  seg(LAT, LON, LAT, LON - ARM), // W
  seg(LAT, LON, LAT + ARM, LON), // N
  seg(LAT, LON, LAT - ARM, LON), // S
];

// ---------------------------------------------------------------------------
// 1. Cross fixture: 4 arm-tips at ~0.69 mi; radius 0.5 → all four are ring
//    nodes. Distribution 100% east ⇒ ALL share should reach the east tip.
// ---------------------------------------------------------------------------
{
  const g = buildGraph(crossSegments);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5,
    { NNE: 0, ENE: 100, ESE: 0, SSE: 0, SSW: 0, WSW: 0, WNW: 0, NNW: 0 });
  ok(sel !== null, "cross: a cordon exists");
  const east = sel.gateways.filter((gw) => gw.lon > LON + 0.005);
  const eastShare = east.reduce((s, gw) => s + gw.share, 0);
  ok(Math.abs(eastShare - 1) < 1e-9,
    `cross: 100% ENE demand puts ALL share on the east tip (got ${eastShare.toFixed(6)})`);
  const total = sel.gateways.reduce((s, gw) => s + gw.share, 0);
  ok(Math.abs(total - 1) < 1e-9, `cross: shares sum to exactly 1 (${total})`);
}

// ---------------------------------------------------------------------------
// 2. Empty-octant redistribution: 100% demand due WEST but the graph has no
//    west arm → share must move to the angularly nearest tips, not vanish.
// ---------------------------------------------------------------------------
{
  const noWest = crossSegments.filter((s2) => !(s2[4] < LON - 0.001)); // drop the W arm
  const g = buildGraph(noWest);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5,
    { NNE: 0, ENE: 0, ESE: 0, SSE: 0, SSW: 0, WSW: 50, WNW: 50, NNW: 0 });
  ok(sel !== null, "no-west: cordon still exists");
  ok(sel.emptyOctants.length >= 1,
    `no-west: empty octants recorded (${sel.emptyOctants.join(",")})`);
  const total = sel.gateways.reduce((s, gw) => s + gw.share, 0);
  ok(Math.abs(total - 1) < 1e-9,
    `no-west: demand is conserved through redistribution (Σ=${total})`);
  // Nearest tips to WSW/WNW demand are the N and S tips (2 steps), not east (4).
  const eastShare = sel.gateways.filter((gw) => gw.lon > LON + 0.005).reduce((s, gw) => s + gw.share, 0);
  ok(eastShare < 0.01,
    `no-west: none of the westbound demand teleports to the EAST tip (east=${eastShare.toFixed(4)})`);
}

// ---------------------------------------------------------------------------
// 3. Class ceiling: a ring of ONLY collectors (cls 4) must still cordon, via
//    the relaxed ceiling, and report which ceiling was used.
// ---------------------------------------------------------------------------
{
  const collectors = crossSegments.map((s2) => [4, ...s2.slice(1)]);
  const g = buildGraph(collectors);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, evenDirs);
  ok(sel !== null && sel.classCeiling === 4,
    `collector-only ring cordons at the relaxed ceiling (ceiling=${sel?.classCeiling})`);
}

// ---------------------------------------------------------------------------
// 4. No graph → null, caller keeps the legacy path.
// ---------------------------------------------------------------------------
{
  const g = buildGraph([]);
  ok(selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, evenDirs) === null,
    "empty graph → null (legacy fallback)");
}

// ---------------------------------------------------------------------------
// 4b. Direction-aware weight: capVph is per direction, so a 4-lane one-way arm
//     (4 lanes one way) and a 4-lane two-way arm (2 each way) carry the same
//     total and must split their octant evenly. Counting capVph once per link
//     gave the one-way arm 2/3 once one-way ways stopped being halved.
// ---------------------------------------------------------------------------
{
  const g = buildGraph([
    [2, LAT, LON, LAT + 0.005, LON + 0.010, 4, 50, "One-way", 1], // ~59°, ENE
    [2, LAT, LON, LAT + 0.001, LON + 0.012, 4, 50, "Two-way", 0], // ~84°, ENE
  ]);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5,
    { NNE: 0, ENE: 100, ESE: 0, SSE: 0, SSW: 0, WSW: 0, WNW: 0, NNW: 0 });
  const oneWay = sel?.gateways.find((gw) => gw.lat > LAT + 0.003);
  const twoWay = sel?.gateways.find((gw) => gw.lat < LAT + 0.003);
  ok(sel !== null && sel.gateways.length === 2 && oneWay?.octant === "ENE" && twoWay?.octant === "ENE",
    `equal-total arms: both tips are ENE gateways (${sel?.gateways.map((gw) => gw.octant).join(",")})`);
  ok(Math.abs((oneWay?.share ?? 0) - 0.5) < 1e-9 && Math.abs((twoWay?.share ?? 0) - 0.5) < 1e-9,
    `equal-total arms: a 4-lane one-way and a 4-lane two-way arm split 50/50 (got ${oneWay?.share?.toFixed(4)}/${twoWay?.share?.toFixed(4)})`);
}

// ---------------------------------------------------------------------------
// 4c. Backfill: the reachability screen must act on CANDIDATES. Two one-way
//     motorway fragments cross the ENE ring with no connection to the site
//     (the fetch clipped them), and their four endpoints outrank the one
//     connected arm. Screening the finished top-3 dropped all three picks and
//     left ENE with nothing; screening candidates hands ENE to the arm.
// ---------------------------------------------------------------------------
{
  const g = buildGraph([
    [3, LAT, LON, LAT + 0.001, LON + 0.012, 2, 50, "Arm", 0],                  // connected, 3800
    [0, LAT + 0.004, LON + 0.011, LAT + 0.006, LON + 0.011, 3, 113, "Isle", 1], // island, 5700
    [0, LAT + 0.006, LON + 0.013, LAT + 0.004, LON + 0.013, 3, 113, "Isle", 1], // island, 5700
  ]);
  const ene = { NNE: 0, ENE: 100, ESE: 0, SSE: 0, SSW: 0, WSW: 0, WNW: 0, NNW: 0 };
  const reach = directedReachability(g, g.nearestNode(LAT, LON));
  const routable = (node) => reach.outbound[node] === 1 || reach.inbound[node] === 1;
  const unscreened = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, ene);
  ok(unscreened !== null && unscreened.gateways.length === 3 && unscreened.gateways.every((gw) => !routable(gw.node)),
    `backfill fixture: unscreened, the 3 ENE slots all go to unreachable fragment ends (${unscreened?.gateways.map((gw) => routable(gw.node)).join(",")})`);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, ene, routable);
  ok(sel !== null && sel.gateways.length === 1 && routable(sel.gateways[0].node)
      && Math.abs(sel.gateways[0].share - 1) < 1e-9 && sel.gateways[0].lat < LAT + 0.003,
    `backfill: screened candidates give ENE's whole share to the connected arm (${sel?.gateways.map((gw) => `${gw.lat.toFixed(4)}:${gw.share.toFixed(3)}`).join(",")})`);
  ok(selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, ene, () => false) === null,
    "backfill: no routable candidate at any class ceiling → null (legacy path)");
}

// ---------------------------------------------------------------------------
// 5. THE REAL NETWORK — Peralta's corridor. Gateways ring the site, demand is
//    conserved, and routing site→gateways passes THROUGH interior junctions
//    with exact node balance. This is the property the whole build exists for.
// ---------------------------------------------------------------------------
{
  const SITE = { lat: 25.8456, lon: -80.2103 };
  const RADIUS = 0.8;
  const segments = roadSegmentsNear("miami_dade_metro", SITE.lat, SITE.lon, RADIUS + 0.25);
  ok(segments.length > 500, `miami: segments loaded (${segments.length})`);
  const g = buildGraph(segments);

  // A realistic uneven distribution (Caltran-style).
  const dirs = { NNE: 22, ENE: 8, ESE: 5, SSE: 18, SSW: 21, WSW: 9, WNW: 7, NNW: 10 };
  const sel = selectCordonGateways(g, SITE, RADIUS, dirs);
  ok(sel !== null, "miami: cordon selected");
  ok(sel.gateways.length >= 8 && sel.gateways.length <= 24,
    `miami: a ring of real corridors, capped at 3/octant (${sel.gateways.length} gateways, ceiling=${sel.classCeiling})`);
  ok(sel.gateways.every((gw) => dist(SITE.lat, SITE.lon, gw.lat, gw.lon) >= RADIUS - 0.05),
    "miami: every gateway is on the outer ring");
  const total = sel.gateways.reduce((s, gw) => s + gw.share, 0);
  ok(Math.abs(total - 1) < 1e-9, `miami: shares sum to 1 (${total})`);

  // Octant totals must follow the printed distribution for octants that have
  // gateways — the report's §6.1 and the cordon can never disagree.
  const octTotal = {};
  for (const gw of sel.gateways) octTotal[gw.octant] = (octTotal[gw.octant] ?? 0) + gw.share;
  const withGateways = Object.keys(octTotal).filter((k) => !sel.emptyOctants.includes(k));
  const gross = Object.values(dirs).reduce((a, b) => a + b, 0);
  let coherent = true;
  for (const k of withGateways) {
    // Each populated octant must carry AT LEAST its own printed share
    // (it may carry more if a neighbour was empty).
    if (octTotal[k] + 1e-9 < dirs[k] / gross) coherent = false;
  }
  ok(coherent, "miami: every populated octant carries at least its printed §6.1 share");

  // Route to the cordon: through-flow with exact conservation.
  const PM_TRIPS = 300;
  const dests = sel.gateways.map((gw) => ({ lat: gw.lat, lon: gw.lon, trips: gw.share * PM_TRIPS }));
  const { assignment, turns, conservation } = assignRoutesWithTurns(SITE, dests, segments);
  ok(assignment.available, "miami: assignment ran to the cordon");
  ok(conservation.balanced,
    `miami: conservation holds through the cordon (max imbalance ${conservation.maxImbalance}, ${conservation.nodesChecked} nodes)`);
  ok(turns.length > 100,
    `miami: rich interior turn ledger (${turns.length} turns — paths now pass THROUGH the study area)`);

  // Determinism, end to end.
  const again = selectCordonGateways(g, SITE, RADIUS, dirs);
  ok(JSON.stringify(again) === JSON.stringify(sel), "miami: gateway selection is byte-deterministic");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
