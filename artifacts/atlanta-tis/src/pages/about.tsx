/**
 * /about — company / mission / methodology overview.
 */
import { Link } from "wouter";
import {
  Building2, Target, BookOpen, ShieldCheck, ArrowRight, Check, Sparkles,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function AboutPage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-gradient-to-b from-blue-50/60 via-background to-background dark:from-blue-950/20"
        />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-xs font-medium text-blue-700 dark:text-blue-300">
            <Building2 className="w-3.5 h-3.5" />
            About
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight">
            Built for the engineers
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">
              doing the work.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
            Simple Impact Studies is a screening-tier traffic engineering
            toolset for the firms shipping work in the Atlanta MSA. Studies
            that used to take 20–60 hours of junior-engineer time now take
            60 seconds — and come out the other side footnoted to HCM, ITE,
            MUTCD, and AASHTO so a PE can sign with confidence.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 space-y-20">
        <section className="grid md:grid-cols-3 gap-4">
          <Tile icon={Target} title="Mission">
            Cut the screening tax. Free PE hours for the work where
            engineering judgment actually matters.
          </Tile>
          <Tile icon={BookOpen} title="Methodology">
            Every figure cited inline. ITE 11th Ed., HCM 6th Ed., MUTCD,
            AASHTO Green Book, FHWA.
          </Tile>
          <Tile icon={ShieldCheck} title="Defensibility">
            Screening-grade outputs come with explicit limitations and
            assumption appendices on every report.
          </Tile>
        </section>

        <section className="space-y-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-600">
              The shipping list
            </div>
            <h2 className="text-3xl font-bold tracking-tight">What we ship</h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Six screening engines that engineers actually use day-to-day:
            </p>
          </div>
          <ul className="grid sm:grid-cols-2 gap-3 pt-2">
            <EngineCard
              title="Traffic Impact Study"
              tag="ITE · HCM"
              body="Trip generation, capacity, recommended mitigations."
            />
            <EngineCard
              title="Parking Demand"
              tag="ITE PG"
              body="Code-min vs. ITE-adjusted demand vs. proposed supply."
            />
            <EngineCard
              title="Signal Warrants"
              tag="MUTCD Ch. 4C"
              body="Warrants 1A, 1B, 3, 7 against your 24-hr volume profile."
            />
            <EngineCard
              title="Sight Distance"
              tag="AASHTO"
              body="Stopping + intersection sight distance per Green Book."
            />
            <EngineCard
              title="Queuing"
              tag="HCM Ch. 31"
              body="95th-percentile back-of-queue, storage adequacy check."
            />
            <EngineCard
              title="Road-Diet"
              tag="FHWA"
              body="Capacity + safety feasibility for road-diet conversions."
            />
          </ul>
          <p className="text-muted-foreground leading-relaxed pt-3">
            Plus a <strong className="text-foreground">post-build verification SKU</strong>{" "}
            that tracks observed traffic against your original forecast using
            live GDOT 511 data — months after the development opens.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-muted/30 p-8 space-y-3">
          <h2 className="text-2xl font-bold tracking-tight">What we won't do</h2>
          <p className="text-muted-foreground leading-relaxed">
            We won't pretend a screening tool is a substitute for a licensed
            PE running full-rigor analytical software. Every deliverable
            carries a "not for design submittal without independent
            verification" footer. The product is built to free up PE hours,
            not to replace PE judgment.
          </p>
          <p className="text-muted-foreground leading-relaxed text-sm pt-1">
            See the{" "}
            <Link href="/legal/disclaimer" className="text-blue-600 hover:underline">
              Engineering Disclaimer
            </Link>{" "}
            for the full scope of what the Service does and does not provide.
          </p>
        </section>

        <section className="text-center space-y-5 pt-4">
          <Sparkles className="w-10 h-10 text-blue-600 mx-auto" />
          <h2 className="text-3xl font-bold tracking-tight">
            Try it on a real project.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            10 free studies on signup, no credit card. Run them on actual
            upcoming sites alongside your own analysis — tell us where the
            numbers diverge.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/signup?plan=growth"
              className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm"
            >
              Start trial
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/for-firms"
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border border-border hover:bg-accent transition-colors"
            >
              For engineering firms
            </Link>
          </div>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function Tile({
  icon: Icon, title, children,
}: { icon: typeof Target; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-5 space-y-3 transition-all hover:border-foreground/20 hover:shadow-sm">
      <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600">
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="font-semibold tracking-tight">{title}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function EngineCard({
  title, tag, body,
}: { title: string; tag: string; body: string }) {
  return (
    <li className="rounded-xl border border-border bg-background p-4 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {tag}
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </li>
  );
}
