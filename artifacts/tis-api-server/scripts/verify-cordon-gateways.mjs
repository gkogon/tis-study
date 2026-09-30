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
// 4c. Backfill: the reachability screen must act on CANDIDATES. Three one-way
//     motorway fragments cross the ENE ring with no connection to the site
//     (the fetch clipped them), and each outranks the one connected arm.
//     Screening the finished top-3 dropped all three picks and left ENE with
//     nothing; screening candidates hands ENE to the arm. A fragment is one
//     crossing, so it takes one slot, not one per endpoint.
// ---------------------------------------------------------------------------
{
  const g = buildGraph([
    [3, LAT, LON, LAT + 0.001, LON + 0.012, 2, 50, "Arm", 0],                  // connected, 3800
    [0, LAT + 0.004, LON + 0.011, LAT + 0.006, LON + 0.011, 3, 113, "Isle", 1], // island, 5700
    [0, LAT + 0.006, LON + 0.013, LAT + 0.004, LON + 0.013, 3, 113, "Isle", 1], // island, 5700
    [0, LAT + 0.004, LON + 0.015, LAT + 0.006, LON + 0.015, 3, 113, "Isle", 1], // island, 5700
  ]);
  const ene = { NNE: 0, ENE: 100, ESE: 0, SSE: 0, SSW: 0, WSW: 0, WNW: 0, NNW: 0 };
  const reach = directedReachability(g, g.nearestNode(LAT, LON));
  const routable = (node) => reach.outbound[node] === 1 || reach.inbound[node] === 1;
  const unscreened = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, ene);
  ok(unscreened !== null && unscreened.gateways.length === 3 && unscreened.gateways.every((gw) => !routable(gw.node)),
    `backfill fixture: unscreened, the 3 ENE slots all go to unreachable fragment ends (${unscreened?.gateways.map((gw) => routable(gw.node)).join(",")})`);
  ok(new Set(unscreened?.gateways.map((gw) => gw.lon.toFixed(3))).size === 3,
    `backfill fixture: one slot per fragment, not two ends of one (${unscreened?.gateways.map((gw) => gw.lon.toFixed(3)).join(",")})`);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, ene, routable);
  ok(sel !== null && sel.gateways.length === 1 && routable(sel.gateways[0].node)
      && Math.abs(sel.gateways[0].share - 1) < 1e-9 && sel.gateways[0].lat < LAT + 0.003,
    `backfill: screened candidates give ENE's whole share to the connected arm (${sel?.gateways.map((gw) => `${gw.lat.toFixed(4)}:${gw.share.toFixed(3)}`).join(",")})`);
  ok(selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, ene, () => false) === null,
    "backfill: no routable candidate at any class ceiling → null (legacy path)");
}

// ---------------------------------------------------------------------------
// 4d–4h. Crossings, not nodes. The top-3 cap used to rank ring nodes one by
//     one, so several nodes of ONE road crossing (a junction and the shape
//     points beside it, the two ways of a divided road) took every slot and a
//     parallel corridor lost its gateway. Every fixture below is drawn with
//     `at(bearing, miles)` from the site at radius 0.5 (ring from 0.45 mi),
//     all in ENE (45°–90°), every way primary (class 2). Capacity per node is
//     the total of its links: a two-way link with L lanes carries
//     (L/2)·1900 each way, a one-way link L·1900.
// ---------------------------------------------------------------------------
const P = Math.PI / 180;
const at = (brg, mi) => [LAT + (mi * Math.cos(brg * P)) / 69.09, LON + (mi * Math.sin(brg * P)) / (69.09 * Math.cos(LAT * P))];
const north = (pt, mi) => [pt[0] + mi / 69.09, pt[1]];
const way = (pts, lanes, name, oneway = 0) =>
  pts.slice(1).map((b, i) => [2, ...pts[i], ...b, lanes, 50, name, oneway]);
const S = [LAT, LON];
const eneOnly = { NNE: 0, ENE: 100, ESE: 0, SSE: 0, SSW: 0, WSW: 0, WNW: 0, NNW: 0 };
const near = (gw, pt) => dist(gw.lat, gw.lon, pt[0], pt[1]) < 0.001;
const shares = (sel) => sel?.gateways.map((gw) => gw.share.toFixed(4)).join(",");
const screenOf = (g) => {
  const reach = directedReachability(g, g.nearestNode(LAT, LON));
  return (node) => reach.outbound[node] === 1 || reach.inbound[node] === 1;
};

// 4d. A 6-lane road A (11400 per link) with a junction J at 0.60 mi (a 2-lane
//     side street, 3800, runs north from it) and shape points P1, P2 at 0.62
//     and 0.64 mi: J = 11400+11400+3800 = 26600, P1 = P2 = 22800. A 4-lane
//     road B (7600 per link) crosses the ring 20° away: B2 = 15200. Ranked as
//     nodes, J, P1, P2 are the top three and B gets nothing. As crossings,
//     A is one gateway (J) and B the other, split 26600:15200 = 7/11 : 4/11.
{
  const J = at(70, 0.60), P1 = at(70, 0.62), P2 = at(70, 0.64), B2 = at(50, 0.60);
  const segs = [
    ...way([S, at(70, 0.30), J, P1, P2, at(70, 0.80)], 6, "Road A"),
    ...way([J, north(J, 0.03)], 2, "Side Street"),
    ...way([S, at(50, 0.30), B2, at(50, 0.80)], 4, "Road B"),
  ];
  const g = buildGraph(segs);
  const cap = new Array(g.nodeLat.length).fill(0);
  for (const lk of g.links) for (const x of [lk.a, lk.b]) cap[x] += lk.capVph * (lk.dir === 0 ? 2 : 1);
  const top3 = [...cap.keys()].filter((i) => dist(LAT, LON, g.nodeLat[i], g.nodeLon[i]) >= 0.45)
    .sort((a, b) => cap[b] - cap[a] || a - b).slice(0, 3);
  ok(top3.map((i) => cap[i]).join(",") === "26600,22800,22800"
      && top3.every((i) => [J, P1, P2].some((pt) => dist(g.nodeLat[i], g.nodeLon[i], pt[0], pt[1]) < 0.001)),
    `cluster fixture: the three highest-capacity ring nodes are J, P1, P2 on road A (${top3.map((i) => cap[i]).join(",")})`);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, eneOnly);
  const onA = sel?.gateways.filter((gw) => near(gw, J) || near(gw, P1) || near(gw, P2)) ?? [];
  const onB = sel?.gateways.filter((gw) => near(gw, B2)) ?? [];
  ok(sel !== null && sel.gateways.length === 2 && onA.length === 1 && near(onA[0], J) && onB.length === 1,
    `cluster: road A's junction cluster is one gateway (J) and parallel road B keeps its own (${sel?.gateways.length} gateways)`);
  ok(Math.abs((onA[0]?.share ?? 0) - 7 / 11) < 1e-9 && Math.abs((onB[0]?.share ?? 0) - 4 / 11) < 1e-9,
    `cluster: A and B split ENE 7/11 : 4/11 (got ${shares(sel)})`);
}

// 4e. Two 4-lane two-way ways leave the site 2.2° apart and reach the ring
//     30 m apart (P2, Q2 at 0.48 mi) — one road drawn as a pair — then fork
//     in the padding band. Each has a junction further out (P3, Q3 at
//     0.70 mi, a 2-lane stub each: 7600+7600+3800 = 19000), and P3 and Q3
//     are 160 m apart, so only the 30 m between their ways out ties them
//     together. The pair is one crossing (P3, the lower node index of the
//     19000 tie); a 2-lane road C (C2 = 7600) keeps its own. 19000:7600 = 5/7 : 2/7.
{
  const P2 = at(69, 0.48), P3 = at(66, 0.70), Q2 = at(71.2, 0.48), Q3 = at(74.5, 0.70), C2 = at(50, 0.60);
  const g = buildGraph([
    ...way([S, at(69, 0.30), P2, P3, at(66, 0.85)], 4, "Pair Road"),
    ...way([P3, north(P3, 0.03)], 2, "P Stub"),
    ...way([S, at(71.2, 0.30), Q2, Q3, at(74.5, 0.85)], 4, "Pair Road"),
    ...way([Q3, north(Q3, -0.03)], 2, "Q Stub"),
    ...way([S, at(50, 0.30), C2, at(50, 0.80)], 2, "Road C"),
  ]);
  ok(dist(P2[0], P2[1], Q2[0], Q2[1]) * 1609.344 < 40 && dist(P3[0], P3[1], Q3[0], Q3[1]) * 1609.344 > 150,
    `pair fixture: ways out 30 m apart, junctions ${(dist(P3[0], P3[1], Q3[0], Q3[1]) * 1609.344).toFixed(0)} m apart`);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, eneOnly);
  const pair = sel?.gateways.filter((gw) => near(gw, P3) || near(gw, Q3)) ?? [];
  const c = sel?.gateways.filter((gw) => near(gw, C2)) ?? [];
  ok(sel !== null && sel.gateways.length === 2 && pair.length === 1 && near(pair[0], P3) && c.length === 1,
    `pair: a road drawn as two ways 30 m apart is one gateway, road C keeps its own (${sel?.gateways.length} gateways)`);
  ok(Math.abs((pair[0]?.share ?? 0) - 5 / 7) < 1e-9 && Math.abs((c[0]?.share ?? 0) - 2 / 7) < 1e-9,
    `pair: 5/7 : 2/7 (got ${shares(sel)})`);
}

// 4f. Two roads C and D reach the ring 18° apart (C1 at 58°, D1 at 76°) and
//     meet at junction K (0.70 mi) in the padding band. K = 7600·3 = 22800 is
//     reached fastest through C. D's best node Dk sits 30 m short of K (a
//     2-lane stub: 7600+7600+3800 = 19000) and is reached through D, so it is
//     a different crossing — but it is the same junction on the map. It
//     yields to K; a 2-lane road E (E2 = 7600) keeps its own. 22800:7600 = 3/4 : 1/4.
{
  const C1 = at(58, 0.48), K = at(66, 0.70), D1 = at(76, 0.48), Dk = at(67.5, 0.70), E2 = at(48, 0.60);
  const g = buildGraph([
    ...way([S, at(58, 0.30), C1, K, at(66, 0.85)], 4, "Road C"),
    ...way([S, at(76, 0.30), D1, Dk, K], 4, "Road D"),
    ...way([Dk, north(Dk, -0.03)], 2, "D Stub"),
    ...way([S, at(48, 0.30), E2, at(48, 0.80)], 2, "Road E"),
  ]);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, eneOnly);
  const k = sel?.gateways.filter((gw) => near(gw, K) || near(gw, Dk)) ?? [];
  const e = sel?.gateways.filter((gw) => near(gw, E2)) ?? [];
  ok(sel !== null && sel.gateways.length === 2 && k.length === 1 && near(k[0], K) && e.length === 1,
    `junction: two nodes 30 m apart at one junction are one gateway even when reached through different roads (${sel?.gateways.length} gateways)`);
  ok(Math.abs((k[0]?.share ?? 0) - 3 / 4) < 1e-9 && Math.abs((e[0]?.share ?? 0) - 1 / 4) < 1e-9,
    `junction: 3/4 : 1/4 (got ${shares(sel)})`);
}

// 4g. A divided road drawn as two one-way carriageways 30 m apart: O runs
//     away from the site, I towards it (2 lanes each: 3800 per link, 7600 per
//     node), and a 2-lane two-way road E (7600) runs 20° away. The router
//     drops a gateway's share in the pass that cannot reach it, so O serves
//     only outbound trips and I only inbound ones. Merging them would throw
//     one direction away: all three stay (1/3 each). Drawn two-way, the same
//     pair is one crossing and E gets half.
{
  const O2 = at(70, 0.60), I2 = at(71.8, 0.60), E2 = at(50, 0.60);
  const build = (oneWay) => buildGraph([
    ...way([S, at(70, 0.30), O2, at(70, 0.80)], 2, "Divided Road", oneWay ? 1 : 0),
    ...way([S, at(71.8, 0.30), I2, at(71.8, 0.80)], 2, "Divided Road", oneWay ? -1 : 0),
    ...way([S, at(50, 0.30), E2, at(50, 0.80)], 2, "Road E"),
  ]);
  const g1 = build(true);
  const sel = selectCordonGateways(g1, { lat: LAT, lon: LON }, 0.5, eneOnly, screenOf(g1));
  const reach = directedReachability(g1, g1.nearestNode(LAT, LON));
  const o = sel?.gateways.find((gw) => near(gw, O2)), i = sel?.gateways.find((gw) => near(gw, I2));
  ok(o && i && reach.outbound[o.node] === 1 && reach.inbound[o.node] === 0
      && reach.inbound[i.node] === 1 && reach.outbound[i.node] === 0,
    `divided fixture: O is outbound-only, I inbound-only (${o ? `${reach.outbound[o.node]}${reach.inbound[o.node]}` : "-"}/${i ? `${reach.outbound[i.node]}${reach.inbound[i.node]}` : "-"})`);
  ok(sel !== null && sel.gateways.length === 3 && sel.gateways.every((gw) => Math.abs(gw.share - 1 / 3) < 1e-9),
    `divided one-way: each carriageway keeps a gateway for its own direction, E the third (${shares(sel)})`);
  const sel2 = selectCordonGateways(build(false), { lat: LAT, lon: LON }, 0.5, eneOnly);
  ok(sel2 !== null && sel2.gateways.length === 2 && sel2.gateways.some((gw) => near(gw, O2))
      && sel2.gateways.some((gw) => near(gw, E2)) && sel2.gateways.every((gw) => Math.abs(gw.share - 0.5) < 1e-9),
    `divided two-way control: the pair is one gateway, E gets half (${shares(sel2)})`);
}

// 4h. A crossing's gateway is a node both passes can use when it has one. A
//     2-lane road R crosses the ring (R2 at 0.60 mi) and a 5-lane one-way ramp
//     leaves it outbound to X and on to a dead end. X = 9500+9500 = 19000
//     outranks R2 = 3800+3800+9500 = 17100, but inbound trips cannot start
//     at X; R2 serves both passes, so R2 is the gateway.
{
  const R2 = at(70, 0.60), X = at(66, 0.70);
  const g = buildGraph([
    ...way([S, at(70, 0.30), R2, at(70, 0.80)], 2, "Road R"),
    ...way([R2, X, at(64, 0.85)], 5, "Ramp", 1),
  ]);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, eneOnly, screenOf(g));
  ok(sel !== null && sel.gateways.length === 1 && near(sel.gateways[0], R2),
    `representative: R2, which both passes can use, not the higher-capacity outbound-only X (${sel?.gateways.map((gw) => `${gw.lat.toFixed(5)},${gw.lon.toFixed(5)}`).join(" ")})`);
}

// 4i. Ties inside a crossing go to the lower node index. A 4-lane road T has
//     two junctions in the padding band, T2 (0.55 mi) and T3 (0.75 mi), each
//     with a 2-lane stub: both 7600+7600+3800 = 19000. T is drawn outward, so
//     T2 has the lower index and is the gateway, on every run.
{
  const T2 = at(70, 0.55), T3 = at(70, 0.75);
  const g = buildGraph([
    ...way([S, at(70, 0.30), T2, T3, at(70, 0.90)], 4, "Road T"),
    ...way([T2, north(T2, 0.03)], 2, "T2 Stub"),
    ...way([T3, north(T3, 0.03)], 2, "T3 Stub"),
  ]);
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, eneOnly);
  ok(sel !== null && sel.gateways.length === 1 && near(sel.gateways[0], T2),
    `tie: one gateway for road T, at the lower-index junction T2 (${sel?.gateways.map((gw) => `${gw.lat.toFixed(5)},${gw.lon.toFixed(5)}`).join(" ")})`);
}

// 4j. A crossing is where the route LAST leaves the ring. Road W leaves at W2
//     (0.48 mi), comes back inside to W3 (0.40 mi) and leaves again at W4
//     (0.55 mi), 180 m from W2. Trips to W4 pass W3 inside the study area and
//     trips to W2 do not, so they are two crossings (4 lanes, 15200 each: 1/2
//     each), not one.
{
  const W2 = at(62, 0.48), W4 = at(72, 0.55);
  const g = buildGraph(way([S, at(60, 0.30), W2, at(66, 0.40), W4, at(74, 0.70)], 4, "Road W"));
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, eneOnly);
  ok(sel !== null && sel.gateways.length === 2 && sel.gateways.some((gw) => near(gw, W2)) && sel.gateways.some((gw) => near(gw, W4))
      && sel.gateways.every((gw) => Math.abs(gw.share - 0.5) < 1e-9),
    `re-entry: a road that leaves the ring, comes back in and leaves again is two crossings (${shares(sel)})`);
}

// 4k. Parallel streets one block apart are two crossings. Roads U and V cross
//     the ring 90 m apart (U2, V2 at 0.48 mi, like Queen Victoria Street and
//     Upper Thames Street in the City of London) and each has a junction
//     further out (U3, V3: 7600+7600+3800 = 19000). A divided road's two
//     ways cross within 60 m (4e); 90 m apart they are two roads, 1/2 each.
{
  const U2 = at(66, 0.48), U3 = at(62, 0.70), V2 = at(72.7, 0.48), V3 = at(76, 0.70);
  const g = buildGraph([
    ...way([S, at(66, 0.30), U2, U3, at(62, 0.85)], 4, "Road U"),
    ...way([U3, north(U3, 0.03)], 2, "U Stub"),
    ...way([S, at(72.7, 0.30), V2, V3, at(76, 0.85)], 4, "Road V"),
    ...way([V3, north(V3, -0.03)], 2, "V Stub"),
  ]);
  const gap = dist(U2[0], U2[1], V2[0], V2[1]) * 1609.344;
  const sel = selectCordonGateways(g, { lat: LAT, lon: LON }, 0.5, eneOnly);
  ok(gap > 80 && gap < 100 && sel !== null && sel.gateways.length === 2 && sel.gateways.some((gw) => near(gw, U3))
      && sel.gateways.some((gw) => near(gw, V3)) && sel.gateways.every((gw) => Math.abs(gw.share - 0.5) < 1e-9),
    `parallel: roads crossing the ring ${gap.toFixed(0)} m apart keep a gateway each (${shares(sel)})`);
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
