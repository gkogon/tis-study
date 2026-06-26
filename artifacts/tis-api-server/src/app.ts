import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { createProxyMiddleware } from "http-proxy-middleware";
import router from "./routes";
import stripeWebhookRouter from "./routes/stripe-webhook";
import unsubscribeRouter from "./routes/unsubscribe";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { corsOptions, analyzerProxyRateLimiter } from "./lib/security";

const app: Express = express();

app.set("trust proxy", 1);

// Security headers. helmet's defaults give us HSTS, X-Content-Type-Options:
// nosniff, X-Frame-Options, Referrer-Policy, and friends. On top of those
// we layer a real Content-Security-Policy — the previous
// `contentSecurityPolicy: false` left the SPA with NO CSP at all, so any
// reflected/stored XSS could load attacker-controlled JS and (even though
// the session cookie is httpOnly) drive authenticated API calls or
// exfiltrate whatever's on the page. The directives are scoped to exactly
// what the production frontend loads:
//   - script-src 'self'      the Vite bundle is self-hosted + content-hashed;
//                            there are no inline or third-party scripts. (The
//                            index.html JSON-LD block is application/ld+json —
//                            data, not executable — so it's exempt.)
//   - style-src 'self' 'unsafe-inline' fonts.googleapis.com — Google Fonts CSS
//                            plus the inline styles React/Radix/Tailwind inject
//                            at runtime (can't be nonced per element).
//   - font-src 'self' fonts.gstatic.com — the webfont files.
//   - img-src 'self' data: blob: https: — logos, rendered PDFs, map/streetview
//                            thumbnails (some served from object storage).
//   - connect-src 'self'     the API and the /api analyzer proxy are same-origin.
//   - frame-ancestors 'none' clickjacking protection.
//   - object-src 'none'; base-uri 'self'; form-action 'self'.
// Stripe Checkout + the billing Portal are full-page redirects (not embedded
// iframes), so no js.stripe.com / frame-src entries are required.
//
// Rollout safety on the live site:
//   - DISABLE_CSP=true       drop back to no-CSP without a code change if a
//                            future frontend dependency needs an origin not
//                            listed here (then add it and clear the flag).
//   - CSP_REPORT_ONLY=true   ship the policy as Report-Only (headers present,
//                            nothing blocked) to vet a change before enforcing.
const cspDirectives: Record<string, Iterable<string>> = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "blob:", "https:"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};
if (process.env.NODE_ENV === "production") {
  // Upgrade any stray http subresource to https in prod. Omitted in dev so
  // it can't interfere with a plain-http localhost asset.
  cspDirectives.upgradeInsecureRequests = [];
}
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy:
      process.env.DISABLE_CSP === "true"
        ? false
        : {
            useDefaults: false,
            reportOnly: process.env.CSP_REPORT_ONLY === "true",
            directives: cspDirectives,
          },
  }),
);
app.use(compression());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors(corsOptions));
app.use(cookieParser());

// Stripe webhook MUST be mounted before the JSON body parser — the
// signature check needs the raw payload bytes, not a parsed object.
app.use("/tis-api", stripeWebhookRouter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(authMiddleware);

app.use("/tis-api", router);

// Public unsubscribe routes — mounted under /api (not /tis-api) so
// cold-email footer links stay short. Registered BEFORE the /api
// analyzer proxy so the unsubscribe paths don't fall through to it.
app.use(unsubscribeRouter);

// ---------- /api/* → analyzer ----------
//
// In production both services are co-located on a single domain. The
// frontend hits /api/* from the same origin (so cookies + CORS Just
// Work) and we forward those requests to the analyzer service over
// Railway's internal network. Locally Vite's dev proxy handles this
// instead — set VITE_ANALYZER_PROXY to point at the analyzer port.
const analyzerUrl = process.env.ANALYZER_API_URL;
if (analyzerUrl) {
  app.use(
    "/api",
    // Rate-limit before forwarding: the analyzer is internal-only and has
    // no limiter of its own, so this public proxy edge (where the real
    // client IP is known via trust-proxy) is the place to cap abuse.
    analyzerProxyRateLimiter,
    createProxyMiddleware({
      target: analyzerUrl,
      changeOrigin: true,
      // Keep the /api prefix on the way through; the analyzer mounts
      // its routes at /api too.
      pathRewrite: (p) => "/api" + p,
      logger,
    }),
  );
}

// ---------- Static frontend ----------
//
// In production the React build is bundled into this service so we can
// ship one container with one domain. The bundle is copied to
// `dist/public/` by the build step.
const FRONTEND_DIST = path.resolve(import.meta.dirname ?? __dirname, "public");
if (fs.existsSync(FRONTEND_DIST)) {
  // Hashed asset files are immutable — long-cache them. The HTML
  // entry has to revalidate every load.
  app.use(
    express.static(FRONTEND_DIST, {
      index: false,
      setHeaders: (res, p) => {
        if (p.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (/\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/i.test(p)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // SPA fallback: anything that isn't an API or a static file gets
  // index.html so React Router handles client-side routing.
  app.get(/^(?!\/(tis-api|api)\b).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
} else {
  logger.warn(
    { dist: FRONTEND_DIST },
    "static-frontend.dist_missing — skipping static + SPA fallback",
  );
}

export default app;
