/**
 * Inline banner that warns the signed-in user when their firm is near
 * or at their study quota. Honors the pricing-page promise: "we show a
 * soft warning before your last study and a hard block after."
 *
 * - At ≥80% usage: yellow warning + link to upgrade.
 * - At 100% usage: red block + clear upgrade CTA.
 * - Below 80%: render nothing.
 *
 * Enterprise tier (when wired) has no cap, so the banner self-hides
 * whenever studyLimit is non-positive.
 *
 * Self-contained: fetches /tis-api/billing/summary on mount. Mount
 * once per page; the small extra request is cheap and keeps the
 * banner state isolated.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ShieldAlert, X } from "lucide-react";

type Summary = {
  firm: {
    planTier: string;
    studyLimit: number;
    studiesUsedThisPeriod: number;
    currentPeriodEnd: string | null;
  } | null;
};

const DISMISSED_KEY = "quotaBannerDismissedAt";

/**
 * Returns true if the user dismissed the warning within the last
 * 24h. Dismissal is per-browser; the underlying quota doesn't change
 * so re-showing every page load would be noisy.
 */
function recentlyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISSED_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < 24 * 60 * 60 * 1000;
}

function markDismissed() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
}

export function QuotaBanner() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dismissed, setDismissed] = useState(recentlyDismissed());

  useEffect(() => {
    let cancelled = false;
    fetch("/tis-api/billing/summary", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Summary | null) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => { /* silent — banner just won't render */ });
    return () => { cancelled = true; };
  }, []);

  if (!summary?.firm) return null;
  const { studyLimit, studiesUsedThisPeriod } = summary.firm;
  if (studyLimit <= 0) return null;

  const ratio = studiesUsedThisPeriod / studyLimit;
  const remaining = Math.max(0, studyLimit - studiesUsedThisPeriod);
  const tier = summary.firm.planTier;
  const tierLabel = tier === "trial" ? "trial" : tier;

  // Hard cap hit — always show, never auto-dismiss.
  if (studiesUsedThisPeriod >= studyLimit) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3 text-sm">
        <ShieldAlert className="w-5 h-5 text-red-700 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold text-red-900">
            {tierLabel === "trial" ? "Trial used up" : "Quota reached"}
          </div>
          <div className="text-red-800 mt-0.5">
            You've used <strong>{studiesUsedThisPeriod} of {studyLimit}</strong> studies this period.
            New generations are blocked.
            {tierLabel === "trial"
              ? " Upgrade to keep generating."
              : " Upgrade or wait for the next billing period."}
          </div>
        </div>
        <Link
          href="/settings/billing"
          className="text-sm font-semibold px-3 py-1.5 rounded-md bg-red-700 text-white hover:bg-red-800 shrink-0"
          data-testid="link-quota-upgrade"
        >
          Upgrade
        </Link>
      </div>
    );
  }

  // Soft warning at ≥80% usage. Suppress for 24h if user dismissed.
  if (ratio >= 0.8 && !dismissed) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3 text-sm">
        <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold text-amber-900">
            {remaining === 1 ? "Last study on your plan" : `${remaining} studies left`}
          </div>
          <div className="text-amber-800 mt-0.5">
            You've used <strong>{studiesUsedThisPeriod} of {studyLimit}</strong>{" "}
            {tierLabel === "trial" ? "trial" : "monthly"} studies. Upgrade to keep
            generating without interruption.
          </div>
        </div>
        <Link
          href="/settings/billing"
          className="text-sm font-semibold px-3 py-1.5 rounded-md bg-amber-700 text-white hover:bg-amber-800 shrink-0"
        >
          Upgrade
        </Link>
        <button
          type="button"
          onClick={() => { markDismissed(); setDismissed(true); }}
          className="text-amber-700 hover:text-amber-900 shrink-0"
          aria-label="Dismiss for 24 hours"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return null;
}
