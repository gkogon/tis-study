/**
 * Read-only Queuing Analysis report.
 */
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Activity } from "lucide-react";

type Verdict = "pass" | "marginal" | "fail" | "not_measured";

export type QueuingReportT = {
  projectName: string;
  intersection: {
    name: string;
    approach: string;
    movement: "through" | "left_turn" | "right_turn";
  };
  inputs: {
    hourlyVolumeVph: number;
    laneCount: number;
    cycleLengthSec: number;
    effectiveGreenSec: number;
    saturationFlowVphpl: number;
    vehicleSpacingFt: number;
    analysisPeriodHr: number;
  };
  capacity: {
    perLaneVph: number;
    totalVph: number;
    vOverC: number;
    isOversaturated: boolean;
  };
  queue: {
    averageVehicles: number;
    averageFt: number;
    p95Vehicles: number;
    p95Ft: number;
  };
  storage: {
    availableFt: number | null;
    verdict: Verdict;
    marginFt: number | null;
    requiredFt: number;
  };
  notes: string[];
  citations: string[];
};

const MOVEMENT_LABEL: Record<string, string> = {
  through: "Through",
  left_turn: "Left turn",
  right_turn: "Right turn",
};

export function QueuingReport({ report }: { report: QueuingReportT }) {
  return (
    <section className="border rounded-xl p-6 space-y-6 bg-background" data-testid="report-queuing">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold">{report.intersection.name}</h2>
        <div className="text-sm text-muted-foreground">
          {MOVEMENT_LABEL[report.intersection.movement]} movement · {report.inputs.laneCount} lane{report.inputs.laneCount === 1 ? "" : "s"}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card label="v/c ratio" value={report.capacity.vOverC.toFixed(2)} sub={`${report.capacity.totalVph} vph capacity`} tone={report.capacity.vOverC > 1 ? "bad" : report.capacity.vOverC > 0.85 ? "warn" : "ok"} />
        <Card label="Average queue / lane" value={`${report.queue.averageFt} ft`} sub={`${report.queue.averageVehicles} vehicles`} />
        <Card label="95th-percentile queue / lane" value={`${report.queue.p95Ft} ft`} sub={`${report.queue.p95Vehicles} vehicles`} tone={report.storage.verdict === "fail" ? "bad" : report.storage.verdict === "marginal" ? "warn" : "muted"} />
      </div>

      <div className="rounded-lg border p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Storage check</div>
          <div className="text-sm">
            <strong>{report.storage.requiredFt} ft</strong> required (95th-pct)
            {report.storage.availableFt !== null && (
              <> · <strong>{report.storage.availableFt} ft</strong> available</>
            )}
            {report.storage.marginFt !== null && (
              <span className={report.storage.marginFt >= 0 ? "text-emerald-600" : "text-red-600"}>
                {" "}({report.storage.marginFt >= 0 ? "+" : ""}{report.storage.marginFt} ft margin)
              </span>
            )}
          </div>
        </div>
        <VerdictBadge verdict={report.storage.verdict} />
      </div>

      {report.notes.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-1 pl-4 list-disc">
          {report.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground text-sm">Inputs</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Hourly volume</dt><dd className="font-mono">{report.inputs.hourlyVolumeVph} vph</dd>
          <dt>Cycle / green</dt><dd className="font-mono">{report.inputs.cycleLengthSec}s / {report.inputs.effectiveGreenSec}s</dd>
          <dt>Saturation flow</dt><dd className="font-mono">{report.inputs.saturationFlowVphpl} vphpl</dd>
          <dt>Vehicle spacing</dt><dd className="font-mono">{report.inputs.vehicleSpacingFt} ft</dd>
          <dt>Analysis period</dt><dd className="font-mono">{report.inputs.analysisPeriodHr * 60} min</dd>
        </dl>
      </details>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Citations</summary>
        <ul className="mt-2 space-y-1 list-disc pl-5">
          {report.citations.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </details>
    </section>
  );
}

function Card({
  label, value, sub, tone = "muted",
}: { label: string; value: string; sub: string; tone?: "muted" | "ok" | "warn" | "bad" }) {
  const toneCls =
    tone === "bad" ? "text-red-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "ok" ? "text-emerald-600" :
    "text-foreground";
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
        <Activity className="w-3 h-3" /> {label}
      </div>
      <div className={"text-2xl font-bold tabular-nums mt-1 " + toneCls}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const map: Record<Verdict, { label: string; icon: typeof CheckCircle2; cls: string }> = {
    pass: { label: "Storage adequate", icon: CheckCircle2, cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
    marginal: { label: "Marginal", icon: AlertTriangle, cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    fail: { label: "Storage short", icon: XCircle, cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
    not_measured: { label: "No storage measured", icon: HelpCircle, cls: "bg-muted text-muted-foreground" },
  };
  const m = map[verdict];
  const Icon = m.icon;
  return (
    <span className={"inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap " + m.cls}>
      <Icon className="w-3 h-3" />
      {m.label}
    </span>
  );
}
