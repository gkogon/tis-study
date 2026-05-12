/**
 * Read-only Sight Distance Analysis report. Used by the generator page
 * after a successful run and by the project-detail page for stored
 * sight-distance projects.
 */
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Eye } from "lucide-react";

type Verdict = "pass" | "marginal" | "fail" | "not_measured";

export type SightDistanceReportT = {
  projectName: string;
  intersection: {
    name: string;
    major: string;
    minor: string;
    designSpeedMph: number;
  };
  inputs: {
    maneuver: "left_from_minor" | "right_from_minor" | "crossing_from_minor";
    vehicleClass: "passenger_car" | "single_unit_truck" | "combination_truck";
    perceptionReactionSec: number;
    decelerationFtPerSec2: number;
    approachGradePct: number;
    lanesToCross: number;
  };
  ssd: {
    requiredFt: number;
    availableFt: number | null;
    verdict: Verdict;
    marginFt: number | null;
    notes: string[];
  };
  isd: {
    requiredFt: number;
    availableFt: number | null;
    verdict: Verdict;
    marginFt: number | null;
    timeGapSec: number;
    notes: string[];
  };
  citations: string[];
};

const MANEUVER_LABEL: Record<string, string> = {
  left_from_minor: "Left turn from minor",
  right_from_minor: "Right turn from minor",
  crossing_from_minor: "Crossing from minor",
};

const VEHICLE_LABEL: Record<string, string> = {
  passenger_car: "Passenger car",
  single_unit_truck: "Single-unit truck",
  combination_truck: "Combination truck",
};

export function SightDistanceReport({ report }: { report: SightDistanceReportT }) {
  return (
    <section className="border rounded-xl p-6 space-y-6 bg-background" data-testid="report-sight-distance">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold">{report.intersection.name}</h2>
        <div className="text-sm text-muted-foreground">
          Design speed {report.intersection.designSpeedMph} mph · {MANEUVER_LABEL[report.inputs.maneuver]} · {VEHICLE_LABEL[report.inputs.vehicleClass]}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DistanceCard
          icon={Eye}
          title="Stopping Sight Distance"
          subtitle="Driver on the major street stopping for an obstacle"
          required={report.ssd.requiredFt}
          available={report.ssd.availableFt}
          verdict={report.ssd.verdict}
          margin={report.ssd.marginFt}
          notes={report.ssd.notes}
        />
        <DistanceCard
          icon={Eye}
          title="Intersection Sight Distance"
          subtitle={`Minor-approach driver, ${report.isd.timeGapSec}s time gap`}
          required={report.isd.requiredFt}
          available={report.isd.availableFt}
          verdict={report.isd.verdict}
          margin={report.isd.marginFt}
          notes={report.isd.notes}
        />
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground text-sm">Assumptions</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Perception-reaction</dt><dd className="font-mono">{report.inputs.perceptionReactionSec.toFixed(1)} s</dd>
          <dt>Deceleration</dt><dd className="font-mono">{report.inputs.decelerationFtPerSec2.toFixed(1)} ft/s²</dd>
          <dt>Approach grade</dt><dd className="font-mono">{report.inputs.approachGradePct.toFixed(1)}%</dd>
          <dt>Lanes to cross</dt><dd className="font-mono">{report.inputs.lanesToCross}</dd>
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

function DistanceCard({
  icon: Icon, title, subtitle, required, available, verdict, margin, notes,
}: {
  icon: typeof Eye;
  title: string;
  subtitle: string;
  required: number;
  available: number | null;
  verdict: Verdict;
  margin: number | null;
  notes: string[];
}) {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-blue-600" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <VerdictBadge verdict={verdict} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Required" value={`${required} ft`} />
        <Stat label="Available" value={available !== null ? `${available} ft` : "—"} />
        <Stat
          label="Margin"
          value={margin !== null ? `${margin >= 0 ? "+" : ""}${margin} ft` : "—"}
          tone={margin === null ? "muted" : margin >= 0 ? "ok" : "bad"}
        />
      </div>
      {notes.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-0.5 pl-4 list-disc">
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label, value, tone = "muted",
}: { label: string; value: string; tone?: "muted" | "ok" | "bad" }) {
  const toneCls =
    tone === "bad" ? "text-red-600" :
    tone === "ok" ? "text-emerald-600" :
    "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={"text-lg font-bold tabular-nums " + toneCls}>{value}</div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const map: Record<Verdict, { label: string; icon: typeof CheckCircle2; cls: string }> = {
    pass: { label: "Pass", icon: CheckCircle2, cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
    marginal: { label: "Marginal", icon: AlertTriangle, cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    fail: { label: "Fail", icon: XCircle, cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
    not_measured: { label: "No measurement", icon: HelpCircle, cls: "bg-muted text-muted-foreground" },
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
