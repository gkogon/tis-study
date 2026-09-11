// whatIfRateLimiter on a throwaway express app, hit over real HTTP.
//
//  1. 60 what-ifs per hour PER USER: the 61st request from one user is 429
//     with the limiter's JSON message and draft-7 RateLimit headers.
//  2. Users do not share a bucket: a second user is 200 while the first is
//     locked out — and neither touches /generate's per-IP budget.
//  3. No session: keyed by IP (ipKeyGenerator), so anonymous callers still
//     hit a ceiling (the route itself 401s them anyway).
//  4. Admin emails and dev-auth environments are exempt.
//
// Run: pnpm run check:whatif-limiter
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
delete process.env.REDIS_URL;          // in-memory store: the bucket logic under test is the same
delete process.env.DEV_AUTH_ENABLED;
process.env.ADMIN_EMAILS = "ops@example.com";
process.env.NODE_ENV = "test";

const { whatIfRateLimiter } = await import(path.resolve(here, "../src/lib/security.ts"));
const { default: express } = await import(path.resolve(here, "../node_modules/express/index.js"));

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const app = express();
// Stand-in for authMiddleware: the test names the user in a header.
app.use((req, _res, next) => {
  const id = req.header("x-test-user");
  req.user = id ? { id, email: req.header("x-test-email") ?? `${id}@example.com` } : undefined;
  next();
});
app.post("/whatif", whatIfRateLimiter, (_req, res) => { res.json({ ok: true }); });

const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const port = server.address().port;
const hit = async (headers = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}/whatif`, { method: "POST", headers });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};

try {
  // 1. Per-user ceiling.
  let last;
  for (let i = 1; i <= 60; i++) last = await hit({ "x-test-user": "user-a" });
  ok(last.status === 200, "user-a: 60th request in the hour is 200");
  ok(last.headers.get("ratelimit") !== null || last.headers.get("ratelimit-limit") !== null, "draft-7 RateLimit header present");
  const over = await hit({ "x-test-user": "user-a" });
  ok(over.status === 429, `user-a: 61st request is 429 (got ${over.status})`);
  ok(over.body?.error && /what-if/i.test(over.body.error), `429 body carries the limiter's message: ${over.body?.error}`);
  ok(over.headers.get("x-ratelimit-limit") === null, "legacy X-RateLimit-* headers are off");

  // 2. Separate buckets.
  const b = await hit({ "x-test-user": "user-b" });
  ok(b.status === 200, `user-b is 200 while user-a is locked out (got ${b.status})`);
  const aAgain = await hit({ "x-test-user": "user-a" });
  ok(aAgain.status === 429, "user-a stays locked out");

  // 3. Anonymous: keyed by IP, distinct from every user bucket.
  let anon;
  for (let i = 1; i <= 60; i++) anon = await hit();
  ok(anon.status === 200, "anonymous: 60th request is 200 (its own IP bucket, not user-a's)");
  const anonOver = await hit();
  ok(anonOver.status === 429, `anonymous: 61st request is 429 (got ${anonOver.status})`);
  const c = await hit({ "x-test-user": "user-c" });
  ok(c.status === 200, "a fresh user is unaffected by the exhausted IP bucket");

  // 4. Admin exempt.
  let admin;
  for (let i = 1; i <= 65; i++) admin = await hit({ "x-test-user": "user-admin", "x-test-email": "ops@example.com" });
  ok(admin.status === 200, `admin email: 65th request is still 200 (got ${admin.status})`);

  // 4b. Dev-auth exempt (skip is evaluated per request).
  process.env.DEV_AUTH_ENABLED = "true";
  const dev = await hit({ "x-test-user": "user-a" });
  ok(dev.status === 200, `DEV_AUTH_ENABLED=true: the locked-out user is waved through (got ${dev.status})`);
  delete process.env.DEV_AUTH_ENABLED;
  const lockedAgain = await hit({ "x-test-user": "user-a" });
  ok(lockedAgain.status === 429, "…and locked out again once dev-auth is off");
} finally {
  server.close();
}

console.log(fails === 0 ? "\nAll what-if limiter checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
