/**
 * Modal that lets a user (typically a traffic engineer) configure their
 * firm's branding once. Settings persist to localStorage and apply to every
 * subsequent TIS report they print/export.
 */
import { useEffect, useRef, useState } from "react";
import { Building2, Upload, X, Trash2 } from "lucide-react";
import {
  loadFirmBranding,
  saveFirmBranding,
  clearFirmBranding,
  type FirmBranding,
  EMPTY_FIRM,
} from "../lib/firm-branding";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (b: FirmBranding) => void;
}

const MAX_LOGO_BYTES = 200 * 1024; // 200KB after base64 — keeps localStorage lean

export function FirmSettingsModal({ open, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FirmBranding>(EMPTY_FIRM);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setForm(loadFirmBranding());
  }, [open]);

  if (!open) return null;

  function handleLogoFile(file: File) {
    setLogoError(null);
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) {
      setLogoError("Logo must be PNG, JPG, WebP, or SVG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      // approximate post-base64 size — base64 is ~33% larger than raw bytes
      if (dataUrl.length > MAX_LOGO_BYTES) {
        setLogoError(
          `Logo is too large (${(dataUrl.length / 1024).toFixed(0)}KB). Compress to under ~150KB.`,
        );
        return;
      }
      setForm((f) => ({ ...f, logoDataUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveFirmBranding(form);
    onSaved(form);
    onClose();
  }

  function handleClear() {
    if (!window.confirm("Clear all firm branding? This will remove your logo from every report.")) return;
    clearFirmBranding();
    setForm({ ...EMPTY_FIRM });
    onSaved({ ...EMPTY_FIRM });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="firm-settings-modal"
    >
      <div
        className="bg-background border rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-background">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Firm branding</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-muted"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            These settings apply to every TIS report you print or export. Stored locally in your browser only —
            nothing is sent to a server.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Firm name *</span>
              <input
                type="text"
                required
                placeholder="e.g. Croy Engineering, LLC"
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                value={form.firmName}
                onChange={(e) => setForm({ ...form, firmName: e.target.value })}
                data-testid="input-firm-name"
              />
            </label>

            <label className="space-y-1 md:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Firm address</span>
              <input
                type="text"
                placeholder="200 Galleria Pkwy SE, Atlanta, GA 30339"
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                value={form.firmAddress}
                onChange={(e) => setForm({ ...form, firmAddress: e.target.value })}
                data-testid="input-firm-address"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</span>
              <input
                type="text"
                placeholder="(404) 555-0123"
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                value={form.firmPhone}
                onChange={(e) => setForm({ ...form, firmPhone: e.target.value })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Default client</span>
              <input
                type="text"
                placeholder="Optional default for new studies"
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                value={form.defaultClient}
                onChange={(e) => setForm({ ...form, defaultClient: e.target.value })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PE name *</span>
              <input
                type="text"
                required
                placeholder="Jane Smith, P.E."
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                value={form.preparedBy}
                onChange={(e) => setForm({ ...form, preparedBy: e.target.value })}
                data-testid="input-pe-name"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PE license</span>
              <input
                type="text"
                placeholder="GA #034152"
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                value={form.peNumber}
                onChange={(e) => setForm({ ...form, peNumber: e.target.value })}
                data-testid="input-pe-number"
              />
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Firm logo</span>
            <div className="flex items-center gap-3">
              {form.logoDataUrl ? (
                <img
                  src={form.logoDataUrl}
                  alt="Firm logo"
                  className="h-16 max-w-[200px] object-contain border rounded bg-white p-1"
                />
              ) : (
                <div className="h-16 w-32 border-2 border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">
                  No logo
                </div>
              )}
              <div className="flex flex-col gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLogoFile(f);
                  }}
                  data-testid="input-logo"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border hover:bg-muted"
                >
                  <Upload className="w-3 h-3" />
                  Upload logo
                </button>
                {form.logoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, logoDataUrl: "" })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border hover:bg-muted text-red-600"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove
                  </button>
                )}
              </div>
            </div>
            {logoError && <p className="text-xs text-red-600">{logoError}</p>}
            <p className="text-xs text-muted-foreground">
              PNG, JPG, WebP, or SVG. Max ~150KB. Renders at top-left of every report cover page.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 pt-4 border-t">
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-red-600 hover:underline"
            >
              Clear all branding
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium rounded bg-foreground text-background hover:opacity-90"
                data-testid="button-save-firm"
              >
                Save branding
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
