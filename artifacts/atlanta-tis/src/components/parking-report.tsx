/**
 * Read-only Parking Demand Study report. Used by the generator page
 * after a successful run, and by the project-detail page for stored
 * parking projects.
 */
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

export type ParkingReportT = {
  projectName: string;
  landUse: { code: string; name: string; unit: string };
  size: number;
  demand: {
    weekdayPeak: number;
    saturdayPeak: number;
    governingDemand: number;
    governingPeriod: "weekday" | "saturday";
    adjustedDemand: number;
    sharedUseReductionPct: number;
  };
  codeRequired: { perUnit: number; total: number; source: string };
  proposedSpaces: number;
  iteVerdict: "surplus" | "match" | "deficit";
  codeVerdict: "surplus" | "match" | "deficit";
  governingDelta: number;
  hourlyProfileWeekday: { hour: number; demand: number }[];
  hourlyProfileSaturday: { hour: number; demand: number }[];
  citations: string[];
};

export function ParkingReport({ report }: { report: ParkingReportT }) {
  const governingMin = Math.max(report.demand.adjustedDemand, report.codeRequired.total);
  const verdict =
    report.governingDelta > 0 ? "surplus" : report.governingDelta < 0 ? "deficit" : "match";

  return (
    <section className="border rounded-xl p-6 space-y-6 bg-background" data-testid="report-parking">
      <header className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-2xl font-bold">{report.projectName}</h2>
        <span className="text-sm text-muted-foreground">
          · {report.landUse.code} {report.landUse.name} · {report.size} {report.landUse.unit}
        </span>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric
          label="ITE peak demand"
          value={`${report.demand.adjustedDemand} spaces`}
          sub={`${report.demand.governingPeriod} peak${
            report.demand.sharedUseReductionPct > 0
              ? `, -${report.demand.sharedUseReductionPct}% shared use`
              : ""
          }`}
        />
        <Metric
          label="Code minimum (Atlanta)"
          value={`${report.codeRequired.total} spaces`}
          sub={`${report.codeRequired.perUnit} per ${report.landUse.unit.toLowerCase().split(" ")[0]}${
            report.codeRequired.source === "user_override" ? ", overridden" : ""
          }`}
        />
        <Metric
          label="Proposed supply"
          value={`${report.proposedSpaces} spaces`}
          sub={`Governing min: ${governingMin}`}
        />
      </div>

      <VerdictBanner verdict={verdict} delta={report.governingDelta} />

      <div className="space-y-3">
        <h3 className="font-semibold">Hourly demand — weekday</h3>
        <BarRow data={report.hourlyProfileWeekday} peak={report.demand.weekdayPeak} />
        <h3 className="font-semibold pt-2">Hourly demand — Saturday</h3>
        <BarRow data={report.hourlyProfileSaturday} peak={report.demand.saturdayPeak} />
      </div>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Citations</summary>
        <ul className="mt-2 space-y-1 list-disc pl-5">
          {report.citations.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </details>
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}

function VerdictBanner({
  verdict, delta,
}: { verdict: "surplus" | "match" | "deficit"; delta: number }) {
  if (verdict === "surplus") {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-4 py-3 flex gap-2">
        <TrendingUp className="w-5 h-5 text-green-700 dark:text-green-300 mt-0.5" />
        <div>
          <div className="font-semibold text-green-800 dark:text-green-200">Proposed supply exceeds governing requirement</div>
          <div className="text-sm text-green-700 dark:text-green-300">
            Surplus of {delta} spaces vs. the higher of code minimum and ITE-adjusted demand.
          </div>
        </div>
      </div>
    );
  }
  if (verdict === "deficit") {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-4 py-3 flex gap-2">
        <TrendingDown className="w-5 h-5 text-red-700 dark:text-red-300 mt-0.5" />
        <div>
          <div className="font-semibold text-red-800 dark:text-red-200">Proposed supply is below governing requirement</div>
          <div className="text-sm text-red-700 dark:text-red-300">
            Deficit of {Math.abs(delta)} spaces. Add supply, apply for a variance, or document a
            shared-use agreement to bring the project into compliance.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 px-4 py-3 flex gap-2">
      <Minus className="w-5 h-5 text-blue-700 dark:text-blue-300 mt-0.5" />
      <div>
        <div className="font-semibold text-blue-800 dark:text-blue-200">Proposed supply meets the governing requirement exactly</div>
      </div>
    </div>
  );
}

function BarRow({
  data, peak,
}: { data: { hour: number; demand: number }[]; peak: number }) {
  const max = Math.max(peak, 1);
  return (
    <div className="flex items-end gap-0.5 h-24 border-b border-dashed">
      {data.map((d) => (
        <div key={d.hour} className="flex-1 flex flex-col items-center gap-1" title={`${d.hour}:00 — ${d.demand} spaces`}>
          <div
            className="w-full bg-blue-600 rounded-t"
            style={{ height: `${(d.demand / max) * 100}%`, minHeight: d.demand > 0 ? "2px" : "0" }}
          />
          {d.hour % 3 === 0 && (
            <div className="text-[9px] text-muted-foreground">{d.hour}</div>
          )}
        </div>
      ))}
    </div>
  );
}
