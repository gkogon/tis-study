/**
 * Public /compare page. Direct competitive positioning against the
 * three real substitutes: outsourced consultants, Synchro Studio, and
 * PTV Vistro / Visum.
 *
 * Honest framing: we're a screening tool, not a Synchro replacement.
 * The page makes that explicit so a senior PE doesn't read it as
 * overreach.
 *
 * Visual language matches home.tsx: numbered report sections, hairline
 * rules, plain-bordered tables.
 */
import { Link } from "wouter";
import { ArrowRight, Check, X, Minus } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { Marker } from "../components/section-marker";

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
    us: { v: "yes", note: "66 land-use codes shipped" },
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

const PIPELINE: Array<{ label: string; highlight?: boolean }> = [
  { label: "Site comes in — RFP or kickoff" },
  { label: "Run Simple Impact Studies screening", highlight: true },
  { label: "Decide: kill, escalate, or design" },
  { label: "If design: Synchro / Vistro full model" },
];

export default function ComparePage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-10">
          <section className="max-w-3xl space-y-6">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                How we compare
              </div>
              <div className="h-px w-full bg-border" />
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.04] text-slate-900 dark:text-slate-50">
              For screening, we beat the alternatives.
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
              We're not a Synchro or Vistro replacement for design
              submittals. We're the screening tool you use before those
              tools — the one that picks which sites are worth modeling in
              the first place.
            </p>
          </section>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 space-y-20">
        <section>
          <Marker n="01" label="Feature comparison" />
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-6">
            Feature-by-feature, head to head.
          </h2>
          <div className="border border-border overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-slate-50 dark:bg-slate-950/40 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold w-[36%]">Feature</th>
                  <th className="text-center px-4 py-3 font-semibold bg-blue-50 dark:bg-blue-950/30 border-x border-border w-[16%]">
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
          <p className="text-xs text-muted-foreground leading-relaxed mt-3 max-w-2xl">
            Verdict reflects the marketed scope of the off-the-shelf product
            at standard tier — not what a power user can custom-build. We've
            intentionally checked "no" against ourselves on design-grade
            modeling so this comparison doesn't oversell.
          </p>
        </section>

        <section>
          <Marker n="02" label="Price comparison" />
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-2">
            Cost of one alternative, per year of us.
          </h2>
          <p className="text-muted-foreground text-lg mb-6 max-w-2xl">
            Real published prices where the vendor lists them; midpoint
            range where they only quote.
          </p>
          <ul className="border border-border divide-y divide-border">
            {PRICE_COMPARE.map((row) => (
              <li
                key={row.who}
                className={
                  "px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 " +
                  (row.highlight ? "bg-blue-50/60 dark:bg-blue-950/20" : "")
                }
              >
                <div>
                  <div className={`font-semibold ${row.highlight ? "text-blue-700" : "text-slate-900 dark:text-slate-100"}`}>
                    {row.who}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{row.unit}</div>
                </div>
                <div className={`font-mono text-xl font-bold tabular-nums whitespace-nowrap ${row.highlight ? "text-blue-700" : "text-slate-900 dark:text-slate-100"}`}>
                  {row.cost}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground leading-relaxed mt-3 max-w-2xl">
            Sources: published vendor price sheets (Caliper, McTrans), leaked
            enterprise quotes (PDF4PRO), and consultant rate benchmarks from
            the Atlanta civil-engineering market (eng-tips, Salary.com 2025).
          </p>
        </section>

        <section>
          <Marker n="03" label="Where we fit" />
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
            <div className="lg:col-span-6 space-y-4">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                Use us first. Use them when the project demands it.
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Most firms screen 20 sites for every 1 they take to
                full-fidelity Synchro or Vistro modeling. The screening step
                is where you spend a junior PE's week deciding "is this even
                worth modeling?" — that's the work we take to 60 seconds.
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                When a site clears screening and you need full signal-timing
                optimization, microsimulation, or a design-grade submittal —
                that's where Synchro / Vistro / SimTraffic earn their cost.
                We complement those tools; we don't replace them.
              </p>
            </div>
            <div className="lg:col-span-6">
              <div className="border-y border-border divide-y divide-border">
                {PIPELINE.map((step, i) => (
                  <div
                    key={i}
                    className={"flex items-center gap-4 py-4 " + (step.highlight ? "bg-blue-50/60 dark:bg-blue-950/20 -mx-4 px-4" : "")}
                  >
                    <span className={`font-mono text-sm tabular-nums font-semibold ${step.highlight ? "text-blue-700" : "text-muted-foreground"}`}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={`text-sm ${step.highlight ? "font-semibold text-slate-900 dark:text-slate-100" : "text-muted-foreground"}`}>
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border border-border bg-slate-50 dark:bg-slate-950/40 px-6 sm:px-10 py-10 space-y-4">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Try it on a real project this week.
          </h2>
          <p className="text-muted-foreground leading-relaxed max-w-xl">
            Ten free studies on signup, no credit card. Run them alongside
            your current screening workflow — tell us where the numbers
            diverge.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/signup?plan=growth"
              className="group inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
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
    <td className={`px-4 py-3 text-center align-top ${highlight ? "bg-blue-50/60 dark:bg-blue-950/15 border-x border-border" : ""}`}>
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
