/**
 * Public landing page. Pitches Simple Impact Studies to engineering
 * firms (the customer) and PEs at those firms (the user).
 *
 * Three layers of CTAs route into the same funnel:
 *   - Hero primary  → /signup (14-day trial)
 *   - Hero secondary→ /studies (browse without signup)
 *   - Final CTA     → /signup (mirror of hero, reinforces)
 *
 * Visual language: Stripe / Linear inspired — strong typography,
 * generous whitespace, a product preview that shows what the
 * deliverable actually looks like instead of describing it.
 */
import { Link } from "wouter";
import {
  ArrowRight, FileCheck2, ShieldCheck, Clock, Layers,
  MapPin, BookOpen, Check, Sparkles, Building2, FileText, ChevronRight,
  TrendingUp, DollarSign, Hourglass, Zap,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { AtlantaLiveStatus } from "../components/atlanta-live-status";
import { CalibrationActivity } from "../components/calibration-activity";

export default function HomePage() {
  return (
    <div className="overflow-x-hidden">
      {/* Background — a subtle slate wash behind the hero so the page
          doesn't feel flat. Cool neutral, not the default-blue glow that
          reads as "another startup landing page." */}
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[600px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-10">
          <HeroSection />
        </div>
        {/* Live calibration counter — placed right under the hero so
            every visitor sees the algorithm working without scrolling.
            Renders nothing until the endpoint returns real data. */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-14 flex justify-center">
          <CalibrationActivity />
        </div>
      </div>

      <StatsBand />
      <RoiSection />
      <CapacitySection />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 space-y-24">
        <AtlantaLiveStatus />
        <PillarsSection />
        <WorkflowSection />
        <MethodologySection />
        <SpeedExplainerSection />
        <SubstituteCostSection />
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
        {/* Monospace eyebrow over a hairline rule — reads like the title
            block of a drawing set, not a marketing pill. */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live GDOT data · 49 metro signals indexed
          </div>
          <div className="h-px w-full bg-border" />
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[60px] font-bold leading-[1.04] text-slate-900 dark:text-slate-50">
          Defensible Traffic Impact Studies —{" "}
          {/* Highlighter swipe, the way an engineer marks the line that
              matters on a plan sheet. box-decoration-clone keeps the
              highlight intact across the line wrap. */}
          <span className="bg-amber-300 dark:bg-amber-400/90 dark:text-slate-900 box-decoration-clone px-1.5 -mx-0.5">
            without the week of engineer time.
          </span>
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-xl">
          Screening-level TIS, parking, signal warrants, sight distance, queuing,
          and road-diet studies — footnoted to HCM, ITE, MUTCD, and AASHTO. The math
          a senior reviewer expects, without the 40 hours of junior-PE grunt work.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/demo"
            className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm hover:shadow"
            data-testid="link-demo"
          >
            <Sparkles className="w-4 h-4" />
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
 * Faux deliverable preview — what an engineer actually receives.
 * Pure CSS / HTML so we don't need an image asset and it scales
 * cleanly. The numbers + intersection rows are realistic-but-fake
 * (drawn from a generic Atlanta multifamily site so they pass
 * sniff tests from a real PE).
 */
function ProductPreview() {
  return (
    <div className="relative">
      {/* Decorative glow behind the card */}
      <div
        aria-hidden
        className="absolute -inset-4 bg-gradient-to-br from-blue-500/15 to-transparent blur-2xl -z-10"
      />
      <div className="rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
        {/* Card header — looks like a project chrome */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 text-xs">
            <FileText className="w-4 h-4 text-blue-700" />
            <span className="font-mono text-muted-foreground">TIS-2026-0429</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Live preview
          </div>
        </div>

        {/* Project header */}
        <div className="px-5 py-4 border-b border-border space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-blue-700">
            Traffic Impact Study
          </div>
          <div className="text-lg font-bold">Peachtree Multifamily — 240 DU</div>
          <div className="text-xs text-muted-foreground">
            ITE 221 · Atlanta MSA · Opening year 2027
          </div>
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
          <MetricTile value="49" label="Intersections" />
          <MetricTile value="9" label="LOS E/F" tone="warn" />
          <MetricTile value="0" label="LOS drops" tone="good" />
          <MetricTile value="0.6s" label="Δ delay" />
        </div>

        {/* Mini intersections table */}
        <div className="px-5 py-4 space-y-2">
          <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
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

        {/* Footnote */}
        <div className="px-5 py-3 border-t border-border bg-muted/30 text-[10px] text-muted-foreground font-mono leading-relaxed">
          Per HCM 6th Ed. Ch.19 Exhibit 19-8: A ≤10s · B ≤20s · C ≤35s · D ≤55s · E ≤80s · F &gt;80s
        </div>
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
      <div className={`text-xl font-bold tabular-nums ${valueColor}`}>{value}</div>
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

/**
 * The LOS A–F color scale, rendered as a thin strip. This is the
 * traffic-engineer's native color language (HCM Exhibit 19-8) — using
 * it as a recurring brand motif is something no generic SaaS template
 * does, and every PE reads it instantly.
 */
function LosScaleStrip() {
  const grades: Array<{ g: string; c: string }> = [
    { g: "A", c: "bg-green-500" },
    { g: "B", c: "bg-green-500" },
    { g: "C", c: "bg-amber-400" },
    { g: "D", c: "bg-amber-500" },
    { g: "E", c: "bg-red-500" },
    { g: "F", c: "bg-red-600" },
  ];
  return (
    <div className="flex items-stretch h-1.5 w-full" aria-hidden>
      {grades.map((x, i) => (
        <div key={i} className={`flex-1 ${x.c}`} />
      ))}
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

function BigStat({
  value, label, sub,
}: { value: string; label: string; sub?: string }) {
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

/**
 * Concrete ROI math the buyer can mentally re-do. Three columns of
 * monthly volume → wage savings, with the subscription cost baked in
 * so the multiple is obvious. Methodology footnote makes the
 * assumptions explicit so a skeptical PE can challenge them.
 */
function RoiSection() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-24">
      <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        <div className="lg:col-span-5 space-y-5">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
            <TrendingUp className="w-3.5 h-3.5" />
            The math
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Pays for itself on
            <br />
            <span className="text-blue-700">day one.</span>
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            A junior PE bills 20–60 hours per screening TIS. At a $125/hr
            blended billable rate, that's <strong className="text-foreground">$5,000 of engineer time</strong> per
            study — billable to other projects the moment we hand the
            deliverable back.
          </p>
          <div className="text-sm text-muted-foreground leading-relaxed pt-1 border-l-2 border-slate-300 dark:border-slate-700 pl-3">
            Most firms charge clients for screening work either as a line
            item in the proposal or as hours against the project budget.
            Either way — when the screening completes in 60 seconds instead
            of a week, that line item becomes margin.
          </div>
        </div>
        <div className="lg:col-span-7">
          <div className="rounded-2xl border border-border bg-background overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between flex-wrap gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Wage savings, by plan
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">
                40 hrs/study × $125/hr blended
              </div>
            </div>
            <div className="divide-y divide-border">
              <RoiRow
                plan="Starter"
                volume="10 studies / mo"
                subscription="$599 / mo"
                savings="$50,000"
                multiple="83×"
              />
              <RoiRow
                plan="Growth"
                volume="30 studies / mo"
                subscription="$2,499 / mo"
                savings="$150,000"
                multiple="60×"
                highlight
              />
              <RoiRow
                plan="Enterprise"
                volume="170 studies / mo"
                subscription="$12,750 / mo"
                savings="$850,000"
                multiple="67×"
              />
            </div>
            <div className="px-6 py-4 border-t border-border bg-slate-50 dark:bg-slate-900/40 text-[11px] text-muted-foreground leading-relaxed">
              Methodology: 40 hours saved per screening at $125/hr is the
              midpoint of the ITE-typical 20–60 hr range and the 2026 Atlanta
              metro junior-PE billable rate. Savings shown are gross labor
              cost recovered — opportunity cost and proposal-win uplift not
              included. Enterprise meter at $75/study, sized to the typical
              high-volume firm's expected monthly run-rate.
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mt-5">
            <RoiTile
              icon={Hourglass}
              value="1,200 hrs"
              label="Engineer time freed / month"
              sub="At 30 studies/mo on Growth"
            />
            <RoiTile
              icon={DollarSign}
              value="$1.8M / yr"
              label="Wage savings at Growth cap"
              sub="Vs. $30K annual subscription"
            />
            <RoiTile
              icon={TrendingUp}
              value="20–80×"
              label="ROI range across plans"
              sub="Subscription vs. recovered wages"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function RoiRow({
  plan, volume, subscription, savings, multiple, highlight,
}: {
  plan: string;
  volume: string;
  subscription: string;
  savings: string;
  multiple: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "px-6 py-4 grid grid-cols-12 gap-3 items-center text-sm " +
        (highlight ? "bg-blue-50/60 dark:bg-blue-950/20" : "")
      }
    >
      <div className="col-span-3">
        <div className={`font-semibold tracking-tight ${highlight ? "text-blue-700" : "text-slate-900 dark:text-slate-100"}`}>
          {plan}
        </div>
        <div className="text-xs text-muted-foreground">{volume}</div>
      </div>
      <div className="col-span-3 text-xs text-muted-foreground tabular-nums">
        {subscription}
      </div>
      <div className="col-span-4 text-right">
        <div className="font-bold tabular-nums text-slate-900 dark:text-slate-100">{savings}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Monthly wage savings
        </div>
      </div>
      <div className="col-span-2 text-right">
        <div className="text-2xl font-bold tabular-nums text-blue-700">
          {multiple}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          ROI
        </div>
      </div>
    </div>
  );
}

function RoiTile({
  icon: Icon, value, label, sub,
}: { icon: typeof Hourglass; value: string; label: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
      <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
        {value}
      </div>
      <div className="text-xs font-medium leading-snug">{label}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{sub}</div>
    </div>
  );
}

/**
 * Capacity-uplift framing. The ROI section above sells cost savings;
 * this one sells revenue uplift — "you can now bid 4-6× more
 * projects than you could before." For a capacity-bottlenecked
 * engineering firm that's the bigger lever; cost savings show up on
 * the P&L, but throughput uplift shows up in the win-rate column.
 *
 * Numbers are conservative-but-defensible: pre-tool throughput
 * assumes a junior PE clears 1-2 screenings/month while juggling
 * other billable work (consistent with the 20-60 hour-per-study
 * range already on the page). Post-tool throughput is capped by the
 * Growth tier itself (30 studies/mo), so the multiple is honest.
 */
function CapacitySection() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 sm:pb-24">
      <div className="rounded-3xl border border-border bg-slate-50 dark:bg-slate-950/40 overflow-hidden">
        <div className="px-6 sm:px-12 py-10 sm:py-14 space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
              <Zap className="w-3.5 h-3.5" />
              Capacity unlocked
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Bid every project,
              <br />
              <span className="text-blue-700">not just the ones you can staff.</span>
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed pt-1">
              Engineering firms aren't demand-bottlenecked — they're
              capacity-bottlenecked. Every screening that takes a junior PE
              a week is a screening they can't bid. Cut that to 60 seconds
              and your firm is suddenly able to credibly chase work it had
              to politely decline before.
            </p>
          </div>

          <div className="grid lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-5">
              <CapacityCard
                tone="before"
                eyebrow="Without the tool"
                metric="4–8"
                unit="screenings / mo"
                detail="Per firm, junior-PE-time-bottlenecked. Each screening eats 20–60 hrs that compete with all other billable work."
              />
            </div>
            <div className="lg:col-span-2 flex items-center justify-center">
              <div className="text-3xl text-slate-400 dark:text-slate-600 hidden lg:block">
                →
              </div>
              <div className="text-2xl text-slate-400 dark:text-slate-600 lg:hidden rotate-90 py-2">
                →
              </div>
            </div>
            <div className="lg:col-span-5">
              <CapacityCard
                tone="after"
                eyebrow="With Simple Impact Studies"
                metric="30+"
                unit="screenings / mo"
                detail="Per firm. Same engineer headcount. The bottleneck moves from internal capacity to inbound demand."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <UpliftTile
              icon={TrendingUp}
              metric="4–6×"
              label="More projects you can credibly bid"
              sub="At constant engineer headcount"
            />
            <UpliftTile
              icon={Hourglass}
              metric="14,400 hrs"
              label="Engineer time freed per year"
              sub="At Growth cap of 30 studies/mo"
            />
            <UpliftTile
              icon={DollarSign}
              metric="$1.8M /yr"
              label="In billable hours redirected"
              sub="To real engineering work, not screenings"
            />
          </div>

          <p className="text-[11px] text-center text-muted-foreground leading-relaxed pt-2 max-w-3xl mx-auto">
            "Without the tool" baseline assumes 5 active engineers at the
            firm and each junior PE clears one screening every 1–2 weeks
            while handling other project work (consistent with the
            published 20–60 hr-per-study range). "More projects bid"
            multiple assumes win-rate stays constant — for most firms it
            actually rises, because faster screenings let you respond to
            developer RFPs ahead of slower competitors.
          </p>
        </div>
      </div>
    </section>
  );
}

function CapacityCard({
  tone, eyebrow, metric, unit, detail,
}: {
  tone: "before" | "after";
  eyebrow: string;
  metric: string;
  unit: string;
  detail: string;
}) {
  const isAfter = tone === "after";
  return (
    <div
      className={
        "h-full rounded-2xl p-6 sm:p-7 space-y-3 transition-all " +
        (isAfter
          ? "border-2 border-blue-700 bg-background shadow-md relative overflow-hidden"
          : "border border-border bg-background/60")
      }
    >
      {isAfter && (
        <div
          aria-hidden
          className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-blue-600/10 blur-2xl pointer-events-none"
        />
      )}
      <div className={`text-[11px] font-semibold uppercase tracking-widest ${isAfter ? "text-blue-700" : "text-muted-foreground"}`}>
        {eyebrow}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={
            "text-5xl sm:text-6xl font-bold tabular-nums tracking-tight " +
            (isAfter
              ? "text-blue-700"
              : "text-slate-700 dark:text-slate-400")
          }
        >
          {metric}
        </span>
        <span className="text-sm text-muted-foreground font-medium">{unit}</span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{detail}</p>
    </div>
  );
}

function UpliftTile({
  icon: Icon, metric, label, sub,
}: { icon: typeof Hourglass; metric: string; label: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
      <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-2xl font-bold tabular-nums tracking-tight text-blue-700">
        {metric}
      </div>
      <div className="text-xs font-medium leading-snug">{label}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{sub}</div>
    </div>
  );
}

function PillarsSection() {
  return (
    <section className="space-y-12">
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
          Why firms switch
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          A junior engineer's week, in a coffee break.
        </h2>
        <p className="text-muted-foreground text-lg">
          Three things every firm gets the day they sign up — no integration work,
          no consultant hours.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Pillar
          icon={Clock}
          title="20–60 hours → 60 seconds"
          body="What used to take a junior engineer a week — sourcing trip-generation rates, modeling capacity, drafting the report — is now one form submission."
        />
        <Pillar
          icon={ShieldCheck}
          title="PE-defensible by design"
          body="Every figure footnoted to HCM, ITE, and the MUTCD. Methodology + limitations appendices on every PDF. PE stamp box on the cover page."
        />
        <Pillar
          icon={FileCheck2}
          title="White-labeled deliverable"
          body="Your firm's logo on every cover page. Your PE name and license number in the signature block. Branded once, applied to every report."
        />
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className="space-y-12">
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
          The workflow
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Three inputs. One deliverable.
        </h2>
        <p className="text-muted-foreground text-lg">
          No CAD files, no manual data scraping, no Synchro session — the
          engine pulls live GDOT counts for every signal in your study radius.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Step
          n={1}
          icon={MapPin}
          title="Drop a pin"
          body="Site coordinates anywhere in the Atlanta MSA. The generator pulls GDOT counts and signal data for every intersection in the study radius (up to 6.5 mi)."
        />
        <Step
          n={2}
          icon={Building2}
          title="Pick a land use"
          body="ITE 11th Ed. codes for 80 use types — multifamily, office, retail, fuel station, drive-through… Enter the size; trip generation and pass-by capture are computed for you."
        />
        <Step
          n={3}
          icon={FileCheck2}
          title="Download the PDF"
          body="Cover page, executive summary, intersection table, mitigations, methodology + limitations appendices. Ready for PE review."
        />
      </div>
    </section>
  );
}

function MethodologySection() {
  return (
    <section className="grid lg:grid-cols-12 gap-10 items-center">
      <div className="lg:col-span-5 space-y-5">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
          The receipts
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Every figure cited inline.
        </h2>
        <p className="text-muted-foreground text-lg leading-relaxed">
          The deliverable that lands on a senior reviewer's desk has the same
          reference column engineers expect in a real TIS. No "trust the
          model" footnotes — every number traces to a published table.
        </p>
        <ul className="space-y-2.5 text-sm pt-1">
          <Bullet>HCM 6th Edition for capacity & LOS</Bullet>
          <Bullet>ITE Trip Generation 11th Edition for rates & K/D factors</Bullet>
          <Bullet>MUTCD 2009/2024 for warrants & signage</Bullet>
          <Bullet>AASHTO Green Book for geometric guidance</Bullet>
        </ul>
      </div>
      <div className="lg:col-span-7">
        <div className="rounded-2xl border border-border bg-background shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Sample footnote
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <BookOpen className="w-3.5 h-3.5" />
              Methodology appendix · p.7
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="font-mono text-xs leading-relaxed border-l-4 border-blue-600 pl-4 py-3 bg-muted/40 rounded-r">
              PM peak trip generation derived from ITE TGM 11th Ed., land use
              220 (Multifamily Housing — Low-Rise), fitted curve T = 0.51(X) +
              9.78 where X = dwelling units (n=42, R² = 0.93). 17% pass-by
              capture applied per ITE TGM Appendix B for sites within 0.25 mi
              of an arterial.
            </div>
            <div className="font-mono text-xs leading-relaxed border-l-4 border-blue-600 pl-4 py-3 bg-muted/40 rounded-r">
              Intersection control delay per HCM Ch. 19 Eq. 19-13. Cycle 90s,
              g/C 0.45, saturation flow 1,800 vphpl × weather factor. 15-min
              peak analysis period (T = 0.25 hr), incremental delay k = 0.5
              (pretimed).
            </div>
            <div className="text-xs text-muted-foreground pt-1">
              Every figure on every page is cited at this level of specificity.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * "How can this possibly be fast?" objection-killer. Senior PEs
 * default-distrust quick tools — if we don't explain the mechanics,
 * they conclude we must be skipping rigor. This section breaks down
 * the actual engineering choices that make 30–60s generation
 * possible without compromising the math. Goal: a PE who reads this
 * leaves thinking "ah, that's just competent software", not "this
 * is sketchy."
 */
function SpeedExplainerSection() {
  return (
    <section className="rounded-3xl border border-border bg-slate-50 dark:bg-slate-950/40 px-6 sm:px-12 py-12 sm:py-16 space-y-10">
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
          Behind the curtain
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          The math hasn't changed. The waiting has.
        </h2>
        <p className="text-muted-foreground text-lg leading-relaxed">
          Every figure in the deliverable comes from the same HCM, ITE, and
          MUTCD tables a senior reviewer would reach for. What's different
          is the work between you and the answer.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MechanicCard
          label="Step 1"
          title="GDOT data pre-indexed"
          body="Signal counts, intersection inventory, and live incident feeds stay loaded in-process. Synchro asks you to import counts manually. We did that work once, for all 49 metro signals."
        />
        <MechanicCard
          label="Step 2"
          title="HCM equations in parallel"
          body="Eq. 19-13 (control delay) and Eq. 19-50 (95th-percentile queue) run concurrently across every intersection in the study radius. Desktop tools evaluate one signal at a time."
        />
        <MechanicCard
          label="Step 3"
          title="ITE rates from one table"
          body="80 land-use codes loaded as a typed lookup, not flipped page-by-page. Pass-by and internal-capture defaults applied automatically per the published ITE TGM Appendix B."
        />
        <MechanicCard
          label="Step 4"
          title="No GUI overhead"
          body="No model setup, no scenario manager, no project file to debug. The form is the model. Generation streams to a structured report, not a windowed UI you have to navigate."
        />
      </div>
      <div className="rounded-xl border border-border bg-background p-5 sm:p-6 max-w-3xl mx-auto">
        <p className="text-sm text-muted-foreground leading-relaxed">
          <strong className="text-foreground">The numbers come out the same.</strong>{" "}
          Calibrated against ground-truth observations at signals where we
          have them — the report flags which intersections are calibrated
          and against how many samples — and otherwise uses HCM defaults a
          reviewer can independently verify. Run a study against a site
          you've already analyzed in Synchro; compare line-by-line. That's
          the test we built for.
        </p>
      </div>
    </section>
  );
}

function MechanicCard({
  label, title, body,
}: { label: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-5 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-blue-700">
        {label}
      </div>
      <div className="font-semibold tracking-tight">{title}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function SubstituteCostSection() {
  return (
    <section className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white px-6 sm:px-12 py-12 sm:py-16 overflow-hidden relative">
      {/* Subtle grid overlay for texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {/* Blue accent corner glow — replaces the all-blue gradient with
          a subtle blue highlight on dark slate, more enterprise-grade. */}
      <div
        aria-hidden
        className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl pointer-events-none"
      />
      <div className="relative grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-7 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-300">
            The economics
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            One outsourced screening costs more than a year of access.
          </h2>
          <p className="text-slate-300 text-lg leading-relaxed max-w-xl">
            A consultant-run screening TIS bills $3,000–9,000 in labor before
            a single intersection is modeled. A firm that runs 20 screenings a
            year on us recovers their subscription before lunch on day one.
          </p>
        </div>
        <div className="lg:col-span-5">
          <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6 space-y-4">
            <CostRow label="Outsourced screening TIS" value="$3K – $9K" sub="per study, labor only" />
            <CostRow label="Synchro Studio license" value="$3,298" sub="per seat, annual" />
            <CostRow label="PTV Vistro / Visum" value="$8K – $15K" sub="per seat, annual" />
            <div className="border-t border-white/15 pt-4 mt-2">
              <CostRow label="Simple Impact Studies — Growth" value="$2,499" sub="firm, monthly · unlimited seats" highlight />
            </div>
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
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className={`text-sm ${highlight ? "font-semibold text-white" : "text-slate-200"}`}>{label}</div>
        <div className="text-xs text-slate-400">{sub}</div>
      </div>
      <div className={`text-lg sm:text-xl font-bold tabular-nums whitespace-nowrap ${highlight ? "text-blue-300" : "text-slate-100"}`}>
        {value}
      </div>
    </div>
  );
}

function FinalCta() {
  return (
    <section className="text-center max-w-3xl mx-auto space-y-6">
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
        Try it on a real project this week.
      </h2>
      <p className="text-muted-foreground text-lg leading-relaxed">
        Ten free studies on signup. Run them on actual upcoming sites. If
        it doesn't save your engineers at least four hours per study, we'll
        part as friends.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Link
          href="/signup?plan=growth"
          className="group inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm"
          data-testid="link-cta-trial-bottom"
        >
          Start 14-day trial
          <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </Link>
        <Link
          href="/for-firms"
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg border border-border hover:bg-accent transition-colors"
          data-testid="link-for-firms-bottom"
        >
          For engineering firms <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}

function Pillar({
  icon: Icon, title, body,
}: { icon: typeof Clock; title: string; body: string }) {
  return (
    <div className="group relative rounded-2xl border border-border bg-background p-6 space-y-3 transition-all hover:border-foreground/20 hover:shadow-sm">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-700 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Step({
  n, icon: Icon, title, body,
}: { n: number; icon: typeof Clock; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-6 space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-full bg-foreground text-background text-xs font-bold flex items-center justify-center">
          {n}
        </span>
        <Icon className="w-5 h-5 text-blue-700" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 items-start">
      <Check className="w-4 h-4 text-blue-700 mt-1 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

/**
 * Layers + Sparkles + ChevronRight icons referenced — kept here so the
 * type-checker is happy with the imports above and so the file's
 * dependencies are explicit at a glance.
 */
void Layers;
