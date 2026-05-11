import { Link } from "wouter";
import {
  useGetTrafficSummary,
  useGetBacktestReport,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ShieldCheck,
  Building2,
  CheckCircle2,
  Clock,
  TrendingUp,
  Sparkles,
  Mail,
  ArrowRight,
  FileText,
} from "lucide-react";

interface Tier {
  name: string;
  price: string;
  cadence: string;
  best: string;
  features: string[];
  cta: string;
  productInterest: string;
  highlight?: boolean;
}

const TIERS: Tier[] = [
  {
    name: "Pilot",
    price: "$25K",
    cadence: "90-day engagement",
    best: "Best for: a single department or one corridor",
    features: [
      "Backtest Credibility Report on YOUR city's signals",
      "1 corridor deep-dive (target intersections of your choice)",
      "Weekly check-ins with our team",
      "Convert to Standard at any time, no penalty",
    ],
    cta: "Start a 90-day pilot",
    productInterest: "pilot",
  },
  {
    name: "Standard",
    price: "$75K",
    cadence: "per year",
    best: "Best for: city-wide rollout, mid-size metro",
    features: [
      "Everything in Pilot",
      "City-wide signal coverage",
      "Quarterly executive briefings",
      "API access for your engineers",
      "Single Sign-On (SAML / Microsoft Entra)",
    ],
    cta: "Talk to sales",
    productInterest: "standard",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "$150K+",
    cadence: "per year",
    best: "Best for: state DOT, multi-jurisdiction, MPO",
    features: [
      "Everything in Standard",
      "Multi-jurisdiction rollup dashboards",
      "Custom integrations (ATMS, CCTV, AVL)",
      "Dedicated solutions engineer",
      "On-prem / FedRAMP-track deployment option",
      "Custom SLAs and security review support",
    ],
    cta: "Request enterprise pricing",
    productInterest: "enterprise",
  },
];

function HeroStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-white/60 font-medium">{label}</div>
      <div className="text-2xl md:text-3xl font-bold text-white mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-white/70 mt-0.5">{sub}</div>}
    </div>
  );
}

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

function DemoForm() {
  return (
    <div className="text-center space-y-4" data-testid="contact-cta">
      <p className="text-sm text-muted-foreground">
        Email us with your city, role, and top traffic problem. We'll respond within one business
        day with a 30-minute demo on YOUR data.
      </p>
      <a
        href="mailto:hello@example.com?subject=Atlanta%20Traffic%20Analyzer%20demo%20request"
        className="inline-flex items-center gap-2 px-5 h-10 rounded-md bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity"
        data-testid="link-contact-email"
      >
        <Mail className="w-4 h-4" /> Email us &mdash; hello@example.com
      </a>
    </div>
  );
}


function PricingCard({ tier }: { tier: Tier }) {
  return (
    <Card
      className={`relative flex flex-col h-full ${
        tier.highlight
          ? "border-primary shadow-lg ring-2 ring-primary/20"
          : "border-border"
      }`}
      data-testid={`card-tier-${tier.productInterest}`}
    >
      {tier.highlight && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
          Most popular
        </Badge>
      )}
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{tier.name}</CardTitle>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-3xl font-bold">{tier.price}</span>
          <span className="text-xs text-muted-foreground">/ {tier.cadence}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">{tier.best}</p>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 gap-4">
        <ul className="space-y-2 flex-1">
          {tier.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <a
          href="#demo-form"
          className={`inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-md text-sm font-semibold transition-colors ${
            tier.highlight
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-foreground text-background hover:opacity-90"
          }`}
          data-testid={`button-select-${tier.productInterest}`}
        >
          {tier.cta} <ArrowRight className="w-4 h-4" />
        </a>
      </CardContent>
    </Card>
  );
}

export default function PitchPage() {
  const summaryQ = useGetTrafficSummary();
  const backtestQ = useGetBacktestReport();

  const summary = summaryQ.data;
  const backtest = backtestQ.data;

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-home"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/exec-summary"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-exec-summary"
          >
            <FileText className="w-4 h-4" />
            One-page summary
          </Link>
        </div>
      </div>

      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-16 md:py-24">
          <Badge className="bg-white/10 text-white border-white/20 mb-4">
            <Sparkles className="w-3 h-3 mr-1" /> For city DOTs and traffic engineering teams
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-4xl">
            Stop paying $40K and waiting 6 weeks for a traffic study.
          </h1>
          <p className="text-lg md:text-xl text-white/80 mt-6 max-w-2xl">
            We turn your existing signal data into an audit-grade accuracy report and a one-click
            Traffic Impact Study generator — calibrated to HCM 6 and ITE 11th Edition. Used by Atlanta-area
            transportation teams to triage corridors faster than any traditional consulting workflow.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-8">
            <a
              href="#demo-form"
              className="inline-flex items-center gap-2 px-5 h-11 rounded-md bg-white text-slate-900 font-semibold hover:bg-white/90 transition-colors"
              data-testid="button-hero-demo"
            >
              Request a 30-min demo <ArrowRight className="w-4 h-4" />
            </a>
            <Link
              href="/exec-summary"
              className="inline-flex items-center gap-2 px-5 h-11 rounded-md border border-white/30 text-white font-medium hover:bg-white/10 transition-colors"
              data-testid="button-hero-summary"
            >
              <FileText className="w-4 h-4" /> Download one-pager
            </Link>
          </div>

          {/* Live proof bar */}
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6 border-t border-white/10 pt-8">
            <HeroStat
              label="Signals analyzed"
              value={fmtNum(summary?.intersectionCount)}
              sub="Atlanta metro live"
            />
            <HeroStat
              label="Daily vehicles modeled"
              value={fmtNum(summary?.totalDailyVehicles)}
              sub="Per-movement detail"
            />
            <HeroStat
              label="Backtest hit-rate"
              value={fmtPct(backtest?.overallHitRatePct)}
              sub={`Lift ${fmtX(backtest?.liftMultiplier)} vs random`}
            />
            <HeroStat
              label="Days observed"
              value={String(backtest?.daysObserved ?? "—")}
              sub="Persistent ground truth"
            />
          </div>
        </div>
      </header>

      {/* Two products */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center">Two products. One platform.</h2>
        <p className="text-center text-muted-foreground mt-3 max-w-2xl mx-auto">
          Buy them together for a city-wide rollout, or start with whichever solves your most painful problem first.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
          <Card>
            <CardHeader>
              <Badge variant="outline" className="w-fit border-emerald-300 text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="w-3 h-3 mr-1" /> Credibility
              </Badge>
              <CardTitle className="text-2xl mt-2">Backtest Credibility Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Audit-grade evidence that the deployed model concentrates real incidents on its
                shortlist — day after day, with Wilson 95% confidence intervals and lift over a
                random baseline. Print-ready for council briefings or grant applications.
              </p>
              <ul className="space-y-1.5 mt-3">
                <li className="flex items-start gap-2"><TrendingUp className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> Daily hit-rate trend, day-of-week breakdown, methodology paragraph</li>
                <li className="flex items-start gap-2"><TrendingUp className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> Auto-updates from persisted prediction history — no manual refresh</li>
                <li className="flex items-start gap-2"><TrendingUp className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> Designed for procurement / due-diligence packets</li>
              </ul>
              <Link
                href="/backtest"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline mt-3"
                data-testid="link-product-backtest"
              >
                See the live report <ArrowRight className="w-4 h-4" />
              </Link>
            </CardContent>
          </Card>

        </div>
      </section>

      {/* Pricing */}
      <section className="bg-muted/30 border-y">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-3xl font-bold text-center">Simple, public pricing.</h2>
          <p className="text-center text-muted-foreground mt-3 max-w-2xl mx-auto">
            Designed to fit common municipal procurement thresholds. Pilot is sole-source-friendly
            in most cities under $50K limits.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
            {TIERS.map((t) => <PricingCard key={t.name} tier={t} />)}
          </div>
        </div>
      </section>

      {/* Demo form */}
      <section id="demo-form" className="max-w-3xl mx-auto px-4 py-16">
        <div className="text-center mb-8">
          <Badge variant="outline" className="mb-3">
            <Mail className="w-3 h-3 mr-1" /> Direct response
          </Badge>
          <h2 className="text-3xl font-bold">Request a demo</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            Tell us about your city and your top traffic problem. We'll come back within one
            business day with a 30-minute demo using YOUR data — not a generic Atlanta sample.
          </p>
        </div>
        <Card>
          <CardContent className="p-6 md:p-8">
            <DemoForm />
          </CardContent>
        </Card>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-4 py-8 text-xs text-muted-foreground text-center">
          Atlanta Traffic Inefficiency Analyzer — calibrated on {fmtNum(summary?.intersectionCount)} signalized
          intersections and {fmtNum(summary?.totalDailyVehicles)} daily vehicle movements. HCM 6 + ITE 11th Edition compliant.
        </div>
      </footer>
    </div>
  );
}
