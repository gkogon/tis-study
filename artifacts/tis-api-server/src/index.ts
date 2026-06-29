import app from "./app";
import { logger } from "./lib/logger";

// Fail-fast: dev-auth is a LOCAL-ONLY sign-in bypass that disables
// password auth, study quotas, and the demo cap. If it ever reaches a
// production host it turns the whole app into a passwordless,
// admin-reachable, unmetered system — so refuse to start rather than run
// wide open. The individual runtime gates are already correct; this is the
// belt-and-suspenders backstop against a stray env var.
// (Requires NODE_ENV=production to be set on the host — same dependency as
// the CORS localhost gate in lib/security.ts.)
if (
  process.env.NODE_ENV === "production" &&
  process.env.DEV_AUTH_ENABLED === "true"
) {
  throw new Error(
    "DEV_AUTH_ENABLED must not be 'true' in production. Unset it on the host before deploying.",
  );
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "TIS API server listening");
});
