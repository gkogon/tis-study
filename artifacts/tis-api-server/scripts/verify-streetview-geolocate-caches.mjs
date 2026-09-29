// The Street View cover-photo cache and the IP-geolocation cache hold ANSWERS,
// never outages, and stay bounded.
//
// streetview.ts (the PDF cover photo) stored null for every miss — a metadata
// 503, an OVER_QUERY_LIMIT, a timeout — with no expiry, so one blip removed a
// site's cover photo from every later render until the process restarted; and
// its 200-entry cap refused inserts once full, freezing the cache for good.
// ip-geolocate.ts (the /demo/presets metro guess) stored null for an hour for
// every failure, ip-api.com's 429 throttle included, and never deleted an
// expired entry, so its map grew by one entry per visitor IP for the life of
// the process.
//
// Contract:
//  1. A TRANSIENT FAILURE IS NOT CACHED: the next call asks again, and a later
//     success is served (and then cached).
//       streetview: metadata non-OK HTTP; metadata status OVER_QUERY_LIMIT,
//       REQUEST_DENIED, INVALID_REQUEST or UNKNOWN_ERROR; image non-OK HTTP; a
//       200 that is not an image, or is truncated; a timeout; a network error.
//       ip-geolocate: non-OK HTTP; a 200 that is not JSON; a fail status the
//       docs do not list; a timeout; a network error.
//  2. A DEFINITIVE ANSWER IS CACHED.
//       streetview: an image; metadata ZERO_RESULTS or NOT_FOUND (no panorama).
//       ip-geolocate: a location; a success with no coordinates; a fail status
//       ip-api documents (private range, reserved range, invalid query) — each
//       depends only on the IP.
//  3. BOUNDED: an entry cap with LRU eviction, and a TTL that deletes
//     (checkBounded in scripts/lib/fetch-stub.mjs).
//  4. ip-api's RATE LIMIT IS HONOURED. It throttles past 45 requests a minute
//     (HTTP 429) and bans a caller that keeps going for an hour; X-Rl counts
//     the requests left in the window and X-Ttl the seconds until it resets. A
//     429, or X-Rl reaching 0, pauses every lookup for X-Ttl seconds (the
//     documented minute when absent) without caching anything per IP; after
//     the pause the next call asks again and its success is served.
//
// Every upstream is answered in-process by a stubbed globalThis.fetch; nothing
// leaves the machine.
//
// Run: pnpm run check:streetview-geolocate-caches
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { stubUpstreams, json, never, withTimeoutsDueNow, checkBounded } from "./lib/fetch-stub.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

process.env.LOG_LEVEL ??= "error"; // streetview warns on every failure, and this check injects dozens
// Without a key fetchStreetViewImage returns null before any lookup. The stub
// answers every request, so this placeholder never leaves the process.
process.env.GOOGLE_MAPS_API_KEY = "check-placeholder-key";

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const { responder, calls } = stubUpstreams({
  meta: "https://maps.googleapis.com/maps/api/streetview/metadata",
  image: "https://maps.googleapis.com/maps/api/streetview",
  ipapi: "http://ip-api.com/json/",
});

const sv = await import(path.resolve(here, "../src/lib/streetview.ts"));
const geo = await import(path.resolve(here, "../src/lib/ip-geolocate.ts"));

const unavailable = () => new Response("Service Unavailable", { status: 503 });
const networkError = () => Promise.reject(new TypeError("fetch failed"));
const notAsked = () => { throw new Error("served from memory — never asked"); };

// ---------------------------------------------------------------------------
// streetview.ts — metadata probe (free), then the image (billed).
// ---------------------------------------------------------------------------
console.log("\n── Street View cover photo (streetview.ts) ──");
{
  const JPEG_BYTES = 4096;
  const metaSays = (status) => () => json({ status });
  const jpeg = (bytes = JPEG_BYTES) => () =>
    new Response(new Uint8Array(bytes).fill(0xd8), { headers: { "content-type": "image/jpeg" } });
  const photo = (v) => Buffer.isBuffer(v) && v.length === JPEG_BYTES;
  const requests = () => calls.meta + calls.image;
  /** Look key up with the endpoints answering as given; returns [value, requests made]. */
  const lookupWith = async ({ lat, lon }, meta, image = notAsked) => {
    responder.meta = meta;
    responder.image = image;
    const before = requests();
    const value = await sv.fetchStreetViewImage(lat, lon);
    return [value, requests() - before];
  };
  let next = 0;
  /** A coordinate no earlier lookup used (0.001° steps survive the 4-dp key). */
  const fresh = () => { const i = next++; return { lat: 33.7 + Math.floor(i / 100) * 0.001, lon: -84.4 + (i % 100) * 0.001 }; };

  // 1. Transient failures are not cached.
  const FAILURES = [
    ["metadata HTTP 503", { meta: unavailable }],
    ["metadata OVER_QUERY_LIMIT", { meta: metaSays("OVER_QUERY_LIMIT") }],
    ["metadata REQUEST_DENIED", { meta: metaSays("REQUEST_DENIED") }],
    ["metadata INVALID_REQUEST", { meta: metaSays("INVALID_REQUEST") }],
    ["metadata UNKNOWN_ERROR", { meta: metaSays("UNKNOWN_ERROR") }],
    ["image HTTP 503", { meta: metaSays("OK"), image: unavailable }],
    ["an image request answered with a page, not an image", {
      meta: metaSays("OK"),
      image: () => new Response("<html>quota exceeded</html>", { headers: { "content-type": "text/html" } }),
    }],
    ["a truncated image", { meta: metaSays("OK"), image: jpeg(200) }],
    ["a timeout", { meta: never, timeout: true }],
    ["a network error", { meta: networkError }],
  ];
  for (const [kind, f] of FAILURES) {
    const key = fresh();
    const failing = () => lookupWith(key, f.meta, f.image);
    const [failed, asked] = await (f.timeout ? withTimeoutsDueNow(failing) : failing());
    ok(failed === null && asked >= 1, `${kind}: no photo`);
    const [retried, askedAgain] = await lookupWith(key, metaSays("OK"), jpeg());
    ok(photo(retried) && askedAgain === 2, `${kind}: the next render asks again (metadata + image) and gets the photo`);
    const [cached, askedThird] = await lookupWith(key, notAsked);
    ok(photo(cached) && askedThird === 0, `${kind}: …and that photo is then served from memory`);
  }

  // 2. "No panorama here" is an answer.
  for (const status of ["ZERO_RESULTS", "NOT_FOUND"]) {
    const key = fresh();
    const [first, asked] = await lookupWith(key, metaSays(status));
    ok(first === null && asked === 1, `metadata ${status}: no photo, and the billed image is never requested`);
    const [again, askedAgain] = await lookupWith(key, metaSays("OK"), jpeg());
    ok(again === null && askedAgain === 0, `metadata ${status}: served from memory on the next render (no panorama is an answer)`);
  }

  // 3. Bounded.
  await checkBounded(ok, {
    max: sv.STREETVIEW_CACHE_MAX_ENTRIES,
    ttl: sv.STREETVIEW_CACHE_TTL_MS,
    size: () => sv.streetViewCacheSize?.(),
    fresh,
    lookup: async (key) => (await lookupWith(key, metaSays("OK"), jpeg()))[1],
  });
}

// ---------------------------------------------------------------------------
// ip-geolocate.ts
// ---------------------------------------------------------------------------
console.log("\n── IP geolocation (ip-geolocate.ts) ──");
{
  const LOCATED = { status: "success", country: "United States", city: "Atlanta", lat: 33.749, lon: -84.388 };
  const answers = (body, status = 200, headers = {}) => () => json(body, status, headers);
  const located = (v) => v?.lat === 33.749 && v?.lon === -84.388 && v?.country === "United States"
    && v?.city === "Atlanta" && v?.source === "ip-api.com";
  let lastUrl = null;
  /** Look ip up with ip-api answering as given; returns [value, requests made]. */
  const lookupWith = async (ip, respond) => {
    responder.ipapi = (url, init) => { lastUrl = url; return respond(url, init); };
    const before = calls.ipapi;
    const value = await geo.geolocateIp(ip);
    return [value, calls.ipapi - before];
  };
  let next = 0;
  /** A public IP no earlier lookup used. */
  const fresh = () => { const i = next++; return `203.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`; };

  // 1. Transient failures are not cached.
  const FAILURES = [
    ["an HTTP 503", unavailable],
    ["a 200 that is not JSON", () => new Response("<html>captive portal</html>", { headers: { "content-type": "text/html" } })],
    ["a fail status the docs do not list", answers({ status: "fail", message: "quota exceeded" })],
    ["a timeout", never, true],
    ["a network error", networkError],
  ];
  for (const [kind, respond, timeout] of FAILURES) {
    const ip = fresh();
    const failing = () => lookupWith(ip, respond);
    const [failed, asked] = await (timeout ? withTimeoutsDueNow(failing) : failing());
    ok(failed === null && asked === 1, `${kind}: no location`);
    const [retried, askedAgain] = await lookupWith(ip, answers(LOCATED));
    ok(located(retried) && askedAgain === 1, `${kind}: the next call asks again and serves the location`);
    const [cached, askedThird] = await lookupWith(ip, notAsked);
    ok(located(cached) && askedThird === 0, `${kind}: …and that location is then served from memory`);
  }

  // 2. Definitive answers are cached.
  const DEFINITIVE = [
    ["fail: private range", { status: "fail", message: "private range" }],
    ["fail: reserved range", { status: "fail", message: "reserved range" }],
    ["fail: invalid query", { status: "fail", message: "invalid query" }],
    ["a success with no coordinates", { status: "success", country: "" }],
  ];
  for (const [kind, body] of DEFINITIVE) {
    const ip = fresh();
    const [first, asked] = await lookupWith(ip, answers(body));
    ok(first === null && asked === 1, `${kind}: no location`);
    const [again, askedAgain] = await lookupWith(ip, answers(LOCATED));
    ok(again === null && askedAgain === 0, `${kind}: served from memory on the next call (it depends only on the IP)`);
  }
  const fields = lastUrl ? (new URL(lastUrl).searchParams.get("fields") ?? "").split(",") : [];
  ok(fields.includes("message"),
    `the request asks for \`message\`, which tells a documented fail from any other (fields=${fields.join(",")})`);

  // 3. Bounded.
  await checkBounded(ok, {
    max: geo.IP_GEO_CACHE_MAX_ENTRIES,
    ttl: geo.IP_GEO_CACHE_TTL_MS,
    size: () => geo.ipGeoCacheSize?.(),
    fresh,
    lookup: async (ip) => (await lookupWith(ip, answers(LOCATED)))[1],
  });

  // 4. The rate limit. Runs last: it moves the clock forward and leaves the
  //    module's pause measured against that clock.
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    const a = fresh(), b = fresh();
    const [throttled, asked] = await lookupWith(a, () =>
      new Response("", { status: 429, headers: { "x-rl": "0", "x-ttl": "20" } }));
    ok(throttled === null && asked === 1, "a 429: no location");
    const [paused, askedPaused] = await lookupWith(b, answers(LOCATED));
    ok(paused === null && askedPaused === 0,
      "…and the next lookup, for any IP, waits out X-Ttl without a request (ip-api bans a caller that keeps going)");
    skew += 21_000;
    const [resumed, askedResumed] = await lookupWith(a, answers(LOCATED));
    ok(located(resumed) && askedResumed === 1,
      "after X-Ttl the throttled IP is asked again (the 429 was not cached for it) and its location is served");
    const [kept, askedKept] = await lookupWith(a, notAsked);
    ok(located(kept) && askedKept === 0, "…and then served from memory");

    // X-Rl reaching 0 on a success: that answer is served and cached, and the
    // next lookup waits for the window to reset instead of drawing a 429.
    const c = fresh(), d = fresh();
    const [spent, askedSpent] = await lookupWith(c, answers(LOCATED, 200, { "x-rl": "0", "x-ttl": "30" }));
    ok(located(spent) && askedSpent === 1, "a success that spends the window (X-Rl: 0) is served");
    ok((await lookupWith(d, answers(LOCATED)))[1] === 0, "…and the next lookup waits for the window to reset");
    skew += 31_000;
    const [afterReset, askedAfterReset] = await lookupWith(d, answers(LOCATED));
    ok(located(afterReset) && askedAfterReset === 1, "…after which it is asked and served");

    // A 429 without X-Ttl waits the documented one-minute window. The pause is
    // probed with another IP: it holds every lookup, not just the throttled one.
    const e = fresh(), f = fresh();
    await lookupWith(e, () => new Response("", { status: 429 }));
    skew += 59_000;
    ok((await lookupWith(f, answers(LOCATED)))[1] === 0, "a 429 without X-Ttl pauses for the documented minute (still paused at 59 s)");
    skew += 2_000;
    const [afterMinute, askedAfterMinute] = await lookupWith(e, answers(LOCATED));
    ok(located(afterMinute) && askedAfterMinute === 1, "…and resumes after it");
  } finally {
    Date.now = realNow;
  }
}

console.log(fails === 0 ? "\nAll Street View / IP-geolocation cache checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
