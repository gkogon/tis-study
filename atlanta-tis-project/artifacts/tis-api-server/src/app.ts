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
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { corsOptions } from "./lib/security";

const app: Express = express();

app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
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
