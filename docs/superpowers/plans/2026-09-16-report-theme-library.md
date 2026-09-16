# Report Theme Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A firm keeps several report formats and picks one per project; new firms are prompted to upload one; themed figures are captioned in the sample's convention.

**Architecture:** Themes move from the `firms.report_template` column into a `firm_report_themes` table with a firm default and a per-project reference; a single resolver picks the theme for every render. Figure conventions are a small extension of the `Theme.figure` schema derived from caption lines, applied by one themed caption helper the chart primitives call under a firm theme.

**Tech Stack:** Express 5, drizzle-orm/pg, zod, PDFKit, React/Vite, node check scripts (`scripts/verify-*.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-16-report-theme-library-design.md`

## Global Constraints

- Default (no-theme) PDF output stays byte-identical: `check:theme-default-identity` must pass unchanged; every new drawing behaviour is gated on `!isDefaultTheme()`.
- Schema changes are additive and idempotent, applied by `lib/db/migrate.mjs` at deploy start (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`); never DROP or rename.
- New theme schema fields are optional so already-stored themes parse.
- No new npm dependencies.
- Check-script convention: `scripts/verify-*.mjs` printing `PASS`/`FAIL` lines, non-zero exit on failure; `check:theme` must stay green.
- Commit after each task; message style `type(scope): summary`; trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Schema + migration for the theme library

**Files:**
- Modify: `lib/db/src/schema/firms.ts` (new table + `defaultReportThemeId`)
- Modify: `lib/db/src/schema/tis-projects.ts` (`reportThemeId`)
- Modify: `lib/db/migrate.mjs` (additive SQL + backfill)

**Interfaces:**
- Produces: `firmReportThemesTable` (`id, firmId, name, stored, createdAt, updatedAt`), `FirmReportTheme` type; `firmsTable.defaultReportThemeId`; `tisProjectsTable.reportThemeId`.

- [ ] **Step 1: Schema** — in `firms.ts` add after `firmMembersTable`:

```ts
/**
 * A firm's library of report formats ("themes"): each row is a StoredTheme
 * extracted from one sample PDF (report-theme/theme.ts). The firm's default
 * is `firmsTable.defaultReportThemeId`; a project may pin another one
 * (`tisProjectsTable.reportThemeId`). Both FKs set null on delete, so a
 * deleted format falls its projects back to the firm default.
 */
export const firmReportThemesTable = pgTable(
  "firm_report_themes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id").notNull().references(() => firmsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    stored: jsonb("stored").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`).$onUpdate(() => new Date()),
  },
  (table) => [index("IDX_firm_report_themes_firm").on(table.firmId)],
);
export type FirmReportTheme = typeof firmReportThemesTable.$inferSelect;
```

and in `firmsTable` (after `reportTemplate`): `defaultReportThemeId: uuid("default_report_theme_id"),` (the FK is declared in SQL only — drizzle can't reference a table declared later in the same file without a circular `AnyPgColumn` cast; the migration carries the constraint).

In `tis-projects.ts` add after `regionCode`: `reportThemeId: uuid("report_theme_id"),`.

- [ ] **Step 2: Migration** — append to `SQL_STATEMENTS` in `migrate.mjs`:

```js
  // Report theme library (spec 2026-09-16-report-theme-library-design.md).
  { id: "firm_report_themes.create", sql: `CREATE TABLE IF NOT EXISTS firm_report_themes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      stored JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );` },
  { id: "firm_report_themes.idx_firm", sql: `CREATE INDEX IF NOT EXISTS "IDX_firm_report_themes_firm" ON firm_report_themes (firm_id);` },
  { id: "firms.default_report_theme_id", sql: `ALTER TABLE firms ADD COLUMN IF NOT EXISTS default_report_theme_id UUID REFERENCES firm_report_themes(id) ON DELETE SET NULL;` },
  { id: "tis_projects.report_theme_id", sql: `ALTER TABLE tis_projects ADD COLUMN IF NOT EXISTS report_theme_id UUID REFERENCES firm_report_themes(id) ON DELETE SET NULL;` },
  // Backfill: a firm's single imported format (V2 row in report_template) becomes its first, default theme.
  { id: "firm_report_themes.backfill", sql: `INSERT INTO firm_report_themes (firm_id, name, stored)
      SELECT f.id, 'Imported format', f.report_template FROM firms f
      WHERE f.report_template IS NOT NULL AND f.report_template->>'version' = '2'
        AND NOT EXISTS (SELECT 1 FROM firm_report_themes t WHERE t.firm_id = f.id);` },
  { id: "firms.default_report_theme_id.backfill", sql: `UPDATE firms f SET default_report_theme_id = t.id, report_template = NULL
      FROM firm_report_themes t
      WHERE t.firm_id = f.id AND f.default_report_theme_id IS NULL AND f.report_template->>'version' = '2';` },
```

- [ ] **Step 3: Verify** — `pnpm --filter @workspace/db run push` against a scratch DB (`createdb -h /tmp tis_theme_smoke`), then `DATABASE_URL=… node lib/db/migrate.mjs` twice (second run all `ok`, no error); `pnpm run typecheck:libs`.
- [ ] **Step 4: Commit** `feat(db): firm_report_themes table, firm default and per-project theme references`.

### Task 2: Theme resolver and library helpers

**Files:**
- Create: `artifacts/tis-api-server/src/lib/report-themes.ts`
- Modify: `artifacts/tis-api-server/src/lib/firms.ts` (remove `loadFirmReportTemplate`; `FirmLite` also omits nothing new — `defaultReportThemeId` stays in the projection, it is one uuid)

**Interfaces (produces):**

```ts
export type ThemeRow = { id: string; name: string; isDefault: boolean; createdAt: string; stored: StoredTheme };
export async function listFirmThemes(firmId: string): Promise<{ themes: ThemeRow[]; legacy: boolean }>;
export async function createFirmTheme(firmId: string, name: string, stored: StoredTheme): Promise<ThemeRow>; // first theme → default
export async function renameFirmTheme(firmId: string, id: string, name: string): Promise<boolean>;
export async function setDefaultFirmTheme(firmId: string, id: string): Promise<boolean>;
export async function deleteFirmTheme(firmId: string, id: string): Promise<boolean>;
export async function getFirmTheme(firmId: string, id: string): Promise<ThemeRow | null>;
/** The theme a render should use: the project's, else the firm default, else null. A foreign/unknown id is ignored. */
export async function resolveProjectTheme(firmId: string, projectThemeId: string | null | undefined): Promise<StoredTheme | null>;
export function isUuid(s: unknown): s is string;
```

- `legacy` = firm has no themes and `firms.report_template` classifies as `"legacy"`.
- `listFirmThemes` selects `id, name, created_at, stored` ordered by `created_at`; `isDefault` = id equals `firms.default_report_theme_id` (one extra select of that column).
- Rows whose `stored` fails `parseStoredTheme` are skipped with a warn log (never 500 a listing).

- [ ] **Step 1: Unit checks** (`scripts/verify-theme-units.mjs`, new block): `isUuid` true for `randomUUID()`, false for `"abc"`, `""`, `null`. (DB functions are covered by the route smoke in Task 4.)
- [ ] **Step 2: Implement**; replace every `loadFirmReportTemplate(firm.id)` call (`routes/projects.ts`, `routes/tis.ts` ×2, `routes/firms.ts`) with `resolveProjectTheme(firm.id, <id>)` — in `projects.ts` the id is `project.reportThemeId`; in `tis.ts` it is `themeIdFromQuery(req)` (Task 4); in `firms.ts` the preview passes the route's `:id` theme's stored directly.
- [ ] **Step 3: Typecheck**, run units. **Commit** `feat(theme): theme library helpers and one resolver for every render`.

### Task 3: Figure conventions — schema, derivation, themed caption

**Files:**
- Modify: `src/lib/report-theme/theme.ts` (schema + summary), `active.ts` (figure counter, chapter), `draw.ts` (`figureCaption`, chapter capture in `heading`), `extract.ts` (wire derivation)
- Create: `src/lib/report-theme/derive/figures.ts`
- Modify: `src/lib/pdf-charts.ts` (`drawFrame`, `drawCompassRose`), `src/lib/pdf-export-distribution.ts` (plan caption)
- Test: `scripts/verify-theme-units.mjs`, `scripts/verify-theme-extract.mjs` + `scripts/fixtures/tis-corpus/expected/*.json`, `scripts/verify-theme-render.mjs`

**Interfaces:**

```ts
// theme.ts
figure: z.object({
  caption: z.object({ position: z.enum(["above", "below"]), style: TextStyleSchema }),
  label: z.enum(["Figure", "Exhibit"]).optional(),
  numbering: z.enum(["sequential", "chapter", "none"]).optional(),
  separator: z.string().max(6).optional(),
}),
export type FigureConvention = { label: "Figure" | "Exhibit"; numbering: "sequential" | "chapter" | "none"; separator: string };
export function figureConvention(t: Theme): FigureConvention; // defaults Figure / none / " — "
export function formatFigureCaption(conv: FigureConvention, n: number, chapter: number | null, title: string): string;
// ThemeSummary gains `figures: string` — e.g. `Figure 3 – Title`, or `Figure — Title` for none.

// active.ts
export function noteChapter(n: number | null): void;      // called by heading(level 1)
export function nextFigureNumber(): { n: number; chapter: number | null }; // per-render counter; chapter numbering restarts per chapter
// both reset by withTheme.

// draw.ts
export function figureCaption(doc, title: string): void;   // strips a leading "Figure — " / "Exhibit — ", formats, draws in figure.caption.style, full usable width

// derive/figures.ts
export function deriveFigureConvention(pages: ScannedPage[]): { label; numbering; separator } | null; // null when < 2 caption lines
```

`formatFigureCaption`: `none` → `${label} — ${title}`; `sequential` → `${label} ${n}${sep}${title}`; `chapter` → `${label} ${chapter ?? n}${chapter !== null ? `-${n}` : ""}${sep}${title}`. `sep` is stored with its spacing (`" – "`, `": "`, `". "`).

`deriveFigureConvention`: over `interiorPages(pages)` lines matching `/^\s*(Figure|Fig\.|Exhibit)\s+(\d+)(?:([-.–])(\d+))?\s*([:.–—-])?\s*(\S.*)$/i` with `m[6].length >= 3`; label = modal of Figure/Exhibit (Fig. → Figure); numbering = "chapter" if lines with a second number ≥ half, else "sequential"; separator = modal `m[5]` → `": "` for ":", `". "` for ".", `" – "` for "–"/"-"/"—", `" "` when absent.

Chart gating: in `drawFrame`, `if (title) { if (isDefaultTheme()) <existing green title> else if (figureConvention(activeTheme()).position === "above") themed.figureCaption(doc, title); }` and after the plot, `if (!isDefaultTheme() && position === "below") themed.figureCaption(doc, title)`. Same for the compass rose and the plan map (whose descriptive sentence stays as a muted note after the caption under a theme).

- [ ] **Step 1: Units** — `formatFigureCaption` for the three numberings and separators; `nextFigureNumber` restarts on `noteChapter(4)`; `deriveFigureConvention` on synthetic lines (`"Figure 1 – A"`, `"Figure 2 – B"` → sequential, `" – "`; `"Figure 3-1: A"`,`"Figure 3-2: B"` → chapter, `": "`; one line → null); a stored theme without `figure.label` parses and `figureConvention` returns the defaults.
- [ ] **Step 2: Implement** all files. Extractor: `figure: { caption: fig ?? {...}, ...(conv ?? {}) }`.
- [ ] **Step 3: Corpus expectations** — add `figureLabel: "Figure"`, `figureNumbering: "sequential"`, `figureSeparator` (`" – "` buncombe/dc, `": "` fairfax/stafford/mansfield, `". "` twisp; dallas has no figure captions → `figureNumbering: "none"`) and a check in `verify-theme-extract.mjs`.
- [ ] **Step 4: Render check** — `SYNTH.theme.figure = { ...SYNTH.theme.figure, label: "Figure", numbering: "chapter", separator: ": " }`; assert a run `/^Figure \d+-\d+: /` on the TX render; add a sequential variant assert `/^Figure \d+: /`; identity guard unchanged.
- [ ] **Step 5: Commit** `feat(theme): figure captions in the sample's convention`.

### Task 4: API routes

**Files:**
- Modify: `src/routes/firms.ts` (replace the three `/firms/report-template*` routes with the five `/firms/report-themes*` routes), `src/routes/projects.ts` (`PATCH /projects/:id`, pdf uses `project.reportThemeId`, GET returns `reportThemeId`), `src/routes/tis.ts` (`?reportThemeId=` on `/generate` and `/generate/pdf`; saved on the project), `src/lib/tis-projects.ts` (`reportThemeId` in `SaveProjectArgs`, `setProjectTheme(firmId, id, themeId)`)
- Delete: `src/lib/report-template/store.ts` usage (filesystem mirror) — the DB is the only home now; `resolveTheme` in `pdf-export.ts` drops the disk fallback.
- Modify: `scratchpad smoke` → commit as `scripts/smoke-report-themes.sh`? No — keep the smoke in the scratchpad (it needs a live DB); document the flow in the PR.

Routes (all behind `req.isAuthenticated()`; write routes behind `requireRole(role, ["owner","admin"])`):

```ts
router.get("/firms/report-themes", …) → { themes: [{ id, name, isDefault, createdAt, summary: summarizeTheme(stored) }], legacy }
router.post("/firms/report-themes", requireTemplateEditor, templateUploadRateLimiter, templateUpload.single("file"), templateUploadErrorHandler, …)
  // name = String(req.body?.name ?? "").trim().slice(0, 80) || `Format ${themes.length + 1}`
  → { ok: true, theme: { id, name, isDefault, createdAt, summary } }
router.patch("/firms/report-themes/:id", …) body { name?: string; isDefault?: true } → { ok: true }; 404 when not the firm's
router.delete("/firms/report-themes/:id", …) → { ok: true }; 404 when not the firm's
router.get("/firms/report-themes/:id/preview.pdf", previewRateLimiter, …) → inline PDF; 404 when not the firm's
router.patch("/projects/:id", …) body { reportThemeId: string | null } → 404 unknown project or foreign theme; { ok: true, reportThemeId }
```

`themeIdFromQuery(req)`: `isUuid(req.query.reportThemeId) ? req.query.reportThemeId : null`.

- [ ] **Step 1: Implement** routes + helpers. **Step 2: Typecheck.** **Step 3: Route smoke** (scratchpad script adapted: list → upload ×2 → second is not default → PATCH isDefault → preview of each → PATCH project → GET project shows id → DELETE → project's id null) all PASS. **Step 4: Commit** `feat(api): report theme library routes; per-project theme on generate, pdf and PATCH`.

### Task 5: Frontend — settings library, study-form picker, project-page picker

**Files:**
- Create: `artifacts/atlanta-tis/src/lib/report-themes.ts` (`type ThemeListItem`, `fetchThemes()`, `themeLabel()`)
- Modify: `pages/settings-firm.tsx` (Report formats card), `pages/tis.tsx` (picker + query param), `pages/project-detail.tsx` (picker + PATCH + download link)

- [ ] Settings card: state `themes: ThemeListItem[]`, `legacy`; list rows: name (click → inline input, blur/Enter → PATCH name), `Default` badge or `Make default` button, `Preview PDF` link (`/tis-api/firms/report-themes/${id}/preview.pdf`, `target=_blank`), `Delete` (confirm dialog via `window.confirm`), expandable summary (existing detail block reused per theme); upload row: file input + name text input ("Format name (optional)"); legacy notice unchanged. Summary line gains `· figures "{summary.figures}"`.
- [ ] Study form: `const [themeId, setThemeId] = useState<string | null | undefined>(undefined)` → after `fetchThemes()`, default = the default theme's id; `<select>` beside Download with "Standard format" (value "") + one option per theme; hidden when `themes.length === 0`; `/tis-api/generate/pdf` and `/tis-api/generate` get `?reportThemeId=` when set.
- [ ] Project page: same select, value from `project.reportThemeId`; `onChange` → `PATCH /tis-api/projects/:id` then refetch; download link unchanged (server uses the stored id).
- [ ] Typecheck `atlanta-tis`. **Commit** `feat(ui): report format library in settings; per-project format picker`.

### Task 6: First-run card

**Files:**
- Create: `artifacts/atlanta-tis/src/components/format-setup-card.tsx`
- Modify: `pages/tis.tsx`, `pages/projects.tsx` (render the card above the page content when signed in)

- [ ] Component: fetches `/tis-api/firms/report-themes` and `/tis-api/firms/me` (role); renders nothing while loading, when `themes.length > 0`, when `legacy`, or when `localStorage.getItem("tis.format-card.dismissed") === "1"`. Copy: title "Set up your report format", body "Upload one of your past studies (PDF) and every study you generate comes out in your firm's format — fonts, colours, cover, headers and footers.", owner/admin: file input → `POST /firms/report-themes` with name "Firm format" → success message with a Preview link + settings link; member: text + "Ask a firm owner or admin" + settings link; `Dismiss` sets the localStorage key. Upload errors shown inline.
- [ ] Typecheck. **Commit** `feat(ui): first-run card prompting a firm's first report format`.

### Task 7: Docs, checks, PR

- [ ] `replit.md`: routes list, `firm_report_themes`, resolver, figure conventions, first-run card; remove the `report_template`-projection gotcha's stale wording (column is now legacy-only).
- [ ] Run: root `pnpm run typecheck`, `check:theme`, `check:region-parity`, `check:state-dispatch`, `check:conserved-assignment`, `smoke:distribution-pdf`, route smoke.
- [ ] Commit, push, PR, CI, merge (Railway deploys `main`; migration runs at start).

## Self-review

- Spec coverage: data model → T1; resolution → T2; API → T4; frontend (settings, study, project) → T5; first-run card → T6; figure conventions (schema, extractor, renderer, checks) → T3; errors (foreign id ignored on render, 404 on PATCH) → T2/T4; rollout/migration → T1/T7. Non-goals need no task.
- Types: `ThemeRow.stored: StoredTheme` (T2) is what T4 passes to `renderStudyPdf({ reportTemplate: stored })`; `figureConvention` (T3) is used by `drawFrame` and `summarizeTheme`; `reportThemeId` spelled identically in schema, SaveProjectArgs, routes and frontend.
