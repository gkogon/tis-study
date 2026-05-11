/**
 * GDOT 511 archive worker. Snapshots the live incident bundle every
 * SNAPSHOT_INTERVAL_MS and persists one row to `traffic_snapshots`.
 *
 * Why this matters: the 511 API is live-only — there is no historical
 * endpoint we (or anyone else) can backfill from. Every minute we run
 * accumulates time-series data nobody else has access to. After 6-12 months
 * this becomes the basis for our prediction-model recency weights and for
 * corridor-level reliability scores. A late-arriving competitor literally
 * cannot reproduce this dataset — they can only start collecting from their
 * own day-zero.
 */
import { db, trafficSnapshotsTable } from "@workspace/db";
import { and, desc, gte, lte, sql } from "drizzle-orm";
import { getLiveIncidents } from "./atlanta-live";
import { logger } from "./logger";

const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const STARTUP_DELAY_MS = 30 * 1000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

async function captureOnce(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const bundle = await getLiveIncidents();
    await db.insert(trafficSnapshotsTable).values({
      incidentCount: bundle.incidents?.length ?? 0,
      snappedToSignalCount: bundle.snappedToSignal ?? 0,
      payload: bundle as unknown as object,
    });
    logger.info(
      { incidents: bundle.incidents?.length ?? 0 },
      "traffic-archive.snapshot_persisted",
    );
  } catch (err) {
    logger.warn({ err }, "traffic-archive.snapshot_failed");
  } finally {
    inFlight = false;
  }
}

export function startTrafficArchive(): void {
  if (timer) return;
  // Stagger first snapshot so a server restart loop doesn't spam the upstream.
  setTimeout(() => {
    void captureOnce();
    timer = setInterval(() => void captureOnce(), SNAPSHOT_INTERVAL_MS);
    timer.unref?.();
  }, STARTUP_DELAY_MS);
  logger.info(
    { intervalMs: SNAPSHOT_INTERVAL_MS, startupDelayMs: STARTUP_DELAY_MS },
    "traffic-archive.scheduled",
  );
}

export type ArchiveSummary = {
  totalSnapshots: number;
  earliestCapturedAt: string | null;
  latestCapturedAt: string | null;
  windowSnapshots: number;
  windowAvgIncidents: number;
  windowMaxIncidents: number;
};

export async function getArchiveSummary(
  sinceIso?: string,
  untilIso?: string,
): Promise<ArchiveSummary> {
  const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const until = untilIso ? new Date(untilIso) : new Date();

  // Aggregate row stats over all rows + the requested window.
  const [totals] = await db
    .select({
      totalSnapshots: sql<number>`count(*)::int`,
      earliest: sql<Date | null>`min(${trafficSnapshotsTable.capturedAt})`,
      latest: sql<Date | null>`max(${trafficSnapshotsTable.capturedAt})`,
    })
    .from(trafficSnapshotsTable);

  const [windowed] = await db
    .select({
      windowSnapshots: sql<number>`count(*)::int`,
      windowAvgIncidents: sql<number>`coalesce(avg(${trafficSnapshotsTable.incidentCount}), 0)::float`,
      windowMaxIncidents: sql<number>`coalesce(max(${trafficSnapshotsTable.incidentCount}), 0)::int`,
    })
    .from(trafficSnapshotsTable)
    .where(
      and(
        gte(trafficSnapshotsTable.capturedAt, since),
        lte(trafficSnapshotsTable.capturedAt, until),
      ),
    );

  // pg returns timestamp aggregates as ISO strings, NOT Date objects, even
  // though drizzle's column type is Date. Coerce defensively so we don't
  // explode on `.toISOString` of a string. Same trick used below for the
  // series.
  return {
    totalSnapshots: totals?.totalSnapshots ?? 0,
    earliestCapturedAt: toIsoOrNull(totals?.earliest),
    latestCapturedAt: toIsoOrNull(totals?.latest),
    windowSnapshots: windowed?.windowSnapshots ?? 0,
    windowAvgIncidents: Math.round((windowed?.windowAvgIncidents ?? 0) * 100) / 100,
    windowMaxIncidents: windowed?.windowMaxIncidents ?? 0,
  };
}

function toIsoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type ArchiveSeriesPoint = {
  capturedAt: string;
  incidentCount: number;
  snappedToSignalCount: number;
};

export async function getArchiveSeries(
  sinceIso?: string,
  untilIso?: string,
  limit = 500,
): Promise<ArchiveSeriesPoint[]> {
  const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const until = untilIso ? new Date(untilIso) : new Date();
  const rows = await db
    .select({
      capturedAt: trafficSnapshotsTable.capturedAt,
      incidentCount: trafficSnapshotsTable.incidentCount,
      snappedToSignalCount: trafficSnapshotsTable.snappedToSignalCount,
    })
    .from(trafficSnapshotsTable)
    .where(
      and(
        gte(trafficSnapshotsTable.capturedAt, since),
        lte(trafficSnapshotsTable.capturedAt, until),
      ),
    )
    .orderBy(desc(trafficSnapshotsTable.capturedAt))
    .limit(Math.min(Math.max(limit, 1), 2000));
  return rows.map((r) => ({
    capturedAt: toIsoOrNull(r.capturedAt) ?? "",
    incidentCount: r.incidentCount,
    snappedToSignalCount: r.snappedToSignalCount,
  }));
}
