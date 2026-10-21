// A failed NYC transit lookup is disclosed, never read as "no subway".
//
// nyc-transit-data.ts returned the same empty context for a definitive "no
// station within the radius" and for a FAILED lookup (non-OK HTTP, a body that
// is not a row array, a timeout, a network error). pdf-export.ts stashes it as
// result.nyTransitContext, and pdf-export-ny.ts read the empty list as a
// finding: §1.4 printed "No MTA subway station within 0.50 mi of the site", and
// the CEQR Ch 16 screen took 0 routes to mean the Outer-Borough non-TOD split —
// 55% vehicle instead of 25% for a Manhattan CBD site — and screened the
// transit and pedestrian thresholds on it. A render during a data.ny.gov outage
// printed the wrong split with nothing saying the lookup had failed.
//
// Contract:
//  1. DATA. A failed subway or bike lookup comes back flagged
//     `lookupFailed: true`, and is still never cached: the next call asks
//     again, and its answer carries no flag. A definitive answer (stations or
//     counters, or none within the radius) carries no flag.
//  2. RENDER, lookups failed (a Manhattan site through renderStudyPdf with the
//     upstreams down): §1.4 and CEQR §A.1 say subway access could not be
//     retrieved and the modal split is not inferred; §A.2 reports the transit
//     and pedestrian screens as not screened; §A.3 draws no conclusion for
//     them; nothing prints the non-TOD split, "No MTA subway station" or "No
//     NYC DOT automated bicycle counter". With the vehicle screen below its
//     threshold, §A.3 does not declare "no significant adverse impact".
//  3. RENDER, lookups answered: stations with 5+ routes give the Manhattan CBD
//     split and no disclosure; a definitive "no station" still gives the
//     non-TOD split and §1.4's "No MTA subway station" (that IS a finding).
//
// Every upstream is answered in-process by a stubbed globalThis.fetch; the
// ones this check does not script (NYSDOT, crash data, Street View) fail, and
// their renderers fall back as they always do.
//
// Run: pnpm run check:nyc-transit-disclosure
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { stubUpstreams, json, never, withTimeoutsDueNow } from "./lib/fetch-stub.mjs";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pageTexts } from "./lib/pdf-text.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

process.env.LOG_LEVEL ??= "error";

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const { responder, calls } = stubUpstreams({
  subway: "https://data.ny.gov/resource/39hk-dx4f.json",
  bike: "https://data.cityofnewyork.us/resource/smn3-rzf9.json",
});

const unavailable = () => new Response("Service Unavailable", { status: 503 });
/** Two Midtown stations on the site itself, five daytime routes between them. */
const midtownStations = ({ lat, lon }) => [
  { stop_name: "42 St-Bryant Pk", gtfs_latitude: String(lat), gtfs_longitude: String(lon), daytime_routes: "B D F M", division: "IND", borough: "M" },
  { stop_name: "5 Av", gtfs_latitude: String(lat), gtfs_longitude: String(lon), daytime_routes: "7", division: "IRT", borough: "M" },
];
const counterAt = ({ lat, lon }) => [{ name: "Test Counter", latitude: String(lat), longitude: String(lon), domain: "NYC DOT" }];

// ---------------------------------------------------------------------------
// 1. Data: a failed lookup is flagged, an answer is not.
// ---------------------------------------------------------------------------
console.log("\n── Data: nyc-transit-data.ts ──");
{
  const nyc = await import(path.resolve(here, "../src/lib/nyc-transit-data.ts"));
  let n = 0;
  const fresh = () => ({ lat: 40.7 + n++ * 0.001, lon: -73.99 });
  const FAILURES = [
    ["an HTTP 503", unavailable],
    ["a body that is not a row array", () => json({ error: true, message: "not a result set" })],
    ["a timeout", never, true],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
  ];
  const LOOKUPS = [
    {
      name: "subway",
      call: (s) => nyc.getNycSubwayContext(s.lat, s.lon, 0.5),
      answer: midtownStations,
      none: () => [],
      found: (ctx) => ctx.stations.length === 2,
    },
    {
      name: "bike",
      call: (s) => nyc.getNycBikeContext(s.lat, s.lon, 1),
      answer: counterAt,
      // The whole counter network comes back on every query; none within the radius.
      none: () => [{ name: "Far Counter", latitude: "40.0", longitude: "-73.0", domain: "NYC DOT" }],
      found: (ctx) => ctx.nearest !== null,
    },
  ];
  for (const l of LOOKUPS) {
    for (const [kind, respond, timeout] of FAILURES) {
      const s = fresh();
      responder[l.name] = respond;
      const failed = await (timeout ? withTimeoutsDueNow(() => l.call(s)) : l.call(s));
      ok(failed.lookupFailed === true && !l.found(failed), `${l.name}, ${kind}: the context comes back flagged lookupFailed`);
      responder[l.name] = () => json(l.answer(s));
      const before = calls[l.name];
      const answered = await l.call(s);
      ok(calls[l.name] === before + 1 && l.found(answered) && !("lookupFailed" in answered),
        `${l.name}, ${kind}: not cached — the next call asks again, and its answer carries no flag`);
    }
    const s = fresh();
    responder[l.name] = () => json(l.none(s));
    const none = await l.call(s);
    ok(!("lookupFailed" in none) && !l.found(none), `${l.name}: a definitive "none within the radius" carries no flag`);
  }
}

// ---------------------------------------------------------------------------
// 2–3. Render: the NY preview fixture moved onto a Midtown site through the
//      real renderStudyPdf, one site per scenario (answers are cached per site).
// ---------------------------------------------------------------------------
console.log("\n── Render: Midtown Manhattan site through renderStudyPdf ──");
const { mod, cleanup } = await loadRendererBundle();
try {
  const base = loadFixture("ny"); // Nassau County: outside NYC, so relocated below
  const LON = -73.9832; // Bryant Park, inside the CBDTP cordon: §1.4 (inNyc) and the CEQR overlay both render
  /** The fixture on a Midtown site. The NY pre-compute reads project.siteLat /
   *  siteLon; the renderers read result.request. Both move. */
  const midtown = (lat, tripGeneration) => {
    const fx = structuredClone(base);
    fx.report.request = { ...fx.report.request, latitude: lat, longitude: LON };
    if (tripGeneration) fx.report.tripGeneration = { ...fx.report.tripGeneration, ...tripGeneration };
    return { ...projectFromFixture(fx), siteLat: String(lat), siteLon: String(LON) };
  };
  const render = async (project) =>
    (await pageTexts(await mod.renderStudyPdf(project, { name: "Transit Disclosure Check", logoUrl: null }))).join(" ");
  const UNSCREENED = /Transit riders \(subway \+ bus\) Not inferred 200 Not screened Pedestrians Not inferred 200 Not screened/;

  // 2. The subway lookup fails while the bike lookup answers — the case that
  //    printed "No MTA subway station" in §1.4. The fixture's 680 peak-hour
  //    vehicle trips cross the vehicle screen.
  {
    const s = { lat: 40.7536, lon: LON };
    responder.subway = unavailable;
    responder.bike = () => json(counterAt(s));
    const t = await render(midtown(s.lat));
    ok(/Subway access could not be retrieved/i.test(t), "subway lookup failed: the report says subway access could not be retrieved");
    ok(t.includes("modal split is not inferred"), "§A.1: the modal split is not inferred");
    ok(UNSCREENED.test(t), "§A.2: the transit and pedestrian screens are reported as not screened");
    ok(t.includes("vehicle threshold(s) crossed") && t.includes("transit and pedestrian screens were not evaluated"),
      "§A.3: the vehicle screen is concluded, the transit and pedestrian screens are left open");
    ok(!t.includes("non-TOD"), "the Outer-Borough non-TOD split is not printed");
    ok(!t.includes("No MTA subway station within"), "§1.4 does not claim there is no subway station");
    ok(t.includes("Nearest NYC DOT bicycle counter: Test Counter"), "§1.4 still reports the bike counter that did answer");
  }

  // 2b. Both lookups fail and the vehicle screen is below its threshold. §1.4
  //     used to vanish silently here; §A.3 must not declare "no significant
  //     adverse impact" while two screens are open.
  {
    responder.subway = unavailable;
    responder.bike = unavailable;
    const t = await render(midtown(40.7546, { amPeakTrips: 20, pmIn: 10, pmOut: 10 }));
    ok(/Subway access could not be retrieved/i.test(t) && /bicycle counter data could not be retrieved/i.test(t),
      "both lookups failed: §1.4 discloses both instead of disappearing");
    ok(t.includes("vehicle trip-end estimate falls below") && t.includes("transit and pedestrian screens were not evaluated"),
      "vehicle below its threshold: §A.3 says so and leaves the transit and pedestrian screens open");
    ok(!t.includes("no significant adverse impact"), "…and does not conclude no significant adverse impact");
  }

  // 2c. The bike lookup fails while the subway lookup answers — the case that
  //     printed "No NYC DOT automated bicycle counter" in §1.4.
  {
    const s = { lat: 40.7556, lon: LON };
    responder.subway = () => json(midtownStations(s));
    responder.bike = unavailable;
    const t = await render(midtown(s.lat));
    ok(/bicycle counter data could not be retrieved/i.test(t), "bike lookup failed: §1.4 says so");
    ok(!t.includes("No NYC DOT automated bicycle counter within"), "§1.4 does not claim there is no bicycle counter");
    ok(t.includes("Manhattan-CBD-typical") && !/Subway access could not be retrieved/i.test(t),
      "the subway answer still drives the Manhattan CBD split, with no subway disclosure");
  }

  // 3. Both lookups answer: Midtown stations with 5 routes, a counter on site.
  {
    const s = { lat: 40.7566, lon: LON };
    responder.subway = () => json(midtownStations(s));
    responder.bike = () => json(counterAt(s));
    const t = await render(midtown(s.lat));
    ok(t.includes("Manhattan-CBD-typical"), "stations with 5 routes give the Manhattan CBD split");
    ok(!/could not be retrieved/i.test(t) && !UNSCREENED.test(t), "…with no disclosure and every screen evaluated");
  }

  // 3b. A definitive "no station within 0.5 mi" is a finding, not a failure.
  {
    const s = { lat: 40.7576, lon: LON };
    responder.subway = () => json([]);
    responder.bike = () => json(counterAt(s));
    const t = await render(midtown(s.lat));
    ok(t.includes("Outer-Borough non-TOD"), "a definitive \"no station\" still gives the non-TOD split");
    ok(t.includes("No MTA subway station within 0.50 mi"), "§1.4 reports the definitive none");
    ok(!/could not be retrieved/i.test(t), "…with no disclosure");
  }
} finally {
  await cleanup();
}

console.log(fails === 0 ? "\nAll NYC transit disclosure checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
