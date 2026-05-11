/**
 * Read-only Signal Warrant Analysis report. Used by the generator page
 * after a successful run, and by the project-detail page for stored
 * warrant projects.
 */
import { CheckCircle2, XCircle, FileWarning } from "lucide-react";

type WarrantOutcome = {
  id: "1A" | "1B" | "3" | "7";
  name: string;
  description: string;
  met: boolean;
  hoursSatisfied: number;
  hoursRequired: number;
  hourBreakdown: {
    hour: number; majorVolume: number; minorVolume: number;
    majorThreshold: number; minorThreshold: number;
    majorMet: boolean; minorMet: boolean; bothMet: boolean;
  }[];
  notes: string[];
};

export type WarrantsReportT = {
  projectName: string;
  intersection: { name: string; major: string; minor: string; laneConfig: string };
  reductionApplied: boolean;
  warrants: WarrantOutcome[];
  anyWarrantMet: boolean;
  citations: string[];
};

export function WarrantsReport({ report }: { report: WarrantsReportT }) {
  return (
    <section className="border rounded-xl p-6 space-y-6 bg-background" data-testid="report-warrants">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold">{report.intersection.name}</h2>
        <div className="text-sm text-muted-foreground">{report.intersection.laneConfig}</div>
        {report.reductionApplied && (
          <div className="text-xs text-muted-foreground">70% threshold reduction applied (speed &gt; 40 mph or low-population).</div>
        )}
      </header>

      {report.anyWarrantMet ? (
        <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-4 py-3 flex gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-700 dark:text-green-300 mt-0.5" />
          <div>
            <div className="font-semibold text-green-800 dark:text-green-200">At least one MUTCD warrant is met.</div>
            <div className="text-sm text-green-700 dark:text-green-300">
              A signal at this location is supported by the screening analysis. A formal warrant study is the next step.
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-4 py-3 flex gap-2">
          <FileWarning className="w-5 h-5 text-amber-700 dark:text-amber-300 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-800 dark:text-amber-200">No warrants met under this screening.</div>
            <div className="text-sm text-amber-700 dark:text-amber-300">
              The intersection does not currently justify a signal under MUTCD Ch. 4C. Consider re-running with updated counts or a different lane configuration.
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {report.warrants.map((w) => <WarrantCard key={w.id} warrant={w} />)}
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

function WarrantCard({ warrant: w }: { warrant: WarrantOutcome }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start gap-2">
        {w.met ? (
          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
        ) : (
          <XCircle className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{w.name}</div>
          <div className="text-xs text-muted-foreground">{w.description}</div>
        </div>
        <div className={"text-sm font-semibold px-2 py-0.5 rounded-full whitespace-nowrap " + (w.met ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" : "bg-muted text-muted-foreground")}>
          {w.met ? "Met" : "Not met"} ({w.hoursSatisfied} / {w.hoursRequired} hr)
        </div>
      </div>
      {w.notes.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-0.5 pl-7 list-disc">
          {w.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <details className="pl-7">
        <summary className="text-xs text-blue-600 cursor-pointer hover:underline">Hour-by-hour detail</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-xs w-full">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1 pr-2">Hr</th>
                <th className="text-right py-1 pr-2">Major</th>
                <th className="text-right py-1 pr-2">Thresh</th>
                <th className="text-right py-1 pr-2">Minor</th>
                <th className="text-right py-1 pr-2">Thresh</th>
                <th className="text-right py-1">Both met</th>
              </tr>
            </thead>
            <tbody>
              {w.hourBreakdown.map((h) => (
                <tr key={h.hour} className={h.bothMet ? "bg-green-50/50 dark:bg-green-950/20" : ""}>
                  <td className="py-0.5 pr-2">{String(h.hour).padStart(2, "0")}:00</td>
                  <td className="py-0.5 pr-2 text-right">{h.majorVolume}</td>
                  <td className="py-0.5 pr-2 text-right text-muted-foreground">{h.majorThreshold}</td>
                  <td className="py-0.5 pr-2 text-right">{h.minorVolume}</td>
                  <td className="py-0.5 pr-2 text-right text-muted-foreground">{h.minorThreshold}</td>
                  <td className="py-0.5 text-right">{h.bothMet ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
