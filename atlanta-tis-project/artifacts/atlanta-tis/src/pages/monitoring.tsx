/**
 * Post-Build Verification — Monitoring dashboard.
 *
 * Lets a firm enroll completed studies for ongoing forecast-vs-actual
 * tracking. Each enrollment can produce reports on demand (or via the
 * monthly job once we wire it). The recurring-revenue SKU.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  ArrowLeft, Activity, Loader2, AlertCircle, RadioTower, CheckCircle2,
  TrendingUp, TrendingDown, Minus, Plus,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Enrollment = {
  id: string;
  label: string;
  siteLat: string;
  siteLon: string;
  status: string;
  enrolledAt: string;
  expectedOpenDate: string | null;
  lastReportAt: string | null;
  projectId: string | null;
};

type ReportPayload = {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  observed: { incidentSnapshots: number; incidentCountTotal: number; incidentsPerDay: number };
  baseline: { incidentsPerDay: number | null; source: string };
  comparison: {
    deltaPct: number | null;
    band: "within_forecast" | "above_forecast" | "below_forecast" | "insufficient_data";
    narrative: string;
  };
  citations: string[];
};

type ProjectListItem = {
  id: string;
  studyType: string;
  projectName: string;
  siteLat: string | null;
  siteLon: string | null;
};

export default function MonitoringPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<{ enrollmentId: string; payload: ReportPayload } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([
      fetch("/tis-api/monitoring/enrollments", { credentials: "include" }).then((r) => r.json()),
      fetch("/tis-api/projects", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([m, p]) => {
        setEnrollments(m.items ?? []);
        setProjects(p.items ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [isAuthenticated]);

  async function enroll(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedProjectId) { setError("Pick a project to monitor."); return; }
    const proj = projects?.find((p) => p.id === selectedProjectId);
    if (!proj || !proj.siteLat || !proj.siteLon) {
      setError("Selected project has no site coordinates.");
      return;
    }
    setEnrolling(true);
    try {
      const r = await fetch("/tis-api/monitoring/enrollments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: proj.id,
          label: label.trim() || proj.projectName,
          siteLat: Number(proj.siteLat),
          siteLon: Number(proj.siteLon),
          forecastSnapshot: { projectId: proj.id, studyType: proj.studyType },
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setEnrollments((prev) => prev ? [data.enrollment, ...prev] : [data.enrollment]);
      setLabel("");
      setSelectedProjectId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrollment failed.");
    } finally {
      setEnrolling(false);
    }
  }

  async function runReport(enrollmentId: string) {
    setError(null);
    setRunningId(enrollmentId);
    try {
      const r = await fetch(
        `/tis-api/monitoring/enrollments/${encodeURIComponent(enrollmentId)}/run`,
        { method: "POST", credentials: "include" },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setLastReport({ enrollmentId, payload: data.payload });
      setEnrollments((prev) => prev ? prev.map((e) => e.id === enrollmentId ? { ...e, lastReportAt: new Date().toISOString() } : e) : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report failed.");
    } finally {
      setRunningId(null);
    }
  }

  if (isLoading) return null;
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <p className="text-muted-foreground">Sign in to view post-build monitoring.</p>
        <button onClick={login} className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        <div>
          <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to projects
          </Link>
        </div>

        <header className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <RadioTower className="w-3.5 h-3.5" /> Post-Build Verification
          </div>
          <h1 className="text-3xl font-bold">Forecast vs. actual — continuous</h1>
          <p className="text-muted-foreground">
            Enroll a completed study to keep tracking it after the development opens.
            Each month we compare the live GDOT incident corpus against the same
            window a year ago and tell you whether the project is operating within
            the forecast envelope. Sell the report to your developer client as risk
            reduction; we'll never charge a study credit for it.
          </p>
        </header>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
          </div>
        )}

        <section className="border rounded-xl p-6 space-y-4 bg-background">
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-600" /> Enroll a project
          </h2>
          <form onSubmit={enroll} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <label className="space-y-1.5 md:col-span-2">
              <div className="text-sm font-medium">Pick a project from your firm history</div>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="input"
                data-testid="select-monitor-project"
              >
                <option value="">— select —</option>
                {(projects ?? []).filter((p) => p.siteLat && p.siteLon).map((p) => (
                  <option key={p.id} value={p.id}>{p.studyType.toUpperCase()} · {p.projectName}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <div className="text-sm font-medium">Label (optional)</div>
              <input
                type="text" value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="defaults to project name"
                className="input"
                data-testid="input-monitor-label"
              />
            </label>
            <button
              type="submit"
              disabled={enrolling}
              className="md:col-span-3 md:max-w-xs inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="button-monitor-enroll"
            >
              {enrolling && <Loader2 className="w-4 h-4 animate-spin" />}
              Enroll
            </button>
          </form>
          <p className="text-xs text-muted-foreground">
            Only projects with site coordinates can be enrolled (warrant / road-diet studies require manual coordinates — coming next).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Active enrollments</h2>
          {!enrollments ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : enrollments.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No enrollments yet. Enroll your first project above.
            </div>
          ) : (
            <div className="rounded-lg border divide-y divide-border">
              {enrollments.map((e) => (
                <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap" data-testid={`row-enrollment-${e.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{e.label}</div>
                    <div className="text-xs text-muted-foreground">
                      Site {Number(e.siteLat).toFixed(4)}, {Number(e.siteLon).toFixed(4)} · enrolled {new Date(e.enrolledAt).toLocaleDateString()}
                      {e.lastReportAt && <> · last report {new Date(e.lastReportAt).toLocaleDateString()}</>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => runReport(e.id)}
                    disabled={runningId === e.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border hover:bg-accent disabled:opacity-50"
                    data-testid={`button-monitor-run-${e.id}`}
                  >
                    {runningId === e.id && <Loader2 className="w-3 h-3 animate-spin" />}
                    Run report now
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {lastReport && <ReportPanel payload={lastReport.payload} />}
      </div>
      <SiteFooter />

      <style>{`.input { width: 100%; border-radius: 0.375rem; border: 1px solid hsl(var(--input)); background: var(--background); padding: 0.5rem 0.75rem; font-size: 0.875rem; }
      .input:focus { outline: 2px solid #2563eb; outline-offset: 1px; }`}</style>
    </div>
  );
}

function ReportPanel({ payload }: { payload: ReportPayload }) {
  const band = payload.comparison.band;
  const Icon =
    band === "above_forecast" ? TrendingUp :
    band === "below_forecast" ? TrendingDown :
    band === "within_forecast" ? CheckCircle2 : Minus;
  const tone =
    band === "above_forecast" ? "border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 text-amber-800 dark:text-amber-200" :
    band === "below_forecast" ? "border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 text-blue-800 dark:text-blue-200" :
    band === "within_forecast" ? "border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 text-green-800 dark:text-green-200" :
    "border-muted bg-muted/30 text-muted-foreground";

  return (
    <section className="border rounded-xl p-6 space-y-4 bg-background" data-testid="report-monitoring">
      <header>
        <h2 className="text-lg font-semibold inline-flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-600" /> Latest verification
        </h2>
        <div className="text-xs text-muted-foreground">
          Window {new Date(payload.periodStart).toLocaleDateString()} → {new Date(payload.periodEnd).toLocaleDateString()}
        </div>
      </header>

      <div className={"rounded-md border px-4 py-3 flex gap-2 " + tone}>
        <Icon className="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">{labelBand(band)}</div>
          <div className="text-sm">{payload.comparison.narrative}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <Stat label="Observed incidents / day" value={payload.observed.incidentsPerDay.toFixed(2)} sub={`${payload.observed.incidentCountTotal} total over window`} />
        <Stat label="Baseline incidents / day" value={payload.baseline.incidentsPerDay !== null ? payload.baseline.incidentsPerDay.toFixed(2) : "—"} sub={payload.baseline.source === "prior_year_window" ? "Prior-year window" : "Insufficient history"} />
        <Stat label="Δ vs baseline" value={payload.comparison.deltaPct !== null ? `${payload.comparison.deltaPct >= 0 ? "+" : ""}${payload.comparison.deltaPct.toFixed(0)}%` : "—"} sub="negative = improving" />
      </div>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Citations</summary>
        <ul className="mt-2 space-y-1 list-disc pl-5">
          {payload.citations.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </details>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function labelBand(b: string): string {
  switch (b) {
    case "within_forecast": return "Within forecast envelope";
    case "above_forecast": return "Above forecast";
    case "below_forecast": return "Below forecast (better than predicted)";
    case "insufficient_data": return "Insufficient baseline data";
    default: return b;
  }
}
