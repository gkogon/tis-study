// The routers read the road file's maxspeed and lanes in the units the file
// stores them.
//
// Every <slug>-roads.json stores OSM maxspeed in km/h (the extractors'
// parseMaxspeedKmh converts "N mph" tags on write), the analyzer serves it
// unconverted, and both routers — the engine's buildGraph
// (network-assignment.ts) and the live study map's buildRoadGraph
// (atlanta-tis study-map-sim.ts) — cost links in mph. Both read the km/h value
// as mph, so a 35 mph street routed at 56 mph and a 70 mph turnpike at 113.
// Nothing looked wrong: every pinned output and every other check passed with
// and without the slip, and a grep cannot tell a km/h number from an mph one.
// So this check RUNS the code:
//
//  1. buildGraph: stored 56 / 89 / 113 km/h route at 34.8 / 55.3 / 70.2 mph,
//     and an untagged link (null, 0, absent) takes its class default.
//  2. buildRoadGraph (the map) gives the same speeds, and the same free-flow
//     time as the engine on every link, so the map draws the paths the report
//     assigned.
//  3. A real way end to end: the first one-way motorway carriageway in the
//     Pittsburgh road file with 3+ lanes and a tagged freeway speed (today a
//     Pennsylvania Turnpike carriageway at 113 km/h), read by
//     roadSegmentsNear, served over a stubbed /api/roads, fetched by
//     fetchLocalRoads and built by both routers. It is served as stored (km/h
//     — the contract the consumers convert against) and routes at its mph.
//     Picked by rule, not by name, so a data refresh that retags one way does
//     not break the check.
//  4. Writer side: in every US and UK road file at least 90% of the tagged
//     values are what an extractor writes for a multiple of 5 mph (8, 16, 24,
//     32, 40, 48, 56, ...). Today the lowest file is Savannah at 95.6%, its
//     remainder real odd-mph tags (12, 18, 27 mph); the floor leaves room for
//     a refresh to add more. An extractor that ever stored raw mph (25, 35,
//     45, 55) would drop a file far below it (the highest raw share is 34.3%);
//     the check proves so by rewriting each file's values as raw mph and
//     requiring the rewrite to fail. Accepting the conversion of ANY whole mph
//     instead would blind the guard: 22, 28 and 34 mph convert to 35, 45 and
//     55, so raw-mph files would pass. Scoped to US and UK files: km/h
//     countries tag round km/h (Montevideo is mostly 45), which says nothing
//     about the unit.
//  5. Lanes: buildGraph's capVph is per direction. OSM `lanes` is both
//     directions on a two-way way but one direction on a one-way way, and
//     buildGraph halved both, so a 3-lane one-way carriageway (the probe in 3)
//     got 2 lanes. One-way 3 -> 3 per direction, two-way 4 -> 2, untagged
//     -> the class default.
//
// Run: pnpm run check:road-units   (or: node ./scripts/verify-road-units.mjs)
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { stubUpstreams, json } from "./lib/fetch-stub.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

process.env.LOG_LEVEL ??= "error";

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const { KMH_PER_MPH } = await import("@workspace/tis-engine-core");
const { buildGraph, fetchLocalRoads } = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
const { buildRoadGraph } = await import(path.resolve(here, "../../atlanta-tis/src/lib/study-map-sim.ts"));
const { roadSegmentsNear } = await import(path.resolve(here, "../../api-server/src/lib/regional-roads.ts"));
const { regionCodeToSlug } = await import(path.resolve(here, "../../api-server/src/lib/regional-intersections.ts"));
const { findDataFile, readJsonMaybeGz } = await import(path.resolve(here, "../../api-server/src/lib/data-files.ts"));
const { REGIONS } = await import(path.resolve(here, "../src/lib/regions.ts"));

// network-assignment.ts CLASS_FREE_MPH, pinned here: study-map-sim.ts must
// hold the same table, and section 2 compares the two routers directly.
const CLASS_FREE_MPH = [60, 50, 40, 30, 25];
// The extractors' own constant (parseMaxspeedKmh in scripts/src/*.ts writes
// Math.round(mph * 1.60934)). The writer guard in section 4 asks what THEY
// write, so it uses theirs, not the engine's KMH_PER_MPH; the two give the
// same whole km/h for every mph from 1 to 200.
const EXTRACTOR_KMH_PER_MPH = 1.60934;
// What parseMaxspeedKmh writes for 5, 10, ..., 85 mph: 8, 16, 24, ..., 137.
const MPH5_KMH = new Set(Array.from({ length: 17 }, (_, i) => Math.round(5 * (i + 1) * EXTRACTOR_KMH_PER_MPH)));
// network-assignment.ts CLASS_LANES_PER_DIR and PER_LANE_CAP_VPH, pinned for
// section 5.
const CLASS_LANES_PER_DIR = [3, 2, 2, 1, 1];
const PER_LANE_CAP_VPH = 1900;
const mphOf = (lk) => (lk.lenMi / lk.freeMin) * 60;
const lanesOf = (lk) => lk.capVph / PER_LANE_CAP_VPH;
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// A 0.1 mi east-west segment. cls, lanes, maxspeed and oneway are the slots
// under test; name is irrelevant to cost.
const LAT = 40.44, LON = -80.0, DLON = 0.1 / (69.172 * Math.cos((LAT * Math.PI) / 180));
const seg = (cls, lanes, maxspeedKmh, oneway = 0, row = 0) =>
  [cls, LAT + row * 0.01, LON, LAT + row * 0.01, LON + DLON, lanes, maxspeedKmh, "Test St", oneway];

const TAGGED = [[56, 34.8], [89, 55.3], [113, 70.2]]; // stored km/h -> mph (35, 55, 70 mph tags)

// ---------------------------------------------------------------------------
// 1. Engine: buildGraph
// ---------------------------------------------------------------------------
for (const [kmh, mph] of TAGGED) {
  const lk = buildGraph([seg(2, null, kmh)]).links[0];
  ok(lk && near(mphOf(lk), mph), `buildGraph: stored ${kmh} km/h routes at ${mph} mph (got ${lk ? mphOf(lk).toFixed(2) : "no link"})`);
}
for (let cls = 0; cls <= 4; cls++) {
  const variants = [["null", seg(cls, null, null)], ["0", seg(cls, null, 0)], ["absent", seg(cls, null, null).slice(0, 6)]];
  for (const [label, s] of variants) {
    const lk = buildGraph([s]).links[0];
    ok(lk && near(mphOf(lk), CLASS_FREE_MPH[cls], 1e-9),
      `buildGraph: class ${cls} with maxspeed ${label} takes the class default ${CLASS_FREE_MPH[cls]} mph (got ${lk ? mphOf(lk).toFixed(2) : "no link"})`);
  }
}

// ---------------------------------------------------------------------------
// 2. Live study map: buildRoadGraph, and parity with the engine
// ---------------------------------------------------------------------------
for (const [kmh, mph] of TAGGED) {
  const lk = buildRoadGraph([seg(2, null, kmh)]).links[0];
  ok(lk && near(mphOf(lk), mph), `buildRoadGraph: stored ${kmh} km/h routes at ${mph} mph (got ${lk ? mphOf(lk).toFixed(2) : "no link"})`);
}
{
  // Every class, tagged and untagged, one-way and two-way, on its own row.
  const mixed = [];
  for (let cls = 0; cls <= 6; cls++) {
    for (const kmh of [null, 0, 40, 56, 89, 113]) mixed.push(seg(cls, null, kmh, cls % 3 === 0 ? 1 : 0, mixed.length));
  }
  const eng = buildGraph(mixed).links, map = buildRoadGraph(mixed).links;
  const worst = eng.reduce((w, lk, i) => Math.max(w, Math.abs(lk.freeMin - (map[i]?.freeMin ?? Infinity)) / lk.freeMin), 0);
  ok(eng.length === mixed.length && map.length === mixed.length && worst < 1e-12,
    `engine and map charge the same free-flow time on all ${mixed.length} links (worst relative gap ${worst.toExponential(1)})`);
}

// ---------------------------------------------------------------------------
// 3. A real way, file -> roadSegmentsNear -> /api/roads -> fetchLocalRoads -> routers
// ---------------------------------------------------------------------------
const fileCache = new Map();
const readRoadFile = (p) => {
  if (!fileCache.has(p)) fileCache.set(p, readJsonMaybeGz(p));
  return fileCache.get(p);
};
{
  const pitPath = findDataFile("pittsburgh-roads.json");
  const pit = pitPath ? readRoadFile(pitPath) : null;
  // Named ways: [cls, name, polyline, lanes, maxspeed, oneway]. The first
  // one-way motorway carriageway with 3+ lanes and a 55+ mph tag.
  const way = pit?.ways.find((w) => w[0] === 0 && typeof w[1] === "string" && Array.isArray(w[2]) && w[2].length >= 2
    && (w[5] === 1 || w[5] === -1) && typeof w[3] === "number" && w[3] >= 3 && MPH5_KMH.has(w[4]) && w[4] >= 89);
  ok(!!way, way
    ? `pittsburgh road file holds a one-way motorway carriageway to probe: ${way[1]}, ${way[3]} lanes, stored at ${way[4]} (${Math.round(way[4] / EXTRACTOR_KMH_PER_MPH)} mph)`
    : "pittsburgh road file holds no one-way class-0 way with 3+ lanes and a 55+ mph tag to probe (was it refetched without lanes, oneway or maxspeed?)");
  if (way) {
    const [name, lanes, kmh, oneway] = [way[1], way[3], way[4], way[5]];
    const mph = kmh / KMH_PER_MPH;
    const [a, b] = way[2];
    const analyzer = `${process.env["ANALYZER_API_URL"] ?? "http://localhost:8080"}/api/roads`;
    const { responder, calls } = stubUpstreams({ analyzer });
    // What the analyzer's GET /api/roads route does (api-server routes/atlanta.ts).
    responder.analyzer = (url) => {
      const q = new URL(url).searchParams;
      const segments = roadSegmentsNear(q.get("regionCode"), Number(q.get("lat")), Number(q.get("lon")), Number(q.get("radiusMi")));
      return json(segments ? { available: true, segments } : { available: false, segments: [] });
    };
    const served = await fetchLocalRoads("pittsburgh_metro", (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.1);
    ok(calls.analyzer === 1 && Array.isArray(served) && served.length > 0,
      `fetchLocalRoads got the segments around it from the stubbed analyzer (${served?.length ?? 0} segments)`);
    const s = (served ?? []).find((x) => x[1] === a[0] && x[2] === a[1] && x[3] === b[0] && x[4] === b[1]);
    ok(!!s && s[6] === kmh && s[7] === name && s[8] === oneway,
      `the carriageway is served as stored: maxspeed ${kmh} (km/h, unconverted), one-way (got ${s ? JSON.stringify([s[5], s[6], s[7], s[8]]) : "no segment"})`);
    const linkOf = (g) => g.links.find((lk) => g.nodeLat[lk.a] === a[0] && g.nodeLon[lk.a] === a[1] && g.nodeLat[lk.b] === b[0] && g.nodeLon[lk.b] === b[1]);
    const eng = linkOf(buildGraph(served ?? []));
    ok(eng && near(mphOf(eng), mph), `buildGraph routes the carriageway at ${mph.toFixed(1)} mph (got ${eng ? mphOf(eng).toFixed(2) : "no link"})`);
    ok(eng && lanesOf(eng) === lanes, `buildGraph gives the one-way carriageway its ${lanes} lanes (got ${eng ? lanesOf(eng) : "no link"})`);
    const map = linkOf(buildRoadGraph(served ?? []));
    ok(map && near(mphOf(map), mph), `buildRoadGraph routes the carriageway at ${mph.toFixed(1)} mph (got ${map ? mphOf(map).toFixed(2) : "no link"})`);
  }
}

// ---------------------------------------------------------------------------
// 4. Writer side: every US and UK road file stores km/h
// ---------------------------------------------------------------------------
{
  const MIN_SHARE = 0.9;
  // Below this many tagged ways a share is too noisy to judge; no US or UK
  // file is near it today (the smallest holds ~240).
  const MIN_TAGGED = 100;

  const files = new Map(); // served path -> region code
  for (const r of Object.values(REGIONS)) {
    const country = r.country ?? "US";
    if (country !== "US" && country !== "UK") continue;
    const p = findDataFile(`${regionCodeToSlug(r.code)}-roads.json`);
    if (p && !files.has(p)) files.set(p, r.code);
  }

  let checked = 0, untagged = 0, small = 0, worst = { share: 1, file: "" }, bestRaw = { share: 0, file: "" };
  for (const [p, code] of files) {
    const road = readRoadFile(p);
    fileCache.delete(p); // statewide files parse to hundreds of MB; hold one at a time
    let tagged = 0, conv = 0, rawConv = 0;
    for (const w of road.ways) {
      // Same slot rule as roadSegmentsNear: maxspeed follows lanes, after the polyline.
      const ms = Array.isArray(w[1]) ? w[3] : w[4];
      if (typeof ms !== "number" || !(ms > 0)) continue;
      tagged++;
      if (MPH5_KMH.has(ms)) conv++;
      // The same way as an extractor that stored raw mph would have written it.
      if (MPH5_KMH.has(Math.round(ms / EXTRACTOR_KMH_PER_MPH))) rawConv++;
    }
    const file = path.basename(p);
    if (tagged === 0) { untagged++; continue; }
    if (tagged < MIN_TAGGED) { small++; continue; }
    checked++;
    const share = conv / tagged, rawShare = rawConv / tagged;
    if (share < worst.share) worst = { share, file };
    if (rawShare > bestRaw.share) bestRaw = { share: rawShare, file };
    if (share < MIN_SHARE) ok(false, `${file} (${code}): only ${(share * 100).toFixed(1)}% of ${tagged} tagged maxspeeds are km/h conversions of a 5 mph step`);
    if (rawShare >= MIN_SHARE) ok(false, `${file} (${code}): rewritten as raw mph it would still pass (${(rawShare * 100).toFixed(1)}%), so the guard cannot see the unit here`);
  }
  ok(checked >= 100 && [...files.values()].includes("london_metro"),
    `${checked} US and UK road files checked, London included (${untagged} carry no maxspeed, ${small} under ${MIN_TAGGED} tagged)`);
  ok(worst.share >= MIN_SHARE, `every checked file stores km/h: lowest conversion share ${(worst.share * 100).toFixed(1)}% (${worst.file})`);
  ok(bestRaw.share < MIN_SHARE, `the guard would catch raw mph in every file: highest raw-mph share ${(bestRaw.share * 100).toFixed(1)}% (${bestRaw.file})`);
}

// ---------------------------------------------------------------------------
// 5. Lanes per direction: one-way as tagged, two-way halved
// ---------------------------------------------------------------------------
{
  const LANE_CASES = [
    // [label, lanes, oneway, expected lanes per direction]
    ["one-way (a->b) 3 lanes", 3, 1, 3],
    ["one-way (b->a) 3 lanes", 3, -1, 3],
    ["one-way 2 lanes", 2, 1, 2],
    ["one-way 1 lane", 1, 1, 1],
    ["two-way 4 lanes", 4, 0, 2],
    ["two-way 2 lanes", 2, 0, 1],
    ["two-way 1 lane", 1, 0, 1],
  ];
  for (const [label, lanes, oneway, want] of LANE_CASES) {
    const lk = buildGraph([seg(2, lanes, null, oneway)]).links[0];
    ok(lk && lanesOf(lk) === want, `buildGraph: ${label} -> ${want} per direction (got ${lk ? lanesOf(lk) : "no link"})`);
  }
  // An absent oneway slot is two-way, the pre-oneway road files' behaviour.
  {
    const lk = buildGraph([seg(2, 4, null).slice(0, 8)]).links[0];
    ok(lk && lanesOf(lk) === 2, `buildGraph: 4 lanes with oneway absent -> 2 per direction (got ${lk ? lanesOf(lk) : "no link"})`);
  }
  for (let cls = 0; cls <= 4; cls++) {
    for (const oneway of [0, 1]) {
      const variants = [["null", seg(cls, null, null, oneway)], ["0", seg(cls, 0, null, oneway)]];
      for (const [label, s] of variants) {
        const lk = buildGraph([s]).links[0];
        ok(lk && lanesOf(lk) === CLASS_LANES_PER_DIR[cls],
          `buildGraph: class ${cls} ${oneway ? "one-way" : "two-way"} with lanes ${label} takes the class default ${CLASS_LANES_PER_DIR[cls]} (got ${lk ? lanesOf(lk) : "no link"})`);
      }
    }
    const lk = buildGraph([seg(cls, null, null).slice(0, 5)]).links[0];
    ok(lk && lanesOf(lk) === CLASS_LANES_PER_DIR[cls],
      `buildGraph: class ${cls} with lanes absent takes the class default ${CLASS_LANES_PER_DIR[cls]} (got ${lk ? lanesOf(lk) : "no link"})`);
  }
}

console.log(fails === 0 ? "\ncheck:road-units passed" : `\n${fails} check(s) FAILED`);
process.exit(fails === 0 ? 0 : 1);
