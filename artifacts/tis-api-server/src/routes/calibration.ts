/**
 * Public calibration-activity endpoint. Powers the live "self-
 * calibrating" counter on the marketing site — concrete proof that
 * the algorithm continuously improves itself against live GDOT data.
 *
 *   GET /tis-api/calibration/activity
 *     {
 *       totalCalibrated:   how many Atlanta signals have a calibration row
 *       totalSnapshots:    GDOT snapshots archived (grows every 10 min)
 *       changesLastHour:   meaningful multiplier moves in the last 60 min
 *       changesLast24h:    ditto, last 24 hours
 *       lastChangeAt:      ISO timestamp of the most recent change
 *     }
 *
 * Public (no auth) — it's an aggregate marketing signal shown on the
 * home page, exposes no per-firm or per-user data. Lightly rate-
 * limited against scrapers.
 */
import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import {
  db,
  intersectionCalibrationTable,
  calibrationChangesTable,
  trafficSnapshotsTable,
} from "@workspace/db";
import { calibrationActivityRateLimiter } from "../lib/security";

const router: IRouter = Router();

type ActivityPayload = {
  totalCalibrated: number;
  totalSnapshots: number;
  changesLastHour: number;
  changesLast24h: number;
  lastChangeAt: string | null;
};

// The marketing counter moves slowly — GDOT snapshots tick every ~10 min
// and calibration changes are hourly — so we serve a short-lived in-memory
// cache instead of running five COUNT(*) queries on every poll. With one
// poll per visitor-tab, a busy homepage fans a lot of identical reads at
// Postgres; a 30 s cache collapses them to ~2 DB round-trips/min per
// instance while keeping the widget effectively live. Per-instance (not
// Redis) on purpose: it only needs to shave duplicate load, not be
// globally exact, and a few-seconds-stale row count is invisible here.
const ACTIVITY_CACHE_TTL_MS = 30_000;
let activityCache: { at: number; body: ActivityPayload } | null = null;

router.get("/calibration/activity", calibrationActivityRateLimiter, async (req, res): Promise<void> => {
  const now = Date.now();
  if (activityCache && now - activityCache.at < ACTIVITY_CACHE_TTL_MS) {
    res.json(activityCache.body);
    return;
  }
  try {
    const [[totalRow], [snapRow], [hourRow], [dayRow], [lastRow]] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(intersectionCalibrationTable),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(trafficSnapshotsTable),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(calibrationChangesTable)
        .where(sql`${calibrationChangesTable.changedAt} > now() - interval '1 hour'`),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(calibrationChangesTable)
        .where(sql`${calibrationChangesTable.changedAt} > now() - interval '24 hours'`),
      db
        .select({ at: sql<Date | null>`max(${calibrationChangesTable.changedAt})` })
        .from(calibrationChangesTable),
    ]);

    const body: ActivityPayload = {
      totalCalibrated: totalRow?.n ?? 0,
      totalSnapshots: snapRow?.n ?? 0,
      changesLastHour: hourRow?.n ?? 0,
      changesLast24h: dayRow?.n ?? 0,
      lastChangeAt: lastRow?.at ? new Date(lastRow.at).toISOString() : null,
    };
    activityCache = { at: now, body };
    res.json(body);
  } catch (err) {
    req.log.error({ err }, "calibration.activity_failed");
    // Soft-fail: the marketing counter just hides itself on error.
    res.status(500).json({ error: "Could not load calibration activity." });
  }
});

export default router;
