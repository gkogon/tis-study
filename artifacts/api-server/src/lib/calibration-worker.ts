/**
 * Hourly calibration worker. Turns the GDOT 511 snapshot archive into
 * live per-intersection delay multipliers — the data-defensibility
 * moat described in intersection-calibration.ts.
 *
 * Every hour this:
 *   1. Reads the last 7 days of traffic_snapshots
 *   2. Aggregates incident exposure per intersection, severity-weighted
 *      (minor=1, major=2, full-closure=3)
 *   3. Maps the pressure score to a bounded delayMultiplier via a
 *      saturating tanh curve (ceiling 1.20, hard-clamped [0.85, 1.30])
 *   4. UPSERTs intersection_calibration for every signal with ≥10
 *      snapshots of observation density
 *
 * The TIS engine (tis-api-server) multiplies its HCM-computed control
 * delay by this multiplier and stamps a "calibrated against N samples"
 * badge on the report. The engine's calibration cache has a 15-minute
 * TTL, so an hourly write here is reflected in generated studies
 * within 15 minutes — no service restart needed.
 *
 * Why this is the moat: the longer the product runs, the more
 * accurate it gets, and the wider the gap from any pure-HCM clone —
 * a competitor cannot backfill GDOT 511 (live-only API), they can
 * only start their own observation window from day zero.
 *
 * Algorithm v1 is incident-density-only. When an observed-delay feed
 * (INRIX / HERE / floating-car) is wired in, the multiplier should
 * blend density with measured predicted-vs-observed error. The
 * bounded clamp stays until that validation exists.
 */
import { db, intersectionCalibrationTable, trafficSnapshotsTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { logger } from "./logger";

const WINDOW_DAYS = 7;
const MIN_SNAPSHOTS = 10;
const MULTIPLIER_FLOOR = 0.85;
const MULTIPLIER_CEILING = 1.3;
const CALIBRATION_INTERVAL_MS = 60 * 60 * 1000; // hourly
// Stagger past the traffic-archive worker's 30s startup so a restart
// loop doesn't fire both jobs simultaneously.
const STARTUP_DELAY_MS = 120 * 1000;

const SEVERITY_WEIGHT: Record<string, number> = {
  minor: 1.0,
  major: 2.0,
  severe: 3.0,
};

function weightOf(incident: { severity?: string | null; isFullClosure?: boolean | null }): number {
  if (incident.isFullClosure) return 3.0;
  const s = (incident.severity ?? "").toLowerCase();
  return SEVERITY_WEIGHT[s] ?? 1.0;
}

/** Pressure score [0, ∞) → multiplier, saturating toward 1.20. */
function pressureToMultiplier(pressure: number): number {
  if (pressure <= 0) return 1.0;
  const adj = 0.2 * Math.tanh(pressure * 1.8);
  const m = 1.0 + adj;
  return Math.max(MULTIPLIER_FLOOR, Math.min(MULTIPLIER_CEILING, m));
}

type Incident = {
  signalId?: string | null;
  signalName?: string | null;
  severity?: string | null;
  isFullClosure?: boolean | null;
};

export type CalibrationUpdateResult = {
  applied: boolean;
  snapshotsInWindow: number;
  signalsSeen: number;
  rowsEligible: number;
  rowsWritten: number;
  multiplierMin: number | null;
  multiplierMax: number | null;
  topSignals: Array<{ intersectionId: string; multiplier: number; pressure: number; name: string | null }>;
};

/**
 * Core calibration computation. Pure of scheduling concerns so it can
 * be called by the hourly worker (apply=true) AND by the standalone
 * CLI script in dry-run mode (apply=false).
 */
export async function runCalibrationUpdate(
  opts: { apply: boolean },
): Promise<CalibrationUpdateResult> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const snapshots = (await db
    .select({ payload: trafficSnapshotsTable.payload })
    .from(trafficSnapshotsTable)
    .where(gte(trafficSnapshotsTable.capturedAt, since))) as Array<{
    payload: { incidents?: Incident[] } | null;
  }>;

  const empty: CalibrationUpdateResult = {
    applied: opts.apply,
    snapshotsInWindow: snapshots.length,
    signalsSeen: 0,
    rowsEligible: 0,
    rowsWritten: 0,
    multiplierMin: null,
    multiplierMax: null,
    topSignals: [],
  };

  if (snapshots.length < MIN_SNAPSHOTS) {
    return empty;
  }

  type Agg = { weightedSum: number; snapshotsWith: number; lastSeenName: string | null };
  const perSignal = new Map<string, Agg>();

  for (const snap of snapshots) {
    const incidents = snap.payload?.incidents ?? [];
    const seenInThisSnap = new Set<string>();
    for (const inc of incidents) {
      const sid = inc.signalId;
      if (!sid) continue;
      const agg = perSignal.get(sid) ?? { weightedSum: 0, snapshotsWith: 0, lastSeenName: null };
      agg.weightedSum += weightOf(inc);
      if (!seenInThisSnap.has(sid)) {
        agg.snapshotsWith += 1;
        seenInThisSnap.add(sid);
      }
      if (inc.signalName) agg.lastSeenName = inc.signalName;
      perSignal.set(sid, agg);
    }
  }

  type Update = { intersectionId: string; multiplier: number; sampleCount: number; pressure: number; name: string | null };
  const updates: Update[] = [];
  for (const [sid, agg] of perSignal.entries()) {
    if (agg.snapshotsWith < MIN_SNAPSHOTS) continue;
    const pressure = agg.weightedSum / snapshots.length;
    updates.push({
      intersectionId: sid,
      multiplier: pressureToMultiplier(pressure),
      sampleCount: agg.snapshotsWith,
      pressure,
      name: agg.lastSeenName,
    });
  }
  updates.sort((a, b) => b.pressure - a.pressure);

  const result: CalibrationUpdateResult = {
    applied: opts.apply,
    snapshotsInWindow: snapshots.length,
    signalsSeen: perSignal.size,
    rowsEligible: updates.length,
    rowsWritten: 0,
    multiplierMin: updates.length ? Math.min(...updates.map((u) => u.multiplier)) : null,
    multiplierMax: updates.length ? Math.max(...updates.map((u) => u.multiplier)) : null,
    topSignals: updates.slice(0, 10).map((u) => ({
      intersectionId: u.intersectionId,
      multiplier: u.multiplier,
      pressure: u.pressure,
      name: u.name,
    })),
  };

  if (!opts.apply || updates.length === 0) {
    return result;
  }

  for (const u of updates) {
    await db
      .insert(intersectionCalibrationTable)
      .values({
        intersectionId: u.intersectionId,
        delayMultiplier: u.multiplier,
        sampleCount: u.sampleCount,
        notes: `Auto-updated hourly from incident-density: pressure=${u.pressure.toFixed(3)} over ${u.sampleCount} snapshots (algorithm v1, incident-density-only). signalName=${u.name ?? "?"}`,
      })
      .onConflictDoUpdate({
        target: intersectionCalibrationTable.intersectionId,
        set: {
          delayMultiplier: u.multiplier,
          sampleCount: u.sampleCount,
          notes: sql`EXCLUDED.notes`,
          updatedAt: sql`now()`,
        },
      });
    result.rowsWritten++;
  }

  return result;
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const r = await runCalibrationUpdate({ apply: true });
    logger.info(
      {
        snapshots: r.snapshotsInWindow,
        signalsSeen: r.signalsSeen,
        rowsWritten: r.rowsWritten,
        multiplierMax: r.multiplierMax,
      },
      "calibration.updated",
    );
  } catch (err) {
    // A failed calibration cycle is non-fatal — the engine falls back
    // to whatever multipliers are already in the table (or pure HCM).
    logger.warn({ err }, "calibration.update_failed");
  } finally {
    inFlight = false;
  }
}

/**
 * Start the hourly calibration worker. Idempotent. Staggered startup
 * so a crash-restart loop doesn't hammer the DB. `timer.unref()` keeps
 * the worker from holding the process open during shutdown.
 */
export function startCalibrationWorker(): void {
  if (timer) return;
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), CALIBRATION_INTERVAL_MS);
    timer.unref?.();
  }, STARTUP_DELAY_MS);
  logger.info(
    { intervalMs: CALIBRATION_INTERVAL_MS, startupDelayMs: STARTUP_DELAY_MS },
    "calibration.scheduled",
  );
}
