// The analyzer's half of web's inventory re-check contract.
//
// Web (tis-api-server tis.ts fetchIntersections) caches each region's
// intersection inventory and, once its window passes, re-checks it with a
// conditional GET: If-None-Match set to the cached copy's ETag, plus an
// explicit "Cache-Control: max-age=0" (without it, fetch() sends no-cache and
// Express never answers 304). That only works because this service's
// inventory responses carry an ETag hashed from the body — Express's default,
// nothing in this package sets it — and answer 304 when it still matches.
// Turn the ETag off, or make the body vary per request, and every re-check
// silently becomes a full 1-10 MB download (New York: 10 MB). This pins it, on
// the real app and real data, for both URLs web reads:
//
//   1. 200 with an ETag.
//   2. Web's exact re-check headers with that ETag -> 304, no body.
//   3. A stale ETag -> 200 with the full body and the SAME ETag as step 1:
//      the tag is a function of the content, not of the request.
//
// Pittsburgh is the region of the 2026-09-25 incident, when web held an old
// copy of this inventory after the analyzer had deployed a new one.
//
// Run: pnpm run check:inventory-etag
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// ts-loader lives in the sibling package; api-server has no scripts harness.
register(pathToFileURL(path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs")).href, import.meta.url);

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.LOG_LEVEL ??= "error";

const { default: app } = await import(path.resolve(here, "../src/app.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

// The URLs tis.ts builds: Atlanta keeps its legacy route.
const targets = [
  ["pittsburgh_metro", `${base}/api/intersections?regionCode=pittsburgh_metro`],
  ["atlanta_metro", `${base}/api/atlanta/intersections`],
];

try {
  for (const [region, url] of targets) {
    const first = await fetch(url);
    const body = await first.text();
    const etag = first.headers.get("etag");
    ok(first.status === 200 && JSON.parse(body).length > 0,
      `${region}: 200 with the inventory (${body.length} bytes)`);
    ok(typeof etag === "string" && etag.length > 0, `${region}: 1. response carries an ETag (${etag})`);

    const same = await fetch(url, { headers: { "If-None-Match": etag ?? "", "Cache-Control": "max-age=0" } });
    const sameBody = await same.text();
    ok(same.status === 304 && sameBody.length === 0,
      `${region}: 2. web's re-check with the current ETag is a 304 with no body (got ${same.status}, ${sameBody.length} bytes)`);

    const stale = await fetch(url, { headers: { "If-None-Match": 'W/"an-older-inventory"', "Cache-Control": "max-age=0" } });
    const staleBody = await stale.text();
    ok(stale.status === 200 && staleBody === body && stale.headers.get("etag") === etag,
      `${region}: 3. a stale ETag gets the full inventory back under the same ETag`);
  }
} catch (err) {
  console.error(err);
  fails++;
} finally {
  server.close();
}

console.log(fails === 0 ? "\nALL CHECKS PASS" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
