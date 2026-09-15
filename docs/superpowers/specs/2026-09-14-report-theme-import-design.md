# Report Theme Import — "upload your last TIS, ours comes out in your format"

**Date:** 2026-09-14
**Status:** Approved design, pending implementation plan
**Replaces:** the heuristic V1 template importer in `artifacts/tis-api-server/src/lib/report-template/{ingest,pdf-assets}.ts` (PR #29, #162)

## 1. Goal

An engineering firm uploads one traffic impact study they previously filed. Every
study the firm generates afterwards looks like that firm produced it: same page
size and margins, same fonts, same colours, same heading hierarchy and numbering
style, same running header/footer, same table styling, same cover composition —
with our engine's content and wording filling it.

A reviewer at the firm should not be able to tell, from the look of the document,
that it was not made with their Word/InDesign template.

### What "matches" means (decided)

**Look + structure.** Typography, palette, page geometry, cover, header/footer,
table and caption style, heading numbering/case, and the firm's own wording for
headings that correspond to ours. Chapter *order* is not taken from the sample:
in every US jurisdiction we serve the section order is dictated by the agency's
TIS guideline (GDOT, FDOT, TxDOT, IDOT, NYSDOT, NCDOT/SCDOT, Caltrans), and a
firm's own sample from that jurisdiction already follows it. The sample's prose is
never reused — a new site must not inherit the sample's site description.

### Non-goals

- An editing screen for detected values (re-upload or revert instead).
- Per-project templates (the theme is per firm, as today).
- Reordering agency-mandated sections.
- Reusing embedded subset fonts from the sample (they contain only the sample's glyphs).
- Pixel-level reproduction of figures/maps.

## 2. Why the V1 importer is being replaced, not extended

1. **It never ran in production.** `ingest.ts` / `pdf-assets.ts` shell out to
   poppler (`pdftotext`, `pdftoppm`, `pdfimages`). The production image has no
   poppler (`synchro-pdf-import.ts:15`), which is why the Synchro importer was
   written in pure JS on `pdfjs-dist`. The new extractor is pure JS.
2. **It renders through the thin template engine.** `report-template/engine.ts`
   has ~12 UK-flavoured providers. US content — GDOT's ten-section outline, the
   Florida/Texas/California/Illinois/New York/Carolinas tiers, LOS tables,
   mitigation, warrants — lives in the hand-coded regional renderers
   (`pdf-export.ts` 9,889 lines + `pdf-export-{states,ny,carolinas,distribution}.ts`).
   A US firm that imported a template got a far thinner study than one that didn't.
3. **It copied the sample's prose** into the template verbatim (`cleanProse`), so a
   new study carried the sample's site description.
4. **Its palette was a pixel histogram** of rasterised pages; accent, table-header
   and rule colours were tints derived from one guessed primary.

## 3. Chosen approach: a Theme layer over the existing renderers

Every regional renderer already draws through a handful of shared primitives —
`section()` / `gaSection()` / `gaSubsection()` / `caSection()` / `ldnSection()` /
`txSection()`…, `rows()`, `table()`, `drawCover()`, `drawHeader()`,
`drawPageFooter()`, and `pdf-charts.ts` — and there is precedent for restyling
them through module state (`velocityPaletteActive` gates the Velocity green in
`table()` and the London headings). We generalise that boolean into a `Theme`.

- A pure-JS **extractor** turns the uploaded PDF into a `Theme` JSON.
- The shared **primitives** read the active `Theme`; `DEFAULT_THEME` reproduces
  today's constants byte-for-byte.
- US studies keep their regional renderer (all content preserved) in the firm's
  look. UK studies apply the theme to the template engine's primitives; the
  Velocity chapter structure stays.
- A **preview** endpoint renders a fixture study through the theme right after
  upload so the engineer can compare it with their sample side by side.

Rejected: (B) porting all regional content into template-engine providers —
months of re-implementation, high regression risk, and the reordering freedom it
buys conflicts with agency outlines; (C) rasterising the sample's cover/header/
footer as overlays — pixel-exact chrome but body typography and tables still need
extraction, PDFs bloat, and it breaks when page counts differ. C survives only as
the full-bleed cover-image case inside A.

## 4. End-to-end flow

1. **Upload.** A firm owner/admin uploads a sample TIS PDF in Firm Settings.
   `POST /tis-api/firms/report-template` (existing route, same auth and role
   rules). Upload limit raised from 2 MB to 20 MB — real filed TIS PDFs with
   figures run 5–15 MB.
2. **Extract** (≈1–3 s) → `{ version: 2, theme, source }` stored in the existing
   `firms.report_template` jsonb column (`lib/db/src/schema/firms.ts:40`).
3. **Preview.** The response carries a summary; the settings page shows it
   (swatches, matched fonts with a "substituted" badge, page size, header/footer
   text, cover kind, warnings) and a **Preview PDF** button that opens
   `GET /tis-api/firms/report-template/preview.pdf` in a new tab.
4. **Generate.** `renderStudyPdf()` resolves the firm's theme and the regional
   renderer draws through it. No theme → `DEFAULT_THEME` → output identical to today.
5. **Remove** (`DELETE /tis-api/firms/report-template`, unchanged) reverts to the
   region default.

V1 rows (they have a `chapters` array) are detected, ignored at render time, and
reported to the settings page as `legacy: true` so it says "re-upload your sample".

## 5. Extractor — `artifacts/tis-api-server/src/lib/report-theme/extract.ts`

Input: a PDF `Buffer`. Uses `pdfjs-dist@5` (legacy build) with the same bootstrap
as `synchro-pdf-import.ts` (DOMMatrix shim, hand pdfjs a copy of the buffer).
Processes page 1 plus the first ≤30 interior pages.

### 5.1 Primitive collection (`report-theme/pdf-scan.ts`)

`getTextContent()` alone cannot give colours, and heading/table colours are the
point. So each page's `getOperatorList()` is walked by a small graphics-state
interpreter tracking the CTM, text matrix, current font (resolved through
`page.commonObjs` to its real name, `bold`/`italic`/`isSerifFont` flags), font
size, fill colour and stroke colour (RGB / gray / CMYK / ICC-based and
pattern colour spaces normalised to hex; unsupported spaces → `null`, never a
throw). It emits, per page:

- **text runs** `{ str, font, size, bold, italic, color, x, y, w, h }` —
  adjacent glyph runs with identical style are merged into lines;
- **filled rects** `{ x, y, w, h, color }` from `rectangle`/`constructPath` +
  `fill`/`eoFill`/`fillStroke`;
- **stroked lines** `{ x1, y1, x2, y2, color, width }` (horizontal/vertical only);
- **images** `{ x, y, w, h, objId }` from `paintImageXObject`/`paintJpegXObject`,
  with the placement transform.

All coordinates are converted to PDF points with the origin top-left so they
compare directly with PDFKit's coordinate system.

### 5.2 Derivations (`report-theme/derive/*.ts`, one pure function each)

| Field | Rule |
|---|---|
| `page.size`, `orientation` | From the viewport of interior pages (mode). Snapped to LETTER / A4 / LEGAL / TABLOID when within 2 pt, else the exact `[w, h]`. |
| `page.margins` | Left = mode of body-run left edges; right = page width − mode of body-run right edges (only runs wider than 60 % of the usable width count, so indented lists and table cells don't skew it); top/bottom = the body band edges after removing header/footer zones. Left and right are then **forced symmetric** (mean) — see §7.3. |
| `fonts.body` | The (family, size) with the most characters on interior pages. |
| `fonts.heading` | The family of the H1 runs (may equal body). |
| `text.body` | Body size and colour (mode). `text.caption`, `text.muted` from caption runs and the running header/footer runs. |
| `headings[0..2]` | Runs that (a) are a whole line, (b) differ from body in font, size, weight or colour, (c) recur in ≥2 places, ranked by size descending → H1, H2, H3 (max 3). Per level: `numbering` from the text (`1.0` / `1.` / `1` / `Section 1` / `A.` / `none`), `case` (UPPER / Title / as-is), `rule` (a stroked line within 6 pt below the heading with its colour and width), `band` (a filled rect containing the heading bbox), `spaceBefore`/`spaceAfter` from the gap to neighbouring runs (median). |
| `header` / `footer` | Runs in the top / bottom 8 % of interior pages whose digit-normalised text recurs on ≥60 % of them. Each segment gets an alignment (left / centre / right from its x-centre) and is **tokenised** — see §5.3. A stroked line within 8 pt of the zone becomes `rule`. |
| `palette` | From fill/stroke ops on interior pages, not pixels. `primary` = most-used saturated (chroma > 25) colour across heading text, bands and table headers; `accent` = the next colour with a hue distance > 40°; `rule` = most common stroke colour of horizontal lines in the body band; `text` = body colour; `muted` = the grey most used by captions/header/footer, else derived. |
| `table` | A table region = ≥3 horizontal rules with equal x-extent, or ≥2 filled row rects with equal x-extent, within 40 pt vertically. Header row = first row whose runs are bold or sit on a fill. Emits header fill + text colour, header/body sizes, rule colour/width, `mode` (`horizontal` / `grid` if vertical rules exist / `none`), zebra fill (alternating row rects), padding (median gap between rule and text), and caption style + position (`Table N-N` run above/below). |
| `figure.caption` | Same for `Figure N-N` runs. |
| `cover` | See §5.4. |
| `synonyms` | Each H1/H2 title is matched to a canonical key by keyword regex (~25 keys: `executive-summary`, `introduction`, `site-description`, `study-area`, `existing-conditions`, `methodology`, `background-growth`, `trip-generation`, `trip-distribution`, `trip-assignment`, `future-conditions`, `capacity-analysis`, `queuing`, `warrants`, `access`, `mitigation`, `conclusions`, `recommendations`, `appendix`, …). The firm's wording is stored per key, numbering stripped. |
| `source` | `{ pages, fontsSeen[], extractedAt, warnings[] }`. |

Every derivation returns `null` for "not detected" and the assembler substitutes
the `DEFAULT_THEME` value and appends a warning (e.g. `"No running footer
detected; using the default footer."`, `"Cover page is a single scanned image;
using it as the cover background."`).

### 5.3 Header/footer tokenisation — never leak the sample's project

Segments are classified in this order; the first match wins:

1. Page number pattern (`Page 3`, `Page 3 of 12`, `3`, `- 3 -`, `3 | `) → `{{page}}` / `{{page}} of {{pages}}` with the surrounding literal text kept.
2. Equals the uploading firm's name (case/punctuation-insensitive) → `{{firm.name}}`.
3. Matches `/traffic (impact|study)|transportation impact|transport (assessment|statement)/i` → `{{documentType}}`.
4. Date-like (`March 2024`, `03/14/2024`, `2024-03-14`) → `{{project.dateLabel}}`.
5. Equals the cover's detected project title → `{{project.projectName}}`.
6. Otherwise the segment is **dropped** and a warning names it.

### 5.4 Cover composition

From page 1:

- `background`: an image covering ≥70 % of the page → `{ kind: "image", data }`
  (PNG data URL); else the page's dominant full-page fill → `{ kind: "color" }`;
  else white.
- `bands[]`: filled rects spanning ≥90 % of the page width → `{ y0, y1, color }`.
- `logo`: the largest non-background image with aspect 1.6–12 and height 24–600 pt
  → `{ x, y, w, h, data }`. Pixels come from pdfjs's decoded image
  (`page.objs.get(objId)` → RGB/RGBA + width/height) and are encoded with the
  existing pure-Node PNG encoder (`encodePngRGBA`, kept from `pdf-assets.ts`).
  JPEG XObjects are decoded by pdfjs the same way.
- `elements[]`: text runs classified by role — largest run matching the document
  type regex → `{{documentType}}`; next-largest run → `{{project.projectName}}`;
  date-like → `{{project.dateLabel}}`; runs starting `Prepared for` / `Prepared by`
  / `Submitted to` keep the label and get `{{project.client}}` / `{{firm.name}}`;
  the firm name → `{{firm.name}}`. Each keeps `{ x, y, w, font, size, bold, color,
  align }`. Unclassified runs are dropped.
- `hasMetaBlock`: true when at least one of date / prepared-for / prepared-by was
  found. When false, the renderer appends our standard meta block (§7.6).

### 5.5 Font substitution (`report-theme/fonts.ts`)

Family is parsed from the PostScript name after stripping the subset prefix
(`ABCDEF+`), style suffixes (`-Bold`, `,Bold`, `BoldMT`, `-BoldItalic`, `PS`,
`MT`) and spaces. Matched, case-insensitively, to bundled OFL/Apache fonts:

| Sample family | Bundled substitute | Metric-compatible |
|---|---|---|
| Arial, Helvetica, ArialMT, Liberation Sans | Liberation Sans | yes |
| Times New Roman, Times, TimesNewRomanPS | Liberation Serif | yes |
| Courier, Courier New | Liberation Mono | yes |
| Calibri | Carlito | yes |
| Cambria | Caladea | yes |
| Georgia | Gelasio | yes |
| Segoe UI | Selawik | yes |
| Open Sans, Roboto, Lato, Montserrat, Source Sans (3/Pro) | itself | exact |
| DejaVu Sans / Verdana / Tahoma | DejaVu Sans | Verdana/Tahoma: close |
| anything else | Liberation Serif if `isSerifFont`, else Liberation Sans | no |

Each family ships Regular / Bold / Italic / BoldItalic under
`artifacts/tis-api-server/data/fonts/<family>/`, with its licence file. The
match is recorded as `{ requested, used, exact }` so the summary can say
"Calibri → Carlito (metric-compatible)". Total added assets ≈ 12 MB.

## 6. Theme schema — `report-theme/theme.ts`

```ts
type StoredTheme = { version: 2; theme: Theme; source: Source };

type TextStyle = { font: "body" | "heading"; size: number; color: string; bold?: boolean; italic?: boolean };
type Segment = { align: "left" | "center" | "right"; text: string }; // text carries {{tokens}}

type Theme = {
  id: string;                                            // "default" | "velocity" | "firm-<firmId>"
  page: {
    size: "LETTER" | "A4" | "LEGAL" | "TABLOID" | [number, number];
    orientation: "portrait" | "landscape";
    margins: { top: number; right: number; bottom: number; left: number }; // left === right
  };
  fonts: { body: FontRef; heading: FontRef };            // FontRef = { family: BundledFamily; requested: string; exact: boolean }
  text: { body: TextStyle; caption: TextStyle; muted: TextStyle };
  headings: [HeadingStyle, HeadingStyle, HeadingStyle];  // H1, H2, H3
  palette: { primary: string; accent: string; text: string; muted: string; rule: string };
  table: {
    header: { fill: string | null; color: string; bold: boolean; size: number };
    body: { size: number; color: string };
    rules: { color: string; width: number; mode: "horizontal" | "grid" | "none" };
    zebra: string | null;
    padX: number; padY: number;
    caption: { position: "above" | "below"; style: TextStyle };
  };
  figure: { caption: { position: "above" | "below"; style: TextStyle } };
  header: { segments: Segment[]; style: TextStyle; rule: { color: string; width: number } | null; height: number } | null;
  footer: { segments: Segment[]; style: TextStyle; rule: { color: string; width: number } | null; height: number } | null;
  cover: {
    background: { kind: "image"; data: string } | { kind: "color"; color: string } | { kind: "none" };
    bands: Array<{ y0: number; y1: number; color: string }>;
    logo: { x: number; y: number; w: number; h: number; data: string } | null;
    elements: Array<{ role: "documentType" | "projectName" | "dateLabel" | "preparedFor" | "preparedBy" | "firmName";
                      x: number; y: number; w: number; align: "left" | "center" | "right"; style: TextStyle; label?: string }>;
    hasMetaBlock: boolean;
  };
  charts: { series: string[] };                          // derived: primary, accent, then tints
  synonyms: Record<string, string>;                      // canonical heading key → firm wording
};

type HeadingStyle = {
  style: TextStyle;
  case: "upper" | "title" | "asis";
  numbering: "1.0" | "1." | "1" | "section" | "letter" | "none";
  rule: { color: string; width: number; gap: number } | null;
  band: { color: string; padX: number; padY: number } | null;
  spaceBefore: number; spaceAfter: number;
};
```

- Validated with a zod v4 schema (`parseStoredTheme(unknown): StoredTheme | null`);
  a malformed row never takes a render down — it falls back to the default with a
  logged warning, exactly like `resolveTemplate` does today.
- `DEFAULT_THEME` encodes today's constants: LETTER, 50 pt margins, DejaVu Sans,
  10 pt body `#000`, `section()` = 13 pt bold black with no numbering rewrite,
  `table()` header `#f3f4f6`, rule `#d1d5db` 0.5 pt, footer as `drawPageFooter`
  draws it, cover as `drawCover` draws it. `theme.isDefault` is a computed flag
  used by the byte-identity guard, never stored.
- `VELOCITY_THEME` encodes the current Velocity constants so the London path's
  gating becomes a theme rather than a boolean; its output must also stay
  byte-identical.

## 7. Rendering — threading the theme through the renderers

### 7.1 Active theme

`report-theme/active.ts` holds `let active: Theme = DEFAULT_THEME` with
`withTheme(theme, fn)` (set → run → reset in `finally`) and `activeTheme()`.
`renderStudyPdf()` resolves the theme up front (it needs page size/margins for
the `PDFDocument` constructor and font registration), performs all its data
`await`s, then wraps the synchronous draw sequence (`drawCover` … `doc.end()`,
`pdf-export.ts:596–617`) in `withTheme`. Verified: there is no `await` inside
that span, so concurrent requests cannot interleave. The plan must re-verify
this and, if an `await` has crept in, switch to passing the theme explicitly.
`velocityPaletteActive` is replaced by `activeTheme().id === "velocity"`.

### 7.2 Fonts

The renderers already say `doc.font("body")` / `doc.font("bold")`. Registration
in `renderStudyPdf` (and `renderTemplatePdf`, and the sample/verify scripts that
construct their own `PDFDocument`) maps those names to the theme's matched
files; `italic`, `bolditalic`, `heading`, `headingbold` are added. No call
sites change.

### 7.3 Page geometry

`PAGE_MARGIN` is declared as a `const 50` in six files. It becomes an import of
`pageMargin()` from `report-theme/active.ts` (a mechanical replacement; the
default returns 50). Because every renderer uses one value for both edges
(`doc.page.width - PAGE_MARGIN`), themed margins are **symmetric left/right**;
top and bottom are independent and set on the `PDFDocument`. `table()` scales a
spec whose widths sum to more than the usable width down proportionally, so a
1-inch-margin sample cannot overflow a table sized for 512 pt.

### 7.4 Primitives — `report-theme/draw.ts`

`heading(doc, level, title)`, `paragraph`, `table`, `rows`, `caption(kind, text)`,
`pageHeader`, `pageFooter`, `cover`. The existing helpers in `pdf-export.ts`,
`pdf-export-states.ts`, `pdf-export-ny.ts`, `pdf-export-carolinas.ts`,
`pdf-export-distribution.ts` and `pdf-charts.ts` delegate to them. With
`DEFAULT_THEME` the primitives must reproduce the current bytes; where a helper's
current behaviour is too idiosyncratic to express through the theme (the Velocity
cover, the Georgia worksheet letterhead), the helper keeps its current code path
under `if (theme.isDefault || theme.id === "velocity")` and uses the themed
primitive otherwise.

### 7.5 Headings

Our titles arrive as `"3.0 STUDY NETWORK"`, `"3.1 Gross Trip Generation"`,
`"EXECUTIVE SUMMARY"`. `heading()` splits a leading number from the title,
re-emits the number in the theme's `numbering` style (`3.0` → `3.` / `3` /
`Section 3` / dropped), applies `case`, and substitutes the firm's wording when
the title's canonical key has a synonym. Level is inferred from the number's
depth (`3.0` → H1, `3.1` → H2, `3.1.2` → H3; unnumbered `section()` → H1,
`gaSubsection()` → H2). Order is never changed.

### 7.6 Cover

Draws `background`, `bands`, `logo`, then `elements` with tokens interpolated
from the project/firm. The firm's uploaded logo (`firm.logoUrl`) wins over the
logo extracted from the sample when both exist. If `hasMetaBlock` is false, our
standard prepared-for / prepared-by / date block is appended in body style below
the lowest element so nothing required disappears. A site photo, when the
regional renderer supplies one, is placed only when the theme's cover has no
`background.image` (otherwise it would fight the firm's artwork).

### 7.7 Header / footer

`pageHeader` / `pageFooter` draw the theme's segments with tokens interpolated
and the rule when present. Front-matter numbering conventions (cover unnumbered,
doc-control sheet unnumbered) are unchanged. When the theme has no footer the
default footer draws as today.

### 7.8 Charts

`pdf-charts.ts` takes series colours from `theme.charts.series` and axis label
fonts from the theme; with the default theme the current colours are used.

### 7.9 UK / template-engine path

`report-template/engine.ts` primitives read palette, fonts, header/footer and
cover from the theme when one is set (`Brand` is built from the theme); the
Velocity template's chapters and providers are untouched. The V1 ingest and
pdf-assets modules are deleted except for the PNG encoder, which moves to
`report-theme/png.ts`.

## 8. API, storage, frontend

| Route | Change |
|---|---|
| `POST /tis-api/firms/report-template` | multer `fileSize` 20 MB; `%PDF-` header check kept; `await extractTheme(buffer)`; stores `{ version: 2, theme, source }` in `firms.report_template`; the filesystem mirror in `report-template/store.ts` stores the same object (kept for DB-less local dev); responds `{ ok, summary }`. |
| `GET /tis-api/firms/report-template` | `{ template: summary }`, `{ template: null }`, or `{ template: null, legacy: true }` for a V1 row. |
| `GET /tis-api/firms/report-template/preview.pdf` | **new.** Owner/admin/member. Picks a committed preview fixture matching the firm's region (the region of the firm's most recent project, else Florida), renders it with `renderStudyPdf` under the firm's theme, streams `application/pdf` with `Content-Disposition: inline`. Rate-limited like `/generate`. |
| `DELETE /tis-api/firms/report-template` | unchanged. |

`summary` = `{ pageSize, orientation, margins, fonts: [{ role, requested, used, exact }], palette, header: string | null, footer: string | null, cover: "image" | "color" | "plain", table: { headerFill, mode }, numbering, warnings[] }`.

Preview fixtures: one committed `resultPayload` per regional renderer family
(FL, GA, TX, IL, NY, Carolinas, CA, UK) under
`artifacts/tis-api-server/data/preview-fixtures/`, copied from the sample
masters (~150 KB each). The Florida one can be the existing
`scripts/fixtures/conserved-legacy-baseline.json`.

`artifacts/atlanta-tis/src/pages/settings-firm.tsx`: the template card shows the
summary — colour swatches, fonts with a "substituted" badge when `exact` is
false, page size, header/footer text with tokens rendered as chips, cover kind,
warnings — and a **Preview PDF** button (new tab) beside Replace / Remove. A
`legacy` row shows "Uploaded with an earlier version — re-upload your sample to
enable the new format matching."

The OpenAPI spec (`lib/tis-api-spec/openapi.yaml`) gains the preview route and the
summary schema; codegen is re-run.

## 9. Corpus and verification

### 9.1 Corpus

`artifacts/tis-api-server/scripts/fetch-tis-corpus.mjs` downloads 6–8 publicly
posted TIS PDFs from municipal/county planning portals into the gitignored
`scripts/fixtures/tis-corpus/`. `scripts/fixtures/tis-corpus/CORPUS.md` (committed)
lists each file's source URL, firm, jurisdiction, and why it was chosen. Selection
criteria: at least one each of — serif body, sans body, Calibri (Word), InDesign
export, full-bleed cover art, plain cover, page numbers in the header, page
numbers in the footer, coloured headings, black headings, grid tables, rule-only
tables. Nothing copyrighted is committed.

### 9.2 Automated checks (repo `verify-*.mjs` style, wired into `package.json`)

| Script | Asserts |
|---|---|
| `check:theme-extract` | For each corpus file, the extracted theme matches a hand-verified expectation file (`scripts/fixtures/tis-corpus/expected/<name>.json`): body family + size, H1 size/colour, primary hex (ΔE < 5), page size, margins ± 4 pt, numbering style, footer contains `{{page}}` when the sample numbers pages, no warning about a dropped segment that should have been tokenised. **This is the accuracy gate.** |
| `check:theme-default-identity` | Every preview fixture renders to identical bytes with `DEFAULT_THEME` before and after the change (baseline hashes committed the same way `conserved-legacy-baseline.json` is). Velocity fixture likewise. |
| `check:theme-render` | Each preview fixture through each corpus theme: renders without throwing, page count within ±30 % of the default render, every matched font family appears in the PDF's font dictionary, no table wider than the usable width, no text run outside the page box. |
| `check:theme-units` | Pure functions: PostScript-name parsing + substitution table, numbering detection, header/footer tokenisation (including the drop rule), palette classification, table-region detection, cover role classification. Fixtures are small synthetic run/rect lists, not PDFs. |

`pnpm typecheck` stays green. Existing checks (`check:conserved-assignment`,
`check:region-parity`, `check:state-dispatch`, `smoke:distribution-pdf`) stay green.

### 9.3 Manual acceptance

For each corpus file: rasterise page 1, an interior body page, and a table page
of the sample and of the preview rendered through its theme; place them side by
side; review together before the work is called complete.

## 10. Error handling

- Non-PDF, encrypted, or zero-page uploads → 400 with a plain message.
- pdfjs failure on a page → that page is skipped and a warning recorded; extraction
  proceeds. If fewer than 2 pages scanned → 422 "Could not read enough of this PDF".
- A theme whose every derivation fell back to defaults → 422 "No formatting could
  be detected (is this a scanned image?)" rather than silently storing the default.
- Render-time: `parseStoredTheme` failure → default theme + `log.warn`; a
  missing bundled font file → DejaVu + `log.error` (never a 500 for a PDF the
  engineer needs today).
- Extraction runs with a 20 s budget; pdfjs runs in-process, so the route awaits
  it directly — no worker thread in this version.

## 11. Rollout

- Ships behind nothing: V1 rows are ignored, so no firm's output changes until
  they upload a sample through the new route.
- `replit.md` "Where things live" gains the `report-theme/` entries and loses
  the `report-template/ingest` ones; the Gotchas section records the
  symmetric-margin constraint and the `withTheme` no-await rule.

## 12. Files

New: `lib/report-theme/{theme,active,extract,pdf-scan,fonts,draw,png}.ts`,
`lib/report-theme/derive/{page,typography,headings,header-footer,palette,tables,cover,synonyms}.ts`,
`data/fonts/<family>/*.ttf` (+ licences), `data/preview-fixtures/*.json`,
`scripts/fetch-tis-corpus.mjs`, `scripts/verify-theme-{extract,default-identity,render,units}.mjs`,
`scripts/fixtures/tis-corpus/{CORPUS.md,expected/}`.

Changed: `lib/pdf-export.ts`, `lib/pdf-export-{states,ny,carolinas,distribution}.ts`,
`lib/pdf-charts.ts`, `lib/report-template/{engine,store}.ts`, `routes/firms.ts`,
`lib/tis-api-spec/openapi.yaml`, `artifacts/atlanta-tis/src/pages/settings-firm.tsx`,
`package.json` (scripts), `replit.md`.

Deleted: `lib/report-template/{ingest,pdf-assets}.ts` (PNG encoder relocated).

Rough size: extractor + scan ≈ 900 lines, theme + draw ≈ 600, renderer threading
≈ 300 changed lines, routes + frontend ≈ 250, scripts ≈ 300.
