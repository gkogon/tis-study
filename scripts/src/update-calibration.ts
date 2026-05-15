/**
 * CLI wrapper around the calibration updater.
 *
 * The algorithm itself lives in the analyzer service
 * (artifacts/api-server/src/lib/calibration-worker.ts) — that's the
 * single source of truth, and the analyzer runs it automatically
 * every hour. This script is for manual / ad-hoc runs: inspecting
 * what the next cycle would do (dry-run) or forcing an update
 * outside the hourly cadence.
 *
 *   pnpm --filter @workspace/scripts run update-calibration            # dry-run
 *   pnpm --filter @workspace/scripts run update-calibration -- --apply # commit
 */
import { runCalibrationUpdate } from "../../artifacts/api-server/src/lib/calibration-worker";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Calibration updater — mode: ${APPLY ? "APPLY (commits writes)" : "DRY-RUN (no writes)"}`);

  const r = await runCalibrationUpdate({ apply: APPLY });

  console.log(`\nSnapshots in 7-day window: ${r.snapshotsInWindow}`);
  console.log(`Distinct signals seen:     ${r.signalsSeen}`);
  console.log(`Signals meeting threshold: ${r.rowsEligible}`);

  if (r.rowsEligible === 0) {
    console.log("\nNothing eligible yet — not enough observation density. Re-run after more snapshots accrue (every 10 min).");
    return;
  }

  console.log(
    `Multiplier range:          ${r.multiplierMin?.toFixed(3)} – ${r.multiplierMax?.toFixed(3)}`,
  );
  console.log("\nTop 10 by incident pressure:");
  console.log(
    "  signalId".padEnd(20) + "pressure".padStart(11) + "multiplier".padStart(13) + "  name",
  );
  console.log("  " + "-".repeat(90));
  for (const s of r.topSignals) {
    console.log(
      "  " +
        String(s.intersectionId).padEnd(18) +
        s.pressure.toFixed(3).padStart(11) +
        ` ${s.multiplier.toFixed(3)} ↑`.padStart(13) +
        `  ${s.name ?? "(name unknown)"}`,
    );
  }

  if (APPLY) {
    console.log(`\n✔ Wrote ${r.rowsWritten} rows to intersection_calibration.`);
    console.log("The TIS engine's calibration cache has a 15-min TTL — generated studies reflect this within 15 minutes.");
  } else {
    console.log("\nDRY-RUN complete. Re-run with --apply to commit.");
    console.log("(The analyzer service also applies this automatically every hour.)");
  }
}

main().catch((err) => {
  console.error("Calibration update failed:", err);
  process.exit(1);
});
