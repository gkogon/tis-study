import { Link } from "wouter";
import {
  useGetTrafficSummary,
  useGetBacktestReport,
  useGetInefficiencyRankings,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Printer,
  ShieldCheck,
  TrendingUp,
  Building2,
  Target,
  Calendar,
  CheckCircle2,
  Mail,
} from "lucide-react";

function fmtNum(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function fmtPct(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(d)}%`;
}

function fmtX(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n === 0) return "—";
  return `${n.toFixed(1)}×`;
}

function HeroBlock({
  label, value, sub, icon: Icon, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof TrendingUp;
  accent: "emerald" | "blue" | "purple" | "amber";
}) {
  const colorMap: Record<string, string> = {
    emerald: "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20",
    blue: "border-blue-300 bg-blue-50/60 dark:bg-blue-950/20",
    purple: "border-purple-300 bg-purple-50/60 dark:bg-purple-950/20",
    amber: "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20",
  };
  const iconColorMap: Record<string, string> = {
    emerald: "text-emerald-600",
    blue: "text-blue-600",
    purple: "text-purple-600",
    amber: "text-amber-600",
  };
  return (
    <div className={`border-l-4 rounded-md p-3 ${colorMap[accent]}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        <Icon className={`w-3 h-3 ${iconColorMap[accent]}`} />
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function ExecSummaryPage() {
  const summaryQ = useGetTrafficSummary();
  const backtestQ = useGetBacktestReport();
  const rankingsQ = useGetInefficiencyRankings();

  const loading = summaryQ.isLoading || backtestQ.isLoading || rankingsQ.isLoading;
  const summary = summaryQ.data;
  const backtest = backtestQ.data;
  const rankings = rankingsQ.data ?? [];

  if (loading) {
    return (
      <div className="max-w-[8.5in] mx-auto px-6 py-8 space-y-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const top5Critical = rankings
    .filter((r) => r.severity === "critical")
    .slice(0, 5);

  return (
    <div className="bg-background min-h-screen">
      {/* Top nav — hidden in print */}
      <div className="max-w-[8.5in] mx-auto px-6 py-4 flex items-center justify-between print:hidden">
        <Link
          href="/pitch"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-pitch"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to pitch page
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

      {/* The one-pager — sized to Letter portrait */}
      <article
        className="max-w-[8.5in] mx-auto px-6 pb-8 print:px-0 print:pb-0"
        data-testid="exec-summary-page"
      >
        {/* Header strip */}
        <header className="border-b-2 border-foreground pb-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="font-semibold">Executive Summary · For City DOT Procurement</span>
            <span>Generated {today}</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mt-2 leading-tight">
            Atlanta Traffic Intelligence Platform
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Replace 6-week, $40K consulting traffic studies with calibrated, audit-grade software.
          </p>
        </header>

        {/* Proof KPIs */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4 break-inside-avoid">
          <HeroBlock
            icon={Building2}
            accent="blue"
            label="Signals analyzed"
            value={fmtNum(summary?.intersectionCount)}
            sub="Atlanta metro live coverage"
          />
          <HeroBlock
            icon={TrendingUp}
            accent="emerald"
            label="Backtest lift"
            value={fmtX(backtest?.liftMultiplier)}
            sub={`vs ${fmtPct(backtest?.randomBaselinePct, 2)} random baseline`}
          />
          <HeroBlock
            icon={Target}
            accent="purple"
            label="Hit-rate"
            value={fmtPct(backtest?.overallHitRatePct)}
            sub={
              backtest
                ? `95% CI ${fmtPct(backtest.hitRateCi95LowPct)}–${fmtPct(backtest.hitRateCi95HighPct)}`
                : undefined
            }
          />
          <HeroBlock
            icon={Calendar}
            accent="amber"
            label="Days observed"
            value={String(backtest?.daysObserved ?? "—")}
            sub={`${fmtNum(backtest?.totalIncidentReports)} incidents scored`}
          />
        </section>

        {/* The pitch — 3 short paragraphs */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 text-[12px] leading-relaxed break-inside-avoid">
          <div>
            <h3 className="text-xs uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
              The Problem
            </h3>
            <p className="text-foreground/85">
              Cities pay engineering consultants $20K–$50K per Traffic Impact Study and wait
              4–8 weeks for results. The same firms re-use the same HCM and ITE methodologies
              every time. Meanwhile, the city has no audit trail showing whether the model
              they're paying for actually predicts congestion.
            </p>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-400 mb-1">
              Our Solution
            </h3>
            <p className="text-foreground/85">
              A Backtest Credibility Report that proves the model works, day after day, with
              Wilson 95% confidence intervals and lift over a random baseline. Built on HCM 6
              and ITE 11th Edition — the same standards your engineers already cite.
            </p>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wide font-semibold text-purple-700 dark:text-purple-400 mb-1">
              The Ask
            </h3>
            <p className="text-foreground/85">
              A 90-day paid pilot at <strong>$25K</strong> — sole-source-friendly under most city
              procurement thresholds. We'll calibrate to your signal feed, deliver a printed
              backtest report on your network, and stand up the live dashboard for your team.
            </p>
          </div>
        </section>

        {/* Most-stressed corridors today */}
        {top5Critical.length > 0 && (
          <section className="mt-5 break-inside-avoid">
            <h3 className="text-xs uppercase tracking-wide font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-red-600" />
              Live demo: 5 most stressed Atlanta intersections right now
            </h3>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/60 text-[10px] uppercase tracking-wide">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold">#</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Intersection</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Zone</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Score</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Avg delay</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Worst movement</th>
                  </tr>
                </thead>
                <tbody>
                  {top5Critical.map((r, i) => (
                    <tr key={r.id} className="border-t" data-testid={`row-critical-${i}`}>
                      <td className="px-2 py-1.5 text-muted-foreground font-mono">{i + 1}</td>
                      <td className="px-2 py-1.5 font-medium">{r.name}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.zone}</td>
                      <td className="px-2 py-1.5 text-right font-bold tabular-nums">{r.inefficiencyScore.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.avgDelaySeconds}s</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.worstMovement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Pricing strip */}
        <section className="mt-5 break-inside-avoid">
          <h3 className="text-xs uppercase tracking-wide font-semibold mb-2">Pricing</h3>
          <div className="grid grid-cols-3 gap-2.5 text-[11px]">
            <div className="border rounded-md p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Pilot</div>
              <div className="text-xl font-bold mt-0.5">$25K</div>
              <div className="text-[10px] text-muted-foreground">90-day engagement</div>
              <div className="mt-1.5 text-foreground/80">Single corridor, weekly check-ins.</div>
            </div>
            <div className="border-2 border-primary rounded-md p-3 bg-primary/5">
              <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">Standard ★</div>
              <div className="text-xl font-bold mt-0.5">$75K / yr</div>
              <div className="text-[10px] text-muted-foreground">Mid-size metro</div>
              <div className="mt-1.5 text-foreground/80">City-wide, SSO, API access.</div>
            </div>
            <div className="border rounded-md p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Enterprise</div>
              <div className="text-xl font-bold mt-0.5">$150K+ / yr</div>
              <div className="text-[10px] text-muted-foreground">State DOT / MPO</div>
              <div className="mt-1.5 text-foreground/80">Multi-jurisdiction rollup, custom integrations, dedicated SE.</div>
            </div>
          </div>
        </section>

        {/* What you get */}
        <section className="mt-5 break-inside-avoid">
          <h3 className="text-xs uppercase tracking-wide font-semibold mb-2">What's in every engagement</h3>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> Calibration to your live signal feed</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> Audit-grade Backtest Credibility Report (printed)</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> HCM 6 + ITE 11th Edition methodology compliance</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> $1M general liability + cyber liability insurance</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> Transparent data sourcing — no black-box ML</li>
          </ul>
        </section>

        {/* Footer / contact */}
        <footer className="mt-6 pt-3 border-t-2 border-foreground flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Next step</div>
            <div className="text-sm font-semibold mt-0.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              Reply with the corridor you'd like to see analyzed.
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              We'll come back in one business day with a tailored backtest on YOUR data.
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Methodology</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">HCM 6 · ITE 11th Edition</div>
            <div className="text-[10px] text-muted-foreground">Wilson 95% CI · Random baseline lift</div>
          </div>
        </footer>
      </article>

      {/* Print stylesheet — Letter portrait, single-page target */}
      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 0.5in; }
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
