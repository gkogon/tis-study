import { Link } from "wouter";
import {
  useGetBacktestReport,
  type BacktestReport,
  type BacktestDayRow,
} from "@workspace/api-client-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Printer, ShieldCheck, TrendingUp, Target, Calendar,
  Award, AlertCircle, BarChart3, FileText,
} from "lucide-react";

function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function fmtX(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return `${n.toFixed(1)}×`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function shortDate(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fullDate(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function HeroKpi({
  icon: Icon, label, value, sub, accent,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sub?: string;
  accent: "blue" | "green" | "purple" | "amber";
}) {
  const colors = {
    blue: "text-blue-600 bg-blue-50 dark:bg-blue-950/40",
    green: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40",
    purple: "text-purple-600 bg-purple-50 dark:bg-purple-950/40",
    amber: "text-amber-600 bg-amber-50 dark:bg-amber-950/40",
  }[accent];
  return (
    <Card className="break-inside-avoid">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${colors}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
            <div className="text-3xl font-bold mt-1 tabular-nums">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BacktestPageInner({ report }: { report: BacktestReport }) {
  // Build chart series oldest-first so the trend reads left-to-right.
  const trend = [...report.perDay].reverse().map((d) => ({
    label: shortDate(d.date),
    hitRate: d.hitRatePct,
    precision: d.precisionPct,
    incidents: d.actualSnappedSignals,
  }));

  const dowChart = report.byDayOfWeek.map((d) => ({
    label: DOW_NAMES[d.dow] ?? "",
    hitRate: d.meanHitRatePct,
    days: d.daysObserved,
  }));

  const beatsBaseline = report.liftMultiplier > 1.5;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6 print:py-0 print:max-w-none print:px-0">
      {/* Top nav row — hidden in print */}
      <div className="flex items-center justify-between print:hidden">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-home"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
          data-testid="button-print"
        >
          <Printer className="w-4 h-4" />
          Print / Save as PDF
        </button>
      </div>

      {/* Report header */}
      <header className="border-b pb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span className="font-medium uppercase tracking-wide text-xs">Audit-grade accuracy report</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold mt-2">Atlanta Traffic Prediction — Backtest Credibility Report</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Day-over-day evidence that the deployed traffic-prediction model concentrates real incidents on its
          high-risk shortlist meaningfully better than chance. Every number on this page is computed directly
          from the persisted prediction history — there is no smoothing, ex-post tuning, or cherry-picking.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-4 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            Window: {report.windowDays} day{report.windowDays === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline" className="font-mono">
            Model: {fmtNum(report.totalSignalsInModel)} signalized intersections
          </Badge>
          <Badge variant="outline" className="font-mono">
            Generated: {new Date(report.generatedAt).toLocaleString()}
          </Badge>
        </div>
      </header>

      {/* Hero KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <HeroKpi
          icon={TrendingUp}
          accent={beatsBaseline ? "green" : "amber"}
          label="Lift vs random"
          value={fmtX(report.liftMultiplier)}
          sub={`vs ${fmtPct(report.randomBaselinePct, 2)} chance baseline`}
        />
        <HeroKpi
          icon={Target}
          accent="blue"
          label="Pooled hit-rate"
          value={fmtPct(report.overallHitRatePct)}
          sub={`95% CI: ${fmtPct(report.hitRateCi95LowPct)}–${fmtPct(report.hitRateCi95HighPct)}`}
        />
        <HeroKpi
          icon={BarChart3}
          accent="purple"
          label="Median day"
          value={fmtPct(report.medianHitRatePct)}
          sub={`Mean: ${fmtPct(report.meanHitRatePct)}`}
        />
        <HeroKpi
          icon={Calendar}
          accent="amber"
          label="Days observed"
          value={String(report.daysObserved)}
          sub={`${fmtNum(report.totalIncidentReports)} live incidents scored`}
        />
      </section>

      {/* What this means — narrative */}
      <Card className="bg-muted/30 border-l-4 border-l-emerald-500 break-inside-avoid">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Award className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="text-sm leading-relaxed">
              <p className="font-semibold mb-1">What this means in plain English</p>
              <p className="text-muted-foreground">
                Across {report.daysObserved} day{report.daysObserved === 1 ? "" : "s"} of live observation, an average
                shortlist of <strong>{fmtNum(report.meanTopN)}</strong> intersections (out of {fmtNum(report.totalSignalsInModel)})
                captured <strong>{fmtPct(report.overallHitRatePct)}</strong> of the intersections that actually saw a reportable
                incident — <strong>{fmtX(report.liftMultiplier)}</strong> better than picking the same number of intersections
                at random. With {fmtNum(report.totalHits)} hits on {fmtNum(report.totalObservedIncidentSignals)} observed-incident
                signals, the 95% Wilson confidence interval for the true hit-rate is <strong>{fmtPct(report.hitRateCi95LowPct)}
                –{fmtPct(report.hitRateCi95HighPct)}</strong>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trend chart */}
      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle className="text-base">Daily hit-rate trend</CardTitle>
          <CardDescription>
            Percent of signals that saw a real incident which were already on the day's predicted shortlist.
            Dotted line = random-shortlist baseline at the average shortlist size.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                  domain={[0, (max: number) => Math.max(30, Math.ceil(max * 1.1))]}
                />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name === "hitRate" ? "Hit-rate" : "Precision"]}
                />
                <ReferenceLine y={report.randomBaselinePct} stroke="#94a3b8" strokeDasharray="4 4" label={{
                  value: "Random baseline", position: "right", fontSize: 10, fill: "#64748b",
                }} />
                <Line
                  type="monotone"
                  dataKey="hitRate"
                  stroke="#0079F2"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#0079F2" }}
                  activeDot={{ r: 6 }}
                  name="hitRate"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* DOW + best/worst day */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle className="text-base">By day of week</CardTitle>
            <CardDescription>Mean hit-rate, with sample size annotated.</CardDescription>
          </CardHeader>
          <CardContent>
            {dowChart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Not enough days observed yet.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dowChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(v: number, _n: string, props: any) => [
                        `${v.toFixed(1)}%`, `Hit-rate (${props.payload.days} day${props.payload.days === 1 ? "" : "s"})`,
                      ]}
                    />
                    <Bar dataKey="hitRate" radius={[4, 4, 0, 0]}>
                      {dowChart.map((_, i) => (
                        <Cell key={i} fill="#795EFF" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle className="text-base">Best & worst day</CardTitle>
            <CardDescription>Single-day hit-rate extremes from the observed window.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {report.bestDay ? (
              <div className="flex items-start gap-3">
                <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/30">
                  <Award className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Best</div>
                  <div className="text-lg font-semibold">{fmtPct(report.bestDay.hitRatePct)} <span className="text-sm font-normal text-muted-foreground">on {fullDate(report.bestDay.date)}</span></div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {report.bestDay.hits}/{report.bestDay.actualSnappedSignals} observed-incident signals on a {report.bestDay.topN}-signal shortlist.
                  </div>
                </div>
              </div>
            ) : null}
            {report.worstDay ? (
              <div className="flex items-start gap-3">
                <div className="p-2 rounded bg-red-50 dark:bg-red-950/30">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                </div>
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Worst</div>
                  <div className="text-lg font-semibold">{fmtPct(report.worstDay.hitRatePct)} <span className="text-sm font-normal text-muted-foreground">on {fullDate(report.worstDay.date)}</span></div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {report.worstDay.hits}/{report.worstDay.actualSnappedSignals} observed-incident signals on a {report.worstDay.topN}-signal shortlist.
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {/* Per-day detail table */}
      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle className="text-base">Per-day detail</CardTitle>
          <CardDescription>
            Source rows from the persisted prediction-history file. Hit-rate = hits ÷ snapped-incident signals;
            precision = hits ÷ shortlist size.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-left py-2 pr-2 font-medium">Date</th>
                  <th className="text-left py-2 px-2 font-medium">DOW</th>
                  <th className="text-right py-2 px-2 font-medium">Shortlist</th>
                  <th className="text-right py-2 px-2 font-medium">Incidents</th>
                  <th className="text-right py-2 px-2 font-medium">Snapped</th>
                  <th className="text-right py-2 px-2 font-medium">Hits</th>
                  <th className="text-right py-2 px-2 font-medium">Hit-rate</th>
                  <th className="text-right py-2 pl-2 font-medium">Precision</th>
                </tr>
              </thead>
              <tbody>
                {report.perDay.map((d: BacktestDayRow) => (
                  <tr key={d.date} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 pr-2 font-mono text-xs">{d.date}</td>
                    <td className="py-2 px-2 text-muted-foreground">{DOW_NAMES[d.dow]}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{d.topN}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{d.actualIncidentTotal}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{d.actualSnappedSignals}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-medium">{d.hits}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold">
                      {d.actualSnappedSignals > 0 ? fmtPct(d.hitRatePct) : "—"}
                    </td>
                    <td className="py-2 pl-2 text-right tabular-nums">
                      {d.topN > 0 ? fmtPct(d.precisionPct) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Methodology */}
      <Card className="break-inside-avoid">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Methodology</CardTitle>
          </div>
          <CardDescription>How every number on this page was computed.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm leading-relaxed text-muted-foreground list-decimal list-inside">
            {report.methodology.map((p, i) => (
              <li key={i} className="pl-1">{p}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <footer className="text-xs text-muted-foreground text-center pt-4 border-t">
        Backtest report generated by Atlanta Traffic Inefficiency Analyzer.
        Source: prediction-history.json (persisted at solar noon Atlanta time, daily).
      </footer>

      {/* Print stylesheet — Letter portrait, generous margins, hide nav */}
      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 0.5in; }
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
          /* Avoid huge page-spanning gaps from 100% width charts */
          .recharts-responsive-container { max-height: 280px !important; }
        }
      `}</style>
    </div>
  );
}

export default function BacktestPage() {
  const { data, isLoading, error } = useGetBacktestReport();

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="text-center text-muted-foreground">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
          <p>Could not load backtest report.</p>
          <p className="text-xs mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return <BacktestPageInner report={data} />;
}
