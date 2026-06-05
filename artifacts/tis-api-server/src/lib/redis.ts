/**
 * Shared Redis client for cross-instance state (rate-limit counters +
 * the global signup ceiling).
 *
 * Why: this service runs on multiple instances (Replit autoscale +
 * Railway), and every limiter previously used express-rate-limit's
 * default in-memory store. That makes each instance count independently,
 * so a configured "10/hr" cap is really "10/hr × instance count" and
 * resets on every redeploy. A single shared Redis backs all instances so
 * the limits hold globally.
 *
 * Config: set `REDIS_URL` (e.g. an Upstash `rediss://…` TLS endpoint, or
 * a Railway Redis URL reachable from both platforms). When it's unset —
 * local dev, or prod before Redis is provisioned — we fall back to the
 * per-instance in-memory behavior, so nothing breaks; limits just aren't
 * shared. Everything here is fail-open: a Redis outage must never take
 * the API down, only soften the limits back to best-effort.
 */

import Redis from "ioredis";
import { RedisStore } from "rate-limit-redis";
import type { Store } from "express-rate-limit";
import { logger } from "./logger";

const REDIS_URL = process.env.REDIS_URL;

let client: Redis | null = null;

if (REDIS_URL) {
  client = new Redis(REDIS_URL, {
    // Fail fast so a Redis hiccup degrades to fail-open in ~1s instead of
    // hanging the request. Paired with `passOnStoreError: true` on the
    // limiters and try/catch around the signup-ceiling commands.
    commandTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  // ioredis emits 'error' on every failed (re)connect; without a listener
  // those would be unhandled and crash the process. Log and carry on.
  client.on("error", (err: Error) => {
    logger.error({ err: err.message }, "redis.connection_error");
  });
  client.on("connect", () => logger.info("redis.connected"));
  logger.info("redis.enabled — rate-limit + signup-ceiling state shared across instances");
} else {
  logger.warn(
    "redis.disabled — REDIS_URL unset; rate limits are per-instance (in-memory). Fine for dev; set REDIS_URL in prod to make limits hold globally.",
  );
}

/** The shared client, or null when REDIS_URL is unset. */
export const redis = client;

/** True when a shared Redis is configured. */
export const redisEnabled = client !== null;

/**
 * Build a shared RedisStore for an express-rate-limit limiter, namespaced
 * by `prefix` so limiters don't collide. Returns `undefined` when Redis
 * isn't configured — express-rate-limit then falls back to its default
 * in-memory MemoryStore (current behavior).
 */
export function makeRateLimitStore(prefix: string): Store | undefined {
  if (!client) return undefined;
  const c = client;
  // rate-limit-redis is transport-agnostic: it hands us a raw command as
  // (cmd, ...args) and wants a promise back. ioredis `call` forwards it.
  return new RedisStore({
    sendCommand: (...args: string[]) => c.call(args[0]!, ...args.slice(1)) as Promise<number>,
    prefix,
  }) as unknown as Store;
}
