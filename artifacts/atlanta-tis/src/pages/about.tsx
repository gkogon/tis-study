/**
 * /about — company / mission / methodology overview.
 */
import { Link } from "wouter";
import {
  ArrowLeft, Building2, Target, BookOpen, ShieldCheck, ArrowRight,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function AboutPage() {
  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-12">
        <div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to home
          </Link>
        </div>

        <header className="space-y-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <Building2 className="w-3.5 h-3.5" /> About
          </div>
          <h1 className="text-4xl font-bold leading-tight">
            Built for the engineers doing the work.
          </h1>
          <p className="text-lg text-muted-foreground">
            Atlanta TIS is a screening-tier traffic engineering toolset
            for the engineering firms shipping work in the Atlanta MSA.
            Studies that used to take 20–60 hours of junior-engineer
            time now take 60 seconds — and come out the other side
            footnoted to HCM, ITE, MUTCD, and AASHTO so a PE can sign
            with confidence.
          </p>
        </header>

        <section className="grid md:grid-cols-3 gap-4">
          <Tile icon={Target} title="Mission">
            Cut the screening tax. Free PE hours for the work where engineering judgment actually matters.
          </Tile>
          <Tile icon={BookOpen} title="Methodology">
            Every figure cited inline. ITE 11th Ed., HCM 6th Ed., MUTCD, AASHTO Green Book, FHWA.
          </Tile>
          <Tile icon={ShieldCheck} title="Defensibility">
            Screening-grade outputs come with explicit limitations and assumption appendices on every report.
          </Tile>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-bold">What we ship</h2>
          <p className="text-muted-foreground leading-relaxed">
            Six screening engines that engineers actually use day-to-day:
          </p>
          <ul className="space-y-1.5 text-sm">
            <Bullet>Traffic Impact Study (TIS) — trip generation, capacity, mitigations</Bullet>
            <Bullet>Parking Demand Study — ITE PG vs. local code vs. proposed</Bullet>
            <Bullet>Signal Warrant Analysis — MUTCD Ch. 4C, four warrants</Bullet>
            <Bullet>Sight Distance Analysis — AASHTO Green Book SSD + ISD</Bullet>
            <Bullet>Queuing Analysis — HCM Ch. 31 95th-percentile back-of-queue</Bullet>
            <Bullet>Road-Diet Feasibility — FHWA capacity + safety screening</Bullet>
          </ul>
          <p className="text-muted-foreground leading-relaxed pt-2">
            Plus a post-build verification SKU that tracks observed
            traffic against your original forecast using live GDOT
            511 data — months after the development opens.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-bold">What we won't do</h2>
          <p className="text-muted-foreground leading-relaxed">
            We won't pretend a screening tool is a substitute for a
            licensed PE running full-rigor analytical software. Every
            deliverable carries a "not for design submittal without
            independent verification" footer. The product is built to
            free up PE hours, not to replace PE judgment.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            See the <Link href="/legal/disclaimer" className="text-blue-600 hover:underline">Engineering Disclaimer</Link> for the
            full scope of what the Service provides and does not provide.
          </p>
        </section>

        <section className="border rounded-xl p-8 bg-muted/30 text-center space-y-3">
          <h2 className="text-2xl font-bold">Try it on a real project</h2>
          <p className="text-muted-foreground">
            14-day trial, no credit card. Run your next three studies
            through the tool alongside your own analysis — tell us where
            the numbers diverge.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/signup?plan=growth"
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              Start trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/for-firms"
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md border border-border hover:bg-accent"
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
    <div className="border rounded-xl p-5 space-y-2 bg-background">
      <Icon className="w-5 h-5 text-blue-600" />
      <div className="font-semibold">{title}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start">
      <span className="text-blue-600 font-bold">•</span>
      <span>{children}</span>
    </li>
  );
}
