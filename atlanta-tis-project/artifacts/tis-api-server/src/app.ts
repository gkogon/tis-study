import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
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

export default app;
