/**
 * Settings → Firm → "Report formats": the firm's library of report formats
 * (themes extracted from sample PDFs). Lists each format with its summary,
 * lets owners/admins upload, rename, make default and delete, and links the
 * per-format preview PDF. The API is /tis-api/firms/report-themes.
 */
import { useEffect, useState } from "react";
import { Upload, Star, Trash2, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import {
  deleteTheme, fetchThemes, patchTheme, previewUrl, uploadTheme,
  type ThemeListItem, type ThemeList,
} from "../lib/report-themes";

type Props = {
  canEdit: boolean;
  /** Called after any change so the page can refresh anything that depends on the library. */
  onChange?: (list: ThemeList) => void;
};

export function ReportFormatsCard({ canEdit, onChange }: Props) {
  const [list, setList] = useState<ThemeList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function reload() {
    const next = await fetchThemes();
    setList(next);
    onChange?.(next);
    return next;
  }

  useEffect(() => {
    let cancelled = false;
    fetchThemes().then((l) => { if (!cancelled) { setList(l); onChange?.(l); } }).catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setError(null); setInfo(null); setBusy(true);
    try { await fn(); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : label); }
    finally { setBusy(false); }
  }

  async function onUpload(file: File) {
    await run("Format import failed.", async () => {
      const t = await uploadTheme(file, newName);
      setNewName("");
      const subs = t.summary.fonts.filter((f) => !f.exact).map((f) => `${f.requested} → ${f.used}`);
      setInfo(
        `"${t.name}" imported — ${t.summary.pageSize} pages, ${t.summary.fonts.map((f) => f.requested).join(" / ")}` +
          (subs.length ? ` (substituted: ${subs.join(", ")})` : "") +
          (t.summary.warnings.length ? `. ${t.summary.warnings.length} note${t.summary.warnings.length === 1 ? "" : "s"} — expand it below.` : ".") +
          (t.isDefault ? " It is now your firm's default format." : ""),
      );
      setOpen((o) => ({ ...o, [t.id]: true }));
    });
  }

  const themes = list?.themes ?? [];

  return (
    <div className="space-y-1.5" data-testid="card-report-formats">
      <label className="text-sm font-medium">Report formats</label>
      {list === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : themes.length === 0 ? (
        list.legacy ? (
          <p className="text-xs text-amber-700" data-testid="text-firm-template-legacy">
            Your example report was uploaded with an earlier version. Re-upload it to enable format matching; until then studies render in the standard format.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Studies render in the standard format for each site's region. Upload one of your past studies to add your firm's format.
          </p>
        )
      ) : (
        <ul className="space-y-2" data-testid="list-report-formats">
          {themes.map((t) => (
            <FormatRow
              key={t.id}
              theme={t}
              canEdit={canEdit}
              busy={busy}
              expanded={!!open[t.id]}
              onToggle={() => setOpen((o) => ({ ...o, [t.id]: !o[t.id] }))}
              editing={editing?.id === t.id ? editing.name : null}
              onEditStart={() => setEditing({ id: t.id, name: t.name })}
              onEditChange={(name) => setEditing({ id: t.id, name })}
              onEditCommit={() => {
                const name = editing?.name.trim() ?? "";
                setEditing(null);
                if (!name || name === t.name) return;
                void run("Could not rename the format.", () => patchTheme(t.id, { name }));
              }}
              onMakeDefault={() => void run("Could not set the default format.", () => patchTheme(t.id, { isDefault: true }))}
              onDelete={() => {
                if (!window.confirm(`Delete "${t.name}"? Projects using it will render in the firm default format instead.`)) return;
                void run("Could not delete the format.", () => deleteTheme(t.id));
              }}
            />
          ))}
          {!themes.some((t) => t.isDefault) && (
            <li className="text-xs text-amber-700">No default format — new studies use the standard format until you mark one as default.</li>
          )}
        </ul>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <label className={"inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border " + (canEdit && !busy ? "hover:bg-accent cursor-pointer" : "opacity-50 cursor-not-allowed")}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {busy ? "Working…" : themes.length ? "Add another format" : "Upload example report"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={!canEdit || busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.currentTarget.value = ""; }}
            className="hidden"
            data-testid="input-firm-template-file"
          />
        </label>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Format name (optional)"
          disabled={!canEdit || busy}
          maxLength={80}
          className="px-2 py-1.5 text-sm rounded-md border bg-background w-56"
          data-testid="input-format-name"
        />
      </div>
      {error && <p className="text-xs text-red-600" data-testid="text-format-error">{error}</p>}
      {info && <p className="text-xs text-emerald-700" data-testid="text-format-info">{info}</p>}
      <p className="text-xs text-muted-foreground">
        Upload one of your own finished studies as a PDF (up to 20 MB). We read its page size and margins, fonts, colours,
        heading style, running header and footer, table style, cover and figure captions, and studies come out in that
        format. Keep several — one per client or agency — and pick one per study. It needs a text layer; a scanned
        report won't import.
      </p>
    </div>
  );
}

type RowProps = {
  theme: ThemeListItem;
  canEdit: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  editing: string | null;
  onEditStart: () => void;
  onEditChange: (name: string) => void;
  onEditCommit: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
};

function FormatRow({ theme: t, canEdit, busy, expanded, onToggle, editing, onEditStart, onEditChange, onEditCommit, onMakeDefault, onDelete }: RowProps) {
  const s = t.summary;
  return (
    <li className="border rounded-md p-3 bg-muted/20 space-y-2" data-testid={`row-report-format-${t.id}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={onToggle} className="text-muted-foreground hover:text-foreground" aria-label={expanded ? "Collapse" : "Expand"} data-testid="button-format-toggle">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {editing !== null ? (
          <input
            autoFocus
            type="text"
            value={editing}
            maxLength={80}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onEditCommit}
            onKeyDown={(e) => { if (e.key === "Enter") onEditCommit(); if (e.key === "Escape") onEditChange(t.name); }}
            className="px-2 py-1 text-sm rounded-md border bg-background w-56"
            data-testid="input-format-rename"
          />
        ) : (
          <button
            type="button"
            onClick={canEdit ? onEditStart : undefined}
            className={"text-sm font-medium " + (canEdit ? "hover:underline cursor-text" : "cursor-default")}
            title={canEdit ? "Click to rename" : undefined}
            data-testid="text-format-name"
          >
            {t.name}
          </button>
        )}
        {t.isDefault && <span className="text-[11px] uppercase tracking-wide rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5" data-testid="badge-format-default">Default</span>}
        <span className="inline-flex items-center gap-1 ml-1">
          {(["primary", "accent", "text", "muted", "rule"] as const).map((k) => (
            <span key={k} title={`${k} ${s.palette[k]}`} className="inline-block w-3.5 h-3.5 rounded-sm border" style={{ backgroundColor: s.palette[k] }} aria-label={`${k} colour ${s.palette[k]}`} />
          ))}
        </span>
        <span className="text-xs text-muted-foreground">{s.pageSize} {s.orientation} · {s.fonts.map((f) => f.requested).join(" / ")}</span>
        <span className="flex-1" />
        <a href={previewUrl(t.id)} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs rounded-md border hover:bg-accent" data-testid="link-format-preview">Preview PDF</a>
        {canEdit && !t.isDefault && (
          <button type="button" onClick={onMakeDefault} disabled={busy} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border hover:bg-accent disabled:opacity-50" data-testid="button-format-default">
            <Star className="w-3 h-3" /> Make default
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={onDelete} disabled={busy} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border hover:bg-accent text-red-700 disabled:opacity-50" data-testid="button-format-delete" aria-label={`Delete ${t.name}`}>
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      {expanded && (
        <div className="space-y-1.5 pl-6" data-testid="details-report-format">
          <p className="text-xs text-muted-foreground">
            margins {Math.round(s.margins.left)} / {Math.round(s.margins.top)} pt ·{" "}
            {s.fonts.map((f) => (
              <span key={f.role} className="mr-3">
                {f.role}: <span className="font-medium text-foreground">{f.requested}</span>
                {!f.exact && <span className="ml-1 rounded bg-amber-100 text-amber-800 px-1">substituted → {f.used}</span>}
              </span>
            ))}
          </p>
          <p className="text-xs text-muted-foreground">
            Headings {s.numbering === "none" ? "unnumbered" : `numbered "${s.numbering}"`} · tables {s.table.mode}
            {s.table.headerFill ? " with filled header" : ""} · {s.cover === "photo" ? "site-photo" : s.cover} cover · figures “{s.figures}”
          </p>
          {(s.header || s.footer) && (
            <p className="text-xs text-muted-foreground font-mono">
              {s.header && <span className="block">header: {s.header}</span>}
              {s.footer && <span className="block">footer: {s.footer}</span>}
            </p>
          )}
          {s.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 list-disc pl-4" data-testid="list-firm-template-warnings">
              {s.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
              {s.warnings.length > 6 && <li>…and {s.warnings.length - 6} more</li>}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
