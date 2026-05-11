/**
 * Public landing page. Pitches the product to Atlanta engineering firms
 * (the customer) and to PEs at those firms (the user). Three calls to
 * action, all routing into the same funnel:
 *   - "Launch TIS Generator" → /tis (try it now, signed-in path)
 *   - "Start firm trial"     → /signup (firm-creation funnel)
 *   - "See pricing"          → /pricing
 *
 * Keep this page lightweight — anything heavier (testimonials,
 * comparison, longer pitch) belongs on /for-firms.
 */
import { Link } from "wouter";
import {
  ArrowRight, FileCheck2, Building2, ShieldCheck, Clock, Layers,
  MapPin, BookOpen, Check,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function HomePage() {
  return (
    <div>
      <div className="max-w-6xl mx-auto px-4 py-16 space-y-20">
        <section className="text-center space-y-6 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <Building2 className="w-3.5 h-3.5" />
            For Atlanta engineering firms
          </div>
          <h1 className="text-5xl md:text-6xl font-bold leading-tight">
            Defensible Traffic Impact Studies
            <br />
            <span className="text-blue-600">in 60 seconds.</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Screening-level TIS reports for the Atlanta MSA, white-labeled with your
            firm's branding and footnoted on every page to HCM 6th Ed., ITE 11th Ed.,
            and the MUTCD.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/signup?plan=growth"
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
              data-testid="link-start-trial"
            >
              Start 14-day firm trial
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/tis"
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md border border-border hover:bg-accent"
              data-testid="link-launch-tis"
            >
              Try the live generator
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md text-blue-600 hover:underline"
              data-testid="link-see-pricing"
            >
              See pricing
            </Link>
          </div>
          <div className="pt-2 text-xs text-muted-foreground">
            14-day trial • No credit card • Cancel anytime
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Pillar icon={Clock} title="20–60 hours → 60 seconds">
            What used to take a junior engineer a week — sourcing trip-generation rates,
            modeling capacity, drafting the report — is now one form submission.
          </Pillar>
          <Pillar icon={ShieldCheck} title="PE-defensible by design">
            Every figure footnoted to HCM, ITE, and the MUTCD. Methodology + limitations
            appendices on every PDF. PE stamp box on the cover page.
          </Pillar>
          <Pillar icon={FileCheck2} title="White-labeled deliverable">
            Your firm's logo on every cover page. Your PE name and license number in the
            signature block. Branded once, applied to every report.
          </Pillar>
        </section>

        <section className="border rounded-xl p-8 space-y-6 bg-muted/30">
          <div className="text-center space-y-2">
            <Layers className="w-8 h-8 text-blue-600 mx-auto" />
            <h2 className="text-3xl font-bold">How a study comes together</h2>
            <p className="text-muted-foreground">Three inputs. One deliverable.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <Step n={1} icon={MapPin} title="Drop a pin">
              Site coordinates anywhere in the Atlanta MSA. The generator pulls GDOT
              counts and signal data for every intersection in the study radius.
            </Step>
            <Step n={2} icon={Building2} title="Pick a land use">
              ITE 11th Ed. land-use codes (multifamily, office, retail, fuel station…).
              Enter the size; trip generation and pass-by capture are computed for you.
            </Step>
            <Step n={3} icon={FileCheck2} title="Download the PDF">
              Cover page, summary, intersection table, mitigation recommendations,
              methodology + limitations appendices. Ready for PE review.
            </Step>
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-8 items-center">
          <div className="space-y-4">
            <BookOpen className="w-8 h-8 text-blue-600" />
            <h2 className="text-3xl font-bold">Every figure cited inline.</h2>
            <p className="text-muted-foreground leading-relaxed">
              The deliverable that lands on a senior reviewer's desk has the same
              reference column engineers expect in a real TIS. No "trust the model"
              footnotes — every number traces to a published table.
            </p>
            <ul className="space-y-2 text-sm">
              <Bullet>HCM 6th Edition for capacity & LOS</Bullet>
              <Bullet>ITE Trip Generation 11th Edition for rates & K/D factors</Bullet>
              <Bullet>MUTCD 2009 for warrants & signage</Bullet>
              <Bullet>AASHTO Green Book for geometric guidance</Bullet>
            </ul>
          </div>
          <div className="rounded-xl border bg-background p-6 space-y-3 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Sample footnote
            </div>
            <div className="font-mono text-xs leading-relaxed border-l-4 border-blue-600 pl-3 py-2 bg-muted/30 rounded-r">
              PM peak trip generation derived from ITE TGM 11th Ed., land use 220
              (Multifamily Housing — Low-Rise), fitted curve T = 0.51(X) + 9.78 where
              X = dwelling units (n=42, R² = 0.93). 17% pass-by capture applied per
              ITE TGM Appendix B for sites within 0.25 mi of an arterial.
            </div>
            <div className="text-xs text-muted-foreground">
              Every figure on every page is cited at this level of specificity.
            </div>
          </div>
        </section>

        <section className="text-center space-y-6 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold">Ready to try it on a real project?</h2>
          <p className="text-lg text-muted-foreground">
            Start the 14-day trial, invite your team, run three real studies.
            If it doesn't save your engineers at least four hours per study,
            we'll part as friends.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup?plan=growth"
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
              data-testid="link-cta-trial-bottom"
            >
              Start 14-day trial
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/for-firms"
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md border border-border hover:bg-accent"
              data-testid="link-for-firms-bottom"
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

function Pillar({
  icon: Icon, title, children,
}: { icon: typeof Clock; title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-xl p-6 space-y-2 bg-background">
      <Icon className="w-7 h-7 text-blue-600" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function Step({
  n, icon: Icon, title, children,
}: { n: number; icon: typeof Clock; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background border rounded-lg p-5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
          {n}
        </span>
        <Icon className="w-5 h-5 text-blue-600" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start">
      <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
