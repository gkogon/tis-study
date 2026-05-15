/**
 * Loads per-intersection calibration multipliers from `intersection_calibration`.
 * The TIS engine multiplies HCM control delay by `delayMultiplier` and stamps a
 * "calibrated against N samples" badge on the report so reviewers can see the
 * adjustment.
 *
 * TTL cache (15 min). The analyzer service runs an hourly calibration
 * worker that rewrites `intersection_calibration` from the live GDOT
 * snapshot archive. A 15-minute TTL means the engine picks up each
 * hourly update within at most 15 minutes — no service restart
 * needed. The query is one cheap SELECT of ~100-300 rows, so a
 * quarter-hourly refresh costs nothing.
 */
import { db, intersectionCalibrationTable } from "@workspace/db";
import { logger } from "./logger";

export type CalibrationEntry = {
  multiplier: number;
  sampleCount: number;
  lastObservedDelaySec: number | null;
};

const CACHE_TTL_MS = 15 * 60 * 1000;

let cache: Map<string, CalibrationEntry> | null = null;
let cacheLoadedAt = 0;
let loadingPromise: Promise<Map<string, CalibrationEntry>> | null = null;

export async function loadCalibrationMap(): Promise<Map<string, CalibrationEntry>> {
  const fresh = cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS;
  if (fresh) return cache!;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const rows = await db.select().from(intersectionCalibrationTable);
      const m = new Map<string, CalibrationEntry>();
      for (const r of rows) {
        m.set(r.intersectionId, {
          multiplier: Number(r.delayMultiplier) || 1,
          sampleCount: r.sampleCount ?? 0,
          lastObservedDelaySec:
            r.lastObservedDelaySec == null ? null : Number(r.lastObservedDelaySec),
        });
      }
      cache = m;
      cacheLoadedAt = Date.now();
      logger.info({ count: m.size }, "tis.calibration_loaded");
      return m;
    } catch (err) {
      logger.warn({ err }, "tis.calibration_load_failed");
      // Don't fail the request. If we have a stale cache, keep serving
      // it (better than dropping all calibration); otherwise fall back
      // to an empty map (pure HCM, no calibration applied).
      if (cache) return cache;
      cache = new Map();
      cacheLoadedAt = Date.now();
      return cache;
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

export function getCalibration(
  map: Map<string, CalibrationEntry>,
  signalId: string,
): CalibrationEntry | undefined {
  return map.get(signalId);
}

/** Test-only: drop the cache. Avoid in production paths. */
export function _resetCalibrationCache(): void {
  cache = null;
}
