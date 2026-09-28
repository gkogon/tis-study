// A changed analyzer inventory is picked up after the cache window — no restart.
//
// Incident 2026-09-25 (#233 widened the Pittsburgh box and added 724 signals):
// web finished deploying before the analyzer, a Butler, PA study fetched the
// analyzer's OLD Pittsburgh inventory, and tis.ts cached it for the life of
// the process. After the analyzer finished deploying, web kept printing a thin
// 2-intersection Butler study until it was restarted. The cache had no expiry,
// so ANY change to analyzer data could fail to take effect in production.
//
// Contract (tis.ts fetchIntersections):
//  1. WITHIN THE WINDOW (ANALYZER_INVENTORY_REVALIDATE_MS) a cached region is
//     served from memory — no request.
//  2. AFTER THE WINDOW the next call re-checks with the analyzer, conditionally
//     (If-None-Match: <the cached copy's ETag>), and a changed inventory
//     replaces the cached one.
//  3. UNCHANGED -> 304: no body re-downloaded, the cached array is kept.
//  4. ONE REQUEST PER REGION at a time: concurrent callers share the cold load
//     and the re-check (the inFlightByRegion de-dupe).
//  5. A FAILED RE-CHECK serves the cached copy instead of failing the study and
//     waits a window before asking again; a failed COLD load still throws and
//     is not cached.
//  6. NO ETAG (an analyzer that sends none) still refreshes after the window,
//     with an unconditional GET.
//  7. ATLANTA's legacy URL (/api/atlanta/intersections) follows the same rules.
//  8. END TO END: generateTisReport for a Butler, PA site (pittsburgh_metro)
//     runs on a thin 2-signal inventory, the analyzer "deploys" the full one,
//     and after the window the same study analyzes every signal.
//
// The stand-in analyzer is a real Express app answering with res.json(), so
// its ETag and 304 handling are Express's own — the code path
// artifacts/api-server serves the inventory with (its side of the contract is
// pinned by that package's check:inventory-etag) — and web reaches it through
// Node's real fetch. That matters for 3: fetch() adds "Cache-Control: no-cache"
// to any request carrying If-None-Match unless the caller sets Cache-Control
// itself, and Express never answers 304 to no-cache, so every unchanged
// re-check would silently re-download the whole inventory.
//
// Run: pnpm run check:inventory-revalidation
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const WINDOW_MS = 500;
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.ANALYZER_INVENTORY_REVALIDATE_MS = String(WINDOW_MS);
process.env.LOG_LEVEL ??= "error";

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pastWindow = () => sleep(WINDOW_MS + 150);

// ---------------------------------------------------------------------------
// Stand-in analyzer.
// ---------------------------------------------------------------------------
const { default: express } = await import(path.resolve(here, "../node_modules/express/index.js"));

/** regionCode -> the inventory the analyzer serves right now. */
const served = new Map();
/** regionCode -> HTTP status the analyzer fails with instead. */
const failing = new Map();
/** Regions answered with no ETag at all. */
const noEtag = new Set();
/** Every inventory request, in arrival order. */
const seen = [];

const analyzer = express();
analyzer.get(["/api/intersections", "/api/atlanta/intersections"], (req, res) => {
  const regionCode = req.path === "/api/atlanta/intersections" ? "atlanta_metro" : String(req.query.regionCode);
  const rec = {
    regionCode,
    path: req.path,
    ifNoneMatch: req.get("if-none-match") ?? null,
    cacheControl: req.get("cache-control") ?? null,
    status: 0,
    etag: null,
  };
  seen.push(rec);
  res.on("finish", () => { rec.status = res.statusCode; rec.etag = res.getHeader("etag") ?? null; });
  if (failing.has(regionCode)) { res.status(failing.get(regionCode)).json({ error: "injected failure" }); return; }
  const inventory = served.get(regionCode);
  if (!inventory) { res.status(400).json({ error: `Unknown or unloaded region: ${regionCode}` }); return; }
  // res.end() skips Express's ETag generation; res.json() is what the analyzer does.
  if (noEtag.has(regionCode)) { res.type("json").end(JSON.stringify(inventory)); return; }
  res.json(inventory);
});
// No road network: the study falls back to gravity assignment, which is all 8 needs.
analyzer.get("/api/roads", (_req, res) => { res.json({ available: false, segments: [] }); });

const server = await new Promise((resolve) => { const s = analyzer.listen(0, "127.0.0.1", () => resolve(s)); });
const ANALYZER = `http://127.0.0.1:${server.address().port}`;
process.env.ANALYZER_API_URL = ANALYZER;

// Keep the study offline: only the stand-in analyzer is reachable (transit,
// DOT feeds and the like get a 404, which the engine already tolerates).
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith(ANALYZER) ? realFetch(input, init) : Promise.resolve(new Response("offline", { status: 404 }));
};

// Import AFTER ANALYZER_API_URL and the window are set: tis.ts reads both at load.
const tis = await import(path.resolve(here, "../src/lib/tis.ts"));
const { fetchIntersections, generateTisReport } = tis;

const requestsFor = (regionCode) => seen.filter((r) => r.regionCode === regionCode);
const last = (regionCode) => requestsFor(regionCode).at(-1);
const settle = () => new Promise((resolve) => setImmediate(resolve)); // let 'finish' land

/** n uniquely named signals on a ~220 m grid around (lat, lon): far enough
 *  apart that the same-junction dedup keeps every one. */
function signalGrid(prefix, lat, lon, n) {
  const out = [];
  for (let k = 0; out.length < n; k++) {
    const row = Math.floor(k / 4) - 1.5, col = (k % 4) - 1.5;
    out.push({
      id: `${prefix}-${k + 1}`,
      name: `${prefix} Ave & ${k + 1}th St`,
      zone: "Fixture",
      roadClass: "primary",
      latitude: lat + row * 0.002,
      longitude: lon + col * 0.0026,
      totalVolume: 1500 + 10 * k,
      volumeSource: "road_class_baseline",
    });
  }
  return out;
}

try {
  ok(tis.INVENTORY_REVALIDATE_MS === WINDOW_MS,
    `the cache window is read from ANALYZER_INVENTORY_REVALIDATE_MS (got ${tis.INVENTORY_REVALIDATE_MS})`);
  ok(typeof fetchIntersections === "function", "tis.ts exports fetchIntersections");

  if (typeof fetchIntersections === "function") {
    // -----------------------------------------------------------------------
    // 1–3. Window, change pickup, 304 reuse.
    // -----------------------------------------------------------------------
    const A = "fixture_a_metro";
    served.set(A, signalGrid("a1", 40, -80, 2));
    const cold = await fetchIntersections(A);
    await settle();
    ok(cold.length === 2 && requestsFor(A).length === 1, "cold load fetches the inventory once");
    ok(last(A).ifNoneMatch === null, "the cold load is unconditional");
    const etagV1 = last(A).etag;
    ok(typeof etagV1 === "string" && etagV1.length > 0, `the analyzer tagged it (ETag ${etagV1})`);

    served.set(A, signalGrid("a2", 40, -80, 27));
    const within = await fetchIntersections(A);
    ok(within === cold && requestsFor(A).length === 1,
      "1. within the window: served from memory, no request (the new inventory is not visible yet)");

    await pastWindow();
    const changed = await fetchIntersections(A);
    await settle();
    ok(changed.length === 27, `2. after the window the changed inventory is picked up (${cold.length} -> ${changed.length} signals)`);
    ok(requestsFor(A).length === 2 && last(A).status === 200, "2. exactly one re-check, answered 200 with the new body");
    ok(last(A).ifNoneMatch === etagV1, `2. the re-check is conditional on the cached copy's ETag (If-None-Match ${last(A).ifNoneMatch})`);
    ok(!/no-cache/i.test(last(A).cacheControl ?? ""),
      `2. the re-check does not carry Cache-Control: no-cache (got ${last(A).cacheControl}), which would forbid a 304`);

    await pastWindow();
    const unchanged = await fetchIntersections(A);
    await settle();
    ok(requestsFor(A).length === 3 && last(A).status === 304,
      `3. unchanged after the window: one re-check, answered 304 (got ${last(A).status})`);
    ok(unchanged === changed, "3. a 304 keeps the cached array (nothing re-downloaded or re-parsed)");

    // -----------------------------------------------------------------------
    // 4. In-flight de-dupe, for the cold load and for the re-check.
    // -----------------------------------------------------------------------
    const B = "fixture_b_metro";
    served.set(B, signalGrid("b1", 41, -81, 3));
    const coldBurst = await Promise.all(Array.from({ length: 5 }, () => fetchIntersections(B)));
    ok(requestsFor(B).length === 1 && coldBurst.every((inv) => inv === coldBurst[0]),
      `4. five concurrent cold callers share one request (${requestsFor(B).length} made)`);
    served.set(B, signalGrid("b2", 41, -81, 5));
    await pastWindow();
    const recheckBurst = await Promise.all(Array.from({ length: 5 }, () => fetchIntersections(B)));
    ok(requestsFor(B).length === 2 && recheckBurst.every((inv) => inv === recheckBurst[0] && inv.length === 5),
      `4. five concurrent callers after the window share one re-check and all get the new inventory (${requestsFor(B).length - 1} re-check(s))`);

    // -----------------------------------------------------------------------
    // 5. Failures.
    // -----------------------------------------------------------------------
    served.set(A, signalGrid("a3", 40, -80, 30));
    failing.set(A, 503);
    await pastWindow();
    let staleServed = null, staleErr = null;
    try { staleServed = await fetchIntersections(A); } catch (e) { staleErr = e; }
    await settle();
    ok(staleErr === null && staleServed === unchanged,
      `5. a failed re-check (503) serves the cached copy instead of failing the study${staleErr ? ` — threw: ${staleErr.message}` : ""}`);
    ok(last(A).status === 503 && requestsFor(A).length === 4, "5. the analyzer was asked once and failed");
    const afterFailure = await fetchIntersections(A);
    ok(afterFailure === unchanged && requestsFor(A).length === 4,
      "5. right after a failed re-check: cached copy, no immediate retry (backs off for a window)");
    failing.delete(A);
    await pastWindow();
    const beforeRecovery = requestsFor(A).length;
    const recovered = await fetchIntersections(A);
    ok(recovered.length === 30 && requestsFor(A).length === beforeRecovery + 1,
      `5. once the analyzer recovers, the next re-check picks up the change (${recovered.length} signals)`);

    const C = "fixture_c_metro";
    failing.set(C, 503);
    let coldErr = null;
    try { await fetchIntersections(C); } catch (e) { coldErr = e; }
    ok(coldErr !== null && /503/.test(coldErr.message),
      `5. a failed cold load still throws (${coldErr ? coldErr.message : "resolved"})`);
    failing.delete(C);
    served.set(C, signalGrid("c1", 42, -82, 4));
    let retried = null;
    try { retried = await fetchIntersections(C); } catch { /* reported below */ }
    ok(retried?.length === 4 && requestsFor(C).length === 2,
      "5. a failed cold load is not cached: the next call fetches again");

    // -----------------------------------------------------------------------
    // 6. No ETag.
    // -----------------------------------------------------------------------
    const D = "fixture_d_metro";
    noEtag.add(D);
    served.set(D, signalGrid("d1", 43, -83, 2));
    const dCold = await fetchIntersections(D);
    await settle();
    ok(dCold.length === 2 && last(D).etag === null, "6. an inventory served without an ETag is cached");
    served.set(D, signalGrid("d2", 43, -83, 6));
    await pastWindow();
    const dFresh = await fetchIntersections(D);
    ok(dFresh.length === 6 && requestsFor(D).length === 2 && last(D).ifNoneMatch === null,
      "6. without an ETag the re-check is an unconditional GET and still picks up the change");

    // -----------------------------------------------------------------------
    // 7. Atlanta's legacy endpoint.
    // -----------------------------------------------------------------------
    const ATL = "atlanta_metro";
    served.set(ATL, signalGrid("atl1", 33.75, -84.39, 3));
    const atlCold = await fetchIntersections(ATL);
    await settle();
    ok(atlCold.length === 3 && last(ATL).path === "/api/atlanta/intersections", "7. atlanta_metro loads from /api/atlanta/intersections");
    const atlEtag = last(ATL).etag;
    served.set(ATL, signalGrid("atl2", 33.75, -84.39, 8));
    await pastWindow();
    const atlFresh = await fetchIntersections(ATL);
    ok(atlFresh.length === 8 && last(ATL).ifNoneMatch === atlEtag,
      "7. and re-checks the same way after the window");
  }

  // -------------------------------------------------------------------------
  // 8. End to end: the Butler study grows once the analyzer has the new data.
  // -------------------------------------------------------------------------
  const BUTLER = { lat: 40.8612, lon: -79.8953 };
  const PGH = "pittsburgh_metro";
  served.set(PGH, signalGrid("butler", BUTLER.lat, BUTLER.lon, 2));
  const studyReq = {
    projectName: "Inventory revalidation", address: "Butler, PA",
    latitude: BUTLER.lat, longitude: BUTLER.lon,
    landUseCode: "820", size: 60, openingYear: 2027, studyRadiusMi: 0.5,
    analysisPeriods: ["pm_peak"],
  };
  const before = await generateTisReport(studyReq);
  const countBefore = before.affectedIntersections?.length ?? 0;
  ok(countBefore === 2, `8. the study runs on the thin inventory first (${countBefore} intersections)`);

  served.set(PGH, signalGrid("butler", BUTLER.lat, BUTLER.lon, 12));
  await pastWindow();
  const after = await generateTisReport(studyReq);
  const countAfter = after.affectedIntersections?.length ?? 0;
  ok(countAfter === 12,
    `8. after the window the same study analyzes the analyzer's new inventory without a restart (${countBefore} -> ${countAfter} intersections)`);
  ok(requestsFor(PGH).length === 2, `8. the study re-checked the analyzer once (${requestsFor(PGH).length} inventory requests)`);
} catch (err) {
  console.error(err);
  fails++;
} finally {
  globalThis.fetch = realFetch;
  server.close();
}

console.log(fails === 0 ? "\nALL CHECKS PASS" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
