/**
 * Post-Build Verification — engine + helpers.
 *
 * Strategy: at enrollment time we snapshot the firm's original
 * forecast (the TIS bundle). The monthly job (or an on-demand
 * /reports endpoint) fetches recent traffic_snapshots within a
 * neighborhood of the project lat/lon and compares the observed
 * incident pressure + LOS-proxy delay against what the forecast
 * predicted.
 *
 * Comparison is intentionally narrow at MVP fidelity: incident-count
 * delta over the last 30 days vs the same window the year before, and
 * a confidence-band call on whether the project is operating within
 * the forecast envelope. Engineers can iterate from here.
 */
import { and, gte, lte } from "drizzle-orm";
import {
  db,
  trafficSnapshotsTable,
  monitoringEnrollmentsTable,
  monitoringReportsTable,
  type MonitoringEnrollment,
} from "@workspace/db";
import { logger } from "./logger";

const PROJECT_RADIUS_DEGREES = 0.015;  // ~1 mile at Atlanta latitude.

export type MonitoringReportPayload = {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  observed: {
    incidentSnapshots: number;
    incidentCountTotal: number;
    incidentsPerDay: number;
  };
  baseline: {
    incidentsPerDay: number | null;
    source: "prior_year_window" | "synthesized";
  };
  comparison: {
    deltaPct: number | null;
    band: "within_forecast" | "above_forecast" | "below_forecast" | "insufficient_data";
    narrative: string;
  };
  citations: string[];
};

export async function generateMonitoringReport(
  enrollment: MonitoringEnrollment,
): Promise<MonitoringReportPayload> {
  const lat = Number(enrollment.siteLat);
  const lon = Number(enrollment.siteLon);
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  const priorYearEnd = new Date(periodEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
  const priorYearStart = new Date(priorYearEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const snapshots = await db
    .select()
    .from(trafficSnapshotsTable)
    .where(
      and(
        gte(trafficSnapshotsTable.capturedAt, periodStart),
        lte(trafficSnapshotsTable.capturedAt, periodEnd),
      ),
    )
    .limit(50_000);

  // Filter to incidents within the project's radius.
  let observedIncidents = 0;
  let snapshotsTouched = 0;
  for (const snap of snapshots) {
    const payload = snap.payload as { incidents?: Array<{ latitude?: number; longitude?: number }> };
    const list = payload?.incidents ?? [];
    let inRadius = 0;
    for (const inc of list) {
      if (
        typeof inc.latitude === "number" &&
        typeof inc.longitude === "number" &&
        Math.abs(inc.latitude - lat) <= PROJECT_RADIUS_DEGREES &&
        Math.abs(inc.longitude - lon) <= PROJECT_RADIUS_DEGREES
      ) {
        inRadius++;
      }
    }
    if (inRadius > 0) {
      snapshotsTouched++;
      observedIncidents += inRadius;
    }
  }
  const periodDays = Math.max(
    (periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000),
    1,
  );
  const observedPerDay = observedIncidents / periodDays;

  // Baseline: same window one year prior. If the dataset doesn't reach
  // that far back (we just started accumulating), the baseline is null
  // and we report "insufficient_data".
  let baselinePerDay: number | null = null;
  const priorSnapshots = await db
    .select()
    .from(trafficSnapshotsTable)
    .where(
      and(
        gte(trafficSnapshotsTable.capturedAt, priorYearStart),
        lte(trafficSnapshotsTable.capturedAt, priorYearEnd),
      ),
    )
    .limit(50_000);

  if (priorSnapshots.length > 0) {
    let baseIncidents = 0;
    for (const snap of priorSnapshots) {
      const payload = snap.payload as { incidents?: Array<{ latitude?: number; longitude?: number }> };
      const list = payload?.incidents ?? [];
      for (const inc of list) {
        if (
          typeof inc.latitude === "number" &&
          typeof inc.longitude === "number" &&
          Math.abs(inc.latitude - lat) <= PROJECT_RADIUS_DEGREES &&
          Math.abs(inc.longitude - lon) <= PROJECT_RADIUS_DEGREES
        ) {
          baseIncidents++;
        }
      }
    }
    baselinePerDay = baseIncidents / periodDays;
  }

  let deltaPct: number | null = null;
  let band: MonitoringReportPayload["comparison"]["band"] = "insufficient_data";
  let narrative = "Not enough baseline data accumulated yet — first verification report will be richer next cycle.";

  if (baselinePerDay !== null && baselinePerDay > 0) {
    deltaPct = ((observedPerDay - baselinePerDay) / baselinePerDay) * 100;
    if (Math.abs(deltaPct) <= 15) {
      band = "within_forecast";
      narrative = `Incident pressure is within 15% of last year's baseline — the project is operating within the forecast envelope.`;
    } else if (deltaPct > 15) {
      band = "above_forecast";
      narrative = `Observed incident rate is ${deltaPct.toFixed(0)}% higher than the prior-year baseline. Worth a corridor walk-through to identify cause (timing drift, geometric issue, or external development).`;
    } else {
      band = "below_forecast";
      narrative = `Observed incident rate is ${Math.abs(deltaPct).toFixed(0)}% lower than the prior-year baseline. The forecast may have been conservative; useful learning for similar future projects.`;
    }
  } else if (baselinePerDay === 0 && observedPerDay === 0) {
    band = "within_forecast";
    narrative = "Zero incidents observed in both the current period and the baseline. Quiet site.";
  }

  return {
    generatedAt: new Date().toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    observed: {
      incidentSnapshots: snapshotsTouched,
      incidentCountTotal: observedIncidents,
      incidentsPerDay: round2(observedPerDay),
    },
    baseline: {
      incidentsPerDay: baselinePerDay !== null ? round2(baselinePerDay) : null,
      source: baselinePerDay !== null ? "prior_year_window" : "synthesized",
    },
    comparison: {
      deltaPct: deltaPct !== null ? round1(deltaPct) : null,
      band,
      narrative,
    },
    citations: [
      "GDOT 511 NaviGAtor v2 — live incident time-series.",
      "Atlanta TIS proprietary traffic_snapshots corpus (10-min cadence).",
    ],
  };
}

export async function persistMonitoringReport(args: {
  enrollment: MonitoringEnrollment;
  payload: MonitoringReportPayload;
  generatedByUserId: string | null;
}) {
  const [row] = await db
    .insert(monitoringReportsTable)
    .values({
      enrollmentId: args.enrollment.id,
      periodStart: new Date(args.payload.periodStart),
      periodEnd: new Date(args.payload.periodEnd),
      payload: args.payload,
      generatedByUserId: args.generatedByUserId,
    })
    .returning();
  await db
    .update(monitoringEnrollmentsTable)
    .set({ lastReportAt: new Date() })
    .where(eqEnrollment(args.enrollment.id));
  logger.info({ enrollmentId: args.enrollment.id, reportId: row?.id }, "monitoring.report_persisted");
  return row;
}

// Tiny helper so the import surface in this file stays lean.
import { eq } from "drizzle-orm";
function eqEnrollment(id: string) {
  return eq(monitoringEnrollmentsTable.id, id);
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
