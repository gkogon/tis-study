import app from "./app";
import { logger } from "./lib/logger";
import { startTrafficArchive } from "./lib/atlanta-traffic-archive";

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

  logger.info({ port }, "Server listening");
  // Kick off the GDOT 511 archive worker after the server is accepting traffic.
  // Failures inside the worker are logged but never crash the process.
  try {
    startTrafficArchive();
  } catch (e) {
    logger.warn({ err: e }, "traffic-archive.start_failed");
  }
});
