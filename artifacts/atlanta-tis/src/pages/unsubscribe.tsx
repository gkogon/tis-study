/**
 * Public unsubscribe page. Reachable without authentication so
 * cold-email recipients can opt out without ever signing up. The
 * footer link in marketing emails points here:
 *
 *   https://simpleimpactstudies.com/unsubscribe?email=<recipient>
 *
 * The email query param prefills the form so the user only has to
 * click confirm. Submitting POSTs to /api/unsubscribe and surfaces
 * the confirmed state. Idempotent — re-submitting after already
 * opting out shows the same success page.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type View = "form" | "submitting" | "done" | "error";

export default function UnsubscribePage() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [view, setView] = useState<View>("form");
  const [error, setError] = useState<string | null>(null);
  const [alreadyOpted, setAlreadyOpted] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  // Prefill from ?email=… and ?source=… (the cold-email footer link
  // can append a source tag like "outbound_apr2026" to attribute the
  // unsubscribe to a specific campaign).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const e = sp.get("email")?.trim();
    if (e) setEmail(e);
    const s = sp.get("source")?.trim();
    if (s) setSource(s);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter the email you want to unsubscribe.");
      return;
    }
    setError(null);
    setView("submitting");
    try {
      const r = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          reason: reason.trim() || undefined,
          source: source ?? "unsubscribe_page",
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error ?? `HTTP ${r.status}`);
        setView("error");
        return;
      }
      setAlreadyOpted(!!data.alreadyOpted);
      setView("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setView("error");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>

        {view === "done" ? (
          <div className="rounded-xl border bg-card p-8 space-y-4">
            <div className="flex gap-3 items-start">
              <CheckCircle2 className="w-6 h-6 text-green-600 mt-0.5 shrink-0" />
              <div>
                <h1 className="text-2xl font-bold">
                  {alreadyOpted ? "Already unsubscribed" : "Unsubscribed"}
                </h1>
                <p className="text-muted-foreground mt-1">
                  <span className="font-mono text-sm">{email}</span>{" "}
                  {alreadyOpted
                    ? "was already on our opt-out list."
                    : "won't receive any further marketing emails from us."}
                </p>
                <p className="text-sm text-muted-foreground mt-3">
                  Transactional emails (password resets, billing receipts,
                  firm invites) will keep working if you're a customer —
                  those are operationally required and exempt from this
                  opt-out.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold">Unsubscribe</h1>
              <p className="text-muted-foreground mt-2">
                Remove your email from our outbound marketing list. Takes
                effect immediately.
              </p>
            </div>

            {error && (
              <div className="flex gap-2 items-start rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>{error}</div>
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <label className="block space-y-1">
                <span className="text-sm font-medium">Email address</span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm font-mono"
                  placeholder="you@firm.com"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-sm font-medium">
                  Reason <span className="text-muted-foreground font-normal">(optional)</span>
                </span>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                  placeholder="Helps us improve — not required."
                />
              </label>

              <button
                type="submit"
                disabled={view === "submitting"}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-foreground text-background hover:opacity-90 disabled:opacity-50"
              >
                {view === "submitting" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Unsubscribe
              </button>
            </form>

            <p className="text-xs text-muted-foreground border-t pt-4">
              Simple Impact Studies · Atlanta, GA · You're receiving this
              option because someone (you or another contact) added this
              address to our outreach list.
            </p>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
