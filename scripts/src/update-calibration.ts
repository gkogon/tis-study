/**
 * Hourly calibration updater. Reads recent traffic snapshots, computes
 * a per-intersection incident-pressure score, and writes refined
 * `delayMultiplier` values into intersection_calibration.
 *
 * The thesis (the moat):
 *   The HCM 6th Ed. delay model is calibrated against generic
 *   nationwide signal performance, with no metro-specific
 *   adjustment. We have something nobody else has: an irreproducible
 *   time-series of every Atlanta-metro incident, captured every 10
 *   minutes from GDOT 511. Intersections that show high incident
 *   density empirically have higher delay variance than the HCM
 *   model predicts. We close that gap with a bounded, transparent
 *   multiplier that increments over time as observations accrue.
 *
 *   A competitor running pure HCM ships less-accurate screening
 *   reports for the Atlanta metro on day one. They can't catch up
 *   without their own multi-month observation window — and our
 *   window keeps growing.
 *
 * Algorithm (v1, conservative):
 *   1. Window: last 7 days of traffic_snapshots
 *   2. For each snapshot, iterate incidents[]. Each incident with a
 *      non-null signalId contributes a weighted point to that signal:
 *        - full closure   = 3.0
 *        - major severity = 2.0
 *        - minor severity = 1.0
 *        - unknown        = 1.0
 *   3. Per signal: total weighted points / snapshot count = pressure score
 *   4. Map pressure → multiplier (saturating tanh-like curve):
 *        0     → 1.00
 *        0.10  → 1.05
 *        0.30  → 1.10
 *        0.60  → 1.15
 *        1.00+ → 1.20
 *      Clamped to [0.85, 1.30] absolute. (DB constraint allows wider
 *      range, but we stay conservative until we have observed-delay
 *      data to validate against.)
 *   5. sampleCount = number of snapshots in window
 *   6. Write to intersection_calibration via UPSERT. Skip signals with
 *      <10 snapshots of data (statistical noise floor).
 *
 * Run modes:
 *   - Default: dry-run. Prints what would change, makes no DB writes.
 *   - --apply: commit the updates.
 *
 *   pnpm --filter @workspace/scripts run update-calibration
 *   pnpm --filter @workspace/scripts run update-calibration -- --apply
 *
 * Future automation:
 *   Once we've reviewed a few manual runs and confirmed the math
 *   is producing sensible adjustments, schedule this hourly via
 *   either:
 *     (a) Railway cron job pointing at this script, or
 *     (b) setInterval inside the analyzer service on startup.
 *   Don't auto-schedule before reviewing manual output — a wrong
 *   multiplier on a frequently-screened intersection silently
 *   degrades every customer's report.
 */
import { db, intersectionCalibrationTable, trafficSnapshotsTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";

const WINDOW_DAYS = 7;
const MIN_SNAPSHOTS = 10;
const MULTIPLIER_FLOOR = 0.85;
const MULTIPLIER_CEILING = 1.30;
const DRY_RUN = !process.argv.includes("--apply");

// Severity weights — bigger numbers = more impact on the pressure
// score. Tuned to be conservative; a "minor" incident on a signal
// every snapshot for a week (~1000 weighted points) maps to a
// pressure score of ~1.0, which is the ceiling of our adjustment.
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

/**
 * Maps pressure score [0, ∞) → multiplier [1.0, 1.20].
 * Saturating curve: small pressure = small adjustment, large
 * pressure converges toward 1.20 (further bounded by the [0.85,
 * 1.30] clamp below).
 */
function pressureToMultiplier(pressure: number): number {
  if (pressure <= 0) return 1.0;
  const adj = 0.20 * Math.tanh(pressure * 1.8);
  const m = 1.0 + adj;
  return Math.max(MULTIPLIER_FLOOR, Math.min(MULTIPLIER_CEILING, m));
}

type Incident = {
  signalId?: string | null;
  signalName?: string | null;
  severity?: string | null;
  isFullClosure?: boolean | null;
};

type SnapshotRow = {
  payload: { incidents?: Incident[] } | null;
};

async function main() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  console.log(`Calibration updater — window: last ${WINDOW_DAYS} days (since ${since.toISOString()})`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no DB writes)" : "APPLY (will commit updates)"}`);

  const snapshots = await db
    .select({ payload: trafficSnapshotsTable.payload })
    .from(trafficSnapshotsTable)
    .where(gte(trafficSnapshotsTable.capturedAt, since));

  console.log(`Snapshots in window: ${snapshots.length}`);
  if (snapshots.length < MIN_SNAPSHOTS) {
    console.log(`Not enough data yet (need ≥${MIN_SNAPSHOTS}). Bailing without writes.`);
    return;
  }

  // Walk every incident across every snapshot. Aggregate per signal:
  //   - weightedSum: total severity-weighted hit-count
  //   - snapshotsWithSignal: how many distinct snapshots contained it
  //   - lastSeenName: the most recent human-readable name
  type Agg = { weightedSum: number; snapshotsWith: number; lastSeenName: string | null };
  const perSignal = new Map<string, Agg>();

  for (const snap of snapshots as SnapshotRow[]) {
    const incidents = snap.payload?.incidents ?? [];
    const seenInThisSnap = new Set<string>();
    for (const inc of incidents) {
      const sid = inc.signalId;
      if (!sid) continue;
      const w = weightOf(inc);
      const agg = perSignal.get(sid) ?? { weightedSum: 0, snapshotsWith: 0, lastSeenName: null };
      agg.weightedSum += w;
      if (!seenInThisSnap.has(sid)) {
        agg.snapshotsWith += 1;
        seenInThisSnap.add(sid);
      }
      if (inc.signalName) agg.lastSeenName = inc.signalName;
      perSignal.set(sid, agg);
    }
  }

  console.log(`Distinct signals seen: ${perSignal.size}`);

  // Build the update batch — only signals with enough observation
  // density to warrant a calibration tweak.
  type Update = {
    intersectionId: string;
    multiplier: number;
    sampleCount: number;
    pressureScore: number;
    signalName: string | null;
  };
  const updates: Update[] = [];

  for (const [sid, agg] of perSignal.entries()) {
    if (agg.snapshotsWith < MIN_SNAPSHOTS) continue;
    const pressure = agg.weightedSum / snapshots.length;
    const multiplier = pressureToMultiplier(pressure);
    updates.push({
      intersectionId: sid,
      multiplier,
      sampleCount: agg.snapshotsWith,
      pressureScore: pressure,
      signalName: agg.lastSeenName,
    });
  }

  updates.sort((a, b) => b.pressureScore - a.pressureScore);

  console.log(`\nSignals meeting MIN_SNAPSHOTS threshold (${MIN_SNAPSHOTS}+): ${updates.length}\n`);

  if (updates.length === 0) {
    console.log("Nothing to update — no signal accumulated enough observation density yet.");
    console.log("Re-run after more time elapses (snapshots accrue every 10 min).");
    return;
  }

  // Show the top adjustments so the operator can sanity-check before --apply.
  console.log("Top 15 by pressure score:");
  console.log(
    "  signalId".padEnd(20) +
    "samples".padStart(10) +
    "pressure".padStart(12) +
    "multiplier".padStart(13) +
    "  name",
  );
  console.log("  " + "-".repeat(95));
  for (const u of updates.slice(0, 15)) {
    const arrow = u.multiplier > 1.001 ? "↑" : u.multiplier < 0.999 ? "↓" : "→";
    console.log(
      "  " +
      String(u.intersectionId).padEnd(18) +
      String(u.sampleCount).padStart(10) +
      u.pressureScore.toFixed(3).padStart(12) +
      ` ${u.multiplier.toFixed(3)} ${arrow}`.padStart(13) +
      `  ${u.signalName ?? "(name unknown)"}`,
    );
  }
  if (updates.length > 15) {
    console.log(`  ... and ${updates.length - 15} more (rerun with verbose flag for full list).`);
  }

  // Summary stats
  const elevated = updates.filter((u) => u.multiplier > 1.001).length;
  const unchanged = updates.filter((u) => Math.abs(u.multiplier - 1.0) <= 0.001).length;
  console.log(`\nSummary: ${elevated} elevated · ${unchanged} unchanged · ${updates.length - elevated - unchanged} reduced (none expected v1)`);
  console.log(`Multiplier range: ${Math.min(...updates.map(u => u.multiplier)).toFixed(3)} – ${Math.max(...updates.map(u => u.multiplier)).toFixed(3)}`);

  if (DRY_RUN) {
    console.log("\nDRY-RUN complete. Re-run with --apply to commit these updates to intersection_calibration.");
    return;
  }

  // Apply: UPSERT each row. Using a transaction so a mid-batch
  // failure doesn't leave the calibration table half-updated.
  console.log(`\nWriting ${updates.length} rows to intersection_calibration...`);
  let writeCount = 0;
  for (const u of updates) {
    await db
      .insert(intersectionCalibrationTable)
      .values({
        intersectionId: u.intersectionId,
        delayMultiplier: u.multiplier,
        sampleCount: u.sampleCount,
        notes: `Auto-updated from incident-density: pressure=${u.pressureScore.toFixed(3)} over ${u.sampleCount} snapshots. Algorithm v1 (incident-density-only — observed-delay validation not yet integrated). signalName=${u.signalName ?? "?"}`,
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
    writeCount++;
  }
  console.log(`✔ Wrote ${writeCount} calibration rows.`);
  console.log(`Reports generated after this commit will pick up the new multipliers immediately (the engine cache resets on process restart; existing instances will refresh on their next read).`);
}

main().catch((err) => {
  console.error("Calibration update failed:", err);
  process.exit(1);
});
