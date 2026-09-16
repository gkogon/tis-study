# Report theme library, onboarding prompt, figure conventions — design

Builds on `2026-09-14-report-theme-import-design.md` (the theme layer, shipped in #221/#222).

## Goal

1. A firm keeps **several report formats** ("themes") and picks one per project — chosen when the study is generated, changeable afterwards from the project page.
2. A firm that has **no format yet** is prompted to upload one where it works, not only in settings.
3. A theme carries the sample's **figure caption convention** — label word, numbering shape, separator, caption style and position — and themed figures are captioned that way.

## Non-goals

- Table numbering. Our renderers draw tables without captions (they follow headings); numbering them means titling ~50 call sites. The extractor may record the sample's table convention later; not now.
- Full-page "exhibit" figure layout. Our figures are 170–330 pt charts; one per page would empty every page (the page-fill gate would fail). Recorded as a known limitation.
- A signup step. Paid signups go straight to Stripe checkout; the prompt is a first-run card instead.

## Data model

- New table `firm_report_themes` — `id uuid pk`, `firm_id uuid → firms (cascade)`, `name text`, `stored jsonb` (the `StoredTheme` `{ version: 2, theme, source }`), `created_at`, `updated_at`. Index on `firm_id`.
- `firms.default_report_theme_id uuid null → firm_report_themes (set null)`.
- `tis_projects.report_theme_id uuid null → firm_report_themes (set null)`.
- `firms.report_template` stays. Migration (in `lib/db/migrate.mjs`, idempotent SQL): every firm whose `report_template->>'version' = '2'` and that has no theme row gets one named "Imported format" and it becomes the default; the column is then nulled for that firm. V1 (`chapters`) rows are untouched and still read as "legacy" by the API.

## Resolution

`resolveProjectTheme(firmId, projectThemeId | null)` → the project's theme if it exists and belongs to the firm, else the firm's default theme, else `null` (default look). Used by `GET /projects/:id/pdf`, `POST /generate`, `POST /generate/pdf` and the preview route. `loadFirmReportTemplate` is removed.

## API (`/tis-api`)

| Route | Notes |
|---|---|
| `GET /firms/report-themes` | `{ themes: [{ id, name, isDefault, createdAt, summary }], legacy?: true }` — summary is `ThemeSummary`. Any signed-in member. |
| `POST /firms/report-themes` | multipart `file` (PDF, 20 MB) + optional `name` (default "Format N"). Owner/admin. Extracts, inserts; the firm's first theme becomes the default. `{ ok, theme }`. Upload limiter as today. |
| `PATCH /firms/report-themes/:id` | `{ name?, isDefault?: true }`. Owner/admin. |
| `DELETE /firms/report-themes/:id` | Owner/admin. Projects and the firm default fall back by FK `set null`. |
| `GET /firms/report-themes/:id/preview.pdf` | Preview limiter as today. |
| `PATCH /projects/:id` | `{ reportThemeId: uuid \| null }` — must belong to the firm. |
| `POST /generate?reportThemeId=` `POST /generate/pdf?reportThemeId=` | Query parameter (the body is the engine request). Stored on the saved project. |

The `/firms/report-template*` routes are replaced (they shipped two days ago; only the settings page used them).

## Frontend

- **Settings → Firm → "Report formats"**: list (name editable inline, "Default" badge / "Make default", Preview PDF, Delete with confirm), upload form (file + name), legacy notice as today. Summary details per theme as today (fonts, palette, cover, figure convention line).
- **Study form (`/tis`)**: "Report format" select beside Download PDF, options from `GET /firms/report-themes` plus "Standard format" (null); defaults to the firm default; sent as `reportThemeId` on generate and PDF download. Hidden when the firm has no themes.
- **Project page**: the same select showing the stored format; changing it PATCHes the project; the download link renders with the stored one.
- **First-run card** (`components/format-setup-card.tsx`) on `/tis` and `/projects` when `themes.length === 0` and not legacy: "Set up your report format — upload a past study and every PDF comes out in your firm's format", inline file input (name "Firm format"), link to settings, Dismiss (localStorage `tis.format-card.dismissed`). Owners/admins only see the upload; members see the text and the settings link.

## Figure conventions (theme schema)

`figure` gains, all optional so stored themes still parse:

```
figure: {
  caption: { position: "above" | "below", style },   // existing
  label?: "Figure" | "Exhibit",                        // default "Figure"
  numbering?: "sequential" | "chapter" | "none",       // default "none"
  separator?: string,                                   // e.g. " – ", ": ", ". "; default " — "
}
```

Extractor (`derive/figures.ts`): over interior lines, `^(Figure|Fig\.|Exhibit)\s+(\d+)(?:[-.–](\d+))?\s*([:.–—-]?)\s*\S` → label = modal word (Fig. → Figure), numbering = "chapter" when a second number group is the majority, else "sequential"; separator = the modal punctuation with the sample's spacing; caption style/position from the existing table/figure derivation. Fewer than two matches → numbering "none" (our "Figure — Title" wording, in the theme's caption style). Summary gains `figures: "Figure 3 – Title"`-style example.

Renderer: `themed.figureCaption(doc, title)` — strips our "Figure — " prefix, formats `${label} ${n}${separator}${title}` with a per-render counter in `active.ts` (reset by `withTheme`; chapter numbering takes the H1 number recorded by `heading(level 1)` and restarts the counter per chapter; a chapter without a number falls back to the running count), draws in `figure.caption.style` at the theme's position. Charts (`drawFrame`), the compass rose and the plan map use it under a theme; the default path is untouched (byte identity). "Below" position: the caption is drawn after the plot instead of before it.

## Errors

Unknown or foreign `reportThemeId` → 404 `{ error }` on PATCH; on generate/pdf it is ignored (falls back to the firm default) with a warn log — a stale id from an old tab must not block a study.

## Checks

- Units: caption formatter (all three numberings, separators, chapter reset); figure-convention derivation from synthetic lines; schema back-compat (a stored theme without `figure.label` parses).
- Corpus expectations (`fixtures/tis-corpus/expected/*.json`): `figureLabel`, `figureNumbering`, `figureSeparator` for the seven samples (all sequential; separators " – ", ": ", ". ").
- Render check: a synthetic theme with `numbering: "chapter"` produces a run matching `/^Figure \d+-\d+: /` and the sequential theme `/^Figure \d+: /`; the default identity guard unchanged.
- Route smoke script updated to the new routes (list → upload → default → preview → PATCH project → DELETE).

## Rollout

Additive migration at deploy start; the settings page and study page switch to the new routes in the same PR. Existing single-theme firms see their theme as "Imported format", default.
