/**
 * Minimal cookie / session banner. We don't run third-party
 * tracking, but a banner is expected in B2B-SaaS UX and gives us a
 * place to link to the Privacy Policy.
 *
 * One persistent cookie ("tis_cookie_ack=1") records that the user
 * dismissed it so we don't re-show on every page.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Cookie, X } from "lucide-react";

const ACK_KEY = "tis_cookie_ack";

export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const acked = document.cookie.includes(`${ACK_KEY}=1`);
    if (!acked) setShow(true);
  }, []);

  function dismiss() {
    const oneYear = 365 * 24 * 60 * 60;
    document.cookie = `${ACK_KEY}=1; Max-Age=${oneYear}; Path=/; SameSite=Lax`;
    setShow(false);
  }

  if (!show) return null;
  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 bg-background border rounded-xl shadow-lg p-4 flex items-start gap-3 text-sm">
      <Cookie className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="font-semibold mb-0.5">We use cookies</div>
        <p className="text-muted-foreground leading-relaxed">
          Just session cookies for sign-in. No advertising or cross-site tracking.{" "}
          <Link href="/legal/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="px-3 py-1 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 shrink-0"
        data-testid="button-cookie-ack"
      >
        OK
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="p-1 rounded-md hover:bg-accent text-muted-foreground shrink-0 -mr-1 -mt-1"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
