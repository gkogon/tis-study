/**
 * Public /security page. Enterprise prospects always ask. Without
 * something on this surface they have to email procurement, which
 * delays the deal by weeks. The page makes the current posture
 * explicit and honest: we ship strong fundamentals today, SOC 2 /
 * SSO are on the Enterprise roadmap with timelines.
 *
 * Honest framing matters: don't claim certifications we don't hold.
 * A prospect's security reviewer will catch any overclaim and we'll
 * lose the deal — exactly the wrong outcome for a page meant to
 * unblock procurement.
 */
import { Link } from "wouter";
import {
  ShieldCheck, Lock, Database, Server, KeyRound, Mail, ArrowRight,
  Check, Clock, FileText,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function SecurityPage() {
  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 space-y-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 dark:bg-slate-100 border border-slate-900 dark:border-slate-100 text-xs font-medium text-white dark:text-slate-900">
            <ShieldCheck className="w-3.5 h-3.5" />
            Security
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight text-slate-900 dark:text-slate-50">
            Engineering data,
            <br />
            <span className="bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              treated like it matters.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            Project inputs, intersection data, and PDF deliverables stay
            private to your firm. We don't train models on your data, we
            don't share it with third parties, and we publish our current
            posture honestly.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-16">
        <section className="grid sm:grid-cols-2 gap-4">
          <Card icon={Lock} title="Encrypted in transit">
            All traffic between your browser, our servers, and our analyzer
            service uses TLS 1.3 (HSTS enabled, max-age 1 year).
          </Card>
          <Card icon={Database} title="Encrypted at rest">
            Postgres is hosted on Railway with disk-level encryption. Backups
            inherit the same.
          </Card>
          <Card icon={KeyRound} title="No model training on your data">
            Project inputs and outputs aren't used to train external models.
            We don't sell, share, or aggregate anonymized project data with
            third parties. See the{" "}
            <Link href="/legal/privacy" className="text-blue-700 hover:underline">
              Privacy Policy
            </Link>.
          </Card>
          <Card icon={Server} title="Single-region deployment">
            Production runs on Railway in us-east. Postgres + analyzer +
            web service co-located so project data doesn't traverse the
            public internet between tiers.
          </Card>
        </section>

        <section className="space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
              Application security
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              How sign-in and sessions work.
            </h2>
          </div>
          <ul className="space-y-3 text-sm">
            <Bullet>
              <strong>bcrypt password hashing</strong> with a per-user salt.
              Passwords are never stored in plaintext or recoverable form;
              forgotten passwords go through a time-boxed reset token (1
              hour TTL).
            </Bullet>
            <Bullet>
              <strong>Server-side sessions</strong> in a hardened
              <code className="mx-1 px-1 py-0.5 text-xs bg-muted rounded">sessions</code>
              table — only an opaque cookie ID is sent to the browser,
              never a JWT containing claims. Sessions expire on a fixed
              TTL and are invalidated on sign-out.
            </Bullet>
            <Bullet>
              <strong>HttpOnly + Secure + SameSite=Lax cookies.</strong>
              The session cookie is unreadable from JavaScript (mitigates
              token theft via XSS), only sent over HTTPS, and protected
              against most CSRF vectors out of the box.
            </Bullet>
            <Bullet>
              <strong>Rate-limited auth endpoints.</strong> Login, signup,
              password reset, and unsubscribe each have per-IP rate limits
              to blunt brute-force, mailbox-flooding, and account-enumeration
              attempts.
            </Bullet>
            <Bullet>
              <strong>Webhook signature verification.</strong> Inbound
              Stripe webhooks are verified against the signing secret
              using HMAC-SHA256 over the raw payload + timestamp; replay
              attacks are rejected.
            </Bullet>
          </ul>
        </section>

        <section className="space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
              Data handling
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              What we collect and what we don't.
            </h2>
          </div>
          <div className="rounded-2xl border border-border overflow-hidden">
            <ul className="divide-y divide-border">
              <DataRow
                what="Account info (email, name, password hash)"
                why="Required to authenticate you and route your projects to the right firm."
              />
              <DataRow
                what="Firm info (name, logo, billing address)"
                why="Required to white-label the PDFs and process subscription billing."
              />
              <DataRow
                what="Project inputs (coordinates, land use, size, address)"
                why="Required to compute the study. Stored so you can re-open and re-print."
              />
              <DataRow
                what="Project outputs (TIS reports, intersection tables)"
                why="Stored so the firm has a permanent audit trail of every study run."
              />
              <DataRow
                what="Stripe customer/subscription IDs"
                why="Required to bill. Card numbers themselves never touch our servers — they live in Stripe."
              />
              <DataRow
                what="Pino structured logs (request paths, statuses, errors)"
                why="Operational debugging. Retained 30 days. Never includes user inputs or PII."
                negative={false}
              />
              <DataRow
                what="Analytics / behavioral tracking"
                why="None today. No GA, no Mixpanel, no session-replay tools. If we add product analytics later it'll be first-party and disclosed here."
                negative={true}
              />
              <DataRow
                what="Third-party data sharing"
                why="None. Project data isn't sold, shared, or aggregated with any external party. Stripe sees billing info only; that's it."
                negative={true}
              />
            </ul>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-slate-50 dark:bg-slate-950/40 px-6 sm:px-10 py-10 space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-blue-700">
              On the roadmap
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Compliance milestones in flight.
            </h2>
            <p className="text-muted-foreground">
              We're transparent about what we ship today vs. what's coming.
              No false claims — your security reviewer can verify everything
              on this page.
            </p>
          </div>
          <ul className="space-y-3">
            <Milestone
              status="now"
              title="Encryption + sessions + rate limits"
              detail="All shipped and in production today."
            />
            <Milestone
              status="soon"
              title="SSO via Okta / Azure AD"
              detail="Wired on Enterprise sign — typically within the contract negotiation window."
            />
            <Milestone
              status="soon"
              title="DPA + MSA available on request"
              detail="Reviewed by your legal team; we sign the standard templates plus reasonable redlines."
            />
            <Milestone
              status="planned"
              title="SOC 2 Type II"
              detail="Scoped to begin once we cross $1M ARR. We'll publish the report under NDA on request before completion."
            />
            <Milestone
              status="planned"
              title="Audit log export"
              detail="Per-firm CSV export of generations, member adds/removes, and billing events. Useful for internal compliance and client deliverables."
            />
          </ul>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 px-6 py-6 space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-amber-700 dark:text-amber-300" />
            <h3 className="font-semibold tracking-tight">Report a security issue</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Email <a href="mailto:gkogon@simpleimpactstudies.com?subject=Security%20disclosure" className="font-mono text-foreground hover:underline">gkogon@simpleimpactstudies.com</a>{" "}
            with subject "Security disclosure" — we ack within one business
            day. We don't run a paid bounty program yet, but we'll credit
            responsible disclosure publicly (with your permission) once
            fixes ship.
          </p>
          <p className="text-xs text-muted-foreground">
            Please give us a reasonable disclosure window before going
            public. We commit to 90 days max for any reported issue.
          </p>
        </section>

        <section className="text-center max-w-2xl mx-auto space-y-4">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Need more detail for procurement?
          </h2>
          <p className="text-muted-foreground">
            We're happy to fill out vendor questionnaires (SIG, CAIQ, custom)
            and walk your security team through architecture. Most reviews
            close in 1–2 calls.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm"
            >
              Contact us <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/legal/privacy"
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border hover:bg-accent transition-colors"
            >
              <FileText className="w-4 h-4" /> Privacy Policy
            </Link>
          </div>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function Card({
  icon: Icon, title, children,
}: { icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-5 space-y-3">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
        <Icon className="w-5 h-5" />
      </div>
      <div className="font-semibold tracking-tight">{title}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <Check className="w-4 h-4 text-blue-700 mt-1 shrink-0" />
      <span className="leading-relaxed text-sm">{children}</span>
    </li>
  );
}

function DataRow({
  what, why, negative,
}: { what: string; why: string; negative?: boolean }) {
  return (
    <li className="px-5 py-4 grid sm:grid-cols-[260px_1fr] gap-3 items-start">
      <div className="flex items-start gap-2">
        {negative ? (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[10px] font-bold mt-0.5 shrink-0">
            ✕
          </span>
        ) : (
          <Check className="w-4 h-4 text-blue-700 mt-1 shrink-0" />
        )}
        <div className="font-medium text-sm">{what}</div>
      </div>
      <div className="text-sm text-muted-foreground leading-relaxed">{why}</div>
    </li>
  );
}

function Milestone({
  status, title, detail,
}: { status: "now" | "soon" | "planned"; title: string; detail: string }) {
  const badge =
    status === "now"
      ? { label: "Shipped", color: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300", icon: Check }
      : status === "soon"
        ? { label: "On Enterprise", color: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300", icon: Clock }
        : { label: "Planned", color: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300", icon: Clock };
  const BadgeIcon = badge.icon;
  return (
    <li className="flex items-start gap-3">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold mt-0.5 shrink-0 ${badge.color}`}>
        <BadgeIcon className="w-3 h-3" />
        {badge.label}
      </span>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{detail}</div>
      </div>
    </li>
  );
}
