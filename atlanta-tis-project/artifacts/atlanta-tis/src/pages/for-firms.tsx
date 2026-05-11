/**
 * Marketing landing page targeted at engineering firms (Kimley-Horn,
 * Stantec, Croy, Wolverton, Pond &amp; Co, etc.). The pitch: replace 20–60
 * hours of junior-engineer time per screening TIS with a 60-second
 * deliverable that cites HCM / ITE / MUTCD on every page.
 */
import { Link } from "wouter";
import {
  ArrowLeft, Clock, FileCheck2, ShieldCheck, Building2, Layers, BookOpen, ArrowRight,
} from "lucide-react";
import { TrialRequestForm } from "../components/trial-request-form";

export default function ForFirmsPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>
      </div>

      <section className="text-center max-w-3xl mx-auto space-y-5">
        <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
          <Building2 className="w-3.5 h-3.5" />
          For Engineering Firms
        </div>
        <h1 className="text-5xl font-bold leading-tight">
          Generate a defensible Traffic Impact Study
          <br />
          <span className="text-blue-600">in 60 seconds.</span>
        </h1>
        <p className="text-xl text-muted-foreground leading-relaxed">
          A screening-level TIS your team can take to a project kickoff, white-labeled with your
          firm's branding, footnoted on every page to HCM 6th Ed., ITE Trip Generation 11th Ed.,
          and the MUTCD.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href="/tis"
            className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
            data-testid="link-tis-demo"
          >
            Try the live generator
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Pillar icon={Clock} title="20–60 hours → 60 seconds">
          What used to take a junior engineer a week — sourcing trip-generation rates,
          modeling capacity, drafting the report — is now one form submission.
        </Pillar>
        <Pillar icon={ShieldCheck} title="PE-defensible by design">
          Every figure footnoted. Methodology appendix and limitations &amp; assumptions
          appendix on every PDF. Signature block + PE stamp box on the cover page.
        </Pillar>
        <Pillar icon={FileCheck2} title="White-labeled deliverable">
          Your firm's logo on every cover page. Your PE name and license number in the
          signature block. Branded once, applied to every report your team prints.
        </Pillar>
      </section>

      <section className="border rounded-xl p-8 bg-muted/30 grid md:grid-cols-2 gap-8 items-center">
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">What's in every report</h2>
          <ul className="space-y-2.5 text-sm">
            <FeatureLine>
              <strong>Cover page</strong> with your firm's logo, project number, client,
              opening year, and a PE stamp / signature block.
            </FeatureLine>
            <FeatureLine>
              <strong>ITE Trip Generation</strong> for the proposed land-use code with
              daily, AM peak, and PM peak trip counts and directional split.
            </FeatureLine>
            <FeatureLine>
              <strong>Off-site impact summary</strong> — affected intersections, LOS drops,
              worst delay delta, with confidence intervals.
            </FeatureLine>
            <FeatureLine>
              <strong>Affected-intersection map</strong> color-coded by post-build LOS, plus
              a sortable capacity table for every signal in the study radius.
            </FeatureLine>
            <FeatureLine>
              <strong>Recommended mitigations</strong> sized to the projected delay impact
              (re-time, dedicated turn lane, signal warrants analysis, geometric).
            </FeatureLine>
            <FeatureLine>
              <strong>Appendix A</strong> — full methodology with formulas, tables, and
              numbered references to HCM 6th Ed., ITE 11th Ed., MUTCD, AASHTO Green Book.
            </FeatureLine>
            <FeatureLine>
              <strong>Appendix B</strong> — limitations &amp; assumptions, including
              conditions under which the report is no longer valid.
            </FeatureLine>
          </ul>
        </div>
        <div className="aspect-[8.5/11] border-2 rounded-lg shadow-md bg-white dark:bg-slate-900 p-4 text-[8px] flex flex-col gap-1.5 overflow-hidden">
          <div className="border-b-4 border-blue-600 pb-1.5 flex justify-between items-start">
            <div className="font-bold text-blue-700">[ Your firm logo ]</div>
            <div className="text-right">
              <div className="font-bold">Your Firm Name</div>
              <div className="text-gray-500">123 Main St, Atlanta, GA</div>
            </div>
          </div>
          <div className="text-center text-[7px] uppercase tracking-widest text-blue-700 mt-3">Traffic Impact Study</div>
          <div className="text-center font-bold text-base mt-1">Midtown Multifamily</div>
          <div className="text-center text-gray-500">1100 Peachtree St NE, Atlanta GA</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-[7px]">
            {["Project No.", "Client", "Prepared By", "Reviewer", "Date", "Opening Year"].map((l) => (
              <div key={l} className="border-b border-gray-300 pb-0.5">
                <div className="text-gray-500">{l}</div>
                <div className="font-semibold">—</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-auto">
            <div className="border-2 border-gray-400 rounded p-1 h-10 text-[6px] text-gray-500">PE Seal</div>
            <div className="text-[6px] text-gray-500 flex flex-col justify-end">
              <div className="border-b border-black h-3" /><div>Signature</div>
              <div className="border-b border-black h-3 mt-1" /><div>Date</div>
            </div>
          </div>
        </div>
      </section>

      <section className="text-center space-y-3 max-w-3xl mx-auto">
        <Layers className="w-10 h-10 text-blue-600 mx-auto" />
        <h2 className="text-3xl font-bold">Built for firms that ship dozens of TIS per month.</h2>
        <p className="text-lg text-muted-foreground">
          Project &amp; client folders. Multi-seat workspaces. Audit log. SSO on Enterprise.
          The deliverable a senior reviewer can mark up in Bluebeam, sign, and ship.
        </p>
      </section>

      <section className="border rounded-xl p-8 grid md:grid-cols-2 gap-8 items-start">
        <div className="space-y-4">
          <BookOpen className="w-8 h-8 text-blue-600" />
          <h2 className="text-2xl font-bold">Try it on a real project this week.</h2>
          <p className="text-muted-foreground">
            Pick three live projects. We'll set up a 14-day trial, run the generator on each,
            and walk your team through the output. If the deliverable doesn't save your
            junior engineers at least 4 hours per study, we'll part as friends.
          </p>
          <ul className="text-sm space-y-1.5 text-muted-foreground">
            <li>• 14-day full-feature trial</li>
            <li>• Onboarding call with your practice lead</li>
            <li>• Your firm's logo loaded on day one</li>
            <li>• No credit card to start</li>
          </ul>
        </div>
        <TrialRequestForm
          source="for_firms_page"
          heading="Request a 14-day trial"
          subheading="One business day response. We'll send a trial link and schedule a 30-min onboarding call."
          ctaLabel="Request trial"
        />
      </section>
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

function FeatureLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-blue-600 font-bold">•</span>
      <span>{children}</span>
    </li>
  );
}
