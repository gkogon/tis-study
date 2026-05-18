/**
 * Marketing landing page targeted at engineering firms (Kimley-Horn,
 * Stantec, Croy, Wolverton, Pond & Co, etc.). Deeper pitch than the
 * home page — assumes the visitor has decided they're interested and
 * wants the full feature breakdown + a trial-request form.
 */
import { Link } from "wouter";
import {
  Clock, FileCheck2, ShieldCheck, Building2, Layers, BookOpen,
  ArrowRight, Check, Sparkles,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { TrialRequestForm } from "../components/trial-request-form";

export default function ForFirmsPage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12">
          <section className="text-center max-w-3xl mx-auto space-y-6">
            <div className="flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Building2 className="w-3.5 h-3.5" />
              For engineering firms
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.04] text-slate-900 dark:text-slate-50">
              Defensible screening TIS —{" "}
              <span className="bg-amber-300 dark:bg-amber-400/90 dark:text-slate-900 box-decoration-clone px-1.5 -mx-0.5">
                without the week of engineer time.
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
              The screening-level Traffic Impact Study your team can take to a
              project kickoff — white-labeled with your firm's branding,
              footnoted on every page to HCM 6th Ed., ITE 11th Ed., and the
              MUTCD. Same math your senior reviewers expect. Without the 40
              hours of junior-PE labor per site.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Link
                href="/tis"
                className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm"
                data-testid="link-tis-demo"
              >
                Try the live generator
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <a
                href="/sample-tis-report.pdf"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border border-border hover:bg-accent transition-colors"
              >
                See a sample report
              </a>
            </div>
          </section>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 space-y-24">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Pillar
            icon={Clock}
            title="20–60 hours → 60 seconds"
            body="What used to take a junior engineer a week — sourcing trip-generation rates, modeling capacity, drafting the report — is now one form submission."
          />
          <Pillar
            icon={ShieldCheck}
            title="PE-defensible by design"
            body="Every figure footnoted. Methodology appendix + limitations & assumptions appendix on every PDF. Signature block + PE stamp box on the cover page."
          />
          <Pillar
            icon={FileCheck2}
            title="White-labeled deliverable"
            body="Your firm's logo on every cover page. Your PE name + license number in the signature block. Branded once, applied to every report your team prints."
          />
        </section>

        <section className="grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-5">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
              The deliverable
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              What's in every report.
            </h2>
            <ul className="space-y-3 text-sm pt-1">
              <FeatureLine>
                <strong>Cover page</strong> with your firm's logo, project
                number, client, opening year, and a PE stamp / signature block.
              </FeatureLine>
              <FeatureLine>
                <strong>ITE Trip Generation</strong> for the proposed land-use
                code with daily, AM peak, and PM peak trip counts and
                directional split.
              </FeatureLine>
              <FeatureLine>
                <strong>Off-site impact summary</strong> — affected
                intersections, LOS drops, worst delay delta, with confidence
                intervals.
              </FeatureLine>
              <FeatureLine>
                <strong>Affected-intersection map</strong> color-coded by
                post-build LOS, plus a sortable capacity table for every
                signal in the study radius.
              </FeatureLine>
              <FeatureLine>
                <strong>Recommended mitigations</strong> sized to the projected
                delay impact (re-time, dedicated turn lane, signal warrants
                analysis, geometric).
              </FeatureLine>
              <FeatureLine>
                <strong>Appendix A</strong> — full methodology with formulas,
                tables, and numbered references to HCM 6th Ed., ITE 11th Ed.,
                MUTCD, AASHTO Green Book.
              </FeatureLine>
              <FeatureLine>
                <strong>Appendix B</strong> — limitations & assumptions,
                including conditions under which the report is no longer valid.
              </FeatureLine>
            </ul>
          </div>
          <div className="lg:col-span-5">
            <CoverPagePreview />
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-gradient-to-br from-slate-900 to-slate-800 dark:from-slate-950 dark:to-slate-900 text-white px-6 sm:px-12 py-12 sm:py-16 overflow-hidden relative">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.08] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />
          <div className="relative max-w-3xl space-y-4">
            <Layers className="w-10 h-10 text-blue-300" />
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Built for firms shipping dozens of TIS per month.
            </h2>
            <p className="text-slate-200 text-lg leading-relaxed">
              Project & client folders. Multi-seat workspaces. Audit log. SSO
              on Enterprise. The deliverable a senior reviewer can mark up in
              Bluebeam, sign, and ship.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 pt-4">
              {[
                "Firm-wide project history",
                "Member roles & invites",
                "White-labeled PDFs with logo + PE block",
                "API access (Enterprise)",
                "SSO via Okta / Azure AD (Enterprise)",
                "DPA + MSA available on request",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2 text-sm">
                  <Check className="w-4 h-4 text-blue-300 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-6 space-y-5">
            <BookOpen className="w-10 h-10 text-blue-700" />
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Try it on a real project this week.
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Pick three live projects. We'll set up a 14-day trial, run the
              generator on each, and walk your team through the output. If
              the deliverable doesn't save your junior engineers at least 4
              hours per study, we'll part as friends.
            </p>
            <ul className="space-y-2 text-sm pt-1">
              <Bullet>14-day full-feature trial</Bullet>
              <Bullet>Onboarding call with your practice lead</Bullet>
              <Bullet>Your firm's logo loaded on day one</Bullet>
              <Bullet>No credit card to start</Bullet>
            </ul>
            <div className="pt-2">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-700"
              >
                <Sparkles className="w-4 h-4" />
                Or jump in instantly with self-serve signup
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
          <div className="lg:col-span-6">
            <TrialRequestForm
              source="for_firms_page"
              heading="Request a 14-day trial"
              subheading="One business day response. We'll send a trial link and schedule a 30-min onboarding call."
              ctaLabel="Request trial"
            />
          </div>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function CoverPagePreview() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-4 bg-gradient-to-br from-blue-500/15 to-transparent blur-2xl -z-10"
      />
      <div className="aspect-[8.5/11] border border-border rounded-xl shadow-2xl bg-white dark:bg-slate-900 p-5 text-[9px] flex flex-col gap-2 overflow-hidden">
        <div className="border-b-4 border-blue-600 pb-2 flex justify-between items-start">
          <div className="font-bold text-blue-700">[ Your firm logo ]</div>
          <div className="text-right">
            <div className="font-bold text-slate-900 dark:text-slate-100">Your Firm Name</div>
            <div className="text-slate-500">123 Main St, Atlanta, GA</div>
          </div>
        </div>
        <div className="text-center text-[8px] uppercase tracking-[0.2em] text-blue-700 mt-4 font-semibold">
          Traffic Impact Study
        </div>
        <div className="text-center font-bold text-lg mt-1 text-slate-900 dark:text-slate-100">
          Midtown Multifamily
        </div>
        <div className="text-center text-slate-500 text-[8px]">
          1100 Peachtree St NE, Atlanta GA
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 mt-4 text-[8px]">
          {["Project No.", "Client", "Prepared By", "Reviewer", "Date", "Opening Year"].map((l) => (
            <div key={l} className="border-b border-slate-300 pb-1">
              <div className="text-slate-500 uppercase tracking-wider text-[7px]">{l}</div>
              <div className="font-semibold text-slate-900 dark:text-slate-200">—</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-auto">
          <div className="border-2 border-slate-400 rounded p-1.5 h-12 text-[7px] text-slate-500 flex items-center justify-center">
            PE Seal
          </div>
          <div className="text-[7px] text-slate-500 flex flex-col justify-end">
            <div className="border-b border-slate-800 dark:border-slate-300 h-3.5" />
            <div className="uppercase tracking-wider mt-0.5">Signature</div>
            <div className="border-b border-slate-800 dark:border-slate-300 h-3.5 mt-1.5" />
            <div className="uppercase tracking-wider mt-0.5">Date</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Pillar({
  icon: Icon, title, body,
}: { icon: typeof Clock; title: string; body: string }) {
  return (
    <div className="group rounded-2xl border border-border bg-background p-6 space-y-3 transition-all hover:border-foreground/20 hover:shadow-sm">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-700 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function FeatureLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <Check className="w-4 h-4 text-blue-700 mt-1 shrink-0" />
      <span className="leading-relaxed">{children}</span>
    </li>
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
