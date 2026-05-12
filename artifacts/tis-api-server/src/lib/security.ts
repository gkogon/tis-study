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
