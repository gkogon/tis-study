// The NY and London lookup caches hold ANSWERS, never outages, and stay bounded.
//
// nysdot-data.ts (posted speed per intersection, county crash summary),
// tfl-ptal.ts (London PTAL band) and nyc-transit-data.ts (subway stations,
// bike counters) each kept a module-level Map with no expiry and no size cap,
// and stored null for a TRANSIENT failure (a 503, a timeout, a network error)
// exactly as for a real "nothing here". One blip and every later study at that
// coordinate silently printed the fallback — the "Speed study required"
// placeholder, the flat london_metro auto share, an empty subway list — until
// the process restarted.
//
// Contract, for each of the five caches:
//  1. A TRANSIENT FAILURE IS NOT CACHED. A non-OK status, a timeout (the
//     module's own abort timer firing against an upstream that never answers),
//     a network error, and a 200 that is not a result set (an ArcGIS `error`
//     body, a non-array SODA body) all return the usual fallback, the NEXT
//     call asks the upstream again, and a later success is served — and then
//     cached.
//  2. A DEFINITIVE ANSWER IS CACHED. A result set with nothing in it (no RDM
//     segment within the buffer, no crash rows for the county, no PTAL cell,
//     no station or counter within the radius) is data: the next call is
//     served from memory.
//  3. BOUNDED. Each cache holds at most its exported MAX_ENTRIES (a miss over
//     the cap evicts the least recently USED entry — a hit refreshes recency),
//     and past its TTL every entry is deleted, not merely skipped; a hit does
//     not extend the TTL.
//
// Every upstream is answered in-process by a stubbed globalThis.fetch; nothing
// leaves the machine.
//
// Run: pnpm run check:lookup-caches
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { stubUpstreams, json, never, withTimeoutsDueNow, checkBounded } from "./lib/fetch-stub.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

process.env.LOG_LEVEL ??= "error"; // tfl-ptal warns on every failure, and this check injects dozens

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const { responder, calls } = stubUpstreams({
  rdm: "https://gis.dot.ny.gov/hostingny/rest/services/Roadways/RDM_Roadway_Current/FeatureServer/0/query",
  crash: "https://data.ny.gov/resource/e8ky-4vqe.json",
  ptal: "https://services1.arcgis.com/YswvgzOodUvqkoCN/arcgis/rest/services/PTAL_2023_Grid_100m_100m/FeatureServer/33/query",
  subway: "https://data.ny.gov/resource/39hk-dx4f.json",
  bike: "https://data.cityofnewyork.us/resource/smn3-rzf9.json",
});

const nysdot = await import(path.resolve(here, "../src/lib/nysdot-data.ts"));
const ptal = await import(path.resolve(here, "../src/lib/tfl-ptal.ts"));
const nyc = await import(path.resolve(here, "../src/lib/nyc-transit-data.ts"));

/** Key i -> a coordinate distinct from every other i. Steps of 0.001° are ten
 *  times coarser than the caches' 4-decimal key, so no two ever collide. */
const grid = (lat0, lon0) => (i) => ({ lat: lat0 + Math.floor(i / 100) * 0.001, lon: lon0 + (i % 100) * 0.001 });

/** An ArcGIS server fault: HTTP 200 with an `error` body and no feature set. */
const ARCGIS_FAULT = { error: { code: 500, message: "Unable to complete operation.", details: [] } };
/** A 200 whose body is not the JSON array SODA returns for every query. */
const SODA_NOT_ROWS = { error: true, message: "not a result set" };

const CACHES = [
  {
    name: "NYSDOT posted speed",
    upstream: "rdm",
    max: nysdot.NY_ROADWAY_CACHE_MAX_ENTRIES,
    ttl: nysdot.NY_LOOKUP_CACHE_TTL_MS,
    size: () => nysdot.nyLookupCacheSizes?.()?.roadway,
    key: grid(42.0, -75.0),
    async lookup({ lat, lon }) {
      const it = { latitude: lat, longitude: lon };
      await nysdot.enrichNyIntersectionsWithSpeed([it]);
      return it;
    },
    found: (it) => it.nysdotPostedSpeedMph === 35 && it.nysdotRoadwayName === "TEST RD",
    fallback: (it) => !("nysdotPostedSpeedMph" in it),
    success: () => ({ features: [{ attributes: { Posted_Speed_Limit_MPH: 35, Roadway_Name: "TEST RD", County_Name: "ALBANY" } }] }),
    empty: () => ({ features: [] }),
    notAnAnswer: ARCGIS_FAULT,
  },
  {
    name: "NY county crash summary",
    upstream: "crash",
    max: nysdot.NY_CRASH_CACHE_MAX_ENTRIES,
    ttl: nysdot.NY_LOOKUP_CACHE_TTL_MS,
    size: () => nysdot.nyLookupCacheSizes?.()?.crash,
    key: (i) => ({ county: `TEST COUNTY ${i}` }),
    lookup: ({ county }) => nysdot.getNyCountyCrashSummary(county),
    found: (s) => s?.totalAccidents === 43 && s?.fatalAccidents === 3,
    fallback: (s) => s === null,
    success: () => [{ accident_descriptor: "Fatal Accident", cnt: "3" }, { accident_descriptor: "Injury Accident", cnt: "40" }],
    empty: () => [],
    notAnAnswer: SODA_NOT_ROWS,
  },
  {
    name: "TfL PTAL band",
    upstream: "ptal",
    max: ptal.PTAL_CACHE_MAX_ENTRIES,
    ttl: ptal.PTAL_CACHE_TTL_MS,
    size: () => ptal.ptalCacheSize?.(),
    key: grid(51.3, -0.2), // inside the Greater London bbox the lookup pre-checks
    lookup: ({ lat, lon }) => ptal.lookupLondonPtal(lat, lon),
    found: (r) => r?.band === "6a" && r?.ai === 42.5,
    fallback: (r) => r === null,
    success: () => ({ features: [{ attributes: { PTAL_2023: "6a", AI: 42.5 } }] }),
    empty: () => ({ features: [] }),
    notAnAnswer: ARCGIS_FAULT,
  },
  {
    name: "NYC subway stations",
    upstream: "subway",
    max: nyc.NYC_TRANSIT_CACHE_MAX_ENTRIES,
    ttl: nyc.NYC_TRANSIT_CACHE_TTL_MS,
    size: () => nyc.nycTransitCacheSizes?.()?.stations,
    key: grid(40.7, -74.0),
    lookup: ({ lat, lon }) => nyc.getNycSubwayContext(lat, lon, 0.5),
    found: (ctx) => ctx.stations.length === 1 && ctx.stations[0].name === "Test St" && ctx.routesAvailable.join() === "A,C,E",
    fallback: (ctx) => ctx.stations.length === 0 && ctx.routesAvailable.length === 0 && ctx.radiusMi === 0.5,
    // The station sits on the site, so it is inside any radius.
    success: ({ lat, lon }) => [{ stop_name: "Test St", gtfs_latitude: String(lat), gtfs_longitude: String(lon), daytime_routes: "A C E", division: "IND", borough: "M" }],
    empty: () => [],
    notAnAnswer: SODA_NOT_ROWS,
  },
  {
    name: "NYC bike counters",
    upstream: "bike",
    max: nyc.NYC_TRANSIT_CACHE_MAX_ENTRIES,
    ttl: nyc.NYC_TRANSIT_CACHE_TTL_MS,
    size: () => nyc.nycTransitCacheSizes?.()?.bike,
    key: grid(40.7, -74.0),
    lookup: ({ lat, lon }) => nyc.getNycBikeContext(lat, lon, 1),
    found: (ctx) => ctx.nearest?.name === "Test Counter" && ctx.countWithin === 1,
    fallback: (ctx) => ctx.nearest === null && ctx.countWithin === 0 && ctx.radiusMi === 1,
    success: ({ lat, lon }) => [{ name: "Test Counter", latitude: String(lat), longitude: String(lon), domain: "NYC DOT" }],
    // The whole (tiny) counter network comes back on every query; "none within
    // the radius" is a counter far away.
    empty: () => [{ name: "Far Counter", latitude: "40.0", longitude: "-73.0", domain: "NYC DOT" }],
    notAnAnswer: SODA_NOT_ROWS,
  },
];

/** Each transient failure, as a responder over (cache, url, init). */
const FAILURES = [
  { kind: "an HTTP 503", respond: () => new Response("Service Unavailable", { status: 503 }) },
  { kind: "a timeout", respond: (_c, url, init) => never(url, init), timeout: true },
  { kind: "a network error", respond: () => Promise.reject(new TypeError("fetch failed")) },
  { kind: "a 200 that is not a result set", respond: (c) => json(c.notAnAnswer) },
];

for (const c of CACHES) {
  console.log(`\n── ${c.name} (${c.upstream}) ──`);
  let next = 0;
  const fresh = () => c.key(next++);
  const n = () => calls[c.upstream];
  /** Look key up with the upstream answering `respond`; returns [value, requests made]. */
  const lookupWith = async (key, respond) => {
    responder[c.upstream] = respond;
    const before = n();
    const value = await c.lookup(key);
    return [value, n() - before];
  };
  const succeed = (key) => () => json(c.success(key));

  // 1. Transient failures are not cached.
  for (const { kind, respond, timeout } of FAILURES) {
    const key = fresh();
    const failing = () => lookupWith(key, (url, init) => respond(c, url, init));
    const [failed, asked] = await (timeout ? withTimeoutsDueNow(failing) : failing());
    ok(asked === 1 && c.fallback(failed), `${kind}: the lookup falls back`);
    const [retried, askedAgain] = await lookupWith(key, succeed(key));
    ok(askedAgain === 1 && c.found(retried), `${kind}: the next call asks the upstream again and serves its success`);
    const [cached, askedThird] = await lookupWith(key, () => { throw new Error("served from memory — never asked"); });
    ok(askedThird === 0 && c.found(cached), `${kind}: …and that success is then served from memory`);
  }

  // 2. A definitive empty answer is cached.
  {
    const key = fresh();
    const [first, asked] = await lookupWith(key, () => json(c.empty(key)));
    ok(asked === 1 && c.fallback(first), "a definitive empty answer returns the fallback");
    const [again, askedAgain] = await lookupWith(key, succeed(key));
    ok(askedAgain === 0 && c.fallback(again), "…and is served from memory on the next call (it is data, not an outage)");
  }

  // 3. Bounded: entry cap with LRU eviction, TTL expiry that frees memory.
  await checkBounded(ok, {
    max: c.max,
    ttl: c.ttl,
    size: c.size,
    fresh,
    lookup: async (key) => (await lookupWith(key, succeed(key)))[1],
  });
}

console.log(fails === 0 ? "\nAll lookup-cache checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
