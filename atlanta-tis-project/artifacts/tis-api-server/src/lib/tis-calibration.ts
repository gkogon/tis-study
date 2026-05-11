/**
 * Loads per-intersection calibration multipliers from `intersection_calibration`.
 * The TIS engine multiplies HCM control delay by `delayMultiplier` and stamps a
 * "calibrated against N samples" badge on the report so reviewers can see the
 * adjustment.
 *
 * Process-lifetime cache. Calibration data updates infrequently (manual / batch
 * job after observation runs) so a restart picking up new rows is fine.
 */
import { db, intersectionCalibrationTable } from "@workspace/db";
import { logger } from "./logger";

export type CalibrationEntry = {
  multiplier: number;
  sampleCount: number;
  lastObservedDelaySec: number | null;
};

let cache: Map<string, CalibrationEntry> | null = null;
let loadingPromise: Promise<Map<string, CalibrationEntry>> | null = null;

export async function loadCalibrationMap(): Promise<Map<string, CalibrationEntry>> {
  if (cache) return cache;
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
      logger.info({ count: m.size }, "tis.calibration_loaded");
      return m;
    } catch (err) {
      logger.warn({ err }, "tis.calibration_load_failed");
      // Don't fail the request — fall back to empty map (no calibration applied).
      cache = new Map();
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
