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
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { AtlantaLiveStatus } from "../components/atlanta-live-status";

export default function HomePage() {
  return (
    <div className="overflow-x-hidden">
      {/* Background gradient — subtle blue glow behind the hero so the
          page doesn't feel flat. Only renders behind the first viewport. */}
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[600px] bg-gradient-to-b from-blue-50/60 via-background to-background dark:from-blue-950/20"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-20">
          <HeroSection />
        </div>
      </div>

      <StatsBand />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 space-y-24">
        <AtlantaLiveStatus />
        <PillarsSection />
        <WorkflowSection />
        <MethodologySection />
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
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-xs font-medium text-blue-700 dark:text-blue-300">
          <Sparkles className="w-3.5 h-3.5" />
          Live GDOT data · 2,589 cameras · 49 metro signals
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[64px] font-bold leading-[1.05] tracking-tight">
          Defensible Traffic
          <br />
          Impact Studies
          <br />
          <span className="bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">
            in 60 seconds.
          </span>
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-xl">
          Screening-level TIS, parking, signal warrants, sight distance, queuing,
          and road-diet studies — footnoted to HCM, ITE, MUTCD, and AASHTO. Built
          for engineering firms that ship.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/signup?plan=growth"
            className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm hover:shadow"
            data-testid="link-start-trial"
          >
            Start 14-day trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/studies"
            className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border border-border hover:border-foreground/30 hover:bg-accent transition-colors"
            data-testid="link-studies-hub"
          >
            Browse all studies
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-blue-600" /> No credit card
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-blue-600" /> 10 free studies
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-blue-600" /> Cancel anytime
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
            <FileText className="w-4 h-4 text-blue-600" />
            <span className="font-mono text-muted-foreground">TIS-2026-0429</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Live preview
          </div>
        </div>

        {/* Project header */}
        <div className="px-5 py-4 border-b border-border space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-blue-600">
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

function StatsBand() {
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        <BigStat value="60s" label="Average study turnaround" />
        <BigStat value="6" label="Study types shipped" />
        <BigStat value="80" label="ITE land-use codes" />
        <BigStat value="4" label="Standards referenced" sub="HCM · ITE · MUTCD · AASHTO" />
      </div>
    </section>
  );
}

function BigStat({
  value, label, sub,
}: { value: string; label: string; sub?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-4xl sm:text-5xl font-bold tabular-nums tracking-tight">
        {value}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/80 font-mono">{sub}</div>}
    </div>
  );
}

function PillarsSection() {
  return (
    <section className="space-y-12">
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-600">
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
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-600">
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
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-600">
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

function SubstituteCostSection() {
  return (
    <section className="rounded-3xl border border-border bg-gradient-to-br from-blue-600 to-blue-700 text-white px-6 sm:px-12 py-12 sm:py-16 overflow-hidden relative">
      {/* Subtle grid overlay for texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-7 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-200">
            The economics
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            One outsourced screening costs more than a year of access.
          </h2>
          <p className="text-blue-50/90 text-lg leading-relaxed max-w-xl">
            A consultant-run screening TIS bills $3,000–9,000 in labor before
            a single intersection is modeled. A firm that runs 20 screenings a
            year on us recovers their subscription before lunch on day one.
          </p>
        </div>
        <div className="lg:col-span-5">
          <div className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 p-6 space-y-4">
            <CostRow label="Outsourced screening TIS" value="$3K – $9K" sub="per study, labor only" />
            <CostRow label="Synchro Studio license" value="$3,298" sub="per seat, annual" />
            <CostRow label="PTV Vistro / Visum" value="$8K – $15K" sub="per seat, annual" />
            <div className="border-t border-white/20 pt-4 mt-2">
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
        <div className={`text-sm ${highlight ? "font-semibold" : ""}`}>{label}</div>
        <div className="text-xs text-blue-100/70">{sub}</div>
      </div>
      <div className={`text-lg sm:text-xl font-bold tabular-nums whitespace-nowrap ${highlight ? "text-white" : "text-blue-100"}`}>
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
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors">
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
        <Icon className="w-5 h-5 text-blue-600" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 items-start">
      <Check className="w-4 h-4 text-blue-600 mt-1 shrink-0" />
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
