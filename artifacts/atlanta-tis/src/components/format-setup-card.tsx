/**
 * First-run prompt for a firm that has no report format yet: upload one past
 * study and every generated PDF comes out in the firm's format. Shown at the
 * top of the study and projects pages until a format exists or the card is
 * dismissed (per browser). Owners/admins upload here; members are pointed at
 * a firm owner. Renders nothing while the library is loading, when the firm
 * already has a format, or when its only format is a legacy (V1) upload —
 * the settings page carries that notice.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Upload, Loader2, X, CheckCircle2 } from "lucide-react";
import { FORMAT_CARD_DISMISSED_KEY, fetchThemes, previewUrl, uploadTheme } from "../lib/report-themes";

function readDismissed(): boolean {
  try { return localStorage.getItem(FORMAT_CARD_DISMISSED_KEY) === "1"; } catch { return false; }
}
function writeDismissed(): void {
  try { localStorage.setItem(FORMAT_CARD_DISMISSED_KEY, "1"); } catch { /* private mode */ }
}

export function FormatSetupCard() {
  const [state, setState] = useState<"loading" | "hidden" | "show">("loading");
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (readDismissed()) { setState("hidden"); return; }
    let cancelled = false;
    Promise.all([
      fetchThemes(),
      fetch("/tis-api/firms/me", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([list, me]) => {
        if (cancelled) return;
        const role = (me as { role?: string } | null)?.role;
        setCanEdit(role === "owner" || role === "admin");
        setState(list.themes.length === 0 && !list.legacy ? "show" : "hidden");
      })
      .catch(() => { if (!cancelled) setState("hidden"); });
    return () => { cancelled = true; };
  }, []);

  if (state !== "show") return null;

  async function onUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const t = await uploadTheme(file, "Firm format");
      setDone({ id: t.id, name: t.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Format import failed.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    writeDismissed();
    setState("hidden");
  }

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 p-4 relative" data-testid="card-format-setup">
      <button type="button" onClick={dismiss} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground" aria-label="Dismiss" data-testid="button-format-setup-dismiss">
        <X className="w-4 h-4" />
      </button>
      {done ? (
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">Your format is set up.</p>
            <p className="text-muted-foreground">
              Every study you generate now comes out in “{done.name}”.{" "}
              <a href={previewUrl(done.id)} target="_blank" rel="noreferrer" className="underline" data-testid="link-format-setup-preview">Preview a sample</a>
              {" · "}
              <Link href="/settings/firm" className="underline">Manage formats</Link>
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2 pr-6">
          <p className="text-sm font-medium">Set up your report format</p>
          <p className="text-sm text-muted-foreground">
            Upload one of your past studies (PDF) and every study you generate comes out in your firm's format — fonts,
            colours, cover, headers and footers, figure captions. Takes about ten seconds.
          </p>
          {canEdit ? (
            <div className="flex items-center gap-2 flex-wrap">
              <label className={"inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-foreground text-background " + (busy ? "opacity-60 cursor-not-allowed" : "hover:opacity-90 cursor-pointer")}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {busy ? "Reading your report…" : "Upload a past study (PDF)"}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.currentTarget.value = ""; }}
                  className="hidden"
                  data-testid="input-format-setup-file"
                />
              </label>
              <Link href="/settings/firm" className="text-sm underline text-muted-foreground">Or set it up in settings</Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask a firm owner or admin to upload one under{" "}
              <Link href="/settings/firm" className="underline">Settings → Firm</Link>.
            </p>
          )}
          {error && <p className="text-xs text-red-600" data-testid="text-format-setup-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
