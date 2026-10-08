/**
 * The server the harness drives: the REAL proofread router (routes/proofread.ts, which brings the real store,
 * runner, firm lookup and limiters with it) behind the same body parser and mount point as src/app.ts. Two things
 * are not the production app:
 *
 *   - the session. `x-user: <id>|<email>` names the signed-in user; no header is signed out. Everything after this
 *     middleware is the real code.
 *   - POST /__harness/claim-one, outside /tis-api, which calls the real claimAndRunOne() once and answers whether it
 *     did work. Production has no such route; the harness uses it to drive one claim with nothing else in flight.
 *
 * `harness-tree:` imports are resolved by run.mjs to the tree under test (--tree), so the same entry bundles the
 * live checkout or a scratch copy with a deliberate break in it.
 */
import express from "express";
import proofreadRouter from "harness-tree:routes/proofread";
import { claimAndRunOne } from "harness-tree:lib/proofread-run";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  const raw = req.header("x-user");
  const [id, email] = raw ? raw.split("|") : [];
  req.user = id ? { id, email: email ?? null, firstName: null, lastName: null } : undefined;
  req.isAuthenticated = () => !!id;
  // pino-http's req.log in production. A route error is printed as one JSON line the harness reports.
  req.log = {
    error: (o, msg) => {
      const e = o?.err;
      console.error(JSON.stringify({ harnessRouteError: msg, message: e?.message, code: e?.code ?? e?.cause?.code }));
    },
    warn() {},
    info() {},
  };
  next();
});
app.use("/tis-api", proofreadRouter);
app.post("/__harness/claim-one", async (_req, res) => {
  try {
    res.json({ worked: await claimAndRunOne() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
const server = app.listen(0, "127.0.0.1", () => console.error(`LISTENING ${server.address().port}`));
