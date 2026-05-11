/**
 * Read-only Road-Diet Feasibility report.
 */
import { CheckCircle2, AlertTriangle, MinusCircle, XCircle, Shield, BikeIcon, GaugeCircle } from "lucide-react";

type Verdict = "highly_feasible" | "feasible_with_caveats" | "marginal" | "not_recommended";

type Config =
  | "4_lane_undivided"
  | "4_lane_divided"
  | "5_lane_with_twltl"
  | "3_lane_with_twltl"
  | "2_lane";

export type RoadDietReportT = {
  projectName: string;
  corridor: {
    name: string;
    currentConfig: Config;
    proposedConfig: Config;
    adt: number;
    postedSpeedMph: number;
  };
  capacity: {
    proposedCapacityVph: number;
    projectedPeakHourVph: number;
    vOverC: number;
    headroom: string;
  };
  safety: {
    baselineCrashes12mo: number | null;
    estimatedReductionPct: number;
    estimatedCrashesPrevented: number | null;
  };
  multimodal: string[];
  overall: {
    verdict: Verdict;
    reasoning: string[];
  };
  citations: string[];
};

const CONFIG_LABEL: Record<string, string> = {
  "4_lane_undivided": "4-lane undivided",
  "4_lane_divided": "4-lane divided",
  "5_lane_with_twltl": "5-lane with TWLTL",
  "3_lane_with_twltl": "3-lane with TWLTL",
  "2_lane": "2-lane",
};

export function RoadDietReport({ report }: { report: RoadDietReportT }) {
  return (
    <section className="border rounded-xl p-6 space-y-6 bg-background" data-testid="report-road-diet">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold">{report.corridor.name}</h2>
        <div className="text-sm text-muted-foreground">
          <strong>{CONFIG_LABEL[report.corridor.currentConfig]}</strong> → <strong>{CONFIG_LABEL[report.corridor.proposedConfig]}</strong> · {report.corridor.adt.toLocaleString()} ADT · {report.corridor.postedSpeedMph} mph posted
        </div>
      </header>

      <VerdictBanner verdict={report.overall.verdict} reasoning={report.overall.reasoning} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat icon={GaugeCircle} label="Peak v/c (proposed)" value={report.capacity.vOverC.toFixed(2)} sub={`${report.capacity.headroom} headroom · ${report.capacity.projectedPeakHourVph} vph / ${report.capacity.proposedCapacityVph} vph capacity`} tone={report.capacity.vOverC > 1 ? "bad" : report.capacity.vOverC > 0.85 ? "warn" : "ok"} />
        <Stat
          icon={Shield}
          label="Estimated crash reduction"
          value={`${report.safety.estimatedReductionPct}%`}
          sub={
            report.safety.estimatedCrashesPrevented !== null
              ? `~${report.safety.estimatedCrashesPrevented} crashes/yr prevented (of ${report.safety.baselineCrashes12mo} observed)`
              : "Provide a 12-mo crash count for an absolute estimate"
          }
          tone="ok"
        />
        <Stat icon={BikeIcon} label="Multimodal" value={`${report.multimodal.length}`} sub="benefits identified" tone="muted" />
      </div>

      {report.multimodal.length > 0 && (
        <div className="text-sm space-y-1">
          <div className="font-semibold">Multimodal effects</div>
          <ul className="space-y-0.5 pl-4 list-disc text-muted-foreground">
            {report.multimodal.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Citations</summary>
        <ul className="mt-2 space-y-1 list-disc pl-5">
          {report.citations.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </details>
    </section>
  );
}

function Stat({
  icon: Icon, label, value, sub, tone = "muted",
}: {
  icon: typeof GaugeCircle;
  label: string;
  value: string;
  sub: string;
  tone?: "muted" | "ok" | "warn" | "bad";
}) {
  const toneCls =
    tone === "bad" ? "text-red-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "ok" ? "text-emerald-600" :
    "text-foreground";
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={"text-2xl font-bold tabular-nums mt-1 " + toneCls}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function VerdictBanner({ verdict, reasoning }: { verdict: Verdict; reasoning: string[] }) {
  const map: Record<Verdict, { label: string; icon: typeof CheckCircle2; cls: string }> = {
    highly_feasible: { label: "Highly feasible", icon: CheckCircle2, cls: "border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 text-green-800 dark:text-green-200" },
    feasible_with_caveats: { label: "Feasible — with caveats", icon: AlertTriangle, cls: "border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 text-blue-800 dark:text-blue-200" },
    marginal: { label: "Marginal", icon: MinusCircle, cls: "border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 text-amber-800 dark:text-amber-200" },
    not_recommended: { label: "Not recommended at this fidelity", icon: XCircle, cls: "border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 text-red-800 dark:text-red-200" },
  };
  const m = map[verdict];
  const Icon = m.icon;
  return (
    <div className={"rounded-md border px-4 py-3 flex gap-2 " + m.cls}>
      <Icon className="w-5 h-5 mt-0.5 shrink-0" />
      <div>
        <div className="font-semibold">{m.label}</div>
        <ul className="text-sm space-y-0.5 list-disc pl-5 mt-1">
          {reasoning.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
    </div>
  );
}
