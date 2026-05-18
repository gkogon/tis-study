/**
 * Public landing page. Pitches Simple Impact Studies to engineering
 * firms (the customer) and PEs at those firms (the user).
 *
 * Visual language: a drawing set / instrument panel, not a SaaS
 * template. Sections are numbered like a report (§01–§06), separated
 * by hairline rules. Floating decorative cards are reserved for the
 * two things that ARE documents — the deliverable preview and the
 * sample footnote — everything else is hairline-divided cells.
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
        <EconomicsSection />
        <CapacitySection />
        <AtlantaLiveStatus />
        <DeliverableSection />
        <WorkflowSection />
        <MethodologySection />
        <SpeedSection />
      </div>

      <SubstituteCostBand />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
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

/**
 * Faux deliverable preview — what an engineer actually receives. One of
 * the two earned "cards" on the page: it depicts a document.
 */
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

/* ----- §01 — The economics --------------------------------------------- */
function EconomicsSection() {
  return (
    <section>
      <Marker n="01" label="The economics" />
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
            back on the billable board.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-blue-600 pl-4">
            You already bill clients for screening work — as a proposal
            line item, or as hours against the project. When that work
            takes a minute instead of a week, the hours stop being cost.
            They become margin.
          </p>
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
            cost recovered — opportunity cost and proposal-win uplift not
            included. Enterprise meter at $75/study.
          </p>
        </div>
      </div>
    </section>
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

/* ----- §02 — Capacity -------------------------------------------------- */
function CapacitySection() {
  return (
    <section>
      <Marker n="02" label="Capacity" />
      <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        <div className="lg:col-span-5 space-y-5">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Bid the work you currently turn down.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Engineering firms don't run out of demand. They run out of
            engineer-hours. Every screening that eats a junior PE's week
            is a project the firm can't take on. Cut the screening to a
            minute and the firm can chase work it used to turn away.
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Baseline assumes 5 active engineers and each junior PE clears
            one screening every 1–2 weeks alongside other project work.
            "More projects bid" holds win-rate constant — for most firms
            it rises, because faster screenings beat slower competitors to
            the developer's RFP.
          </p>
        </div>

        <div className="lg:col-span-7 space-y-5">
          <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            <CapacityCell tone="before" eyebrow="Without the tool" metric="4–8" unit="screenings / mo" />
            <div className="flex sm:flex-col items-center justify-center text-2xl text-slate-300 dark:text-slate-600 font-mono">
              →
            </div>
            <CapacityCell tone="after" eyebrow="With Simple Impact Studies" metric="30+" unit="screenings / mo" />
          </div>
          <div className="grid grid-cols-3 gap-px bg-border border border-border">
            <UpliftCell metric="4–6×" label="More projects you can bid" />
            <UpliftCell metric="14,400" label="Engineer hrs freed / yr" />
            <UpliftCell metric="$1.8M" label="Billable hours redirected / yr" />
          </div>
        </div>
      </div>
    </section>
  );
}

function CapacityCell({
  tone, eyebrow, metric, unit,
}: { tone: "before" | "after"; eyebrow: string; metric: string; unit: string }) {
  const isAfter = tone === "after";
  return (
    <div className={"p-6 border " + (isAfter ? "border-blue-700 bg-blue-50/40 dark:bg-blue-950/20" : "border-border bg-background")}>
      <div className={`font-mono text-[10px] uppercase tracking-[0.16em] ${isAfter ? "text-blue-700" : "text-muted-foreground"}`}>
        {eyebrow}
      </div>
      <div className="flex items-baseline gap-2 mt-3">
        <span className={`font-mono text-5xl font-bold tabular-nums tracking-tight ${isAfter ? "text-blue-700" : "text-slate-700 dark:text-slate-400"}`}>
          {metric}
        </span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function UpliftCell({ metric, label }: { metric: string; label: string }) {
  return (
    <div className="bg-background px-4 py-5 space-y-1">
      <div className="font-mono text-2xl font-bold tabular-nums tracking-tight text-blue-700">{metric}</div>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
    </div>
  );
}

/* ----- §03 — What you get on day one ----------------------------------- */
const DELIVERABLES = [
  {
    title: "A week of work, in a minute",
    body: "Sourcing trip-generation rates, modeling capacity, drafting the report — what used to take a junior engineer a week is one form submission.",
  },
  {
    title: "PE-defensible by design",
    body: "Every figure footnoted to HCM, ITE, and the MUTCD. Methodology and limitations appendices on every PDF. PE stamp box on the cover page.",
  },
  {
    title: "White-labeled deliverable",
    body: "Your firm's logo on every cover page. Your PE name and license number in the signature block. Branded once, applied to every report.",
  },
];

function DeliverableSection() {
  return (
    <section>
      <Marker n="03" label="What you get on day one" />
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl mb-2">
        No integration. No consultant hours. No setup call.
      </h2>
      <div className="divide-y divide-border border-y border-border mt-7">
        {DELIVERABLES.map((d, i) => (
          <div key={i} className="grid md:grid-cols-12 gap-x-6 gap-y-2 py-7">
            <div className="md:col-span-4 flex items-baseline gap-3">
              <span className="font-mono text-sm tabular-nums text-blue-700 font-semibold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-lg font-semibold tracking-tight">{d.title}</h3>
            </div>
            <p className="md:col-span-8 text-muted-foreground leading-relaxed">{d.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----- §04 — The workflow ---------------------------------------------- */
const STEPS = [
  {
    title: "Drop a pin",
    body: "Site coordinates anywhere in the Atlanta MSA. The generator pulls GDOT counts and signal data for every intersection in the study radius — up to 6.5 mi.",
  },
  {
    title: "Pick a land use",
    body: "ITE 11th Ed. codes for 80 use types — multifamily, office, retail, fuel station, drive-through. Enter the size; trip generation and pass-by capture are computed for you.",
  },
  {
    title: "Download the PDF",
    body: "Cover page, executive summary, intersection table, mitigations, methodology and limitations appendices. Ready for PE review.",
  },
];

function WorkflowSection() {
  return (
    <section>
      <Marker n="04" label="The workflow" />
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl mb-2">
        Three inputs. One report.
      </h2>
      <p className="text-muted-foreground text-lg max-w-2xl mb-7">
        No CAD files, no manual data scraping, no Synchro session.
      </p>
      <div className="grid sm:grid-cols-3 gap-px bg-border border border-border">
        {STEPS.map((s, i) => (
          <div key={i} className="bg-background p-6 sm:p-7 space-y-3">
            <div className="font-mono text-3xl font-bold tabular-nums text-slate-200 dark:text-slate-700">
              {String(i + 1).padStart(2, "0")}
            </div>
            <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----- §05 — The receipts ---------------------------------------------- */
function MethodologySection() {
  return (
    <section>
      <Marker n="05" label="The receipts" />
      <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        <div className="lg:col-span-5 space-y-5">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Every figure cited inline.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            The deliverable that lands on a senior reviewer's desk has the
            same reference column engineers expect in a real TIS. No
            "trust the model" footnotes — every number traces to a
            published table.
          </p>
          <ul className="space-y-2.5 text-sm">
            <Bullet>HCM 6th Edition for capacity &amp; LOS</Bullet>
            <Bullet>ITE Trip Generation 11th Edition for rates &amp; K/D factors</Bullet>
            <Bullet>MUTCD 2009/2024 for warrants &amp; signage</Bullet>
            <Bullet>AASHTO Green Book for geometric guidance</Bullet>
          </ul>
        </div>
        <div className="lg:col-span-7">
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
                17% pass-by capture applied per ITE TGM Appendix B.
              </p>
              <p className="font-mono text-xs leading-relaxed border-l-2 border-blue-600 pl-4 py-1 text-muted-foreground">
                Intersection control delay per HCM Ch. 19 Eq. 19-13. Cycle
                90s, g/C 0.45, saturation flow 1,800 vphpl × weather factor.
                15-min peak analysis period, incremental delay k = 0.5.
              </p>
              <p className="text-xs text-muted-foreground">
                Every figure on every page is cited at this level of specificity.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----- §06 — Why it runs in a minute ----------------------------------- */
const MECHANICS = [
  {
    title: "GDOT data pre-indexed",
    body: "Signal counts, intersection inventory, and live incident feeds stay loaded in-process. Synchro asks you to import counts manually. We did that work once, for all 49 metro signals.",
  },
  {
    title: "HCM equations in parallel",
    body: "Eq. 19-13 (control delay) and Eq. 19-50 (95th-percentile queue) run concurrently across every intersection in the study radius. Desktop tools evaluate one signal at a time.",
  },
  {
    title: "ITE rates from one table",
    body: "80 land-use codes loaded as a typed lookup, not flipped page-by-page. Pass-by and internal-capture defaults applied automatically per ITE TGM Appendix B.",
  },
  {
    title: "No GUI overhead",
    body: "No model setup, no scenario manager, no project file to debug. The form is the model. Generation streams to a structured report, not a windowed UI.",
  },
];

function SpeedSection() {
  return (
    <section>
      <Marker n="06" label="Why it runs in a minute" />
      <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        <div className="lg:col-span-4 space-y-5 lg:sticky lg:top-24">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Same math. We took the slow parts out.
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Every figure comes from the same HCM, ITE, and MUTCD tables a
            senior reviewer would reach for. Run a study against a site
            you've already analyzed in Synchro and compare line-by-line —
            that's the test we built for.
          </p>
        </div>
        <div className="lg:col-span-8">
          <div className="divide-y divide-border border-y border-border">
            {MECHANICS.map((m, i) => (
              <div key={i} className="flex gap-5 py-6">
                <span className="font-mono text-sm tabular-nums text-blue-700 font-semibold pt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="space-y-1.5">
                  <h3 className="font-semibold tracking-tight">{m.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{m.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----- Substitute-cost band (the one dark interlude) ------------------- */
function SubstituteCostBand() {
  return (
    <section className="bg-slate-950 text-white">
      <LosScaleStrip />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 grid lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-300">
            One outsourced screening
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            …costs more than a year of access.
          </h2>
          <p className="text-slate-300 text-lg leading-relaxed max-w-xl">
            A consultant-run screening TIS bills $3,000–9,000 in labor
            before a single intersection is modeled. A firm that runs 20
            screenings a year recovers its subscription before lunch on
            day one.
          </p>
        </div>
        <div className="lg:col-span-5">
          <div className="border border-white/15 divide-y divide-white/10">
            <CostRow label="Outsourced screening TIS" value="$3K – $9K" sub="per study, labor only" />
            <CostRow label="Synchro Studio license" value="$3,298" sub="per seat, annual" />
            <CostRow label="PTV Vistro / Visum" value="$8K – $15K" sub="per seat, annual" />
            <CostRow label="Simple Impact Studies — Growth" value="$2,499" sub="firm, monthly · unlimited seats" highlight />
          </div>
        </div>
      </div>
    </section>
  );
}

function CostRow({
  label, value, sub, highlight,
}: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={"flex items-baseline justify-between gap-3 px-5 py-4 " + (highlight ? "bg-white/[0.06]" : "")}>
      <div className="min-w-0">
        <div className={`text-sm ${highlight ? "font-semibold text-white" : "text-slate-200"}`}>{label}</div>
        <div className="text-xs text-slate-400 font-mono">{sub}</div>
      </div>
      <div className={`font-mono text-lg sm:text-xl font-bold tabular-nums whitespace-nowrap ${highlight ? "text-blue-300" : "text-slate-100"}`}>
        {value}
      </div>
    </div>
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

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 items-start">
      <Check className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
