/**
 * Public /compare page. Direct competitive positioning against the
 * three real substitutes:
 *
 *   1. Outsourced consultants — "we'll hire a sub to do screening"
 *   2. Synchro Studio (Cubic Trafficware) — desktop incumbent
 *   3. PTV Vistro / Visum — premium desktop incumbent
 *
 * Goal: a prospect who's quoting Synchro, considering outsourcing,
 * or weighing a Vistro license should leave this page with the
 * substitute-cost argument firmly in mind.
 *
 * Honest framing: we're a screening tool, not a Synchro replacement.
 * The page makes that explicit so a senior PE doesn't read it as
 * overreach.
 */
import { Link } from "wouter";
import {
  ArrowRight, Check, X, Minus, Scale, Sparkles,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Verdict = "yes" | "no" | "partial";

type CompareRow = {
  feature: string;
  us: { v: Verdict; note?: string };
  synchro: { v: Verdict; note?: string };
  vistro: { v: Verdict; note?: string };
  outsourced: { v: Verdict; note?: string };
};

const ROWS: CompareRow[] = [
  {
    feature: "60-second turnaround",
    us: { v: "yes" },
    synchro: { v: "no", note: "hours of model setup per study" },
    vistro: { v: "no", note: "hours of model setup per study" },
    outsourced: { v: "no", note: "5–10 days typical" },
  },
  {
    feature: "Atlanta-MSA-specific data baked in",
    us: { v: "yes", note: "GDOT 511 live, 49 metro signals indexed" },
    synchro: { v: "no", note: "you supply counts" },
    vistro: { v: "no", note: "you supply counts" },
    outsourced: { v: "partial", note: "depends on the sub" },
  },
  {
    feature: "HCM 6th Ed. capacity model",
    us: { v: "yes" },
    synchro: { v: "yes" },
    vistro: { v: "yes" },
    outsourced: { v: "yes" },
  },
  {
    feature: "ITE 11th Ed. trip generation",
    us: { v: "yes", note: "80 land-use codes shipped" },
    synchro: { v: "partial", note: "TripGen add-on $649" },
    vistro: { v: "yes" },
    outsourced: { v: "yes" },
  },
  {
    feature: "MUTCD signal warrants",
    us: { v: "yes", note: "Warrants 1A, 1B, 3, 7" },
    synchro: { v: "partial", note: "Warrants 10 add-on $549" },
    vistro: { v: "yes" },
    outsourced: { v: "yes" },
  },
  {
    feature: "AASHTO sight distance",
    us: { v: "yes" },
    synchro: { v: "no" },
    vistro: { v: "no" },
    outsourced: { v: "yes" },
  },
  {
    feature: "Monte-Carlo sensitivity",
    us: { v: "yes", note: "100 iterations, ±10% trip / ±15% volume" },
    synchro: { v: "no" },
    vistro: { v: "partial", note: "manual scenarios" },
    outsourced: { v: "partial" },
  },
  {
    feature: "White-labeled PDF deliverable",
    us: { v: "yes", note: "your logo + PE block on every cover" },
    synchro: { v: "no", note: "manual report assembly" },
    vistro: { v: "no", note: "manual report assembly" },
    outsourced: { v: "yes" },
  },
  {
    feature: "Project history / audit trail",
    us: { v: "yes" },
    synchro: { v: "partial", note: "local .syn files" },
    vistro: { v: "partial", note: "local files" },
    outsourced: { v: "no", note: "lives in the sub's filing system" },
  },
  {
    feature: "Multi-engineer / firm-wide access",
    us: { v: "yes", note: "unlimited seats on Growth" },
    synchro: { v: "partial", note: "per-seat license, $1,998–$4,298 each" },
    vistro: { v: "no", note: "per-seat license" },
    outsourced: { v: "no" },
  },
  {
    feature: "Design-grade traffic modeling",
    us: { v: "no", note: "screening only — use Synchro for design submittal" },
    synchro: { v: "yes" },
    vistro: { v: "yes" },
    outsourced: { v: "yes" },
  },
];

const PRICE_COMPARE = [
  { who: "Outsourced screening TIS", cost: "$3,000 – $9,000", unit: "per study, labor only" },
  { who: "Synchro Studio (single seat)", cost: "$3,298 – $4,298", unit: "perpetual + annual maintenance" },
  { who: "PTV Vistro", cost: "$5,000 – $10,000", unit: "annual subscription, per seat" },
  { who: "PTV Visum", cost: "$8,000 – $15,000", unit: "annual subscription, per seat" },
  { who: "TransCAD", cost: "$6,000 – $7,200", unit: "annual subscription" },
  { who: "Simple Impact Studies — Starter", cost: "$599", unit: "firm-wide, monthly · 10 studies", highlight: true },
  { who: "Simple Impact Studies — Growth", cost: "$2,499", unit: "firm-wide, monthly · 30 studies · unlimited seats", highlight: true },
];

export default function ComparePage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 space-y-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 dark:bg-slate-100 border border-slate-900 dark:border-slate-100 text-xs font-medium text-white dark:text-slate-900">
            <Scale className="w-3.5 h-3.5" />
            How we compare
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight text-slate-900 dark:text-slate-50 max-w-3xl mx-auto">
            For screening,
            <br />
            <span className="bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              we beat the alternatives.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
            We're not a Synchro or Vistro replacement for design submittals.
            We're the screening tool you use before those tools — the one
            that picks which sites are worth modeling in the first place.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-20">

        <section className="space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
              Feature comparison
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Feature-by-feature, head to head.
            </h2>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-slate-50 dark:bg-slate-950/40 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold w-[36%]">Feature</th>
                    <th className="text-center px-4 py-3 font-semibold bg-blue-50 dark:bg-blue-950/30 border-x border-blue-200 dark:border-blue-900 w-[16%]">
                      Simple Impact Studies
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-muted-foreground w-[16%]">Synchro</th>
                    <th className="text-center px-4 py-3 font-semibold text-muted-foreground w-[16%]">PTV Vistro</th>
                    <th className="text-center px-4 py-3 font-semibold text-muted-foreground w-[16%]">Outsourced sub</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.feature} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium align-top">{row.feature}</td>
                      <Cell entry={row.us} highlight />
                      <Cell entry={row.synchro} />
                      <Cell entry={row.vistro} />
                      <Cell entry={row.outsourced} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center max-w-2xl mx-auto leading-relaxed">
            Verdict reflects the marketed scope of the off-the-shelf product
            at standard tier — not what a power user can custom-build.
            We've intentionally checked "no" against ourselves on
            design-grade modeling so this comparison doesn't oversell.
          </p>
        </section>

        <section className="space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
              Price comparison
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Cost of one alternative, per year of us.
            </h2>
            <p className="text-muted-foreground text-lg pt-1">
              Real published prices where the vendor lists them; midpoint
              range where they only quote.
            </p>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden">
            <ul className="divide-y divide-border">
              {PRICE_COMPARE.map((row) => (
                <li
                  key={row.who}
                  className={
                    "px-6 py-4 flex flex-wrap items-center justify-between gap-3 " +
                    (row.highlight ? "bg-blue-50/60 dark:bg-blue-950/20" : "")
                  }
                >
                  <div>
                    <div className={`font-semibold ${row.highlight ? "text-blue-700" : "text-slate-900 dark:text-slate-100"}`}>
                      {row.who}
                    </div>
                    <div className="text-xs text-muted-foreground">{row.unit}</div>
                  </div>
                  <div className={`text-xl font-bold tabular-nums whitespace-nowrap ${row.highlight ? "text-blue-700" : "text-slate-900 dark:text-slate-100"}`}>
                    {row.cost}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground text-center max-w-2xl mx-auto leading-relaxed">
            Sources: published vendor price sheets (Caliper, McTrans),
            leaked enterprise quotes (PDF4PRO), and consultant rate
            benchmarks from the Atlanta civil-engineering market (eng-tips,
            Salary.com 2025).
          </p>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white px-6 sm:px-12 py-12 sm:py-16 overflow-hidden relative">
          <div
            aria-hidden
            className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl pointer-events-none"
          />
          <div className="relative grid lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-blue-300">
                Honest about scope
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Use us first. Use them when the project demands it.
              </h2>
              <p className="text-slate-300 text-lg leading-relaxed">
                Most firms screen 20 sites for every 1 they take to
                full-fidelity Synchro or Vistro modeling. The screening
                step is where you spend a junior PE's week deciding "is
                this even worth modeling?" — that's the work we take to
                60 seconds.
              </p>
              <p className="text-slate-400 text-sm leading-relaxed">
                When a site clears screening and you need a full signal
                timing optimization, microsimulation, or a design-grade
                submittal — that's where Synchro / Vistro / SimTraffic
                earn their cost. We complement those tools; we don't
                replace them.
              </p>
            </div>
            <div className="lg:col-span-5 space-y-3">
              <FlowStep n={1} label="Site comes in (RFP / kickoff)" />
              <FlowStep n={2} label="Run Simple Impact Studies screening" highlight />
              <FlowStep n={3} label="Decide: kill, escalate, or design?" />
              <FlowStep n={4} label="If design: Synchro / Vistro full model" />
            </div>
          </div>
        </section>

        <section className="text-center max-w-3xl mx-auto space-y-6">
          <Sparkles className="w-10 h-10 text-blue-700 mx-auto" />
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Try it on a real project this week.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Ten free studies on signup, no credit card. Run them alongside
            your current screening workflow — tell us where the numbers
            diverge.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/signup?plan=growth"
              className="group inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm"
            >
              Start 14-day trial
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg border border-border hover:bg-accent transition-colors"
            >
              Talk to us instead
            </Link>
          </div>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function Cell({
  entry, highlight,
}: { entry: { v: Verdict; note?: string }; highlight?: boolean }) {
  const Icon =
    entry.v === "yes" ? Check :
    entry.v === "no" ? X :
    Minus;
  const color =
    entry.v === "yes" ? (highlight ? "text-blue-700" : "text-green-700 dark:text-green-400") :
    entry.v === "no" ? "text-red-600 dark:text-red-400" :
    "text-amber-600 dark:text-amber-400";
  return (
    <td className={`px-4 py-3 text-center align-top ${highlight ? "bg-blue-50/60 dark:bg-blue-950/15 border-x border-blue-200 dark:border-blue-900" : ""}`}>
      <div className="flex flex-col items-center gap-1">
        <Icon className={`w-5 h-5 ${color}`} />
        {entry.note && (
          <div className="text-[10px] text-muted-foreground leading-tight max-w-[140px]">
            {entry.note}
          </div>
        )}
      </div>
    </td>
  );
}

function FlowStep({
  n, label, highlight,
}: { n: number; label: string; highlight?: boolean }) {
  return (
    <div
      className={
        "flex items-center gap-3 rounded-lg p-3 " +
        (highlight
          ? "bg-blue-600/20 border border-blue-400/30"
          : "bg-white/5 border border-white/10")
      }
    >
      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${highlight ? "bg-blue-300 text-slate-900" : "bg-white/15 text-white"}`}>
        {n}
      </span>
      <span className={`text-sm ${highlight ? "font-semibold text-white" : "text-slate-300"}`}>
        {label}
      </span>
    </div>
  );
}
