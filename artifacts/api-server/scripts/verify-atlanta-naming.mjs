// Regression guard for Atlanta cross-street naming.
//
// The bug: atlanta-signal-naming.ts buildGrid() accepted only 3-element way
// tuples ([classCode, name, polyline]). The 2026-08-21 roads regeneration
// (#126) rewrote atlanta-roads.json in the 6-element shape every other region
// ships — [classCode, name, polyline, lanes, maxspeedKmh, oneway] — so the
// guard rejected all 240,804 ways, the grid indexed nothing, and every one of
// the 7,958 Atlanta signals fell through to the coordinate label built by
// atlanta-analysis.ts namelessLabel():
//
//   "Signal 35.6mi NE of CBD (34.0097, -83.8526)"
//   "Signal near Five Points (33.7540, -84.3900)"
//
// Those labels reached the engine (tis-api-server tis.ts reads
// /api/atlanta/intersections), the study map (/api/intersections?regionCode=
// atlanta_metro), /atlanta/intersections/:id and every PDF, because all of
// them read through getIntersectionSummaries() / getIntersectionById().
//
// Invariants this guards, on the shipped data files:
//   1. >= 99 % of Atlanta summaries carry a cross-street name ("A & B") or a
//      single-road name ("Near X").
//   2. The synthetic coordinate label appears ONLY where the resolver found no
//      named road within its 150 m search radius, and on no more than the
//      pinned residue (12 signals on the 2026-08-21 roads file; their nearest
//      named road is 151–438 m away). Matched on the exact namelessLabel()
//      templates, not the bare words: "Five Points Road" is a real street in
//      the Atlanta roads file, so a legitimate "Near Five Points Road" must
//      not trip the check.
//   3. Ids, row count and the 6 embedded OSM names are untouched — the fix
//      changes names only, never ids, zones, volumes or severity.
//
// Run: node ./scripts/verify-atlanta-naming.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

const here = path.dirname(fileURLToPath(import.meta.url));
// ts-loader lives in the sibling package; api-server has no scripts harness.
register(pathToFileURL(path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs")).href, import.meta.url);

const { loadSignals, loadRoadNetwork } = await import(path.resolve(here, "../src/lib/atlanta-data.ts"));
const { resolveSignalNames } = await import(path.resolve(here, "../src/lib/atlanta-signal-naming.ts"));
const { getIntersectionSummaries, getIntersectionById } = await import(
  path.resolve(here, "../src/lib/atlanta-analysis.ts")
);

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else console.log("ok:", msg);
};

// The two namelessLabel() templates, verbatim from atlanta-analysis.ts.
const SYNTHETIC_CBD = /^Signal \d+\.\dmi [NSEW]{1,2} of CBD \(-?\d+\.\d{4}, -?\d+\.\d{4}\)$/;
const SYNTHETIC_FIVE_POINTS = /^Signal near Five Points \(-?\d+\.\d{4}, -?\d+\.\d{4}\)$/;
const CROSS_STREET = / & /;
const SINGLE_ROAD = /^Near /;
// Signals with no named road within FAR_RADIUS_M (150 m) on the shipped roads
// file. Raise only after confirming the new residue is genuinely unresolvable
// (see the nearest-named-road distances in the PR that introduced this check).
const MAX_UNRESOLVED = 12;

// ---------------------------------------------------------------------------
// 1. Cold start: the first call loads both files, builds the grid and names
//    every signal. Printed, not asserted — CI runners vary — but it is the
//    number to quote for the engine's 30 s analyzer timeout.
// ---------------------------------------------------------------------------
const t0 = performance.now();
const summaries = getIntersectionSummaries();
const coldMs = performance.now() - t0;
console.log(`info: getIntersectionSummaries() cold start ${(coldMs / 1000).toFixed(1)} s (roads load + grid build + naming pass)`);

const t1 = performance.now();
const again = getIntersectionSummaries();
const warmMs = performance.now() - t1;
ok(again === summaries, `second call is memoized (same array, ${warmMs.toFixed(1)} ms)`);

// ---------------------------------------------------------------------------
// 2. Row count and ids are what the signals file says — the fix is names-only.
// ---------------------------------------------------------------------------
const signals = loadSignals();
ok(summaries.length === signals.length, `one summary per signal tuple (${summaries.length} / ${signals.length})`);
ok(
  summaries.every((s) => /^ATL-\d+$/.test(s.id)),
  `every id keeps the ATL-<osmId> format (/atlanta/intersections/:id and the accident joins depend on it)`,
);
ok(
  summaries.every((s, i) => s.id === `ATL-${signals[i][0]}`),
  `summary order and ids match the signals file order`,
);

// ---------------------------------------------------------------------------
// 3. Naming coverage.
// ---------------------------------------------------------------------------
const total = summaries.length;
let cross = 0;
let single = 0;
let cbd = 0;
let fivePoints = 0;
const synthetic = [];
for (const s of summaries) {
  const isCbd = SYNTHETIC_CBD.test(s.name);
  const isFivePoints = !isCbd && SYNTHETIC_FIVE_POINTS.test(s.name);
  if (isCbd) cbd++;
  if (isFivePoints) fivePoints++;
  if (isCbd || isFivePoints) synthetic.push(s);
  if (CROSS_STREET.test(s.name)) cross++;
  else if (SINGLE_ROAD.test(s.name)) single++;
}
const named = cross + single;
const namedPct = Math.round((named / total) * 1000) / 10;
console.log(
  `info: ${total} summaries — "A & B" ${cross}, "Near X" ${single}, named ${named} (${namedPct.toFixed(1)} %), ` +
    `synthetic "of CBD" ${cbd}, synthetic "near Five Points" ${fivePoints}`,
);
ok(namedPct >= 99, `>= 99 % of Atlanta summaries are named "A & B" or "Near X" (got ${namedPct.toFixed(1)} %)`);
ok(
  synthetic.length <= MAX_UNRESOLVED,
  `synthetic coordinate labels are within the pinned residue (${synthetic.length} <= ${MAX_UNRESOLVED})`,
);

// Every synthetic label must be explained by the resolver itself: the signal
// has no named road within its search radius. resolveSignalNames is memoized,
// so this returns the map ensureLoaded() already built.
const resolved = resolveSignalNames(signals, loadRoadNetwork());
const embeddedByOsm = new Map(signals.filter((t) => t[3] && t[3].trim()).map((t) => [t[0], t[3]]));
console.log(
  `info: resolver named ${resolved.size} / ${signals.length} signals; ${embeddedByOsm.size} carry an embedded OSM name`,
);
const syntheticButResolvable = synthetic.filter((s) => {
  const osmId = Number(s.id.slice(4));
  return resolved.has(osmId) || embeddedByOsm.has(osmId);
});
ok(
  syntheticButResolvable.length === 0,
  `every synthetic label belongs to a signal the resolver could not name (${synthetic.length} synthetic; ${syntheticButResolvable.length} resolvable but still synthetic)`,
);
for (const s of syntheticButResolvable.slice(0, 10)) console.error(`   resolvable but synthetic: ${s.id}: ${s.name}`);
const unresolved = signals.filter((t) => !resolved.has(t[0]) && !embeddedByOsm.has(t[0]));
ok(
  unresolved.length === synthetic.length,
  `every unresolved signal is the one carrying a synthetic label (${unresolved.length} unresolved vs ${synthetic.length} synthetic)`,
);
if (synthetic.length > 0) {
  console.log(`info: ${synthetic.length} signal(s) with no named road within the resolver radius keep the coordinate label:`);
  for (const s of synthetic) console.log(`   ${s.id}: ${s.name}`);
}

// Everything that is neither a cross-street, a "Near X" nor a synthetic label
// must be one of the embedded OSM names (memorial intersections).
const other = summaries.filter(
  (s) => !CROSS_STREET.test(s.name) && !SINGLE_ROAD.test(s.name) && !SYNTHETIC_CBD.test(s.name) && !SYNTHETIC_FIVE_POINTS.test(s.name),
);
const otherNotEmbedded = other.filter((s) => !embeddedByOsm.has(Number(s.id.slice(4))));
ok(
  otherNotEmbedded.length === 0,
  `every other name is an embedded OSM name (${other.length} such rows; ${otherNotEmbedded.length} unexplained)`,
);
for (const s of otherNotEmbedded.slice(0, 10)) console.error(`   unexplained: ${s.id}: ${s.name}`);

// ---------------------------------------------------------------------------
// 4. Embedded OSM names still take precedence over the derived label.
// ---------------------------------------------------------------------------
for (const [osmId, embedded] of embeddedByOsm) {
  const row = getIntersectionById(`ATL-${osmId}`);
  ok(row !== undefined && row.name === embedded, `ATL-${osmId} keeps its embedded OSM name "${embedded}"`);
}

// ---------------------------------------------------------------------------
// 5. Samples — the Peachtree / 14th pair in Midtown plus three others.
// ---------------------------------------------------------------------------
const sampleIds = [
  "ATL-69421277", // Peachtree Street NE & 14th Street NE
  "ATL-69372826", // West Peachtree Street NW & 14th Street NW
  "ATL-9270199576", // embedded "Cheshire & Faulkner"
  summaries[0].id, // first row in file order
  summaries.find((s) => SINGLE_ROAD.test(s.name))?.id, // first "Near X"
].filter(Boolean);
console.log("samples:");
for (const id of sampleIds) {
  const s = summaries.find((x) => x.id === id);
  console.log(`   ${id}: ${s ? s.name : "(missing)"}`);
}
const peachtree = summaries.find((s) => s.id === "ATL-69421277");
ok(
  peachtree !== undefined && /Peachtree/.test(peachtree.name) && /14th/.test(peachtree.name) && CROSS_STREET.test(peachtree.name),
  `ATL-69421277 resolves to the Peachtree / 14th cross-street pair (got "${peachtree?.name}")`,
);
const westPeachtree = summaries.find((s) => s.id === "ATL-69372826");
ok(
  westPeachtree !== undefined && /West Peachtree/.test(westPeachtree.name) && /14th/.test(westPeachtree.name),
  `ATL-69372826 resolves to the West Peachtree / 14th cross-street pair (got "${westPeachtree?.name}")`,
);

if (fails > 0) {
  console.error(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log("\nverify-atlanta-naming: all checks passed");
