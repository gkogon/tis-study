import type { CorsOptions } from "cors";
import rateLimit from "express-rate-limit";

function parseAllowedOrigins(): string[] {
  const raw = process.env.REPLIT_DOMAINS ?? "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((host) => [`https://${host}`, `http://${host}`]);
  const local = ["http://localhost:80", "http://localhost:5000", "http://localhost:8090"];
  return [...new Set([...fromEnv, ...local])];
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

export const corsOptions: CorsOptions = {
  origin(origin, cb) {
    // Same-origin requests (no Origin header), e.g. server-to-server, are
    // allowed. Browsers always send Origin for cross-origin XHR/fetch.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
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
