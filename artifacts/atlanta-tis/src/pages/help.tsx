/**
 * Public /help page. Reduces inbound support load by pre-answering
 * the questions that come up in a typical first-week-of-use cycle —
 * how to run the first study, what the deliverable contains, how
 * firm-wide accounts work, etc. Also serves as content for prospects
 * researching the product before signing up.
 */
import { Link } from "wouter";
import {
  BookOpen, MapPin, Building2, FileCheck2, ShieldCheck,
  CreditCard, Mail, Search, ArrowRight, ChevronRight,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function HelpPage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 space-y-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 dark:bg-slate-100 border border-slate-900 dark:border-slate-100 text-xs font-medium text-white dark:text-slate-900">
            <BookOpen className="w-3.5 h-3.5" />
            Help & docs
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight text-slate-900 dark:text-slate-50">
            Get up and running
            <br />
            <span className="bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              in under five minutes.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            Everything you need to run your first screening, set up your
            firm account, and understand what's in every deliverable.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-16">

        {/* Quick-start workflow */}
        <section className="space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
              Quick start
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              From signup to your first PDF in 4 steps.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Step n={1} icon={Building2} title="Sign up & name your firm">
              Email + password, then a single firm name. Your team can join
              later under the same firm — every study they run rolls up to
              your shared project history.
            </Step>
            <Step n={2} icon={MapPin} title="Drop a pin on your site">
              Anywhere in the Atlanta MSA. The generator pulls live GDOT
              counts and signal data for every intersection in your study
              radius (up to 6.5 mi).
            </Step>
            <Step n={3} icon={FileCheck2} title="Pick a land use + size">
              Any of 80 ITE 11th-Ed. land-use codes (multifamily, office,
              retail, fuel station, drive-through…). Enter unit count or
              square footage; pass-by capture is computed automatically.
            </Step>
            <Step n={4} icon={FileCheck2} title="Download the report">
              Cover page, executive summary, intersection table,
              mitigations, methodology + limitations appendices. White-
              labeled with your firm's logo if you've uploaded one.
            </Step>
          </div>
        </section>

        {/* Section anchors / table of contents */}
        <section className="grid sm:grid-cols-2 gap-3">
          <SectionLink to="#first-study" icon={MapPin} label="Running your first study" />
          <SectionLink to="#deliverable" icon={FileCheck2} label="What's in the PDF" />
          <SectionLink to="#firm-setup" icon={Building2} label="Firm account & branding" />
          <SectionLink to="#quota" icon={ShieldCheck} label="Studies, quota, & billing" />
          <SectionLink to="#data" icon={Search} label="Data sources & methodology" />
          <SectionLink to="#troubleshooting" icon={CreditCard} label="Troubleshooting" />
        </section>

        {/* Running your first study */}
        <section id="first-study" className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Running your first study
          </h2>
          <FAQ q="What inputs does the generator need?">
            <p>Three required fields:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Site coordinates</strong> — drop a pin on the map or paste a lat/lon. Must fall inside the Atlanta MSA box (lat 33.4–34.2, lon −84.9 to −83.9).</li>
              <li><strong>ITE land-use code</strong> — picked from a dropdown of 80 codes. Each code carries its own daily/AM-peak/PM-peak rates from the ITE Trip Generation Manual 11th Edition.</li>
              <li><strong>Project size</strong> — usually dwelling units (multifamily), 1,000-sqft GFA (office/retail), or fueling positions (gas stations). The unit auto-updates based on the chosen land use.</li>
            </ul>
            <p className="mt-2">Optional fields for more precise screening: opening year (default 2027), study radius (default 0.5 mi), background growth rate, weather scenario, pass-by override, and Monte-Carlo sensitivity toggle.</p>
          </FAQ>
          <FAQ q="How long does generation take?">
            Most studies complete in 30–90 seconds. The generator pulls live
            GDOT 511 data + intersection inventory in parallel with the trip
            generation math; if GDOT's API is slow that day, the run can
            take up to 2 minutes. There's no queue — runs are not throttled
            unless you've hit your firm's monthly study cap.
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
        </section>

        {/* What's in the deliverable */}
        <section id="deliverable" className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            What's in every deliverable
          </h2>
          <div className="rounded-2xl border border-border bg-background p-6 space-y-3">
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

        {/* Firm account */}
        <section id="firm-setup" className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Firm account & branding
          </h2>
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
        </section>

        {/* Quota & billing */}
        <section id="quota" className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Studies, quota & billing
          </h2>
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
        </section>

        {/* Data & methodology */}
        <section id="data" className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Data sources & methodology
          </h2>
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
        </section>

        {/* Troubleshooting */}
        <section id="troubleshooting" className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Troubleshooting
          </h2>
          <FAQ q="The generator returned 'No intersections found' — what now?">
            Your study radius is probably too small for the chosen site,
            or you're in an area without GDOT-managed signals (e.g.,
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
        </section>

        {/* Contact strip */}
        <section className="rounded-2xl border border-border bg-slate-50 dark:bg-slate-950/40 p-6 sm:p-8 text-center space-y-3">
          <Mail className="w-8 h-8 text-blue-700 mx-auto" />
          <h2 className="text-2xl font-bold tracking-tight">Didn't find your answer?</h2>
          <p className="text-muted-foreground">
            We reply same-day. Drop us a line — questions about pricing,
            integrations, demos, or anything else welcome.
          </p>
          <div className="pt-2">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm"
            >
              Contact us <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function Step({
  n, icon: Icon, title, children,
}: { n: number; icon: typeof MapPin; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-5 space-y-2.5">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-full bg-foreground text-background text-xs font-bold flex items-center justify-center">
          {n}
        </span>
        <Icon className="w-5 h-5 text-blue-700" />
      </div>
      <h3 className="font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function SectionLink({
  to, icon: Icon, label,
}: { to: string; icon: typeof MapPin; label: string }) {
  return (
    <a
      href={to}
      className="rounded-xl border border-border bg-background p-4 flex items-center gap-3 hover:bg-accent transition-colors group"
    >
      <Icon className="w-4 h-4 text-blue-700 shrink-0" />
      <span className="text-sm font-medium flex-1">{label}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
    </a>
  );
}

function FAQ({
  q, children,
}: { q: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-border bg-background overflow-hidden group">
      <summary className="px-5 py-4 cursor-pointer list-none font-semibold flex items-center justify-between">
        <span>{q}</span>
        <span className="text-muted-foreground text-xl group-open:rotate-45 transition-transform shrink-0 ml-3">
          +
        </span>
      </summary>
      <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </details>
  );
}
