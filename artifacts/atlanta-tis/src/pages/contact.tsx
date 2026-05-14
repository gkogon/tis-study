/**
 * Public /contact page. Two paths in:
 *
 *   1. Cold-email recipients who'd rather not open their mail app to
 *      reply (~30% of desktop users — mailto silently fails for them).
 *   2. Prospects researching the product who want a way to inquire
 *      without committing to a trial signup yet.
 *
 * Posts to the existing /tis-api/leads endpoint (rate-limited 5/10min/IP
 * via leadsRateLimiter, honeypot-protected). On submit, we surface a
 * success state with the user's name pinned so they can confirm it
 * went through.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useCreateLead } from "@workspace/tis-api-client-react";
import {
  Mail, Building2, CheckCircle2, AlertCircle, Loader2, Send,
  Copy, Check as CheckIcon, MessageSquare,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

const CONTACT_EMAIL = "gkogon@simpleimpactstudies.com";

export default function ContactPage() {
  const create = useCreateLead();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [city, setCity] = useState("");
  const [role, setRole] = useState("");
  const [topic, setTopic] = useState<"general" | "enterprise" | "demo" | "support">("general");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const enrichedMessage = [
      `Topic: ${TOPIC_LABEL[topic]}`,
      message ? `\nMessage:\n${message}` : null,
    ].filter(Boolean).join("\n");

    create.mutate(
      {
        data: {
          name: name.trim(),
          email: email.trim(),
          organization: organization.trim() || "(not provided)",
          city: city.trim() || "(not provided)",
          role: role.trim() || undefined,
          message: enrichedMessage,
          productInterest: topic,
          source: "other",
          website,
        },
      },
      { onSuccess: () => setSubmitted(true) },
    );
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = CONTACT_EMAIL;
      document.body.appendChild(input);
      input.select();
      try { document.execCommand("copy"); } catch { /* swallow */ }
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 space-y-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 dark:bg-slate-100 border border-slate-900 dark:border-slate-100 text-xs font-medium text-white dark:text-slate-900">
            <MessageSquare className="w-3.5 h-3.5" />
            Contact us
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight text-slate-900 dark:text-slate-50">
            Get in touch.
            <br />
            <span className="bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              We reply same-day.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            Questions about Enterprise pricing, a custom integration, a
            demo for your team, or just want to compare us against your
            current screening workflow — drop us a line.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-2xl border border-border bg-background p-6 space-y-4">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                <Mail className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="font-semibold tracking-tight">Email us directly</div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  For quick questions or if you'd rather skip the form,
                  email <span className="font-mono text-foreground">{CONTACT_EMAIL}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={copyEmail}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium hover:bg-accent transition-colors"
                aria-label="Copy email address"
              >
                {copied ? <CheckIcon className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied to clipboard" : "Copy email address"}
              </button>
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Simple%20Impact%20Studies%20inquiry`}
                className="block text-center text-xs text-blue-700 hover:underline"
              >
                Or open in mail app →
              </a>
            </div>

            <div className="rounded-2xl border border-border bg-slate-50 dark:bg-slate-950/40 p-6 space-y-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="font-semibold tracking-tight">For Enterprise prospects</div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Multi-state firms running 100+ screenings/month —
                  schedule a 30-min walkthrough plus a custom volume quote.
                  Most Enterprise contracts close inside 4–6 weeks.
                </p>
              </div>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
              >
                See plan comparison →
              </Link>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <div className="font-semibold uppercase tracking-widest text-foreground/80">
                What to expect
              </div>
              <p className="leading-relaxed">
                Same-day reply for inquiries received during business hours
                (9am–6pm ET, Mon–Fri). Inquiries on weekends get a Monday
                morning reply. We never sell, share, or pass your email to a
                third party — see the{" "}
                <Link href="/legal/privacy" className="text-blue-700 hover:underline">
                  Privacy Policy
                </Link>.
              </p>
            </div>
          </div>

          <div className="lg:col-span-7">
            {submitted ? (
              <div className="rounded-2xl border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-8 space-y-4 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/40">
                  <CheckCircle2 className="w-6 h-6 text-green-700 dark:text-green-300" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight">Got it — talk soon.</h2>
                <p className="text-muted-foreground leading-relaxed max-w-md mx-auto">
                  Your message is in. You'll hear back at{" "}
                  <span className="font-mono text-foreground">{email}</span> within one
                  business day.
                </p>
                <div className="pt-2">
                  <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md border hover:bg-accent transition-colors"
                  >
                    Back to home
                  </Link>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                className="rounded-2xl border border-border bg-background p-6 sm:p-8 space-y-5"
              >
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold tracking-tight">Send us a message</h2>
                  <p className="text-sm text-muted-foreground">
                    Required fields marked with *. Don't sweat the details — a
                    name and a question is enough to get started.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Field
                    label="Your name *"
                    value={name}
                    onChange={setName}
                    placeholder="Jane Smith, PE"
                    required
                  />
                  <Field
                    label="Work email *"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="jane@firm.com"
                    required
                  />
                  <Field
                    label="Firm / organization"
                    value={organization}
                    onChange={setOrganization}
                    placeholder="Acme Engineering"
                  />
                  <Field
                    label="City"
                    value={city}
                    onChange={setCity}
                    placeholder="Atlanta"
                  />
                  <Field
                    label="Your role"
                    value={role}
                    onChange={setRole}
                    placeholder="Traffic Practice Lead"
                  />
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      What's this about?
                    </label>
                    <select
                      value={topic}
                      onChange={(e) => setTopic(e.target.value as typeof topic)}
                      className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                    >
                      <option value="general">General inquiry</option>
                      <option value="enterprise">Enterprise pricing</option>
                      <option value="demo">Schedule a demo</option>
                      <option value="support">Support / billing</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Message
                  </label>
                  <textarea
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                    placeholder="Tell us about your firm, typical screening volume, or any specific question."
                  />
                </div>

                {/* Honeypot — invisible to humans, irresistible to bots */}
                <div className="absolute -left-[10000px]" aria-hidden>
                  <label>
                    Your website (leave blank):
                    <input
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </label>
                </div>

                {create.isError && (
                  <div className="flex gap-2 items-start rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      Something went wrong. Email us directly at{" "}
                      <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
                        {CONTACT_EMAIL}
                      </a>{" "}
                      so we don't lose your message.
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={create.isPending || !name.trim() || !email.trim()}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all shadow-sm disabled:opacity-50"
                >
                  {create.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {create.isPending ? "Sending…" : "Send message"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

const TOPIC_LABEL: Record<string, string> = {
  general: "General inquiry",
  enterprise: "Enterprise pricing",
  demo: "Schedule a demo",
  support: "Support / billing",
};

function Field({
  label, value, onChange, placeholder, type = "text", required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md border bg-background text-sm"
      />
    </div>
  );
}
