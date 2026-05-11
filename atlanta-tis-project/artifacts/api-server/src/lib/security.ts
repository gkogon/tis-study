import type { CorsOptions } from "cors";

function parseAllowedOrigins(): string[] {
  const raw = process.env.REPLIT_DOMAINS ?? "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((host) => [`https://${host}`, `http://${host}`]);
  const local = ["http://localhost:80", "http://localhost:5000", "http://localhost:8080"];
  return [...new Set([...fromEnv, ...local])];
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

export const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
};
