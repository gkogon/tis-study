/**
 * Live calibration-activity counter. Polls /tis-api/calibration/activity
 * and renders a "the algorithm is improving itself right now" strip —
 * concrete, watchable proof of the self-calibrating claim.
 *
 * Self-contained and fail-quiet: if the endpoint errors or returns no
 * data, the component renders nothing rather than showing a broken
 * widget on the marketing page.
 *
 * Polls every 60s. The underlying worker runs hourly, so the numbers
 * only move once an hour — the poll just keeps a long-open tab fresh.
 */
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

type ActivityData = {
  totalCalibrated: number;
  totalSnapshots: number;
  changesLastHour: number;
  changesLast24h: number;
  lastChangeAt: string | null;
};

export function CalibrationActivity({ variant = "strip" }: { variant?: "strip" | "inline" }) {
  const [data, setData] = useState<ActivityData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/tis-api/calibration/activity");
        if (!r.ok) return;
        const d = (await r.json()) as ActivityData;
        if (!cancelled) setData(d);
      } catch {
        /* fail quiet — component just stays hidden */
      }
    }
    poll();
    const t = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Render nothing until we have real data, or if the table is empty.
  if (!data || data.totalCalibrated <= 0) return null;

  if (variant === "inline") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="relative flex w-2 h-2">
          <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
        </span>
        {data.totalCalibrated} Atlanta signals under live calibration
      </span>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full border border-border bg-background px-4 py-2 shadow-sm">
      <span className="inline-flex items-center gap-2">
        <span className="relative flex w-2.5 h-2.5">
          <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          Self-calibrating
        </span>
      </span>
      <span className="hidden sm:inline text-border">·</span>
      <span className="text-sm">
        <strong className="tabular-nums">{data.totalCalibrated}</strong>{" "}
        <span className="text-muted-foreground">intersections recalibrated hourly</span>
      </span>
      <span className="hidden sm:inline text-border">·</span>
      {/* The always-growing number: GDOT snapshots archived. Ticks up
          every 10 min — visible proof of the irreproducible data moat. */}
      <span className="text-sm inline-flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-blue-700" />
        <strong className="tabular-nums">{data.totalSnapshots.toLocaleString()}</strong>{" "}
        <span className="text-muted-foreground">GDOT snapshots archived</span>
      </span>
      {data.changesLastHour > 0 && (
        <>
          <span className="hidden sm:inline text-border">·</span>
          <span className="text-sm">
            <strong className="tabular-nums text-blue-700">{data.changesLastHour}</strong>{" "}
            <span className="text-muted-foreground">recalibrated this hour</span>
          </span>
        </>
      )}
    </div>
  );
}
