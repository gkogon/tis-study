import type { CorsOptions } from "cors";
import rateLimit from "express-rate-limit";
import { isAdminEmail } from "./auth";
import { makeRateLimitStore } from "./redis";

// Every limiter below shares two cross-instance settings:
//   - `store`: a Redis-backed store (namespaced per limiter) when
//     REDIS_URL is set, so counters hold across all instances; falls
//     back to express-rate-limit's in-memory MemoryStore otherwise.
//   - `passOnStoreError: true`: if the Redis store errors (outage,
//     timeout), allow the request rather than 500 — a rate limiter must
//     never be a single point of failure for the whole API.

function parseAllowedOrigins(): string[] {
  // `ALLOWED_ORIGINS` is a comma-separated list of fully-qualified
  // origins (e.g. https://simpleimpactstudies.com,https://app.example.com).
  // Each entry is taken as-is; if you list `example.com` we'll also
  // accept the https variant explicitly to cover the rough-typed case.
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((host) => (host.startsWith("http") ? [host] : [`https://${host}`, `http://${host}`]));
  // Common local-dev ports: 80 / 5000 / 5173 (Vite default) / 8090.
  const local = [
    "http://localhost:80",
    "http://localhost:5000",
    "http://localhost:5173",
    "http://localhost:8090",
  ];
  return [...new Set([...fromEnv, ...local])];
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

const IS_DEV = process.env.NODE_ENV !== "production";

export const corsOptions: CorsOptions = {
  origin(origin, cb) {
    // Same-origin requests (no Origin header), e.g. server-to-server, are
    // allowed. Browsers always send Origin for cross-origin XHR/fetch.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // In development, permit any localhost / 127.0.0.1 origin so engineers
    // don't have to grow the allowlist for every port they spin up.
    if (IS_DEV && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
};

// Per-IP rate limit for the public lead-capture endpoint.
export const leadsRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a few minutes." },
  store: makeRateLimitStore("rl:leads:"),
  passOnStoreError: true,
});

// Per-IP rate limit for TIS generate.
export const generateRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many TIS generations. Please slow down." },
  store: makeRateLimitStore("rl:generate:"),
  passOnStoreError: true,
});

// Per-IP brute-force protection for /auth/login. A real attacker
// distributes across IPs, so this is defense-in-depth — pair with
// bcrypt cost on the password side and consider a per-email lockout
// at the application layer when you have a Sentry/alerts pipeline.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
  store: makeRateLimitStore("rl:login:"),
  passOnStoreError: true,
});

// Per-IP rate limit on signups. Tightened from 5/hr to 3/hr in the
// signup-defense layering pass. The other layers (honeypot, form-load
// time, disposable-email blocklist, global ceiling) live in
// lib/signup-defense.ts and apply on top of this.
export const signupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Try again later." },
  store: makeRateLimitStore("rl:signup:"),
  passOnStoreError: true,
});

// Per-IP rate limit on password-reset request. Prevents an attacker
// from spamming reset-email sends to a victim's mailbox. The reset
// flow itself is idempotent and reveals nothing (200 either way), so
// the abuse vector is mailbox-flooding, not info disclosure.
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Try again later." },
  store: makeRateLimitStore("rl:pwreset:"),
  passOnStoreError: true,
});

// Per-IP rate limit on the public unsubscribe endpoint. Honest users
// hit it once; bots probing or DOSing the DB hit it constantly. 20
// per 10 min is generous for a legitimate human and tight enough to
// shut down a bored scanner.
export const unsubscribeRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in a few minutes." },
  store: makeRateLimitStore("rl:unsub:"),
  passOnStoreError: true,
});

// Per-IP rate limit on the public /demo/generate endpoint. The demo
// runs the full TIS engine (hits the analyzer, pulls GDOT data) so
// each call is a real backend operation — we want to expose it to
// cold prospects for evaluation but not let scrapers grind through
// hundreds of presets. 3/day per IP is enough for an honest
// prospect to try a couple of presets and lock in on signup, but
// not enough for a bot to hammer GDOT through our pipe.
//
// Bypass: authenticated dev/admin sessions — the operator's "infinite"
// account was hitting this 3/day cap when running demo flows
// post-sign-in, even though the same account is treated as unlimited
// on /generate. authMiddleware runs before this so `req.user` is
// already populated; mirroring isUnlimitedStudies' sync conditions
// (skipping the firm-load DB call — enterprise studyLimit<=0 firms
// should be hitting /generate, not /demo/generate).
export const demoRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You've used your free demo runs for today. Sign up free to keep generating." },
  store: makeRateLimitStore("rl:demo:"),
  passOnStoreError: true,
  skip: (req) => {
    if (process.env.DEV_AUTH_ENABLED === "true") return true;
    // Any signed-in user has a real account — the demo cap is for
    // anonymous prospects, so never rate-limit an authenticated session.
    // (Requires the client to send credentials on /demo requests.)
    try { if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return true; } catch { /* not augmented */ }
    const email = req.user?.email;
    return !!email && isAdminEmail(email);
  },
});

// /demo/geocode — looser than demoRateLimiter because geocoding is the
// helper that turns "1100 Peachtree St" into lat/lon before a study
// runs. A cold-click visitor might type 2–3 candidate addresses before
// landing on one inside a covered metro, so 3/day is far too tight.
// 30/hour caps obvious scraping but lets the genuine try-a-few-addresses
// path through. Falls back to the in-memory store if Redis is unset.
export const geocodeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many address lookups in the last hour. Try again later, or paste coordinates directly." },
  store: makeRateLimitStore("rl:geocode:"),
  passOnStoreError: true,
});

// Per-IP rate limit on the public /api/* proxy to the analyzer service.
// The analyzer's ~30 read-only /atlanta/* endpoints (live-incidents,
// cameras, live-weather, predicted-traffic-flow, today-accident-
// predictions, …) are only reachable through this proxy, and several
// fan out to upstream feeds (GDOT, NWS). Without a limiter here a scraper
// could grind those endpoints — and our upstream quotas — for free.
//
// Sizing: the home-page flagship widgets poll a handful of these at 60s
// intervals plus a one-time burst on load, so a real user (even a NAT'd
// office sharing one IP) stays far under 5 req/s. 300/min caps a grinder
// at 5 req/s — orders of magnitude below the hundreds/s they'd want —
// while leaving generous headroom for legitimate polling. Tune `limit`
// if real traffic ever bumps the ceiling.
//
// NOTE: like every limiter here this uses the default in-memory store, so
// the effective cap is 300/min × instance count and resets on redeploy.
// A shared (Redis/Upstash) store would make it hold globally — tracked
// separately as the cross-cutting store fix.
export const analyzerProxyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
  store: makeRateLimitStore("rl:analyzer:"),
  passOnStoreError: true,
});
