/**
 * /about — company / mission / methodology overview.
 *
 * Visual language matches home.tsx: numbered report sections, hairline
 * rules, instrument cells, no decorative icon-card grids.
 */
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { Marker } from "../components/section-marker";

const PRINCIPLES: Array<[string, string]> = [
  ["Mission", "Cut the screening tax. Free PE hours for the work where engineering judgment actually matters."],
  ["Methodology", "Every figure cited inline. ITE 11th Ed., HCM 6th Ed., MUTCD, AASHTO Green Book, FHWA."],
  ["Defensibility", "Screening-grade outputs ship with explicit limitations and assumption appendices on every report."],
];

const ENGINES: Array<{ title: string; tag: string; body: string }> = [
  { title: "Traffic Impact Study", tag: "ITE · HCM", body: "Trip generation, capacity, recommended mitigations." },
  { title: "Parking Demand", tag: "ITE PG", body: "Code-min vs. ITE-adjusted demand vs. proposed supply." },
  { title: "Signal Warrants", tag: "MUTCD Ch. 4C", body: "Warrants 1A, 1B, 3, 7 against your 24-hr volume profile." },
  { title: "Sight Distance", tag: "AASHTO", body: "Stopping + intersection sight distance per Green Book." },
  { title: "Queuing", tag: "HCM Ch. 31", body: "95th-percentile back-of-queue, storage adequacy check." },
  { title: "Road-Diet", tag: "FHWA", body: "Capacity + safety feasibility for road-diet conversions." },
];

export default function AboutPage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 space-y-6">
          <div className="space-y-2">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              About
            </div>
            <div className="h-px w-full bg-border" />
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.04] text-slate-900 dark:text-slate-50">
            Screening studies eat too much engineering time.{" "}
            <span className="bg-amber-300 dark:bg-amber-400/90 dark:text-slate-900 box-decoration-clone px-1.5 -mx-0.5">
              So we built this.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
            Simple Impact Studies runs screening-level traffic studies for
            engineering firms in metro Atlanta. The screening pass that used
            to cost a junior engineer 20 to 60 hours now takes about a
            minute. Every figure still traces to HCM, ITE, MUTCD, and
            AASHTO. A PE can sign it.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 space-y-20">
        <section>
          <Marker n="01" label="What we stand on" />
          <div className="grid sm:grid-cols-3 gap-px bg-border border border-border">
            {PRINCIPLES.map(([title, body]) => (
              <div key={title} className="bg-background p-5 space-y-2">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-blue-700">
                  {title}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <Marker n="02" label="What we ship" />
          <h2 className="text-3xl font-bold tracking-tight">
            Six screening engines.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed mt-2">
            The studies engineers actually run day-to-day:
          </p>
          <div className="grid sm:grid-cols-2 gap-px bg-border border border-border mt-7">
            {ENGINES.map((e) => (
              <div key={e.title} className="bg-background p-5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-sm">{e.title}</div>
                  <div className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {e.tag}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{e.body}</p>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground leading-relaxed mt-5">
            Plus a{" "}
            <strong className="text-foreground">post-build verification SKU</strong>{" "}
            that tracks observed traffic against your original forecast using
            live GDOT 511 data — months after the development opens.
          </p>
        </section>

        <section>
          <Marker n="03" label="What we won't do" />
          <div className="border-l-2 border-blue-600 pl-5 space-y-3">
            <p className="text-muted-foreground leading-relaxed">
              We won't pretend a screening tool is a substitute for a
              licensed PE running full-rigor analytical software. Every
              deliverable carries a "not for design submittal without
              independent verification" footer. The product is built to free
              up PE hours, not to replace PE judgment.
            </p>
            <p className="text-muted-foreground leading-relaxed text-sm">
              See the{" "}
              <Link href="/legal/disclaimer" className="text-blue-700 hover:underline">
                Engineering Disclaimer
              </Link>{" "}
              for the full scope of what the Service does and does not provide.
            </p>
          </div>
        </section>

        <section className="border border-border bg-slate-50 dark:bg-slate-950/40 px-6 sm:px-10 py-10 space-y-4">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Try it on a real project.
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            10 free studies on signup, no credit card. Run them on actual
            upcoming sites alongside your own analysis — tell us where the
            numbers diverge.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/signup?plan=growth"
              className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
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
