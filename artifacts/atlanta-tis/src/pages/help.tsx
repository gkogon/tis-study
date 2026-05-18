/**
 * Public /help page. Pre-answers the questions from a typical
 * first-week-of-use cycle and serves as research content for
 * prospects before signup.
 *
 * Visual language matches home.tsx: numbered report sections, hairline
 * rules, instrument cells, hairline-divided FAQ lists.
 */
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { Marker } from "../components/section-marker";

const STEPS: Array<[string, string]> = [
  ["Sign up & name your firm", "Email + password, then a single firm name. Your team can join later under the same firm — every study they run rolls up to your shared project history."],
  ["Drop a pin on your site", "Anywhere in the Atlanta MSA. The generator pulls live GDOT counts and signal data for every intersection in your study radius (up to 6.5 mi)."],
  ["Pick a land use + size", "Any of 66 ITE 11th-Ed. land-use codes — multifamily, office, retail, fuel station, drive-through. Enter unit count or square footage; pass-by capture is computed automatically."],
  ["Download the report", "Cover page, executive summary, intersection table, mitigations, methodology and limitations appendices. White-labeled with your firm's logo if you've uploaded one."],
];

const TOC: Array<[string, string]> = [
  ["#first-study", "Running your first study"],
  ["#deliverable", "What's in the PDF"],
  ["#firm-setup", "Firm account & branding"],
  ["#quota", "Studies, quota & billing"],
  ["#data", "Data sources & methodology"],
  ["#troubleshooting", "Troubleshooting"],
];

export default function HelpPage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-10 space-y-6">
          <div className="space-y-2">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Help &amp; docs
            </div>
            <div className="h-px w-full bg-border" />
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.04] tracking-tight text-slate-900 dark:text-slate-50">
            Get up and running in under five minutes.
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
            Everything you need to run your first screening, set up your
            firm account, and understand what's in every deliverable.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-20 space-y-16">
        <section>
          <Marker n="01" label="Quick start" />
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-6">
            From signup to your first PDF in 4 steps.
          </h2>
          <div className="grid sm:grid-cols-2 gap-px bg-border border border-border">
            {STEPS.map(([title, body], i) => (
              <div key={title} className="bg-background p-5 space-y-2">
                <div className="font-mono text-2xl font-bold tabular-nums text-slate-200 dark:text-slate-700">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="font-semibold tracking-tight">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <nav className="grid sm:grid-cols-2 gap-px bg-border border border-border">
          {TOC.map(([to, label]) => (
            <a
              key={to}
              href={to}
              className="bg-background px-5 py-4 flex items-center justify-between gap-3 hover:bg-accent transition-colors group"
            >
              <span className="text-sm font-medium">{label}</span>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
            </a>
          ))}
        </nav>

        <section id="first-study">
          <Marker n="02" label="First study" />
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-5">
            Running your first study
          </h2>
          <FaqList>
            <FAQ q="What inputs does the generator need?">
              <p>Three required fields:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li><strong>Site coordinates</strong> — drop a pin on the map or paste a lat/lon. Must fall inside the Atlanta MSA box (lat 33.4–34.2, lon −84.9 to −83.9).</li>
                <li><strong>ITE land-use code</strong> — picked from a dropdown of 66 codes. Each code carries its own daily/AM-peak/PM-peak rates from the ITE Trip Generation Manual 11th Edition.</li>
                <li><strong>Project size</strong> — usually dwelling units (multifamily), 1,000-sqft GFA (office/retail), or fueling positions (gas stations). The unit auto-updates based on the chosen land use.</li>
              </ul>
              <p className="mt-2">Optional fields for more precise screening: opening year (default 2027), study radius (default 0.5 mi), background growth rate, weather scenario, pass-by override, and Monte-Carlo sensitivity toggle.</p>
            </FAQ>
            <FAQ q="How long does generation take?">
              Most studies complete in 30–90 seconds. The generator pulls
              live GDOT 511 data + intersection inventory in parallel with
              the trip generation math; if GDOT's API is slow that day, the
              run can take up to 2 minutes. There's no queue — runs are not
              throttled unless you've hit your firm's monthly study cap.
            </FAQ>
            <FAQ q="What if my project site is outside the Atlanta MSA?">
              Today the engine only services the Atlanta MSA box (the GDOT
              data feed is Georgia-specific). Adjacent metros — Charlotte,
              Nashville, Birmingham, Jacksonville — are on the roadmap; each
              one needs its state DOT integration before launch.{" "}
              <Link href="/contact" className="text-blue-700 hover:underline">Contact us</Link> if your firm wants
              to be a beta partner in a specific metro.
            </FAQ>
            <FAQ q="Can I save and re-print a past study?">
              Yes. Every successful run saves to your firm's project history
              at <code className="px-1 py-0.5 bg-muted rounded text-xs">/projects</code>. Re-printing
              doesn't count against your monthly study quota — only fresh
              generations do.
            </FAQ>
          </FaqList>
        </section>

        <section id="deliverable">
          <Marker n="03" label="The deliverable" />
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-5">
            What's in every deliverable
          </h2>
          <div className="border border-border bg-background p-6 space-y-3">
            <p className="font-medium">A typical TIS PDF runs 6–10 pages depending on intersection count:</p>
            <ul className="text-sm space-y-2 leading-relaxed">
              <li><strong>Page 1 — Cover.</strong> Your firm's logo, project name, address, client, opening year, PE stamp box, signature/date lines.</li>
              <li><strong>Page 2 — Executive summary.</strong> Headline metric strip (intersections studied, LOS drops, intersections at E/F, worst Δ delay), project inputs, PM-peak trip generation, period-by-period trip totals.</li>
              <li><strong>Page 3+ — Intersections.</strong> One row per signal: existing/future LOS chips (color-coded), Δ delay, 95th-percentile back-of-queue length, recommended mitigation sized to the impact.</li>
              <li><strong>Monte-Carlo sensitivity</strong> (optional). 100-iteration robustness test on the LOS impacts.</li>
              <li><strong>Findings + methodology appendices.</strong> Every figure footnoted to HCM, ITE, MUTCD, AASHTO. PE-defensible.</li>
              <li><strong>Citations page</strong> at the end with the full reference list.</li>
            </ul>
            <p className="text-sm text-muted-foreground pt-2">
              Want to see the actual file before signing up?{" "}
              <a href="/sample-tis-report.pdf" target="_blank" rel="noopener" className="text-blue-700 hover:underline font-medium">
                Download a sample TIS report →
              </a>
            </p>
          </div>
        </section>

        <section id="firm-setup">
          <Marker n="04" label="Firm account" />
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-5">
            Firm account &amp; branding
          </h2>
          <FaqList>
            <FAQ q="Can multiple engineers in my firm use one account?">
              Yes — that's the firm-account model. Starter includes 3 seats;
              Growth includes unlimited. Each seat is a separate sign-in for
              an engineer; all projects roll up to the firm.{" "}
              <Link href="/settings/firm" className="text-blue-700 hover:underline">Settings → Firm</Link> manages
              members, invites, and roles (owner / admin / member).
            </FAQ>
            <FAQ q="How does white-labeling work?">
              Upload your firm's logo at <Link href="/settings/firm" className="text-blue-700 hover:underline">Settings → Firm</Link>.
              PNG, JPG, SVG, or WebP up to 2 MB. Every PDF cover from that
              point on shows your logo top-right. The PE name and license
              number in the signature block come from{" "}
              <Link href="/settings/profile" className="text-blue-700 hover:underline">Settings → Profile</Link>.
            </FAQ>
            <FAQ q="What roles can do what?">
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li><strong>Owner.</strong> Everything an admin can do, plus billing changes and removing other members.</li>
                <li><strong>Admin.</strong> Edit firm details, upload logos, invite + manage members, run studies.</li>
                <li><strong>Member.</strong> Run studies and view firm history. No billing or member-management access.</li>
              </ul>
            </FAQ>
          </FaqList>
        </section>

        <section id="quota">
          <Marker n="05" label="Quota & billing" />
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-5">
            Studies, quota &amp; billing
          </h2>
          <FaqList>
            <FAQ q="What counts as a 'study'?">
              One successful run of the generator. Re-prints and re-opens of
              past projects don't count. If a generation errors out (bad
              coordinate, upstream timeout), it doesn't count either — the
              quota only ticks when a study completes and saves to your
              project history.
            </FAQ>
            <FAQ q="What if we hit our monthly cap?">
              You'll see a soft warning at 80% usage and a hard block at
              100%. Upgrades take effect immediately from{" "}
              <Link href="/settings/billing" className="text-blue-700 hover:underline">Settings → Billing</Link>.
              The cap resets on every successful Stripe invoice (your billing
              anniversary).
            </FAQ>
            <FAQ q="Annual vs monthly billing?">
              Annual plans bill once per year and save you ~17% ("2 months
              free"). The cap is monthly either way — annual just changes the
              invoice cadence, not the quota cadence.
            </FAQ>
            <FAQ q="How do I cancel?">
              From <Link href="/settings/billing" className="text-blue-700 hover:underline">Settings → Billing</Link>{" "}
              → Manage in Stripe Portal. You keep access until the end of the
              billing period you've already paid for; afterward the firm
              drops back to trial mode (project history stays).
            </FAQ>
          </FaqList>
        </section>

        <section id="data">
          <Marker n="06" label="Data & methodology" />
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-5">
            Data sources &amp; methodology
          </h2>
          <FaqList>
            <FAQ q="Where do the intersection counts come from?">
              GDOT 511 NaviGAtor v2 — Georgia DOT's public ITS feed. The
              engine pulls live signal volumes and incident data. For
              intersections where we have ground-truth observations, we
              calibrate the HCM delay model against observed delay; report
              text notes which signals are calibrated and against how many
              samples.
            </FAQ>
            <FAQ q="What standards are referenced?">
              HCM 6th Edition (capacity, LOS, queuing). ITE Trip Generation
              Manual 11th Edition (rates, K/D factors, pass-by). ITE Parking
              Generation 5th Edition. MUTCD 2009/2024 (signal warrants).
              AASHTO Green Book (sight distance). FHWA (road-diet feasibility).
              Every figure on every page footnotes the specific source.
            </FAQ>
            <FAQ q="Is this a substitute for stamped engineering work?">
              <strong>No.</strong> Outputs are screening-grade and meant to
              support — not replace — a licensed PE's analytical workflow.
              Every PDF includes a "not for design submittal without
              independent verification" footer. The product is built to free
              up PE hours, not to replace PE judgment. See the{" "}
              <Link href="/legal/disclaimer" className="text-blue-700 hover:underline">Engineering Disclaimer</Link>{" "}
              for full scope.
            </FAQ>
          </FaqList>
        </section>

        <section id="troubleshooting">
          <Marker n="07" label="Troubleshooting" />
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-5">
            Troubleshooting
          </h2>
          <FaqList>
            <FAQ q="The generator returned 'No intersections found' — what now?">
              Your study radius is probably too small for the chosen site,
              or you're in an area without GDOT-managed signals (e.g., a
              private campus). Try increasing radius up to 6.5 mi. If still
              zero, your project genuinely has no off-site signalized
              intersections in range — the report will note that and skip
              the capacity analysis.
            </FAQ>
            <FAQ q="The PDF download isn't working.">
              Most often a browser pop-up blocker. Open{" "}
              <Link href="/projects" className="text-blue-700 hover:underline">My projects</Link>{" "}
              and click the download icon next to the study — that's a
              direct download link, no pop-up. If that fails too,{" "}
              <Link href="/contact" className="text-blue-700 hover:underline">contact us</Link>{" "}
              with the project name and we'll regenerate.
            </FAQ>
            <FAQ q="I forgot my password.">
              Use the{" "}
              <Link href="/auth/forgot" className="text-blue-700 hover:underline">Forgot password link</Link>{" "}
              on the login page. The reset email is sent through Resend; it
              usually lands within 30 seconds (check spam if not).
            </FAQ>
            <FAQ q="I accidentally signed up with the wrong email.">
              Two options: re-sign-up under the correct email (firms with
              zero past projects can be safely abandoned), or{" "}
              <Link href="/contact" className="text-blue-700 hover:underline">contact us</Link>{" "}
              and we'll migrate your account.
            </FAQ>
          </FaqList>
        </section>

        <section className="border border-border bg-slate-50 dark:bg-slate-950/40 px-6 sm:px-10 py-10 space-y-4">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Didn't find your answer?
          </h2>
          <p className="text-muted-foreground leading-relaxed max-w-xl">
            We reply same-day. Drop us a line — questions about pricing,
            integrations, demos, or anything else welcome.
          </p>
          <Link
            href="/contact"
            className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
          >
            Contact us
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function FaqList({ children }: { children: React.ReactNode }) {
  return <div className="border-y border-border divide-y divide-border">{children}</div>;
}

function FAQ({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="py-4 cursor-pointer list-none font-semibold flex items-center justify-between gap-4">
        <span>{q}</span>
        <span className="text-muted-foreground text-xl group-open:rotate-45 transition-transform shrink-0">
          +
        </span>
      </summary>
      <div className="pb-4 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </details>
  );
}
