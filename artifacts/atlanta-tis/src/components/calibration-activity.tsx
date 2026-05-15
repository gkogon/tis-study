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
  changesLastHour: number;
  changesLast24h: number;
  lastChangeAt: string | null;
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "moments ago";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

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

  // Activity phrase, in priority order:
  //   1. Movement this hour → the live number the visitor wants
  //   2. No movement this hour but history exists → last-update time
  //   3. No history yet (audit log just started) → describe the cadence
  let activity: { node: React.ReactNode; muted: boolean };
  if (data.changesLastHour > 0) {
    activity = {
      muted: false,
      node: (
        <>
          <strong className="tabular-nums">{data.changesLastHour}</strong>{" "}
          <span className="text-muted-foreground">recalibrated this hour</span>
        </>
      ),
    };
  } else if (data.lastChangeAt) {
    activity = {
      muted: true,
      node: <span className="text-muted-foreground">last recalibration {relTime(data.lastChangeAt)}</span>,
    };
  } else {
    activity = {
      muted: true,
      node: <span className="text-muted-foreground">recalibrating hourly from live GDOT data</span>,
    };
  }

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
        <span className="text-muted-foreground">Atlanta intersections under live calibration</span>
      </span>
      <span className="hidden sm:inline text-border">·</span>
      <span className="text-sm inline-flex items-center gap-1.5">
        <Activity className={`w-3.5 h-3.5 ${activity.muted ? "text-muted-foreground" : "text-blue-700"}`} />
        {activity.node}
      </span>
    </div>
  );
}
