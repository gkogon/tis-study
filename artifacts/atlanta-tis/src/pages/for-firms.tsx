/**
 * Marketing landing page targeted at engineering firms (Kimley-Horn,
 * Stantec, Croy, Wolverton, Pond & Co, etc.). Deeper pitch than the
 * home page — full feature breakdown + a trial-request form.
 *
 * Visual language matches home.tsx: numbered report sections, hairline
 * rules, instrument cells. Cards reserved for document depictions.
 */
import { Link } from "wouter";
import { ArrowRight, Check } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { TrialRequestForm } from "../components/trial-request-form";
import { Marker } from "../components/section-marker";

const PILLARS = [
  {
    title: "A week of work, in a minute",
    body: "Sourcing trip-generation rates, modeling capacity, drafting the report — what used to take a junior engineer a week is now one form submission.",
  },
  {
    title: "PE-defensible by design",
    body: "Every figure footnoted. Methodology appendix and limitations & assumptions appendix on every PDF. Signature block and PE stamp box on the cover page.",
  },
  {
    title: "White-labeled deliverable",
    body: "Your firm's logo on every cover page. Your PE name and license number in the signature block. Branded once, applied to every report your team prints.",
  },
];

const FIRM_FEATURES = [
  "Firm-wide project history",
  "Member roles & invites",
  "White-labeled PDFs with logo + PE block",
  "API access (Enterprise)",
  "SSO via Okta / Azure AD (Enterprise)",
  "DPA + MSA available on request",
];

const REPORT_CONTENTS: Array<[string, string]> = [
  ["Cover page", "Your firm's logo, project number, client, opening year, and a PE stamp / signature block."],
  ["ITE Trip Generation", "Proposed land-use code with daily, AM peak, and PM peak trip counts and directional split."],
  ["Off-site impact summary", "Affected intersections, LOS drops, worst delay delta, with confidence intervals."],
  ["Affected-intersection map", "Color-coded by post-build LOS, plus a sortable capacity table for every signal in the radius."],
  ["Recommended mitigations", "Sized to projected delay impact — re-time, dedicated turn lane, warrants analysis, geometric."],
  ["Appendix A — Methodology", "Full formulas, tables, and numbered references to HCM 6th Ed., ITE 11th Ed., MUTCD, AASHTO."],
  ["Appendix B — Limitations", "Assumptions and the conditions under which the report is no longer valid."],
];

export default function ForFirmsPage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12">
          <section className="max-w-3xl space-y-6">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                For engineering firms
              </div>
              <div className="h-px w-full bg-border" />
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.04] text-slate-900 dark:text-slate-50">
              Your engineers have{" "}
              <span className="bg-amber-300 dark:bg-amber-400/90 dark:text-slate-900 box-decoration-clone px-1.5 -mx-0.5">
                better things to do
              </span>{" "}
              than screening TIS.
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
              A screening TIS your team can take to a project kickoff.
              White-labeled with your firm's branding. Every page footnoted
              to HCM, ITE, and the MUTCD. Same math your senior reviewers
              expect. The 40 hours of junior-PE labor per site, gone.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/tis"
                className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
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

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 space-y-20">
        <section>
          <Marker n="01" label="Why firms switch" />
          <div className="divide-y divide-border border-y border-border">
            {PILLARS.map((p, i) => (
              <div key={i} className="grid md:grid-cols-12 gap-x-6 gap-y-2 py-7">
                <div className="md:col-span-4 flex items-baseline gap-3">
                  <span className="font-mono text-sm tabular-nums text-blue-700 font-semibold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-lg font-semibold tracking-tight">{p.title}</h3>
                </div>
                <p className="md:col-span-8 text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <Marker n="02" label="The deliverable" />
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
            <div className="lg:col-span-7 space-y-5">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                What's in every report.
              </h2>
              <div className="divide-y divide-border border-y border-border">
                {REPORT_CONTENTS.map(([title, body]) => (
                  <div key={title} className="py-4">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {title}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:col-span-5 lg:sticky lg:top-24">
              <CoverPagePreview />
            </div>
          </div>
        </section>

        <section>
          <Marker n="03" label="Built for volume" />
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl">
            Built for firms shipping dozens of TIS per month.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mt-3">
            Project and client folders. Multi-seat workspaces. Audit log.
            SSO on Enterprise. The deliverable a senior reviewer can mark up
            in Bluebeam, sign, and ship.
          </p>
          <div className="grid sm:grid-cols-2 gap-px bg-border border border-border mt-7">
            {FIRM_FEATURES.map((f) => (
              <div key={f} className="bg-background px-5 py-4 flex items-center gap-2.5 text-sm">
                <Check className="w-4 h-4 text-blue-700 shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <Marker n="04" label="Get started" />
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
            <div className="lg:col-span-6 space-y-5">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Try it on a real project this week.
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Pick three live projects. We'll set up a 14-day trial, run
                the generator on each, and walk your team through the
                output. If the deliverable doesn't save your junior
                engineers at least 4 hours per study, we'll part as friends.
              </p>
              <ul className="space-y-2 text-sm">
                <Bullet>14-day full-feature trial</Bullet>
                <Bullet>Onboarding call with your practice lead</Bullet>
                <Bullet>Your firm's logo loaded on day one</Bullet>
                <Bullet>No credit card to start</Bullet>
              </ul>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"
              >
                Or jump in instantly with self-serve signup
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="lg:col-span-6">
              <TrialRequestForm
                source="for_firms_page"
                heading="Request a 14-day trial"
                subheading="One business day response. We'll send a trial link and schedule a 30-min onboarding call."
                ctaLabel="Request trial"
              />
            </div>
          </div>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

/**
 * Faux cover-page preview — an earned "card": it depicts a document.
 */
function CoverPagePreview() {
  return (
    <div className="aspect-[8.5/11] border border-border shadow-lg bg-white dark:bg-slate-900 p-5 text-[9px] flex flex-col gap-2 overflow-hidden">
      <div className="border-b-4 border-blue-600 pb-2 flex justify-between items-start">
        <div className="font-bold text-blue-700">[ Your firm logo ]</div>
        <div className="text-right">
          <div className="font-bold text-slate-900 dark:text-slate-100">Your Firm Name</div>
          <div className="text-slate-500">123 Main St, Atlanta, GA</div>
        </div>
      </div>
      <div className="text-center font-mono text-[8px] uppercase tracking-[0.2em] text-blue-700 mt-4 font-semibold">
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
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 items-start">
      <Check className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
