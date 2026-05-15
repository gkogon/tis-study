import type { CorsOptions } from "cors";
import rateLimit from "express-rate-limit";

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
});

// Per-IP rate limit for TIS generate.
export const generateRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many TIS generations. Please slow down." },
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
});

// Per-IP rate limit on signups. Prevents bulk account creation from
// scripts probing the system. Lower-volume than logins because each
// signup is a "first-time" event for a real human.
export const signupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Try again later." },
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
});

// Per-IP rate limit on the public /demo/generate endpoint. The demo
// runs the full TIS engine (hits the analyzer, pulls GDOT data) so
// each call is a real backend operation — we want to expose it to
// cold prospects for evaluation but not let scrapers grind through
// hundreds of presets. 3/day per IP is enough for an honest
// prospect to try a couple of presets and lock in on signup, but
// not enough for a bot to hammer GDOT through our pipe.
export const demoRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You've used your free demo runs for today. Sign up free to keep generating." },
});
