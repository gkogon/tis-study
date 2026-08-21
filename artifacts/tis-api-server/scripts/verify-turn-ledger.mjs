// Regression check for the turn ledger — the conserved (in-link, node,
// out-link) attribution retained during route assignment.
//
// WHY IT EXISTS. Today every studied intersection is loaded INDEPENDENTLY from
// one global 8-octant vector, so the trips leaving intersection A toward B and
// the trips arriving at B are two unrelated estimates. Nothing forces them to
// agree, and nothing can answer "where did those six right turns go?".
//
// Link flow through the network was ALREADY conserved — assignRoutes loads the
// whole path from the site, so every link on it carries the same trips. What
// was thrown away was the attribution: which movement each vehicle made at each
// junction. The ledger keeps it, blended with the same MSA phi as `vol` so it
// stays consistent with link volumes at every iteration rather than only at
// convergence.
//
// THE INVARIANT UNDER TEST: at every interior node the paths pass through,
// sum(trips entering) === sum(trips leaving). A path contributes exactly one
// (in,out) pair per node it traverses, so this holds by construction — and if
// it ever stops holding, the ledger is lying and every movement derived from it
// would be wrong.
//
// Run: node ./scripts/verify-turn-ledger.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { assignRoutes, assignRoutesWithTurns } = await import(
  path.resolve(here, "../src/lib/network-assignment.ts")
);
const { roadSegmentsNear } = await import(
  path.resolve(here, "../../api-server/src/lib/regional-roads.ts")
);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// ---------------------------------------------------------------------------
// 1. Hand-checkable corridor: site at the west end, destinations east.
//    A --- B --- C --- D   (all on one straight E-W street)
//    Site at A. Destinations at C and D. Every trip must pass through B.
// ---------------------------------------------------------------------------
{
  const LAT = 33.75;
  const seg = (lonA, lonB) => [3, LAT, lonA, LAT, lonB, 2, 30, "Test Ave", 0];
  const segments = [
    seg(-84.400, -84.390),   // A-B
    seg(-84.390, -84.380),   // B-C
    seg(-84.380, -84.370),   // C-D
  ];
  const site = { lat: LAT, lon: -84.400 };
  const destinations = [
    { lat: LAT, lon: -84.380, trips: 60 },   // C
    { lat: LAT, lon: -84.370, trips: 40 },   // D
  ];

  const { assignment, turns, conservation } = assignRoutesWithTurns(site, destinations, segments);
  ok(assignment.available, "corridor: assignment ran");
  ok(turns.length > 0, `corridor: ledger recorded turns (${turns.length})`);
  ok(conservation.balanced,
    `corridor: node balance holds (max imbalance ${conservation.maxImbalance}, ${conservation.nodesChecked} nodes)`);

  // B is the only true interior node on both paths: 100 trips pass through it.
  const byNode = new Map();
  for (const t of turns) byNode.set(t.node, (byNode.get(t.node) ?? 0) + t.trips);
  const busiest = Math.max(...byNode.values());
  ok(Math.abs(busiest - 100) < 1e-6,
    `corridor: the shared interior node carries BOTH destinations' trips (${busiest} of 100)`);

  // Every recorded turn is a real (in != out) movement at its node.
  ok(turns.every((t) => t.inLink !== t.outLink),
    "corridor: no turn has the same link entering and leaving (would be a U-turn artefact)");
}

// ---------------------------------------------------------------------------
// 2. Branching network: destinations in opposite directions from the site.
//    Conservation must still hold once paths diverge.
// ---------------------------------------------------------------------------
{
  const LAT = 33.75, LON = -84.39;
  const seg = (aLat, aLon, bLat, bLon) => [3, aLat, aLon, bLat, bLon, 2, 30, "Grid", 0];
  const segments = [
    seg(LAT, LON, LAT, LON + 0.01),          // east
    seg(LAT, LON + 0.01, LAT, LON + 0.02),
    seg(LAT, LON, LAT, LON - 0.01),          // west
    seg(LAT, LON, LAT + 0.01, LON),          // north
    seg(LAT + 0.01, LON, LAT + 0.01, LON + 0.01),
  ];
  const { turns, conservation } = assignRoutesWithTurns(
    { lat: LAT, lon: LON },
    [
      { lat: LAT, lon: LON + 0.02, trips: 50 },
      { lat: LAT, lon: LON - 0.01, trips: 30 },
      { lat: LAT + 0.01, lon: LON + 0.01, trips: 20 },
    ],
    segments,
  );
  ok(conservation.balanced,
    `branching: node balance holds (max imbalance ${conservation.maxImbalance}, ${conservation.nodesChecked} nodes)`);
  ok(turns.length > 0, `branching: ledger populated (${turns.length} turns)`);
}

// ---------------------------------------------------------------------------
// 3. A REAL network — Peralta's corridor. This is the one that matters.
// ---------------------------------------------------------------------------
{
  const LAT = 25.8456, LON = -80.2103;
  const segments = roadSegmentsNear("miami_dade_metro", LAT, LON, 1.0);
  ok(Array.isArray(segments) && segments.length > 100,
    `miami: real road segments loaded (${segments?.length})`);

  // Destinations spread around the site, as the engine does.
  const destinations = [];
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * 2 * Math.PI;
    destinations.push({
      lat: LAT + 0.008 * Math.cos(th),
      lon: LON + 0.008 * Math.sin(th),
      trips: 25,
    });
  }

  const { assignment, turns, conservation } = assignRoutesWithTurns(
    { lat: LAT, lon: LON }, destinations, segments,
  );
  ok(assignment.available, "miami: assignment ran on the real network");
  ok(turns.length > 0, `miami: ledger recorded turns (${turns.length})`);
  ok(conservation.balanced,
    `miami: CONSERVATION HOLDS on a real network — max imbalance ${conservation.maxImbalance} over ${conservation.nodesChecked} nodes`);

  // Determinism: identical inputs must give byte-identical output, or derived
  // movement volumes would drift between runs of the same study.
  const again = assignRoutesWithTurns({ lat: LAT, lon: LON }, destinations, segments);
  ok(JSON.stringify(again.turns) === JSON.stringify(turns),
    "miami: repeated runs produce a byte-identical ledger");

  // The public entry point must be unchanged — the report payload cannot move.
  const legacy = assignRoutes({ lat: LAT, lon: LON }, destinations, segments);
  ok(JSON.stringify(legacy) === JSON.stringify(assignment),
    "miami: assignRoutes() output is byte-identical to the wrapped assignment (payload unchanged)");
}

// ---------------------------------------------------------------------------
// 4. Degenerate inputs stay safe.
// ---------------------------------------------------------------------------
{
  const none = assignRoutesWithTurns({ lat: 0, lon: 0 }, [], []);
  ok(none.turns.length === 0 && none.conservation.balanced && !none.assignment.available,
    "empty input: no turns, trivially balanced, assignment unavailable");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
