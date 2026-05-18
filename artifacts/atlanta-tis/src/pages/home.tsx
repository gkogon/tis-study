/**
 * Public landing page. Pitches Simple Impact Studies to engineering
 * firms (the customer) and PEs at those firms (the user).
 *
 * Visual language: a drawing set / instrument panel. Numbered report
 * sections (§01–§03), hairline rules, big mono numbers. Kept short on
 * purpose — three content sections, each carrying real figures.
 */
import { Link } from "wouter";
import { ArrowRight, Check, FileText, BookOpen } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { AtlantaLiveStatus } from "../components/atlanta-live-status";
import { CalibrationActivity } from "../components/calibration-activity";
import { Marker, LosScaleStrip } from "../components/section-marker";

export default function HomePage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[600px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-10">
          <HeroSection />
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-14 flex justify-center">
          <CalibrationActivity />
        </div>
      </div>

      <StatsBand />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 space-y-20">
        <MathSection />
        <AtlantaLiveStatus />
        <EconomicsSection />
        <WorkflowSection />
        <FinalCta />
      </div>

      <SiteFooter />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
      <div className="lg:col-span-7 space-y-7">
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live GDOT data · 49 metro signals indexed
          </div>
          <div className="h-px w-full bg-border" />
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[60px] font-bold leading-[1.04] text-slate-900 dark:text-slate-50">
          A screening TIS shouldn't take{" "}
          <span className="bg-amber-300 dark:bg-amber-400/90 dark:text-slate-900 box-decoration-clone px-1.5 -mx-0.5">
            a week.
          </span>
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-xl">
          TIS, parking, signal warrants, sight distance, queuing, road diet.
          Every figure footnoted to HCM, ITE, MUTCD, or AASHTO. A junior PE
          spends 20 to 40 hours on a screening pass. Here it runs in about a minute.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/demo"
            className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
            data-testid="link-demo"
          >
            Try a live demo
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/signup?plan=growth"
            className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border border-border hover:border-foreground/30 hover:bg-accent transition-colors"
            data-testid="link-start-trial"
          >
            Start 14-day trial
          </Link>
          <a
            href="/sample-tis-report.pdf"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-sample-pdf"
          >
            <FileText className="w-4 h-4" />
            Or download a sample PDF
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-blue-700" /> No credit card
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-blue-700" /> 10 free studies
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-blue-700" /> Cancel anytime
          </span>
        </div>
      </div>

      <div className="lg:col-span-5">
        <ProductPreview />
      </div>
    </section>
  );
}

/** Faux deliverable preview — an earned card: it depicts a document. */
function ProductPreview() {
  return (
    <div className="rounded-lg border border-border bg-background shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2 text-xs">
          <FileText className="w-4 h-4 text-blue-700" />
          <span className="font-mono text-muted-foreground">TIS-2026-0429</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          Live preview
        </div>
      </div>

      <div className="px-5 py-4 border-b border-border space-y-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-blue-700">
          Traffic Impact Study
        </div>
        <div className="text-lg font-bold">Peachtree Multifamily — 240 DU</div>
        <div className="text-xs text-muted-foreground font-mono">
          ITE 221 · Atlanta MSA · Opening year 2027
        </div>
      </div>

      <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
        <MetricTile value="49" label="Intersections" />
        <MetricTile value="9" label="LOS E/F" tone="warn" />
        <MetricTile value="0" label="LOS drops" tone="good" />
        <MetricTile value="0.6s" label="Δ delay" />
      </div>

      <div className="px-5 py-4 space-y-2">
        <div className="grid grid-cols-12 gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-6">Signal</div>
          <div className="col-span-2 text-center">Existing</div>
          <div className="col-span-2 text-center">Future</div>
          <div className="col-span-2 text-right">Δ delay</div>
        </div>
        <IntersectionRow name="Peachtree & 5th" existing="C" future="C" delta="6.8s" />
        <IntersectionRow name="Spring & North Ave" existing="D" future="E" delta="23.4s" alert />
        <IntersectionRow name="W Peachtree & 14th" existing="F" future="F" delta="11.8s" />
        <IntersectionRow name="Crescent & 8th" existing="B" future="C" delta="4.1s" />
      </div>

      <div className="px-5 py-3 border-t border-border bg-muted/40 text-[10px] text-muted-foreground font-mono leading-relaxed">
        Per HCM 6th Ed. Ch.19 Exhibit 19-8: A ≤10s · B ≤20s · C ≤35s · D ≤55s · E ≤80s · F &gt;80s
      </div>
    </div>
  );
}

function MetricTile({
  value, label, tone,
}: { value: string; label: string; tone?: "warn" | "good" }) {
  const valueColor =
    tone === "warn" ? "text-amber-600" :
    tone === "good" ? "text-green-600" :
    "text-foreground";
  return (
    <div className="px-3 py-3 text-center">
      <div className={`font-mono text-xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}

const LOS_CHIP: Record<string, string> = {
  A: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  B: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  C: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  D: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  E: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  F: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

function IntersectionRow({
  name, existing, future, delta, alert,
}: { name: string; existing: string; future: string; delta: string; alert?: boolean }) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center text-xs">
      <div className="col-span-6 truncate font-medium">{name}</div>
      <div className="col-span-2 text-center">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${LOS_CHIP[existing] ?? ""}`}>
          {existing}
        </span>
      </div>
      <div className="col-span-2 text-center">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${LOS_CHIP[future] ?? ""}`}>
          {future}
        </span>
      </div>
      <div className={`col-span-2 text-right tabular-nums font-mono text-[11px] ${alert ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
        +{delta}
      </div>
    </div>
  );
}

function StatsBand() {
  return (
    <section className="border-y border-border bg-slate-50 dark:bg-slate-950/40">
      <LosScaleStrip />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        <BigStat value="40 hrs" label="Saved per screening study" />
        <BigStat value="$5,000" label="In junior-engineer wages, per study" />
        <BigStat value="60s" label="Average study turnaround" />
        <BigStat value="6" label="Study engines" sub="TIS · Parking · Warrants · SD · Queuing · Road-Diet" />
      </div>
    </section>
  );
}

function BigStat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-950/40 px-3 py-2 space-y-1.5">
      <div className="font-mono text-4xl sm:text-5xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
        {value}
      </div>
      <div className="text-sm text-muted-foreground leading-snug">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/80 font-mono leading-snug">{sub}</div>}
    </div>
  );
}

/* ----- §01 — The math -------------------------------------------------- */

const MATH_STATS: Array<{ value: string; unit?: string; label: string; sub: string }> = [
  {
    value: "800",
    label: "HCM analyses per intersection",
    sub: "4 approaches × existing + future × 100 Monte-Carlo runs",
  },
  {
    value: "100",
    label: "Monte-Carlo iterations",
    sub: "±10% trip rate, ±15% existing volume, every study",
  },
  {
    value: "66",
    label: "ITE trip-generation curves",
    sub: "Daily / AM / PM peak rates, per land use",
  },
  {
    value: "8",
    label: "Reference standards",
    sub: "HCM · ITE TGM · ITE PG · MUTCD · AASHTO · FHWA",
  },
];

const MECHANICS: Array<[string, string]> = [
  ["GDOT data pre-indexed", "Signal counts, intersection inventory, and live incident feeds stay loaded in-process. We did the import once, for all 49 metro signals."],
  ["HCM equations in parallel", "Eq. 19-13 (control delay) and Eq. 19-50 (95th-percentile queue) run concurrently across every intersection in the radius."],
  ["ITE rates from one table", "66 land-use codes as a typed lookup, not flipped page-by-page. Pass-by and internal capture applied per ITE TGM Appendix B."],
  ["No GUI overhead", "No model setup, no scenario manager, no project file. The form is the model; generation streams straight to a structured report."],
];

function MathSection() {
  return (
    <section>
      <Marker n="01" label="The math" />
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 max-w-2xl">
        Real HCM math. We just took the week out.
      </h2>
      <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mt-3">
        Every figure comes from the same HCM, ITE, and MUTCD tables a senior
        reviewer would reach for. Nothing is estimated past the point a
        published equation can carry it.
      </p>

      {/* Computational scale — the beefy numbers. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border mt-8">
        {MATH_STATS.map((s) => (
          <div key={s.label} className="bg-background px-5 py-6 space-y-2">
            <div className="font-mono text-5xl sm:text-6xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
              {s.value}
            </div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
              {s.label}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground leading-snug">
              {s.sub}
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed mt-3">
        Multiply by every signalized intersection in the study radius — a
        typical screening clears tens of thousands of HCM delay and queue
        solves before it returns a single number.
      </p>

      <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start mt-12">
        <div className="lg:col-span-6 space-y-4">
          <h3 className="text-xl font-bold tracking-tight">
            Why it still runs in a minute
          </h3>
          <div className="divide-y divide-border border-y border-border">
            {MECHANICS.map(([title, body], i) => (
              <div key={title} className="flex gap-4 py-4">
                <span className="font-mono text-sm tabular-nums text-blue-700 font-semibold pt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="space-y-1">
                  <div className="font-semibold tracking-tight text-sm">{title}</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 space-y-3">
          <div className="border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Sample footnote
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <BookOpen className="w-3.5 h-3.5" />
                Methodology appendix · p.7
              </span>
            </div>
            <div className="p-6 space-y-4">
              <p className="font-mono text-xs leading-relaxed border-l-2 border-blue-600 pl-4 py-1 text-muted-foreground">
                PM peak trip generation derived from ITE TGM 11th Ed., land
                use 220 (Multifamily Housing — Low-Rise), fitted curve T =
                0.51(X) + 9.78 where X = dwelling units (n=42, R² = 0.93).
                17% pass-by capture per ITE TGM Appendix B.
              </p>
              <p className="font-mono text-xs leading-relaxed border-l-2 border-blue-600 pl-4 py-1 text-muted-foreground">
                Intersection control delay per HCM Ch. 19 Eq. 19-13. Cycle
                90s, g/C 0.45, saturation flow 1,800 vphpl × weather factor.
                15-min peak period, incremental delay k = 0.5.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Every figure on every page is cited at this level. Run a study
            against a site you've already analyzed in Synchro and compare
            line-by-line — that's the test we built for.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ----- §02 — The economics --------------------------------------------- */
function EconomicsSection() {
  return (
    <section>
      <Marker n="02" label="The economics" />
      <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        <div className="lg:col-span-5 space-y-5">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            It pays for itself on the first study.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            A junior PE bills 20 to 60 hours on a screening TIS. At a
            $125/hr blended rate that's{" "}
            <strong className="text-foreground">$5,000 of engineer time</strong>{" "}
            per study. When the screening takes a minute, those hours go
            back on the billable board — and the freed capacity lets a firm
            bid 4 to 6× more projects at the same headcount.
          </p>
          <div className="border border-border divide-y divide-border">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/40">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                The alternative — what one screening costs elsewhere
              </span>
            </div>
            <CostRow label="Outsourced screening TIS" value="$3K–9K" sub="per study, labor only" />
            <CostRow label="Synchro Studio license" value="$3,298" sub="per seat, annual" />
            <CostRow label="PTV Vistro / Visum" value="$8K–15K" sub="per seat, annual" />
          </div>
        </div>

        <div className="lg:col-span-7 space-y-4">
          <div className="border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between flex-wrap gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Wage savings, by plan
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                40 hrs/study × $125/hr
              </span>
            </div>
            <div className="divide-y divide-border">
              <RoiRow plan="Starter" volume="10 studies / mo" subscription="$599 / mo" savings="$50,000" multiple="83×" />
              <RoiRow plan="Growth" volume="30 studies / mo" subscription="$2,499 / mo" savings="$150,000" multiple="60×" highlight />
              <RoiRow plan="Enterprise" volume="170 studies / mo" subscription="$12,750 / mo" savings="$850,000" multiple="67×" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Methodology: 40 hours saved per screening at $125/hr is the
            midpoint of the ITE-typical 20–60 hr range and the 2026 Atlanta
            metro junior-PE billable rate. Savings shown are gross labor
            cost recovered. Enterprise meter at $75/study.
          </p>
        </div>
      </div>
    </section>
  );
}

function CostRow({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="px-4 py-3 flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</div>
        <div className="text-xs text-muted-foreground font-mono">{sub}</div>
      </div>
      <div className="font-mono text-base font-bold tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}

function RoiRow({
  plan, volume, subscription, savings, multiple, highlight,
}: {
  plan: string; volume: string; subscription: string;
  savings: string; multiple: string; highlight?: boolean;
}) {
  return (
    <div className={"px-5 py-4 grid grid-cols-12 gap-3 items-center text-sm " + (highlight ? "bg-blue-50/60 dark:bg-blue-950/20" : "")}>
      <div className="col-span-4 sm:col-span-3">
        <div className={`font-semibold tracking-tight ${highlight ? "text-blue-700" : "text-slate-900 dark:text-slate-100"}`}>
          {plan}
        </div>
        <div className="text-xs text-muted-foreground">{volume}</div>
      </div>
      <div className="col-span-3 hidden sm:block font-mono text-xs text-muted-foreground tabular-nums">
        {subscription}
      </div>
      <div className="col-span-5 sm:col-span-4 text-right">
        <div className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">{savings}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Monthly wage savings</div>
      </div>
      <div className="col-span-3 sm:col-span-2 text-right">
        <div className="font-mono text-2xl font-bold tabular-nums text-blue-700">{multiple}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ROI</div>
      </div>
    </div>
  );
}

/* ----- §03 — From inputs to report ------------------------------------- */
const STEPS: Array<[string, string]> = [
  ["Drop a pin", "Site coordinates anywhere in the Atlanta MSA. The generator pulls GDOT counts and signal data for every intersection in the radius — up to 6.5 mi."],
  ["Pick a land use", "ITE 11th Ed. codes for 66 use types. Enter the size; trip generation and pass-by capture are computed for you."],
  ["Download the PDF", "Cover page, executive summary, intersection table, mitigations, methodology and limitations appendices. Ready for PE review."],
];

const REPORT_INCLUDES = [
  "Cover page with your firm's logo + PE stamp block",
  "Executive summary metric strip",
  "Per-intersection capacity table, color-coded by LOS",
  "Recommended mitigations sized to the impact",
  "Methodology + limitations appendices",
];

function WorkflowSection() {
  return (
    <section>
      <Marker n="03" label="From inputs to report" />
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl">
        Three inputs. One report.
      </h2>
      <p className="text-muted-foreground text-lg max-w-2xl mt-3">
        No CAD files, no manual data scraping, no Synchro session.
      </p>
      <div className="grid sm:grid-cols-3 gap-px bg-border border border-border mt-7">
        {STEPS.map(([title, body], i) => (
          <div key={title} className="bg-background p-6 sm:p-7 space-y-3">
            <div className="font-mono text-3xl font-bold tabular-nums text-slate-200 dark:text-slate-700">
              {String(i + 1).padStart(2, "0")}
            </div>
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        {REPORT_INCLUDES.map((r) => (
          <span key={r} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-blue-700 shrink-0" />
            {r}
          </span>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="border border-border bg-slate-50 dark:bg-slate-950/40 px-6 sm:px-10 py-12 sm:py-14">
      <div className="grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-8 space-y-3">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Try it on a real project this week.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-xl">
            Ten free studies on signup. Run them on actual upcoming sites.
            If it doesn't save your engineers at least four hours per
            study, we'll part as friends.
          </p>
        </div>
        <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3">
          <Link
            href="/signup?plan=growth"
            className="group inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
            data-testid="link-cta-trial-bottom"
          >
            Start 14-day trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/for-firms"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg border border-border hover:bg-accent transition-colors"
            data-testid="link-for-firms-bottom"
          >
            For engineering firms
          </Link>
        </div>
      </div>
    </section>
  );
}
