/**
 * Public landing page. Pitches Simple Impact Studies to engineering
 * firms (the customer) and PEs at those firms (the user).
 *
 * Visual language: a drawing set / instrument panel. Numbered report
 * sections (§01–§03), hairline rules, big mono numbers. Kept short on
 * purpose — three content sections, each carrying real figures.
 *
 * The opener is `StudyAliveHero`: a pinned canvas simulation that builds
 * a study as the visitor scrolls (site → signal → rush hour → report).
 *
 * The whole page renders inside `.dark`, so the body below the opener
 * stays on the hero's near-black instrument panel instead of dropping
 * back to the light marketing theme. Grounds #0B1220 / #0F1729,
 * hairlines #1E2A3F / #2B3A52, muted text #8A9BB5, dim #5B6B85.
 */
import { Link } from "wouter";
import { ArrowRight, Check, BookOpen } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { StudyAliveHero } from "../components/study-alive-hero";
import { AtlantaLiveStatus } from "../components/atlanta-live-status";
import { CalibrationActivity } from "../components/calibration-activity";
import { CoverageGrid } from "../components/coverage-grid";
import { Marker, LosScaleStrip } from "../components/section-marker";
import { usePageMeta } from "../hooks/use-page-meta";
import { TOTAL_METROS, TOTAL_SIGNALS, COUNTRIES_COVERED, CONTINENTS_COVERED } from "../data/metro-coverage";

/**
 * Home A palette, expressed as overrides of the `.dark` tokens so every
 * token-based color inside the page (sections, coverage grid, the live
 * Atlanta widgets, the footer) lands on the same ground as the opener.
 */
const HOME_DARK_TOKENS = {
  "--background": "220 49% 8%", // #0B1220
  "--card": "220 49% 8%",
  "--border": "218 35% 18%", // #1E2A3F
  "--muted-foreground": "216 23% 63%", // #8A9BB5
} as React.CSSProperties;

export default function HomePage() {
  usePageMeta({
    title: "Simple Impact Studies — Defensible TIS without the week of engineer time",
    description: `Screening-level Traffic Impact Studies for engineering firms across ${TOTAL_METROS} cities in ${COUNTRIES_COVERED} countries on ${CONTINENTS_COVERED} continents (${TOTAL_SIGNALS.toLocaleString()} signals indexed). Openly-published capacity math, public trip-generation data, MUTCD, AASHTO — the math your reviewer expects, in about a minute.`,
    canonical: "https://simpleimpactstudies.com/",
  });

  return (
    <div className="dark bg-background text-foreground overflow-x-hidden" style={HOME_DARK_TOKENS}>
      <StudyAliveHero />

      <StatsBand />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 space-y-20">
        <MathSection />
        <CoverageGrid accent="amber" />
        <FlagshipSection />
        <EconomicsSection />
        <WorkflowSection />
        <FinalCta />
      </div>

      <SiteFooter />
    </div>
  );
}

function StatsBand() {
  return (
    <section id="after-hero" className="border-y border-[#1E2A3F] bg-[#0F1729]">
      <LosScaleStrip />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#1E2A3F]">
          <BigStat value="40 hrs" label="Junior production hours replaced, per study" />
          <BigStat value="$5,000" label="In junior-engineer production wages, per study" />
          <BigStat value="60s" label="Average study turnaround" />
          <BigStat value="6" label="Study engines" sub="TIS · Parking · Warrants · SD · Queuing · Road-Diet" />
        </div>
      </div>
    </section>
  );
}

function BigStat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="bg-[#0F1729] px-3 py-2 space-y-1.5">
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
    label: "Capacity analyses per intersection",
    sub: "4 approaches × existing + future × 100 Monte-Carlo runs",
  },
  {
    value: "100",
    label: "Monte-Carlo iterations",
    sub: "±10% trip rate, ±15% existing volume, every study",
  },
  {
    value: "80",
    label: "Trip-generation rate sets",
    sub: "Daily / AM / PM peak rates, per land use",
  },
  {
    value: "6",
    label: "Reference standards",
    sub: "Webster/Akçelik · NHTS · SANDAG · MUTCD · AASHTO · FHWA",
  },
];

const MECHANICS: Array<[string, string]> = [
  ["State-DOT data pre-indexed", `Signal counts, intersection inventory, and live incident feeds stay loaded in-process. We did the import once, for all ${TOTAL_SIGNALS.toLocaleString()} signals across ${TOTAL_METROS} metros.`],
  ["Capacity equations in parallel", "Webster–Akçelik control delay and 95th-percentile back-of-queue run concurrently across every intersection in the radius."],
  ["Trip rates from one table", "80 land-use codes as a typed lookup, not flipped page-by-page. Public-data average rates (SANDAG 2002 / NHTS 2017 / NCHRP 716), with pass-by and internal-capture credits applied before off-site assignment."],
  ["No GUI overhead", "No model setup, no scenario manager, no project file. The form is the model; generation streams straight to a structured report."],
];

function MathSection() {
  return (
    <section>
      <Marker n="01" label="The math" accent="amber" />
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 max-w-2xl">
        Real capacity math. We just took the week out.
      </h2>
      <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mt-3">
        Every figure comes from the same public-data sources a senior
        reviewer would reach for — openly-published Webster–Akçelik capacity methods, NHTS / SANDAG /
        NCHRP trip rates, and MUTCD / AASHTO / FHWA standards. Nothing is
        estimated past the point a published equation can carry it.
      </p>

      {/* Computational scale — the beefy numbers. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#2B3A52] border border-[#2B3A52] mt-8">
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
        typical screening clears tens of thousands of delay and queue
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
                <span className="font-mono text-sm tabular-nums text-amber-400 font-semibold pt-0.5">
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
            <div className="px-5 py-3 border-b border-border bg-[#0F1729] flex items-center justify-between">
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
                PM peak trip generation from public-data average rates
                (SANDAG 2002, corroborated by NHTS 2017 / NCHRP 716) for land
                use 220 (Multifamily — Low-Rise): 0.56 PM-peak vehicle trips
                per dwelling unit × 240 DU. Residual external trips after
                internal-capture and pass-by credits assigned off-site.
              </p>
              <p className="font-mono text-xs leading-relaxed border-l-2 border-blue-600 pl-4 py-1 text-muted-foreground">
                Intersection control delay per the Webster–Akçelik signalized model. Cycle
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

/* ----- Flagship section — Atlanta as the fully-wired reference ----------- */
function FlagshipSection() {
  return (
    <section className="space-y-8">
      <Marker n="A" label="Flagship reference" accent="amber" />
      <div className="grid lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-5 space-y-3">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Atlanta is the proof.
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            Every metro on the platform runs the same engine. Atlanta is
            our flagship — the only metro with the full live calibration
            stack (GDOT 511 incidents, hourly traffic-flow archives,
            crash history, weather sensors). The widgets below are real,
            live data from Atlanta right now — they prove the depth the
            engine can carry where the data exists.
          </p>
          <p className="text-xs text-muted-foreground/80 leading-relaxed font-mono">
            The other {TOTAL_METROS - 1} metros run the same Webster/NHTS/MUTCD math against
            the OSM signal graph + measured AADT from each state DOT (where
            published). See the per-metro coverage table above for what's
            wired where.
          </p>
        </div>
        <div className="lg:col-span-7 space-y-6">
          <CalibrationActivity />
          <AtlantaLiveStatus />
        </div>
      </div>
    </section>
  );
}

/* ----- §02 — The economics --------------------------------------------- */
function EconomicsSection() {
  return (
    <section>
      <Marker n="02" label="The economics" accent="amber" />
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
            <div className="px-4 py-2.5 bg-[#0F1729]">
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
            <div className="px-5 py-3 border-b border-border bg-[#0F1729] flex items-center justify-between flex-wrap gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Wage savings, by plan
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                40 hrs/study × $125/hr
              </span>
            </div>
            <div className="divide-y divide-border">
              <RoiRow plan="Starter" volume="5 studies / mo" subscription="$1,500 / mo" savings="$25,000" multiple="17×" />
              <RoiRow plan="Growth" volume="15 studies / mo" subscription="$5,000 / mo" savings="$75,000" multiple="15×" highlight />
              <RoiRow plan="Enterprise" volume="20+ studies / mo" subscription="$10,000 / mo" savings="$100,000" multiple="10×" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Methodology: 40 hours saved per screening at $125/hr is the
            midpoint of the typical 20–60 hr manual-screening range and the
            2026 US junior-PE billable rate. Savings shown are gross labor
            cost recovered. Enterprise is flat $10,000/mo — unlimited studies.
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
    <div className={"px-5 py-4 grid grid-cols-12 gap-3 items-center text-sm " + (highlight ? "bg-blue-500/10" : "")}>
      <div className="col-span-4 sm:col-span-3">
        <div className={`font-semibold tracking-tight ${highlight ? "text-blue-400" : "text-slate-900 dark:text-slate-100"}`}>
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
        <div className="font-mono text-2xl font-bold tabular-nums text-blue-400">{multiple}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ROI</div>
      </div>
    </div>
  );
}

/* ----- §03 — From inputs to report ------------------------------------- */
const STEPS: Array<[string, string]> = [
  ["Drop a pin", `Site coordinates anywhere in any of our ${TOTAL_METROS} covered metros. The generator pulls state-DOT counts and signal data for every intersection in the radius — up to 6.5 mi.`],
  ["Pick a land use", "Public-data land-use codes. Enter the size; trip generation and pass-by capture are computed for you."],
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
      <Marker n="03" label="From inputs to report" accent="amber" />
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl">
        Three inputs. One report.
      </h2>
      <p className="text-muted-foreground text-lg max-w-2xl mt-3">
        No CAD files, no manual data scraping, no Synchro session.
      </p>
      <div className="grid sm:grid-cols-3 gap-px bg-[#2B3A52] border border-[#2B3A52] mt-7">
        {STEPS.map(([title, body], i) => (
          <div key={title} className="bg-background p-6 sm:p-7 space-y-3">
            <div className="font-mono text-3xl font-bold tabular-nums text-[#5B6B85]">
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
            <Check className="w-4 h-4 text-blue-400 shrink-0" />
            {r}
          </span>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="rounded-[8px] border border-[#2B3A52] bg-[#0B1220] px-6 sm:px-10 py-12 sm:py-14">
      <div className="grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-8 space-y-3">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Try it on a real project this week.
          </h2>
          <p className="text-white/70 text-lg leading-relaxed max-w-xl">
            Ten free studies on signup. Run them on actual upcoming sites.
            If it doesn't save your engineers at least four hours per
            study, we'll part as friends.
          </p>
        </div>
        <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3">
          <Link
            href="/signup?plan=growth"
            className="group inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold rounded-lg bg-white text-slate-900 hover:bg-slate-100 transition-all"
            data-testid="link-cta-trial-bottom"
          >
            Start 14-day trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/for-firms"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold rounded-lg border border-white/25 text-white hover:bg-white/5 transition-colors"
            data-testid="link-for-firms-bottom"
          >
            For engineering firms
          </Link>
        </div>
      </div>
    </section>
  );
}
