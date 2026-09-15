# Report Theme Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A firm uploads one of its filed TIS PDFs and every study it generates afterwards renders in that firm's page geometry, fonts, colours, heading styles, running header/footer, table style and cover — with our engine's content — plus an instant preview PDF.

**Architecture:** A pure-JS extractor (`pdfjs-dist` operator-list interpreter → per-field derivations) produces a versioned `Theme` JSON stored in `firms.report_template`. A `Theme` is threaded through the shared drawing primitives the regional renderers already use (headings, tables, key-value rows, metric strips, header/footer, cover, charts) via module-level state set for the synchronous draw pass; `DEFAULT_THEME` reproduces today's output byte-for-byte. The poppler-based V1 importer is deleted.

**Tech Stack:** TypeScript 5.9, Node 26, Express 5, PDFKit 0.15, pdfjs-dist 5.7.284 (legacy build), zod 3.25 (added to `tis-api-server`), esbuild for check-script bundling, pnpm 9 workspaces. No test runner — checks are `node ./scripts/verify-*.mjs` scripts wired into `package.json`, matching the repo's existing convention.

**Spec:** `docs/superpowers/specs/2026-09-14-report-theme-import-design.md`

## Global Constraints

- Branch: `feat/report-theme-import` (cut from `origin/main`). Commit after every task.
- `pnpm install` must have been run on this branch (it links the new `@workspace/tis-engine-core` workspace package; without it the renderer bundle fails with `Could not resolve "@workspace/tis-engine-core"`).
- All paths below are relative to `artifacts/tis-api-server/` unless they start with `artifacts/`, `lib/`, `docs/` or `scripts/src/`.
- **Byte identity:** with no firm theme, every PDF must be byte-identical to today's output after normalising `/CreationDate (...)` and `/ID [<…> <…>]` (PDFKit derives both from the wall clock). `check:theme-default-identity` enforces this from Task 3 onward and must pass at the end of every task that touches a renderer.
- **No `await` inside `withTheme()`** — the theme is module-level state; the draw pass in `renderStudyPdf` (`drawCover` … `doc.end()`) is synchronous and must stay that way.
- **Themed margins are symmetric left/right** (`margins.left === margins.right`); top/bottom independent.
- **The sample's text never reaches a new study:** header/footer segments and cover text are tokenised; anything unclassified is dropped with a warning. No prose is copied.
- Upload limit for the template route: 20 MB. Extraction budget: 20 s. Pages scanned: page 1 + first 30 interior pages.
- Fonts: only OFL/Apache-licensed families are bundled, each with its licence file. Embedded subset fonts from the sample are never reused.
- Firms routes are not in `lib/tis-api-spec/openapi.yaml` (the settings page uses raw `fetch`), so no codegen step — this deviates from spec §8's last paragraph deliberately; follow the existing convention.
- The screening disclaimer that `drawPageFooter` prints today is part of the *default* footer only; a themed footer draws the firm's segments (spec §7.7).
- Check scripts import TypeScript through `scripts/ts-loader.mjs` (pure modules) or through an esbuild bundle (`scripts/lib/bundle-renderer.mjs`, for anything that pulls in `pdf-export.ts`). The pnpm workspace root is `/Users/geraldkogon/tis-study`.
- Preview fixtures are copied from the gitignored `private/county-samples-tampa/master-*.json` (absolute path `/Users/geraldkogon/tis-study/private/county-samples-tampa/`) — a worktree does not contain them, so use the absolute path.

---

## File Structure

New (all under `src/lib/report-theme/` unless noted):

| File | Responsibility |
|---|---|
| `theme.ts` | `Theme` / `StoredTheme` types, zod schemas, `DEFAULT_THEME`, `parseStoredTheme`, `classifyStoredTemplate`, `pageSizePoints`, `summarizeTheme`, colour helpers `tint`/`luminance`/`chroma`. |
| `active.ts` | Module-level active theme: `withTheme`, `activeTheme`, `isDefaultTheme`, `pageMargin`, `takeSynonym`. |
| `fonts.ts` | Bundled family table, `parsePostScriptName`, `matchFamily`, `fontPath`, `registerThemeFonts`. |
| `canonical.ts` | Canonical heading keys + `canonicalKey(text)` (shared by draw and extract). |
| `draw.ts` | Themed primitives: `heading`, `formatHeading`, `table`, `scaleWidths`, `rows`, `metricStrip`, `pageHeader`, `pageFooter`, `cover`, `interpolate`, `applyStyle`. |
| `png.ts` | Pure-Node PNG encoder (moved from `report-template/pdf-assets.ts`) + `imagePixelsToPngDataUrl`. |
| `pdf-scan.ts` | pdfjs operator-list interpreter → `ScannedPage[]` (text runs with font/size/colour/bbox, filled rects, stroked lines, image placements) + `linesOf`. |
| `derive/typography.ts` | `bodyStyle`, `detectHeadings`, `detectNumbering`. |
| `derive/page.ts` | `pageGeometry`. |
| `derive/header-footer.ts` | `detectRunningZones`, `tokenizeSegment`, `classifyRunningText`. |
| `derive/palette.ts` | `derivePalette`. |
| `derive/tables.ts` | `detectTables`, `detectFigureCaption`. |
| `derive/cover.ts` | `deriveCover`. |
| `derive/synonyms.ts` | `mapSynonyms`. |
| `extract.ts` | `extractTheme(pdf, opts)` assembler, `ThemeExtractError`, timeout, fallback/warning policy. |
| `preview-fixtures.ts` | `pickPreviewFixture`, `projectFromFixture`, `regionFamilyForCoordinate`. |
| `data/preview-fixtures/{fl,ga,tx,ny,nc,sc}.json` | Committed study payloads for the preview endpoint and checks. |
| `data/fonts/<family>/{Regular,Bold,Italic,BoldItalic}.ttf` + `LICENSE.txt` | Bundled substitute fonts. |
| `scripts/fonts-manifest.json`, `scripts/fetch-fonts.mjs` | Font download manifest + fetcher. |
| `scripts/build-preview-fixtures.mjs` | Copies masters → preview fixtures. |
| `scripts/lib/bundle-renderer.mjs`, `scripts/lib/pdf-norm.mjs` | esbuild bundling helper; PDF normalise/hash helpers. |
| `scripts/verify-theme-units.mjs` | Pure-function checks (theme, fonts, draw formatting, derive modules). |
| `scripts/verify-theme-default-identity.mjs` | Byte-identity guard (`--pin` to re-baseline). |
| `scripts/verify-theme-scan.mjs` | Scanner + extractor on PDFKit-generated synthetic PDFs. |
| `scripts/verify-theme-render.mjs` | Fixtures × synthetic and corpus themes render checks. |
| `scripts/verify-theme-extract.mjs` | Corpus accuracy gate against `scripts/fixtures/tis-corpus/expected/*.json`. |
| `scripts/fetch-tis-corpus.mjs`, `scripts/fixtures/tis-corpus/CORPUS.md`, `scripts/fixtures/tis-corpus/expected/` | Public-TIS corpus (PDFs gitignored). |
| `scripts/fixtures/theme-identity-baseline.json` | Pinned hashes for the identity guard. |

Modified: `src/lib/pdf-export.ts`, `src/lib/pdf-export-states.ts`, `src/lib/pdf-export-ny.ts`, `src/lib/pdf-export-carolinas.ts`, `src/lib/pdf-export-distribution.ts`, `src/lib/pdf-charts.ts`, `src/lib/report-template/engine.ts`, `src/lib/report-template/store.ts`, `src/routes/firms.ts`, `package.json`, `.gitignore` (root), `artifacts/atlanta-tis/src/pages/settings-firm.tsx`, `replit.md`.

Deleted: `src/lib/report-template/ingest.ts`, `src/lib/report-template/pdf-assets.ts`.

## Conventions used by every task

- Run a check script from `artifacts/tis-api-server/`: `node ./scripts/verify-theme-units.mjs`. Every check prints `PASS`/`FAIL` lines and exits non-zero on any FAIL (the `ok(cond, msg)` idiom from `scripts/verify-name-dedup.mjs`).
- Typecheck: `pnpm --filter @workspace/tis-api-server run typecheck`.
- pdfjs in Node needs the `DOMMatrix` shim before import (copied from `synchro-pdf-import.ts`); `pdf-scan.ts` owns it.
- Commit message style in this repo: `feat(theme): …`, `chore(theme): …`, `refactor(pdf): …`, imperative, wrapped, ending with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` line.

---

# Phase A — Theme foundation (renderers become theme-capable; zero visible change)

### Task 1: Theme schema, default theme, summary

**Files:**
- Create: `src/lib/report-theme/theme.ts`
- Create: `scripts/verify-theme-units.mjs`
- Modify: `package.json` (add `zod` dependency and the `check:theme-units` script)

**Interfaces:**
- Produces: `Theme`, `StoredTheme`, `TextStyle`, `HeadingStyle`, `RunningZone`, `ThemeSummary`, `BUNDLED_FAMILIES`, `BundledFamily`, `THEME_VERSION`, `DEFAULT_THEME`, `ThemeSchema`, `StoredThemeSchema`, `parseStoredTheme(raw): StoredTheme | null`, `classifyStoredTemplate(raw): "none" | "legacy" | "v2" | "invalid"`, `isDefaultTheme(t: Theme): boolean`, `pageSizePoints(page: Theme["page"]): [number, number]`, `summarizeTheme(s: StoredTheme): ThemeSummary`, `tint(hex, t)`, `luminance(hex)`, `chroma(hex)`, `hueDegrees(hex)`, `hueDistance(a, b)`.

- [ ] **Step 1: Add zod to the server package**

In `package.json` `dependencies`, add `"zod": "catalog:"` (alphabetically after `"stripe"`), then from the repo root:

```bash
pnpm install --prefer-offline
```

Expected: `node_modules/zod` appears under `artifacts/tis-api-server/node_modules/`.

- [ ] **Step 2: Write the failing unit check**

Create `scripts/verify-theme-units.mjs`:

```js
// Pure-function checks for the report-theme modules. No PDFs, no network.
// Run: node ./scripts/verify-theme-units.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

// ─── theme.ts ────────────────────────────────────────────────────────────────
const theme = await import(path.resolve(here, "../src/lib/report-theme/theme.ts"));
const { DEFAULT_THEME, parseStoredTheme, classifyStoredTemplate, isDefaultTheme, pageSizePoints, summarizeTheme, StoredThemeSchema, tint, luminance, chroma, hueDistance } = theme;

ok(isDefaultTheme(DEFAULT_THEME), "DEFAULT_THEME is the default");
eq(pageSizePoints(DEFAULT_THEME.page), [612, 792], "LETTER portrait is 612×792");
eq(pageSizePoints({ ...DEFAULT_THEME.page, orientation: "landscape" }), [792, 612], "landscape swaps");
eq(pageSizePoints({ ...DEFAULT_THEME.page, size: [500, 700] }), [500, 700], "custom size passes through");
ok(StoredThemeSchema.safeParse({ version: 2, theme: DEFAULT_THEME, source: { pages: 3, fontsSeen: [], extractedAt: "2026-01-01T00:00:00Z", warnings: [] } }).success, "DEFAULT_THEME validates under the schema");
eq(classifyStoredTemplate(null), "none", "null → none");
eq(classifyStoredTemplate({ id: "x", chapters: [] }), "legacy", "V1 object with chapters → legacy");
eq(classifyStoredTemplate({ version: 2, theme: DEFAULT_THEME, source: { pages: 1, fontsSeen: [], extractedAt: "x", warnings: [] } }), "v2", "valid v2 → v2");
eq(classifyStoredTemplate({ version: 2, theme: { id: "bad" } }), "invalid", "v2 that fails schema → invalid");
eq(classifyStoredTemplate("nope"), "invalid", "string → invalid");
ok(parseStoredTheme({ version: 2, theme: { ...DEFAULT_THEME, palette: { ...DEFAULT_THEME.palette, primary: "red" } }, source: { pages: 1, fontsSeen: [], extractedAt: "x", warnings: [] } }) === null, "bad hex rejected");
const stored = { version: 2, theme: { ...DEFAULT_THEME, id: "firm-1", header: null, footer: { segments: [{ align: "center", text: "Page {{page}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: null, height: 30 } }, source: { pages: 12, fontsSeen: ["ABCDEF+Calibri"], extractedAt: "2026-09-14T00:00:00Z", warnings: ["w1"] } };
const summary = summarizeTheme(parseStoredTheme(stored));
eq(summary.pageSize, "LETTER", "summary pageSize");
eq(summary.footer, "Page {{page}}", "summary footer joins segments");
eq(summary.header, null, "summary header null");
eq(summary.warnings, ["w1"], "summary warnings pass through");
eq(summary.fonts.map((f) => f.role), ["body", "heading"], "summary lists body + heading fonts");
eq(tint("#000000", 0.5), "#808080", "tint mixes toward white");
ok(Math.abs(luminance("#ffffff") - 255) < 0.01, "luminance white = 255");
eq(chroma("#808080"), 0, "grey has zero chroma");
ok(hueDistance("#ff0000", "#00ff00") > 100, "red vs green far apart");
ok(hueDistance("#ff0000", "#ff2010") < 15, "near-reds close");

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
```

- [ ] **Step 3: Run it to see it fail**

```bash
node ./scripts/verify-theme-units.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `../src/lib/report-theme/theme.ts`.

- [ ] **Step 4: Write `theme.ts`**

Create `src/lib/report-theme/theme.ts`:

```ts
/**
 * Report theme — the declarative "look" a firm's uploaded sample TIS is
 * distilled into, and the values every drawing primitive reads.
 *
 * Stored per firm in `firms.report_template` as `{ version: 2, theme, source }`.
 * `DEFAULT_THEME` encodes today's constants exactly so the renderers are
 * byte-identical when no firm theme is set (see check:theme-default-identity).
 *
 * See docs/superpowers/specs/2026-09-14-report-theme-import-design.md §6.
 */
import { z } from "zod";

export const THEME_VERSION = 2 as const;

export const BUNDLED_FAMILIES = [
  "dejavu-sans",
  "liberation-sans",
  "liberation-serif",
  "liberation-mono",
  "carlito",
  "caladea",
  "gelasio",
  "open-sans",
  "roboto",
  "lato",
  "montserrat",
  "source-sans-3",
] as const;
export type BundledFamily = (typeof BUNDLED_FAMILIES)[number];

const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/, "lowercase #rrggbb");
const TextStyleSchema = z.object({
  font: z.enum(["body", "heading"]),
  size: z.number().min(4).max(96),
  color: HexSchema,
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});
const FontRefSchema = z.object({
  family: z.enum(BUNDLED_FAMILIES),
  requested: z.string().max(120),
  exact: z.boolean(),
});
const RuleSchema = z.object({ color: HexSchema, width: z.number().min(0.1).max(12) });
const SegmentSchema = z.object({ align: z.enum(["left", "center", "right"]), text: z.string().max(400) });
const HeadingStyleSchema = z.object({
  style: TextStyleSchema,
  case: z.enum(["upper", "title", "asis"]),
  numbering: z.enum(["1.0", "1.", "1", "section", "letter", "none"]),
  rule: RuleSchema.extend({ gap: z.number().min(0).max(24) }).nullable(),
  band: z.object({ color: HexSchema, padX: z.number().min(0).max(24), padY: z.number().min(0).max(24) }).nullable(),
  spaceBefore: z.number().min(0).max(72),
  spaceAfter: z.number().min(0).max(72),
});
const RunningZoneSchema = z.object({
  segments: z.array(SegmentSchema).max(6),
  style: TextStyleSchema,
  rule: RuleSchema.nullable(),
  height: z.number().min(0).max(144),
});
const DataUrlSchema = z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(4_000_000);
const CoverElementSchema = z.object({
  role: z.enum(["documentType", "projectName", "dateLabel", "preparedFor", "preparedBy", "firmName"]),
  x: z.number(),
  y: z.number(),
  w: z.number().min(20),
  align: z.enum(["left", "center", "right"]),
  style: TextStyleSchema,
  label: z.string().max(80).optional(),
});
const MarginSchema = z.number().min(18).max(144);

export const ThemeSchema = z.object({
  id: z.string().min(1).max(80),
  page: z.object({
    size: z.union([
      z.enum(["LETTER", "A4", "LEGAL", "TABLOID"]),
      z.tuple([z.number().min(200).max(2000), z.number().min(200).max(2000)]),
    ]),
    orientation: z.enum(["portrait", "landscape"]),
    margins: z.object({ top: MarginSchema, right: MarginSchema, bottom: MarginSchema, left: MarginSchema }),
  }),
  fonts: z.object({ body: FontRefSchema, heading: FontRefSchema }),
  text: z.object({ body: TextStyleSchema, caption: TextStyleSchema, muted: TextStyleSchema }),
  headings: z.tuple([HeadingStyleSchema, HeadingStyleSchema, HeadingStyleSchema]),
  palette: z.object({ primary: HexSchema, accent: HexSchema, text: HexSchema, muted: HexSchema, rule: HexSchema }),
  table: z.object({
    header: z.object({ fill: HexSchema.nullable(), color: HexSchema, bold: z.boolean(), size: z.number().min(4).max(24) }),
    body: z.object({ size: z.number().min(4).max(24), color: HexSchema }),
    rules: z.object({ color: HexSchema, width: z.number().min(0.1).max(6), mode: z.enum(["horizontal", "grid", "none"]) }),
    zebra: HexSchema.nullable(),
    padX: z.number().min(0).max(20),
    padY: z.number().min(0).max(20),
    caption: z.object({ position: z.enum(["above", "below"]), style: TextStyleSchema }),
  }),
  figure: z.object({ caption: z.object({ position: z.enum(["above", "below"]), style: TextStyleSchema }) }),
  header: RunningZoneSchema.nullable(),
  footer: RunningZoneSchema.nullable(),
  cover: z.object({
    background: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("image"), data: DataUrlSchema }),
      z.object({ kind: z.literal("color"), color: HexSchema }),
      z.object({ kind: z.literal("none") }),
    ]),
    bands: z.array(z.object({ y0: z.number(), y1: z.number(), color: HexSchema })).max(8),
    logo: z.object({ x: z.number(), y: z.number(), w: z.number().min(4), h: z.number().min(4), data: DataUrlSchema }).nullable(),
    elements: z.array(CoverElementSchema).max(12),
    hasMetaBlock: z.boolean(),
  }),
  charts: z.object({ series: z.array(HexSchema).min(2).max(8) }),
  synonyms: z.record(z.string(), z.string().max(120)),
});

export const SourceSchema = z.object({
  pages: z.number().int().min(0),
  fontsSeen: z.array(z.string().max(120)).max(64),
  extractedAt: z.string(),
  warnings: z.array(z.string().max(300)).max(64),
});

export const StoredThemeSchema = z.object({
  version: z.literal(THEME_VERSION),
  theme: ThemeSchema,
  source: SourceSchema,
});

export type Theme = z.infer<typeof ThemeSchema>;
export type StoredTheme = z.infer<typeof StoredThemeSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type HeadingStyle = z.infer<typeof HeadingStyleSchema>;
export type RunningZone = z.infer<typeof RunningZoneSchema>;
export type CoverElement = z.infer<typeof CoverElementSchema>;
export type Numbering = HeadingStyle["numbering"];

/** Today's constants, verbatim. Do not "improve" — the identity check pins it. */
export const DEFAULT_THEME: Theme = {
  id: "default",
  page: { size: "LETTER", orientation: "portrait", margins: { top: 50, right: 50, bottom: 50, left: 50 } },
  fonts: {
    body: { family: "dejavu-sans", requested: "DejaVu Sans", exact: true },
    heading: { family: "dejavu-sans", requested: "DejaVu Sans", exact: true },
  },
  text: {
    body: { font: "body", size: 10, color: "#000000" },
    caption: { font: "body", size: 9, color: "#6b7280" },
    muted: { font: "body", size: 9, color: "#6b7280" },
  },
  headings: [
    { style: { font: "heading", size: 13, color: "#000000", bold: true }, case: "asis", numbering: "1.0", rule: null, band: null, spaceBefore: 0, spaceAfter: 4 },
    { style: { font: "heading", size: 11, color: "#000000", bold: true }, case: "asis", numbering: "1.0", rule: null, band: null, spaceBefore: 0, spaceAfter: 3 },
    { style: { font: "heading", size: 10, color: "#000000", bold: true }, case: "asis", numbering: "1.0", rule: null, band: null, spaceBefore: 0, spaceAfter: 2 },
  ],
  palette: { primary: "#2563eb", accent: "#7a1420", text: "#000000", muted: "#6b7280", rule: "#e5e7eb" },
  table: {
    header: { fill: "#f3f4f6", color: "#000000", bold: true, size: 9 },
    body: { size: 9, color: "#000000" },
    rules: { color: "#e5e7eb", width: 0.5, mode: "horizontal" },
    zebra: null,
    padX: 4,
    padY: 4,
    caption: { position: "above", style: { font: "body", size: 9, color: "#6b7280", bold: true } },
  },
  figure: { caption: { position: "below", style: { font: "body", size: 9, color: "#6b7280" } } },
  header: null,
  footer: null,
  cover: { background: { kind: "none" }, bands: [], logo: null, elements: [], hasMetaBlock: true },
  charts: { series: ["#fc8460", "#60c09c"] },
  synonyms: {},
};

export function isDefaultTheme(t: Theme): boolean {
  return t.id === "default";
}

export function parseStoredTheme(raw: unknown): StoredTheme | null {
  const r = StoredThemeSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * What a `firms.report_template` row holds. V1 rows (the retired poppler
 * importer wrote a ReportTemplate with `chapters`) are "legacy": ignored at
 * render time and reported to the settings page so the firm re-uploads.
 */
export function classifyStoredTemplate(raw: unknown): "none" | "legacy" | "v2" | "invalid" {
  if (raw == null) return "none";
  if (typeof raw !== "object") return "invalid";
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.chapters)) return "legacy";
  if (o.version === THEME_VERSION) return StoredThemeSchema.safeParse(raw).success ? "v2" : "invalid";
  return "invalid";
}

const PAGE_SIZES: Record<"LETTER" | "A4" | "LEGAL" | "TABLOID", [number, number]> = {
  LETTER: [612, 792],
  A4: [595.28, 841.89],
  LEGAL: [612, 1008],
  TABLOID: [792, 1224],
};

export function pageSizePoints(page: Theme["page"]): [number, number] {
  const base: [number, number] = typeof page.size === "string" ? PAGE_SIZES[page.size] : page.size;
  return page.orientation === "landscape" ? [base[1], base[0]] : [base[0], base[1]];
}

// ─── Colour helpers (shared by draw + derive) ───────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** Mix toward white: t=0 → hex, t=1 → white. */
export function tint(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
export function chroma(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}
export function hueDegrees(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
export function hueDistance(a: string, b: string): number {
  const d = Math.abs(hueDegrees(a) - hueDegrees(b));
  return Math.min(d, 360 - d);
}

// ─── Summary for the settings page ──────────────────────────────────────────

export type ThemeSummary = {
  pageSize: string;
  orientation: Theme["page"]["orientation"];
  margins: Theme["page"]["margins"];
  fonts: Array<{ role: "body" | "heading"; requested: string; used: BundledFamily; exact: boolean }>;
  palette: Theme["palette"];
  header: string | null;
  footer: string | null;
  cover: "image" | "color" | "plain";
  table: { headerFill: string | null; mode: Theme["table"]["rules"]["mode"] };
  numbering: Numbering;
  warnings: string[];
  extractedAt: string;
};

export function summarizeTheme(s: StoredTheme): ThemeSummary {
  const t = s.theme;
  const zone = (z: RunningZone | null) => (z && z.segments.length ? z.segments.map((seg) => seg.text).join("   ") : null);
  return {
    pageSize: typeof t.page.size === "string" ? t.page.size : `${Math.round(t.page.size[0])}×${Math.round(t.page.size[1])} pt`,
    orientation: t.page.orientation,
    margins: t.page.margins,
    fonts: [
      { role: "body", requested: t.fonts.body.requested, used: t.fonts.body.family, exact: t.fonts.body.exact },
      { role: "heading", requested: t.fonts.heading.requested, used: t.fonts.heading.family, exact: t.fonts.heading.exact },
    ],
    palette: t.palette,
    header: zone(t.header),
    footer: zone(t.footer),
    cover: t.cover.background.kind === "image" ? "image" : t.cover.background.kind === "color" || t.cover.bands.length ? "color" : "plain",
    table: { headerFill: t.table.header.fill, mode: t.table.rules.mode },
    numbering: t.headings[0].numbering,
    warnings: s.source.warnings,
    extractedAt: s.source.extractedAt,
  };
}
```

- [ ] **Step 5: Run the check and typecheck**

```bash
node ./scripts/verify-theme-units.mjs && pnpm --filter @workspace/tis-api-server run typecheck
```

Expected: every line `PASS`, `ALL PASS`, typecheck clean.

- [ ] **Step 6: Wire the script and commit**

Add to `package.json` scripts: `"check:theme-units": "node ./scripts/verify-theme-units.mjs"`.

```bash
git add artifacts/tis-api-server/package.json pnpm-lock.yaml artifacts/tis-api-server/src/lib/report-theme/theme.ts artifacts/tis-api-server/scripts/verify-theme-units.mjs
git commit -m "feat(theme): Theme schema, DEFAULT_THEME and summary

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Bundled fonts and font matching

**Files:**
- Create: `scripts/fonts-manifest.json`, `scripts/fetch-fonts.mjs`
- Create: `data/fonts/<family>/{Regular,Bold,Italic,BoldItalic}.ttf` + `LICENSE.txt` (11 families, fetched)
- Create: `src/lib/report-theme/fonts.ts`
- Modify: `scripts/verify-theme-units.mjs` (append font checks)

**Interfaces:**
- Consumes: `BundledFamily`, `Theme`, `isDefaultTheme` from `theme.ts`.
- Produces: `FONT_DIR`, `type FontStyle = "regular" | "bold" | "italic" | "bolditalic"`, `fontPath(family, style): string`, `parsePostScriptName(name): { family: string; bold: boolean; italic: boolean }`, `matchFamily(psFamily, hints?: { serif?: boolean; mono?: boolean }): { family: BundledFamily; exact: boolean }`, `registerThemeFonts(doc: PDFKit.PDFDocument, theme: Theme): void` (registers `body`, `bold`, `italic`, `bolditalic`, `heading`, `headingbold`, `mono`).

- [ ] **Step 1: Write the manifest**

Create `scripts/fonts-manifest.json` (every URL below returned HTTP 200 on 2026-09-14):

```json
{
  "liberation-sans":  { "archive": "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz", "prefix": "liberation-fonts-ttf-2.1.5/", "files": { "Regular": "LiberationSans-Regular.ttf", "Bold": "LiberationSans-Bold.ttf", "Italic": "LiberationSans-Italic.ttf", "BoldItalic": "LiberationSans-BoldItalic.ttf" }, "licence": "LICENSE" },
  "liberation-serif": { "archive": "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz", "prefix": "liberation-fonts-ttf-2.1.5/", "files": { "Regular": "LiberationSerif-Regular.ttf", "Bold": "LiberationSerif-Bold.ttf", "Italic": "LiberationSerif-Italic.ttf", "BoldItalic": "LiberationSerif-BoldItalic.ttf" }, "licence": "LICENSE" },
  "liberation-mono":  { "archive": "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz", "prefix": "liberation-fonts-ttf-2.1.5/", "files": { "Regular": "LiberationMono-Regular.ttf", "Bold": "LiberationMono-Bold.ttf", "Italic": "LiberationMono-Italic.ttf", "BoldItalic": "LiberationMono-BoldItalic.ttf" }, "licence": "LICENSE" },
  "carlito":       { "base": "https://raw.githubusercontent.com/googlefonts/carlito/main/", "files": { "Regular": "fonts/ttf/Carlito-Regular.ttf", "Bold": "fonts/ttf/Carlito-Bold.ttf", "Italic": "fonts/ttf/Carlito-Italic.ttf", "BoldItalic": "fonts/ttf/Carlito-BoldItalic.ttf" }, "licence": ["OFL.txt"] },
  "caladea":       { "base": "https://raw.githubusercontent.com/huertatipografica/Caladea/master/", "files": { "Regular": "fonts/ttf/Caladea-Regular.ttf", "Bold": "fonts/ttf/Caladea-Bold.ttf", "Italic": "fonts/ttf/Caladea-Italic.ttf", "BoldItalic": "fonts/ttf/Caladea-BoldItalic.ttf" }, "licence": ["OFL.txt", "LICENSE.txt", "LICENSE"] },
  "gelasio":       { "base": "https://raw.githubusercontent.com/SorkinType/Gelasio/main/", "files": { "Regular": "fonts/ttf/Gelasio-Regular.ttf", "Bold": "fonts/ttf/Gelasio-Bold.ttf", "Italic": "fonts/ttf/Gelasio-Italic.ttf", "BoldItalic": "fonts/ttf/Gelasio-BoldItalic.ttf" }, "licence": ["OFL.txt", "LICENSE.txt", "LICENSE"] },
  "open-sans":     { "base": "https://raw.githubusercontent.com/googlefonts/opensans/main/", "files": { "Regular": "fonts/ttf/OpenSans-Regular.ttf", "Bold": "fonts/ttf/OpenSans-Bold.ttf", "Italic": "fonts/ttf/OpenSans-Italic.ttf", "BoldItalic": "fonts/ttf/OpenSans-BoldItalic.ttf" }, "licence": ["OFL.txt"] },
  "roboto":        { "base": "https://raw.githubusercontent.com/googlefonts/roboto-2/main/", "files": { "Regular": "src/hinted/Roboto-Regular.ttf", "Bold": "src/hinted/Roboto-Bold.ttf", "Italic": "src/hinted/Roboto-Italic.ttf", "BoldItalic": "src/hinted/Roboto-BoldItalic.ttf" }, "licence": ["LICENSE", "LICENSE.txt"] },
  "lato":          { "base": "https://raw.githubusercontent.com/googlefonts/LatoGFVersion/main/", "files": { "Regular": "fonts/Lato-Regular.ttf", "Bold": "fonts/Lato-Bold.ttf", "Italic": "fonts/Lato-Italic.ttf", "BoldItalic": "fonts/Lato-BoldItalic.ttf" }, "licence": ["OFL.txt", "OFL", "LICENSE.txt"] },
  "montserrat":    { "base": "https://raw.githubusercontent.com/JulietaUla/Montserrat/master/", "files": { "Regular": "fonts/ttf/Montserrat-Regular.ttf", "Bold": "fonts/ttf/Montserrat-Bold.ttf", "Italic": "fonts/ttf/Montserrat-Italic.ttf", "BoldItalic": "fonts/ttf/Montserrat-BoldItalic.ttf" }, "licence": ["OFL.txt", "LICENSE.txt", "LICENSE"] },
  "source-sans-3": { "base": "https://raw.githubusercontent.com/adobe-fonts/source-sans/release/", "files": { "Regular": "TTF/SourceSans3-Regular.ttf", "Bold": "TTF/SourceSans3-Bold.ttf", "Italic": "TTF/SourceSans3-It.ttf", "BoldItalic": "TTF/SourceSans3-BoldIt.ttf" }, "licence": ["LICENSE.md", "LICENSE.txt", "LICENSE"] }
}
```

- [ ] **Step 2: Write the fetcher**

Create `scripts/fetch-fonts.mjs`:

```js
// Downloads the bundled substitute fonts listed in fonts-manifest.json into
// data/fonts/<family>/{Regular,Bold,Italic,BoldItalic}.ttf + LICENSE.txt.
// Idempotent: existing files are kept. Run: node ./scripts/fetch-fonts.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync, existsSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.resolve(here, "fonts-manifest.json"), "utf8"));
const outRoot = path.resolve(here, "../data/fonts");

async function get(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

const archives = new Map(); // url → extracted dir
async function fromArchive(url) {
  if (archives.has(url)) return archives.get(url);
  const dir = mkdtempSync(path.join(os.tmpdir(), "fonts-"));
  writeFileSync(path.join(dir, "a.tgz"), await get(url));
  execFileSync("tar", ["xzf", "a.tgz"], { cwd: dir });
  archives.set(url, dir);
  return dir;
}

let failures = 0;
for (const [family, spec] of Object.entries(manifest)) {
  const dir = path.join(outRoot, family);
  mkdirSync(dir, { recursive: true });
  for (const [style, rel] of Object.entries(spec.files)) {
    const dest = path.join(dir, `${style}.ttf`);
    if (existsSync(dest)) { console.log(`keep  ${family}/${style}.ttf`); continue; }
    try {
      if (spec.archive) {
        const adir = await fromArchive(spec.archive);
        writeFileSync(dest, readFileSync(path.join(adir, spec.prefix, rel)));
      } else {
        writeFileSync(dest, await get(spec.base + rel));
      }
      console.log(`fetch ${family}/${style}.ttf`);
    } catch (e) { console.error(`FAIL  ${family}/${style}: ${e.message}`); failures++; }
  }
  const licDest = path.join(dir, "LICENSE.txt");
  if (!existsSync(licDest)) {
    const cands = Array.isArray(spec.licence) ? spec.licence : [spec.licence];
    let done = false;
    for (const c of cands) {
      try {
        const buf = spec.archive ? readFileSync(path.join(await fromArchive(spec.archive), spec.prefix, c)) : await get(spec.base + c);
        writeFileSync(licDest, buf); done = true; console.log(`fetch ${family}/LICENSE.txt (${c})`); break;
      } catch { /* try next */ }
    }
    if (!done) { console.error(`FAIL  ${family}: no licence file found among ${cands.join(", ")}`); failures++; }
  }
}
for (const dir of archives.values()) rmSync(dir, { recursive: true, force: true });
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("fonts ready");
```

- [ ] **Step 3: Fetch the fonts and verify they load in fontkit**

```bash
node ./scripts/fetch-fonts.mjs && ls data/fonts/*/ | head -60 && du -sh data/fonts
```

Expected: 11 directories × 5 files, `fonts ready`, total ≈ 10–14 MB. If a licence candidate list fails for a family, open that repo on GitHub, find the licence file's real name, add it to that family's `licence` array, re-run. Then sanity-load every file:

```bash
node -e '
const fk = require("/Users/geraldkogon/tis-study/node_modules/.pnpm/node_modules/fontkit");
const fs = require("fs"), p = require("path");
for (const fam of fs.readdirSync("data/fonts")) { if (!fs.statSync(p.join("data/fonts", fam)).isDirectory()) continue;
  for (const f of fs.readdirSync(p.join("data/fonts", fam))) if (f.endsWith(".ttf")) { const font = fk.openSync(p.join("data/fonts", fam, f)); console.log(fam, f, font.familyName, font.subfamilyName, font.numGlyphs); } }'
```

Expected: one line per file with a family name and glyph count > 200 (if the fontkit path differs, `find /Users/geraldkogon/tis-study/node_modules/.pnpm -maxdepth 3 -name fontkit -type d | head -1`).

- [ ] **Step 4: Append the failing font checks to the unit script**

Append to `scripts/verify-theme-units.mjs` before the final `if (fails)` block:

```js
// ─── fonts.ts ────────────────────────────────────────────────────────────────
const fonts = await import(path.resolve(here, "../src/lib/report-theme/fonts.ts"));
const { parsePostScriptName, matchFamily, fontPath } = fonts;
import { existsSync } from "node:fs";

eq(parsePostScriptName("ABCDEF+Calibri-Bold"), { family: "Calibri", bold: true, italic: false }, "subset prefix + Bold");
eq(parsePostScriptName("TimesNewRomanPSMT"), { family: "Times New Roman", bold: false, italic: false }, "PSMT suffix + camel split");
eq(parsePostScriptName("ArialMT"), { family: "Arial", bold: false, italic: false }, "MT suffix");
eq(parsePostScriptName("Arial,BoldItalic"), { family: "Arial", bold: true, italic: true }, "comma style");
eq(parsePostScriptName("Helvetica-BoldOblique"), { family: "Helvetica", bold: true, italic: true }, "Oblique = italic");
eq(parsePostScriptName("OpenSans-SemiBold"), { family: "Open Sans", bold: true, italic: false }, "SemiBold counts as bold");
eq(parsePostScriptName("SegoeUI"), { family: "Segoe UI", bold: false, italic: false }, "SegoeUI split");
eq(parsePostScriptName("Cambria"), { family: "Cambria", bold: false, italic: false }, "plain name");
eq(matchFamily("Calibri"), { family: "carlito", exact: false }, "Calibri → Carlito");
eq(matchFamily("Times New Roman"), { family: "liberation-serif", exact: false }, "Times → Liberation Serif");
eq(matchFamily("Arial"), { family: "liberation-sans", exact: false }, "Arial → Liberation Sans");
eq(matchFamily("Open Sans"), { family: "open-sans", exact: true }, "Open Sans exact");
eq(matchFamily("Source Sans Pro"), { family: "source-sans-3", exact: true }, "Source Sans Pro → 3");
eq(matchFamily("Segoe UI"), { family: "open-sans", exact: false }, "Segoe UI → Open Sans");
eq(matchFamily("Garamond", { serif: true }), { family: "liberation-serif", exact: false }, "unknown serif → Liberation Serif");
eq(matchFamily("Futura"), { family: "liberation-sans", exact: false }, "unknown sans → Liberation Sans");
eq(matchFamily("Consolas", { mono: true }), { family: "liberation-mono", exact: false }, "unknown mono → Liberation Mono");
eq(matchFamily("DejaVu Sans"), { family: "dejavu-sans", exact: true }, "DejaVu exact");
for (const fam of ["carlito", "liberation-serif", "open-sans"]) for (const st of ["regular", "bold", "italic", "bolditalic"]) ok(existsSync(fontPath(fam, st)), `fontPath(${fam}, ${st}) exists`);
ok(fontPath("dejavu-sans", "bold").endsWith("DejaVuSans-Bold.ttf"), "DejaVu bold maps to the existing file");
ok(fontPath("dejavu-sans", "italic").endsWith("DejaVuSans.ttf"), "DejaVu has no italic → regular");
```

Run `node ./scripts/verify-theme-units.mjs` — expected: module not found for `fonts.ts`.

- [ ] **Step 5: Write `fonts.ts`**

Create `src/lib/report-theme/fonts.ts`:

```ts
/**
 * Bundled substitute fonts + PostScript-name matching.
 *
 * A firm's PDF names its fonts ("ABCDEF+Calibri-Bold"); we can't reuse the
 * embedded subset (it only holds the sample's glyphs), so the family is
 * matched to a metric-compatible open font we ship under data/fonts/<family>/.
 * `exact` is false when a substitute stands in — the settings page says so.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDefaultTheme, type BundledFamily, type Theme } from "./theme";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same dual-path resolution as pdf-export.ts (src/lib vs dist).
export const FONT_DIR = (() => {
  for (const c of [
    path.resolve(__dirname, "../../../data/fonts"),
    path.resolve(__dirname, "../../data/fonts"),
    path.resolve(__dirname, "../data/fonts"),
  ]) {
    if (existsSync(path.join(c, "DejaVuSans.ttf"))) return c;
  }
  return path.resolve(__dirname, "../../../data/fonts");
})();

export type FontStyle = "regular" | "bold" | "italic" | "bolditalic";
const FILE: Record<FontStyle, string> = { regular: "Regular.ttf", bold: "Bold.ttf", italic: "Italic.ttf", bolditalic: "BoldItalic.ttf" };

export function fontPath(family: BundledFamily, style: FontStyle): string {
  if (family === "dejavu-sans") {
    return path.join(FONT_DIR, style === "bold" || style === "bolditalic" ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf");
  }
  const p = path.join(FONT_DIR, family, FILE[style]);
  if (existsSync(p)) return p;
  const regular = path.join(FONT_DIR, family, FILE.regular);
  return existsSync(regular) ? regular : path.join(FONT_DIR, "DejaVuSans.ttf");
}

const STYLE_WORDS = /(bold|black|heavy|semibold|demibold|extrabold|ultrabold|italic|oblique|regular|roman|book|medium|light|thin|condensed)/gi;

export function parsePostScriptName(name: string): { family: string; bold: boolean; italic: boolean } {
  const n = name.replace(/^[A-Z]{6}\+/, "");
  const lower = n.toLowerCase();
  const bold = /bold|black|heavy|semibold|demibold|extrabold|ultrabold/.test(lower);
  const italic = /italic|oblique/.test(lower);
  let family = n
    .replace(/[-,_ ]?(?:bold|black|heavy|semibold|demibold|extrabold|ultrabold|italic|oblique|regular|roman|book|medium|light|thin|condensed)+/gi, "")
    .replace(/(PSMT|PS|MT)$/, "")
    .replace(/[-,_]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!family) family = n.replace(STYLE_WORDS, "").trim() || n;
  return { family, bold, italic };
}

const ALIASES: Array<{ re: RegExp; family: BundledFamily; exact: boolean }> = [
  { re: /^(arial|helvetica|arimo)$/i, family: "liberation-sans", exact: false },
  { re: /^liberation sans$/i, family: "liberation-sans", exact: true },
  { re: /^(times new roman|times|tinos)$/i, family: "liberation-serif", exact: false },
  { re: /^liberation serif$/i, family: "liberation-serif", exact: true },
  { re: /^(courier new|courier|cousine)$/i, family: "liberation-mono", exact: false },
  { re: /^liberation mono$/i, family: "liberation-mono", exact: true },
  { re: /^calibri$/i, family: "carlito", exact: false },
  { re: /^carlito$/i, family: "carlito", exact: true },
  { re: /^cambria$/i, family: "caladea", exact: false },
  { re: /^caladea$/i, family: "caladea", exact: true },
  { re: /^georgia$/i, family: "gelasio", exact: false },
  { re: /^gelasio$/i, family: "gelasio", exact: true },
  { re: /^segoe ui$/i, family: "open-sans", exact: false },
  { re: /^open sans$/i, family: "open-sans", exact: true },
  { re: /^roboto$/i, family: "roboto", exact: true },
  { re: /^lato$/i, family: "lato", exact: true },
  { re: /^montserrat$/i, family: "montserrat", exact: true },
  { re: /^source sans( pro| 3)?$/i, family: "source-sans-3", exact: true },
  { re: /^dejavu sans$/i, family: "dejavu-sans", exact: true },
  { re: /^(verdana|tahoma)$/i, family: "dejavu-sans", exact: false },
];

export function matchFamily(psFamily: string, hints: { serif?: boolean; mono?: boolean } = {}): { family: BundledFamily; exact: boolean } {
  const f = psFamily.trim();
  for (const a of ALIASES) if (a.re.test(f)) return { family: a.family, exact: a.exact };
  if (hints.mono) return { family: "liberation-mono", exact: false };
  if (hints.serif) return { family: "liberation-serif", exact: false };
  return { family: "liberation-sans", exact: false };
}

/**
 * Register the seven logical font names the renderers use. With the default
 * theme this registers exactly the DejaVu files pdf-export.ts registered
 * before (byte identity); the extra names are only embedded if used.
 */
export function registerThemeFonts(doc: PDFKit.PDFDocument, theme: Theme): void {
  const mono = path.join(FONT_DIR, "DejaVuSansMono.ttf");
  if (isDefaultTheme(theme)) {
    doc.registerFont("body", fontPath("dejavu-sans", "regular"));
    doc.registerFont("bold", fontPath("dejavu-sans", "bold"));
    doc.registerFont("mono", mono);
    doc.registerFont("italic", fontPath("dejavu-sans", "regular"));
    doc.registerFont("bolditalic", fontPath("dejavu-sans", "bold"));
    doc.registerFont("heading", fontPath("dejavu-sans", "regular"));
    doc.registerFont("headingbold", fontPath("dejavu-sans", "bold"));
    return;
  }
  const b = theme.fonts.body.family;
  const h = theme.fonts.heading.family;
  doc.registerFont("body", fontPath(b, "regular"));
  doc.registerFont("bold", fontPath(b, "bold"));
  doc.registerFont("italic", fontPath(b, "italic"));
  doc.registerFont("bolditalic", fontPath(b, "bolditalic"));
  doc.registerFont("heading", fontPath(h, "regular"));
  doc.registerFont("headingbold", fontPath(h, "bold"));
  const lm = fontPath("liberation-mono", "regular");
  doc.registerFont("mono", existsSync(lm) ? lm : mono);
}
```

- [ ] **Step 6: Run the checks**

```bash
node ./scripts/verify-theme-units.mjs && pnpm --filter @workspace/tis-api-server run typecheck
```

Expected: `ALL PASS`. If a `parsePostScriptName` expectation fails, adjust the regexes in `fonts.ts`, not the expectations.

- [ ] **Step 7: Commit (fonts included)**

```bash
git add artifacts/tis-api-server/data/fonts artifacts/tis-api-server/scripts/fonts-manifest.json artifacts/tis-api-server/scripts/fetch-fonts.mjs artifacts/tis-api-server/src/lib/report-theme/fonts.ts artifacts/tis-api-server/scripts/verify-theme-units.mjs
git commit -m "feat(theme): bundle OFL substitute fonts and match PostScript names

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Preview fixtures and the byte-identity guard (pin BEFORE touching renderers)

**Files:**
- Create: `scripts/build-preview-fixtures.mjs`, `data/preview-fixtures/{fl,ga,tx,ny,nc,sc}.json`
- Create: `scripts/lib/bundle-renderer.mjs`, `scripts/lib/pdf-norm.mjs`, `scripts/lib/fixture-project.mjs`
- Create: `scripts/verify-theme-default-identity.mjs`, `scripts/fixtures/theme-identity-baseline.json`
- Modify: `package.json` (scripts), root `.gitignore`

**Interfaces:**
- Produces: `loadRendererBundle(): Promise<{ mod, cleanup }>` (mod exports `renderStudyPdf`, and from Task 4 on also `DEFAULT_THEME`, `withTheme`, `parseStoredTheme`), `normalizePdf(buf): string`, `pdfHash(buf): string`, `projectFromFixture(fixture, key): StoredProject-shaped object`, `loadFixture(family): fixture`.
- Fixture shape: `{ family: "fl"|"ga"|"tx"|"ny"|"nc"|"sc", key: string, projectName: string, latitude: number, longitude: number, landUseCode: string, report: <resultPayload with .request> }`.

- [ ] **Step 1: Write the fixture builder**

Create `scripts/build-preview-fixtures.mjs`:

```js
// Copies the sample masters (gitignored, private/) into committed preview
// fixtures, one per regional renderer family. Re-run only when a master is
// regenerated. Run: node ./scripts/build-preview-fixtures.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MASTERS = "/Users/geraldkogon/tis-study/private/county-samples-tampa";
const OUT = path.resolve(here, "../data/preview-fixtures");
const MAP = { fl: "master-broward.json", ga: "master-bartow.json", tx: "master-bexar.json", ny: "master-nassau.json", nc: "master-wake.json", sc: "master-richland.json" };
mkdirSync(OUT, { recursive: true });
for (const [family, file] of Object.entries(MAP)) {
  const m = JSON.parse(readFileSync(path.join(MASTERS, file), "utf8"));
  const report = m.report ?? m;
  const fx = { family, key: file.replace(/^master-|\.json$/g, ""), projectName: m.projectName, latitude: m.latitude, longitude: m.longitude, landUseCode: String(m.landUseCode ?? ""), report };
  writeFileSync(path.join(OUT, `${family}.json`), JSON.stringify(fx));
  console.log(family, file, `${Math.round(JSON.stringify(fx).length / 1024)} KB`);
}
```

Run: `node ./scripts/build-preview-fixtures.mjs` — expected six lines, each 100–200 KB.

- [ ] **Step 2: Write the shared script helpers**

Create `scripts/lib/pdf-norm.mjs`:

```js
import { createHash } from "node:crypto";
/** PDFKit stamps the wall clock into CreationDate and derives /ID from it — mask both (same length, so xref offsets are unchanged). */
export function normalizePdf(buf) {
  return buf.toString("latin1")
    .replace(/\/CreationDate \([^)]*\)/g, "/CreationDate (XXXXXXXXXXXXXXXXXX)")
    .replace(/\/ID \[<[0-9a-fA-F]+> <[0-9a-fA-F]+>\]/g, "/ID [<X> <X>]");
}
export function pdfHash(buf) { return createHash("sha256").update(normalizePdf(buf)).digest("hex"); }
export function pdfPageCount(buf) {
  const counts = [...buf.toString("latin1").matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}
```

Create `scripts/lib/fixture-project.mjs`:

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_FAMILIES = ["fl", "ga", "tx", "ny", "nc", "sc"];
export function loadFixture(family) {
  return JSON.parse(readFileSync(path.resolve(here, "../../data/preview-fixtures", `${family}.json`), "utf8"));
}
/** StoredProject-shaped record with a FIXED createdAt so renders are reproducible. */
export function projectFromFixture(fx) {
  return {
    id: `preview-${fx.key}`, studyType: "tis", projectName: fx.projectName, landUseCode: fx.landUseCode,
    siteLat: String(fx.latitude), siteLon: String(fx.longitude), version: 1,
    createdAt: new Date("2026-01-15T12:00:00Z"), requestPayload: fx.report.request, resultPayload: fx.report,
  };
}
```

Create `scripts/lib/bundle-renderer.mjs` (same approach as `verify-driveway-routing.mjs`; pdf-export.ts cannot be imported under the ts-loader because of a `.js`-suffixed import):

```js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, unlink } from "node:fs/promises";
import { build as esbuild } from "../../node_modules/esbuild/lib/main.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.resolve(here, "../../src/lib");

/**
 * Bundle pdf-export.ts (+ report-theme) into a temp ESM file inside src/lib so
 * relative data paths resolve, import it, and return the module. Call
 * `cleanup()` when done. Extra exports: pass source lines like
 * `export { foo } from "./report-theme/foo";`.
 */
export async function loadRendererBundle(extraExports = "") {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://localhost/tis_check_stub_db";
  const entry = path.join(lib, `.theme-bundle-entry-${process.pid}.ts`);
  const out = path.join(lib, `.theme-bundle-${process.pid}.mjs`);
  await writeFile(entry, `export { renderStudyPdf } from "./pdf-export";\n${extraExports}\n`, "utf8");
  await esbuild({
    entryPoints: [entry], platform: "node", bundle: true, format: "esm", outfile: out, logLevel: "error",
    external: ["*.node", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino", "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis", "pdfjs-dist"],
    banner: { js: `import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);` },
  });
  const mod = await import(out);
  const cleanup = async () => { await unlink(entry).catch(() => {}); await unlink(out).catch(() => {}); };
  return { mod, cleanup };
}
```

Add to the root `.gitignore`:

```
# esbuild temp bundles written by the theme check scripts
artifacts/tis-api-server/src/lib/.theme-bundle-*
```

- [ ] **Step 3: Write the identity guard**

Create `scripts/verify-theme-default-identity.mjs`:

```js
// Byte-identity guard: with no firm theme, renderStudyPdf must produce exactly
// the bytes it produced before the theme layer existed (after masking PDFKit's
// clock-derived CreationDate/ID). Fixtures are the three whose regional
// renderer does no network enrichment (TX, NC, SC) so the hash is stable
// offline. `--pin` re-baselines (only when a deliberate render change lands).
// Run: node ./scripts/verify-theme-default-identity.mjs [--pin]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pdfHash } from "./lib/pdf-norm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.resolve(here, "fixtures/theme-identity-baseline.json");
const FAMILIES = ["tx", "nc", "sc"];
const pin = process.argv.includes("--pin");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const { mod, cleanup } = await loadRendererBundle();
try {
  const firm = { name: "Identity Check Firm", logoUrl: null };
  const hashes = {};
  for (const fam of FAMILIES) {
    const project = projectFromFixture(loadFixture(fam));
    const a = pdfHash(await mod.renderStudyPdf(project, firm));
    const b = pdfHash(await mod.renderStudyPdf(project, firm));
    ok(a === b, `${fam}: two renders are identical (deterministic)`);
    hashes[fam] = a;
  }
  if (pin) {
    writeFileSync(BASELINE, JSON.stringify(hashes, null, 2) + "\n");
    console.log(`pinned ${BASELINE}`);
  } else {
    ok(existsSync(BASELINE), "baseline file exists (run with --pin once)");
    const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
    for (const fam of FAMILIES) ok(hashes[fam] === base[fam], `${fam}: matches pinned baseline`);
  }
} finally { await cleanup(); }
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
```

- [ ] **Step 4: Pin the baseline on the untouched renderers, then verify**

```bash
node ./scripts/verify-theme-default-identity.mjs --pin && node ./scripts/verify-theme-default-identity.mjs
```

Expected: three `deterministic` PASS lines both times; the second run shows three `matches pinned baseline` PASS lines and `ALL PASS`. (First run bundles in ~1 s and renders in < 1 s per fixture.)

- [ ] **Step 5: Wire scripts and commit**

Add to `package.json` scripts:
```
"check:theme-default-identity": "node ./scripts/verify-theme-default-identity.mjs",
"build:preview-fixtures": "node ./scripts/build-preview-fixtures.mjs"
```

```bash
git add .gitignore artifacts/tis-api-server/package.json artifacts/tis-api-server/data/preview-fixtures artifacts/tis-api-server/scripts/build-preview-fixtures.mjs artifacts/tis-api-server/scripts/lib artifacts/tis-api-server/scripts/verify-theme-default-identity.mjs artifacts/tis-api-server/scripts/fixtures/theme-identity-baseline.json
git commit -m "chore(theme): preview fixtures and the default-render byte-identity guard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Active-theme state, canonical heading keys, and the themed drawing primitives

**Files:**
- Create: `src/lib/report-theme/active.ts`, `src/lib/report-theme/canonical.ts`, `src/lib/report-theme/draw.ts`
- Modify: `scripts/verify-theme-units.mjs` (append checks)

**Interfaces:**
- Consumes: `Theme`, `TextStyle`, `Numbering`, `DEFAULT_THEME`, `isDefaultTheme(theme)` from `theme.ts`.
- Produces (`active.ts`): `activeTheme(): Theme`, `isDefaultTheme(): boolean` (no-arg, reads active), `pageMargin(): number`, `withTheme<T>(theme, fn: () => T): T`, `takeSynonym(key): string | null` (returns the firm wording the first time a canonical key is asked for during one `withTheme` run, `null` afterwards — prevents two of our headings collapsing onto one sample title).
- Produces (`canonical.ts`): `CANONICAL: Array<{ key: string; re: RegExp }>`, `canonicalKey(text): string | null`, `stripNumbering(text): string`.
- Produces (`draw.ts`): `TokenContext`, `interpolate(text, ctx, page?, pages?)`, `applyStyle(doc, style)`, `splitHeading(title)`, `formatNumber(parts, numbering)`, `applyCase(text, c)`, `formatHeading(title, level, theme, synonymFor)`, `heading(doc, level, title)`, `TableSpec`, `scaleWidths(widths, usable)`, `table(doc, spec)`, `rows(doc, pairs)`, `metricStrip(doc, metrics)`, `pageHeader(doc, ctx, page, pages)`, `pageFooter(doc, ctx, page, pages)`, `CoverInput`, `cover(doc, input)`.

- [ ] **Step 1: Append the failing checks**

Append to `scripts/verify-theme-units.mjs` before the final `if (fails)` block:

```js
// ─── active.ts / canonical.ts / draw.ts ─────────────────────────────────────
const active = await import(path.resolve(here, "../src/lib/report-theme/active.ts"));
const canonical = await import(path.resolve(here, "../src/lib/report-theme/canonical.ts"));
const draw = await import(path.resolve(here, "../src/lib/report-theme/draw.ts"));

eq(active.pageMargin(), 50, "default page margin is 50");
ok(active.isDefaultTheme(), "default theme active at start");
const T = { ...DEFAULT_THEME, id: "firm-x", page: { ...DEFAULT_THEME.page, margins: { top: 72, right: 72, bottom: 72, left: 72 } }, synonyms: { "trip-generation": "Site Trip Generation" } };
const inside = active.withTheme(T, () => [active.pageMargin(), active.isDefaultTheme(), active.takeSynonym("trip-generation"), active.takeSynonym("trip-generation")]);
eq(inside, [72, false, "Site Trip Generation", null], "withTheme sets margin, flags non-default, hands out a synonym once");
ok(active.isDefaultTheme() && active.pageMargin() === 50, "withTheme resets afterwards");
let threw = false; try { active.withTheme(T, () => { throw new Error("boom"); }); } catch { threw = true; }
ok(threw && active.isDefaultTheme(), "withTheme resets on throw");
let asyncRejected = false; try { active.withTheme(T, async () => 1); } catch { asyncRejected = true; }
ok(asyncRejected, "withTheme refuses an async fn");

eq(canonical.canonicalKey("4.0 TRIP GENERATION"), "trip-generation", "canonical: trip generation");
eq(canonical.canonicalKey("Level of Service Analysis"), "capacity-analysis", "canonical: LOS");
eq(canonical.canonicalKey("Conclusions and Recommendations"), "conclusions", "canonical: conclusions wins over recommendations");
eq(canonical.canonicalKey("Something Unrelated"), null, "canonical: unknown → null");
eq(canonical.stripNumbering("3.1 Gross Trip Generation"), "Gross Trip Generation", "stripNumbering dotted");
eq(canonical.stripNumbering("Section 2 – Existing Conditions"), "Existing Conditions", "stripNumbering Section N –");

eq(draw.splitHeading("3.0 STUDY NETWORK"), { parts: [3], text: "STUDY NETWORK" }, "3.0 is a level-1 number");
eq(draw.splitHeading("3.1 Gross Trip Generation"), { parts: [3, 1], text: "Gross Trip Generation" }, "3.1 split");
eq(draw.splitHeading("EXECUTIVE SUMMARY"), { parts: [], text: "EXECUTIVE SUMMARY" }, "no number");
eq(draw.formatNumber([3], "1.0"), "3.0", "1.0 style");
eq(draw.formatNumber([3, 1], "1.0"), "3.1", "1.0 style level 2");
eq(draw.formatNumber([3], "1."), "3.", "1. style");
eq(draw.formatNumber([3, 1], "1."), "3.1", "1. style level 2");
eq(draw.formatNumber([3], "1"), "3", "bare style");
eq(draw.formatNumber([3], "section"), "Section 3", "section style");
eq(draw.formatNumber([2], "letter"), "B.", "letter style");
eq(draw.formatNumber([3], "none"), "", "none drops");
eq(draw.applyCase("STUDY NETWORK", "title"), "Study Network", "title case");
eq(draw.applyCase("trip distribution and assignment", "title"), "Trip Distribution and Assignment", "title case keeps small words");
eq(draw.applyCase("Study Network", "upper"), "STUDY NETWORK", "upper");
const T2 = { ...DEFAULT_THEME, headings: [{ ...DEFAULT_THEME.headings[0], case: "title", numbering: "1." }, { ...DEFAULT_THEME.headings[1], case: "asis", numbering: "1." }, DEFAULT_THEME.headings[2]] };
eq(draw.formatHeading("4.0 TRIP GENERATION", 1, T2, (k) => (k === "trip-generation" ? "Site Trip Generation" : null)), "4.  Site Trip Generation", "formatHeading: number restyled, firm wording, title case");
eq(draw.formatHeading("4.0 TRIP GENERATION", 1, T2, () => null), "4.  Trip Generation", "formatHeading without synonym");
eq(draw.formatHeading("EXECUTIVE SUMMARY", 1, { ...T2, headings: [{ ...T2.headings[0], numbering: "none" }, T2.headings[1], T2.headings[2]] }, () => null), "Executive Summary", "unnumbered heading");
eq(draw.scaleWidths([200, 200, 200], 468), [156, 156, 156], "scaleWidths shrinks proportionally");
eq(draw.scaleWidths([100, 100], 468), [100, 100], "scaleWidths leaves fitting widths alone");
eq(draw.interpolate("{{firm.name}} · {{documentType}} · Page {{page}} of {{pages}}", { firmName: "Acme", projectName: "P", address: "", dateLabel: "", documentType: "Traffic Impact Study", client: "" }, 3, 12), "Acme · Traffic Impact Study · Page 3 of 12", "interpolate tokens");

// Render a small themed PDF uncompressed and look for the font + colour ops.
import PDFDocument from "pdfkit";
const RED = { ...DEFAULT_THEME, id: "firm-red", fonts: { body: { family: "carlito", requested: "Calibri", exact: false }, heading: { family: "liberation-serif", requested: "Times New Roman", exact: false } }, headings: [{ ...DEFAULT_THEME.headings[0], style: { font: "heading", size: 16, color: "#c0392b", bold: true }, rule: { color: "#c0392b", width: 1, gap: 2 } }, DEFAULT_THEME.headings[1], DEFAULT_THEME.headings[2]], table: { ...DEFAULT_THEME.table, header: { fill: "#1f3a5f", color: "#ffffff", bold: true, size: 9 }, rules: { color: "#1f3a5f", width: 0.75, mode: "grid" } }, footer: { segments: [{ align: "center", text: "Page {{page}} of {{pages}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: null, height: 30 } };
const pdfBytes = await new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 50, bottom: 50, left: 50, right: 50 }, compress: false, bufferPages: true });
  fonts.registerThemeFonts(doc, RED);
  const chunks = []; doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
  active.withTheme(RED, () => {
    draw.heading(doc, 1, "1.0 INTRODUCTION");
    draw.table(doc, { headers: ["A", "B"], widths: [300, 300], rows: [["1", "2"], ["3", "4"]] });
    draw.rows(doc, [["Label", "Value"]]);
    draw.metricStrip(doc, [{ label: "trips", value: "1,234" }]);
    draw.pageFooter(doc, { firmName: "F", projectName: "P", address: "", dateLabel: "", documentType: "D", client: "" }, 1, 1);
    doc.end();
  });
});
const pdfText = pdfBytes.toString("latin1");
const rg = (hex) => [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1e6) / 1e6).join(" ");
ok(/\/BaseFont \/[A-Z]{6}\+LiberationSerif-Bold/.test(pdfText), "heading embeds Liberation Serif Bold");
ok(/\/BaseFont \/[A-Z]{6}\+Carlito/.test(pdfText), "body embeds Carlito");
ok(pdfText.includes(`${rg("#c0392b")} rg`), "heading colour op present");
ok(pdfText.includes(`${rg("#1f3a5f")} rg`), "table header fill op present");
ok(pdfText.includes(`${rg("#1f3a5f")} RG`), "grid rule stroke op present");
ok(pdfText.includes("Page 1 of 1"), "footer interpolated");
```

Run `node ./scripts/verify-theme-units.mjs` — expected: module not found for `active.ts`.

- [ ] **Step 2: Write `active.ts`**

```ts
/**
 * The theme in force for the current synchronous draw pass.
 *
 * Module-level on purpose (the same pattern as `velocityPaletteActive` in
 * pdf-export.ts): the regional renderers call shared primitives from
 * hundreds of sites, and threading a parameter through them all is not
 * worth it. Safe because `withTheme` only wraps synchronous code — an
 * `await` inside it would let a concurrent request read the wrong theme,
 * which is why `withTheme` refuses a function that returns a Promise.
 */
import { DEFAULT_THEME, isDefaultTheme as isDefault, type Theme } from "./theme";

let active: Theme = DEFAULT_THEME;
let usedSynonyms = new Set<string>();

export function activeTheme(): Theme {
  return active;
}
export function isDefaultTheme(): boolean {
  return isDefault(active);
}
/** Left (= right) page margin of the active theme; 50 for the default. */
export function pageMargin(): number {
  return active.page.margins.left;
}
/**
 * The firm's wording for a canonical heading key, handed out once per draw
 * pass so two of our headings that map to the same key (e.g. FINDINGS and
 * CONCLUSIONS) cannot both become the sample's "Conclusions".
 */
export function takeSynonym(key: string): string | null {
  const w = active.synonyms[key];
  if (!w || usedSynonyms.has(key)) return null;
  usedSynonyms.add(key);
  return w;
}
export function withTheme<T>(theme: Theme, fn: () => T): T {
  const prevTheme = active;
  const prevUsed = usedSynonyms;
  active = theme;
  usedSynonyms = new Set();
  try {
    const out = fn();
    if (out instanceof Promise) throw new Error("withTheme(fn): fn must be synchronous — the active theme is module state");
    return out;
  } finally {
    active = prevTheme;
    usedSynonyms = prevUsed;
  }
}
```

- [ ] **Step 3: Write `canonical.ts`**

```ts
/**
 * Canonical heading keys. The extractor maps the sample's H1/H2 titles onto
 * these (derive/synonyms.ts) and draw.ts maps OUR titles onto them at render
 * time, so a firm's wording replaces ours where the two correspond.
 * Order matters: first match wins ("Conclusions and Recommendations" →
 * conclusions).
 */
export const CANONICAL: Array<{ key: string; re: RegExp }> = [
  { key: "executive-summary", re: /executive summary|summary of findings/i },
  { key: "introduction", re: /\bintroduction\b|\bpurpose\b|project description|proposed (development|project)|background/i },
  { key: "site-description", re: /site (description|plan|location)|project site|location description|land use/i },
  { key: "study-area", re: /study (area|network|intersections)|scope of (the )?study/i },
  { key: "existing-conditions", re: /existing (conditions|traffic|roadway|facilities|volumes|network)/i },
  { key: "methodology", re: /methodolog|analysis (approach|assumptions)|\bassumptions\b/i },
  { key: "background-growth", re: /background (traffic|growth)|growth rate|no[- ]build/i },
  { key: "trip-generation", re: /trip generation|site trips|trip gen\b/i },
  { key: "trip-distribution", re: /trip distribution|distribution and assignment/i },
  { key: "trip-assignment", re: /trip assignment|traffic assignment/i },
  { key: "future-conditions", re: /future (conditions|traffic|volumes)|build conditions|opening year|horizon year|design year/i },
  { key: "capacity-analysis", re: /capacity analys|level of service|\blos\b|intersection (analysis|operations)|operational analysis|traffic (analysis|operations)/i },
  { key: "queuing", re: /queu/i },
  { key: "warrants", re: /warrant/i },
  { key: "access", re: /site access|access (management|analysis)|driveway|ingress|egress|circulation/i },
  { key: "safety", re: /crash|safety|collision/i },
  { key: "multimodal", re: /pedestrian|bicycle|transit|multimodal/i },
  { key: "programmed-projects", re: /programmed|planned (roadway|improvements)|committed (projects|improvements)/i },
  { key: "mitigation", re: /mitigation|recommended improvements|\bimprovements\b/i },
  { key: "conclusions", re: /conclusion|findings/i },
  { key: "recommendations", re: /recommendation/i },
  { key: "certification", re: /certification|seal|signature/i },
  { key: "appendix", re: /appendi/i },
];

/** "3.1 Title", "Section 2 – Title", "B. Title" → "Title". */
export function stripNumbering(text: string): string {
  return text
    .replace(/^\s*section\s+\d+\s*[-–—:.]?\s*/i, "")
    .replace(/^\s*(?:\d+(?:\.\d+)*\.?|[A-Z]\.)\s+/, "")
    .trim();
}

export function canonicalKey(text: string): string | null {
  const t = stripNumbering(text);
  for (const c of CANONICAL) if (c.re.test(t)) return c.key;
  return null;
}
```

- [ ] **Step 4: Write `draw.ts`**

```ts
/**
 * Themed drawing primitives. The regional renderers' own helpers
 * (`section`, `gaSection`, `table`, `rows`, `metricStrip`, `drawHeader`,
 * `drawPageFooter`, `drawCover` …) delegate here whenever a non-default theme
 * is active; with the default theme they keep their original code paths so
 * output stays byte-identical.
 */
import { activeTheme, takeSynonym } from "./active";
import { canonicalKey } from "./canonical";
import type { Numbering, TextStyle, Theme } from "./theme";

export type TokenContext = {
  firmName: string;
  projectName: string;
  address: string;
  dateLabel: string;
  documentType: string;
  client: string;
};

export function interpolate(text: string, ctx: TokenContext, page = 0, pages = 0): string {
  const map: Record<string, string> = {
    "firm.name": ctx.firmName,
    "project.projectName": ctx.projectName,
    "project.address": ctx.address,
    "project.dateLabel": ctx.dateLabel,
    "project.client": ctx.client,
    documentType: ctx.documentType,
    page: page ? String(page) : "",
    pages: pages ? String(pages) : "",
  };
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => map[k] ?? "");
}

function fontName(style: TextStyle): string {
  if (style.font === "heading") return style.bold ? "headingbold" : "heading";
  if (style.bold && style.italic) return "bolditalic";
  if (style.bold) return "bold";
  if (style.italic) return "italic";
  return "body";
}
export function applyStyle(doc: PDFKit.PDFDocument, style: TextStyle): void {
  doc.font(fontName(style)).fontSize(style.size).fillColor(style.color);
}
const usable = (doc: PDFKit.PDFDocument) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc: PDFKit.PDFDocument) => doc.page.height - doc.page.margins.bottom;

// ─── Headings ────────────────────────────────────────────────────────────────

export function splitHeading(title: string): { parts: number[]; text: string } {
  const m = /^\s*(\d+(?:\.\d+)*)\.?\s+(.+)$/.exec(title);
  if (!m) return { parts: [], text: title.trim() };
  let parts = m[1].split(".").map(Number);
  if (parts.length === 2 && parts[1] === 0) parts = [parts[0]]; // "3.0" numbers a level-1 heading
  return { parts, text: m[2].trim() };
}

export function formatNumber(parts: number[], numbering: Numbering): string {
  if (!parts.length || numbering === "none") return "";
  const dotted = parts.join(".");
  switch (numbering) {
    case "1.0": return parts.length === 1 ? `${parts[0]}.0` : dotted;
    case "1.": return parts.length === 1 ? `${parts[0]}.` : dotted;
    case "1": return dotted;
    case "section": return parts.length === 1 ? `Section ${parts[0]}` : dotted;
    case "letter": {
      const L = String.fromCharCode(64 + Math.min(26, Math.max(1, parts[0])));
      return parts.length === 1 ? `${L}.` : [L, ...parts.slice(1)].join(".");
    }
  }
}

const SMALL_WORDS = new Set(["and", "or", "of", "for", "the", "to", "a", "an", "in", "on", "at", "by", "with"]);
export function applyCase(text: string, c: "upper" | "title" | "asis"): string {
  if (c === "upper") return text.toUpperCase();
  if (c === "title") {
    return text
      .toLowerCase()
      .split(/\s+/)
      .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }
  return text;
}

/** Re-express one of our heading titles in the theme's numbering, case and wording. */
export function formatHeading(title: string, level: 1 | 2 | 3, theme: Theme, synonymFor: (key: string) => string | null): string {
  const { parts, text } = splitHeading(title);
  const h = theme.headings[level - 1];
  const key = canonicalKey(text);
  const wording = (key && synonymFor(key)) || text;
  const num = formatNumber(parts, h.numbering);
  const sep = h.numbering === "section" && parts.length === 1 ? " – " : "  ";
  return (num ? num + sep : "") + applyCase(wording, h.case);
}

export function heading(doc: PDFKit.PDFDocument, level: 1 | 2 | 3, title: string): void {
  const t = activeTheme();
  const h = t.headings[level - 1];
  const label = formatHeading(title, level, t, takeSynonym);
  const x = doc.page.margins.left;
  const w = usable(doc);
  applyStyle(doc, h.style);
  const textH = doc.heightOfString(label, { width: w });
  const need = h.spaceBefore + textH + (h.band ? h.band.padY * 2 : 0) + (h.rule ? h.rule.gap + h.rule.width : 0) + h.spaceAfter + 24;
  if (doc.y + need > bottomLimit(doc)) doc.addPage();
  doc.y += h.spaceBefore;
  doc.x = x;
  if (h.band) {
    doc.save().rect(x, doc.y, w, textH + h.band.padY * 2).fill(h.band.color).restore();
    const ty = doc.y + h.band.padY;
    applyStyle(doc, h.style);
    doc.text(label, x + h.band.padX, ty, { width: w - h.band.padX * 2 });
    doc.y = ty + textH + h.band.padY;
  } else {
    doc.text(label, x, doc.y, { width: w });
  }
  if (h.rule) {
    const ry = doc.y + h.rule.gap;
    doc.save().strokeColor(h.rule.color).lineWidth(h.rule.width).moveTo(x, ry).lineTo(x + w, ry).stroke().restore();
    doc.y = ry + h.rule.width;
  }
  doc.y += h.spaceAfter;
  doc.x = x;
  doc.fillColor(t.text.body.color);
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export type TableSpec = {
  headers: string[];
  widths: number[];
  align?: Array<"left" | "right" | "center">;
  rows: string[][];
};

/** Renderers hard-code widths for a 512 pt usable width; shrink when the theme's margins leave less. */
export function scaleWidths(widths: number[], usableW: number): number[] {
  const sum = widths.reduce((s, w) => s + w, 0);
  if (sum <= usableW || sum === 0) return widths;
  const k = usableW / sum;
  return widths.map((w) => Math.floor(w * k * 100) / 100);
}

export function table(doc: PDFKit.PDFDocument, spec: TableSpec): void {
  const t = activeTheme();
  const tb = t.table;
  const startX = doc.page.margins.left;
  const widths = scaleWidths(spec.widths, usable(doc));
  const totalW = widths.reduce((s, w) => s + w, 0);
  const align = spec.align ?? spec.headers.map(() => "left" as const);
  const headerStyle: TextStyle = { font: "body", size: tb.header.size, color: tb.header.color, bold: tb.header.bold };
  const bodyStyle: TextStyle = { font: "body", size: tb.body.size, color: tb.body.color };
  const measure = (cells: string[], isHeader: boolean): number => {
    applyStyle(doc, isHeader ? headerStyle : bodyStyle);
    let h = 0;
    cells.forEach((c, i) => {
      const hh = doc.heightOfString(c ?? "", { width: (widths[i] ?? 60) - tb.padX * 2, align: align[i] ?? "left" });
      if (hh > h) h = hh;
    });
    return Math.max(tb.body.size + 4, h) + tb.padY * 2;
  };
  const hrule = (y: number) => {
    if (tb.rules.mode === "none") return;
    doc.save().strokeColor(tb.rules.color).lineWidth(tb.rules.width).moveTo(startX, y).lineTo(startX + totalW, y).stroke().restore();
  };
  const vrules = (y: number, h: number) => {
    if (tb.rules.mode !== "grid") return;
    doc.save().strokeColor(tb.rules.color).lineWidth(tb.rules.width);
    let x = startX;
    for (const w of [...widths, 0]) {
      doc.moveTo(x, y).lineTo(x, y + h).stroke();
      x += w;
    }
    doc.restore();
  };
  const drawRow = (cells: string[], y: number, isHeader: boolean, h: number, rowIdx: number) => {
    if (isHeader && tb.header.fill) doc.save().rect(startX, y, totalW, h).fill(tb.header.fill).restore();
    else if (!isHeader && tb.zebra && rowIdx % 2 === 1) doc.save().rect(startX, y, totalW, h).fill(tb.zebra).restore();
    applyStyle(doc, isHeader ? headerStyle : bodyStyle);
    let x = startX;
    cells.forEach((c, i) => {
      doc.text(c ?? "", x + tb.padX, y + tb.padY, { width: (widths[i] ?? 60) - tb.padX * 2, align: align[i] ?? "left" });
      x += widths[i] ?? 60;
    });
    vrules(y, h);
  };
  let y = doc.y;
  const headerH = measure(spec.headers, true);
  const firstRowH = spec.rows.length ? measure(spec.rows[0], false) : 0;
  if (y + headerH + firstRowH > bottomLimit(doc) - 40) {
    doc.addPage();
    y = doc.y;
  }
  hrule(y);
  drawRow(spec.headers, y, true, headerH, -1);
  y += headerH;
  hrule(y);
  spec.rows.forEach((r, idx) => {
    const rh = measure(r, false);
    if (y + rh > bottomLimit(doc) - 40) {
      doc.addPage();
      y = doc.y;
      const hh = measure(spec.headers, true);
      hrule(y);
      drawRow(spec.headers, y, true, hh, -1);
      y += hh;
      hrule(y);
    }
    drawRow(r, y, false, rh, idx);
    y += rh;
    hrule(y);
  });
  doc.y = y + 6;
  doc.x = startX;
  doc.fillColor(t.text.body.color);
}

// ─── Key/value rows and metric strip ────────────────────────────────────────

export function rows(doc: PDFKit.PDFDocument, pairs: Array<[string, string | undefined]>): void {
  const t = activeTheme();
  const startX = doc.page.margins.left;
  const labelW = Math.min(220, usable(doc) * 0.42);
  const valueW = usable(doc) - labelW - 10;
  for (const [label, value] of pairs) {
    const val = value ?? "—";
    applyStyle(doc, t.text.body);
    const rowH = Math.max(doc.heightOfString(label, { width: labelW }), doc.heightOfString(val, { width: valueW }));
    if (doc.y + rowH > bottomLimit(doc)) doc.addPage();
    const y = doc.y;
    doc.fillColor(t.palette.muted).text(label, startX, y, { width: labelW });
    doc.fillColor(t.text.body.color).text(val, startX + labelW + 10, y, { width: valueW });
    doc.y = y + rowH + 1;
  }
  doc.x = startX;
}

export function metricStrip(doc: PDFKit.PDFDocument, metrics: Array<{ label: string; value: string }>): void {
  const t = activeTheme();
  const startX = doc.page.margins.left;
  const cellW = usable(doc) / Math.max(1, metrics.length);
  const h = 50;
  if (doc.y + h + 8 > bottomLimit(doc)) doc.addPage();
  const y = doc.y;
  metrics.forEach((m, i) => {
    const x = startX + i * cellW;
    doc.save().rect(x, y, cellW, h).fillAndStroke(t.table.header.fill ?? "#f9fafb", t.palette.rule).restore();
    doc.font("headingbold");
    let fs = 20;
    while (fs > 9 && doc.fontSize(fs).widthOfString(m.value) > cellW - 14) fs -= 1;
    doc.fontSize(fs).fillColor(t.palette.primary).text(m.value, x, y + 8 + (20 - fs) / 2, { width: cellW, align: "center", lineBreak: false });
    doc.font("body").fontSize(8).fillColor(t.palette.muted).text(m.label.toUpperCase(), x, y + 32, { width: cellW, align: "center", characterSpacing: 1, lineBreak: false });
  });
  doc.fillColor(t.text.body.color);
  doc.x = startX;
  doc.y = y + h + 4;
}

// ─── Running header / footer ─────────────────────────────────────────────────

function drawZone(doc: PDFKit.PDFDocument, zone: NonNullable<Theme["header"]>, ctx: TokenContext, page: number, pages: number, where: "top" | "bottom"): void {
  const x = doc.page.margins.left;
  const w = usable(doc);
  // Stamping outside the body band must not trip PDFKit's end-of-page check
  // (it would append blank pages) — same trick as drawPageFooter in pdf-export.ts.
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  applyStyle(doc, zone.style);
  const lineH = zone.style.size * 1.2;
  const y = where === "top" ? Math.max(6, doc.page.margins.top - zone.height + 2) : doc.page.height - zone.height + 2;
  for (const seg of zone.segments) {
    doc.text(interpolate(seg.text, ctx, page, pages), x, y, { width: w, align: seg.align, lineBreak: false });
  }
  if (zone.rule) {
    const ry = where === "top" ? y + lineH + 2 : y - 3;
    doc.strokeColor(zone.rule.color).lineWidth(zone.rule.width).moveTo(x, ry).lineTo(x + w, ry).stroke();
  }
  doc.restore();
  doc.page.margins.bottom = savedBottom;
}
export function pageHeader(doc: PDFKit.PDFDocument, ctx: TokenContext, page: number, pages: number): void {
  const z = activeTheme().header;
  if (z && z.segments.length) drawZone(doc, z, ctx, page, pages, "top");
}
export function pageFooter(doc: PDFKit.PDFDocument, ctx: TokenContext, page: number, pages: number): void {
  const z = activeTheme().footer;
  if (z && z.segments.length) drawZone(doc, z, ctx, page, pages, "bottom");
}

// ─── Cover ───────────────────────────────────────────────────────────────────

export type CoverInput = TokenContext & { firmLogo: Buffer | null; sitePhoto: Buffer | null };

function dataUrlToBuffer(d: string): Buffer | null {
  const m = /^data:image\/png;base64,(.+)$/i.exec(d);
  return m ? Buffer.from(m[1], "base64") : null;
}
function roleToken(role: Theme["cover"]["elements"][number]["role"]): string {
  switch (role) {
    case "documentType": return "{{documentType}}";
    case "projectName": return "{{project.projectName}}";
    case "dateLabel": return "{{project.dateLabel}}";
    case "preparedFor": return "{{project.client}}";
    case "preparedBy": return "{{firm.name}}";
    case "firmName": return "{{firm.name}}";
  }
}

export function cover(doc: PDFKit.PDFDocument, input: CoverInput): void {
  const t = activeTheme();
  const c = t.cover;
  const W = doc.page.width;
  const H = doc.page.height;
  if (c.background.kind === "image") {
    const b = dataUrlToBuffer(c.background.data);
    if (b) { try { doc.image(b, 0, 0, { width: W, height: H }); } catch { /* white page */ } }
  } else if (c.background.kind === "color") {
    doc.rect(0, 0, W, H).fill(c.background.color);
  }
  for (const band of c.bands) doc.rect(0, band.y0, W, band.y1 - band.y0).fill(band.color);
  // The firm's uploaded logo wins over the one lifted from the sample (spec §7.6).
  const logoBuf = input.firmLogo ?? (c.logo ? dataUrlToBuffer(c.logo.data) : null);
  if (logoBuf) {
    const box = c.logo ?? { x: doc.page.margins.left, y: 40, w: 220, h: 64 };
    try { doc.image(logoBuf, box.x, box.y, { fit: [box.w, box.h] }); } catch { /* ignore */ }
  }
  let lowest = 0;
  let lowestAboveMid = 0;
  let highestBelowMid = H;
  for (const el of c.elements) {
    const value = interpolate(roleToken(el.role), input);
    if (!value) continue;
    const text = el.label ? `${el.label} ${value}` : value;
    applyStyle(doc, el.style);
    const h = doc.heightOfString(text, { width: el.w });
    doc.text(text, el.x, el.y, { width: el.w, align: el.align });
    const bottom = el.y + h;
    if (bottom > lowest) lowest = bottom;
    if (el.y < H / 2 && bottom > lowestAboveMid) lowestAboveMid = bottom;
    if (el.y >= H / 2 && el.y < highestBelowMid) highestBelowMid = el.y;
  }
  if (!c.hasMetaBlock) {
    const x = doc.page.margins.left;
    const w = usable(doc);
    let yy = Math.max(lowest + 36, H - 200);
    applyStyle(doc, t.text.body);
    for (const [k, v] of [["Prepared for", input.client], ["Prepared by", input.firmName], ["Date", input.dateLabel]] as const) {
      if (!v) continue;
      doc.font("bold").text(k, x, yy, { width: 110 });
      doc.font("body").text(v, x + 120, yy, { width: w - 120 });
      yy += t.text.body.size * 1.6;
    }
  }
  if (input.sitePhoto && c.background.kind !== "image") {
    const top = lowestAboveMid + 24;
    const bottom = (c.elements.some((e) => e.y >= H / 2) ? highestBelowMid : c.hasMetaBlock ? H - 60 : H - 220) - 24;
    if (bottom - top >= 220) {
      try {
        doc.save().rect(doc.page.margins.left, top, usable(doc), bottom - top).clip();
        doc.image(input.sitePhoto, doc.page.margins.left, top, { cover: [usable(doc), bottom - top], align: "center", valign: "center" });
        doc.restore();
      } catch { /* no photo */ }
    }
  }
  doc.fillColor(t.text.body.color);
}
```

- [ ] **Step 5: Run the checks**

```bash
node ./scripts/verify-theme-units.mjs && pnpm --filter @workspace/tis-api-server run typecheck
```

Expected: `ALL PASS`. If the `rg` colour assertions fail, print the content stream (`pdfText.match(/\d\.\d+ \d\.\d+ \d\.\d+ rg/g)`) and confirm PDFKit's rounding; adjust the `rg` helper in the check to match PDFKit's `PDFObject.number` (6-decimal rounding), never the primitives.

- [ ] **Step 6: Commit**

```bash
git add artifacts/tis-api-server/src/lib/report-theme/active.ts artifacts/tis-api-server/src/lib/report-theme/canonical.ts artifacts/tis-api-server/src/lib/report-theme/draw.ts artifacts/tis-api-server/scripts/verify-theme-units.mjs
git commit -m "feat(theme): active-theme state and themed drawing primitives

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Thread the theme through `pdf-export.ts`

**Files:**
- Modify: `src/lib/pdf-export.ts` — imports (top), `resolveTemplate` (~line 269), `renderStudyPdf` (lines 320–617), `drawCitationsFooter` (~1042), `caSection`/`caSubsection` (~3003), `gaSection`/`gaSubsection` (~3659), `ldnSection`/`ldnSubsection` (~4933), `section`/`rows`/`table`/`metricStrip` (~9738–9895), every `PAGE_MARGIN` use.
- Modify: `src/lib/report-template/store.ts` (store `StoredTheme` instead of `ReportTemplate`).

**Interfaces:**
- Consumes: `withTheme`, `isDefaultTheme`, `pageMargin` (`active.ts`); `DEFAULT_THEME`, `pageSizePoints`, `parseStoredTheme`, `Theme` (`theme.ts`); `registerThemeFonts` (`fonts.ts`); `themed.*` (`draw.ts`).
- Produces: `resolveTheme(firm: FirmStamp): Theme` (module-private), `loadFirmTheme(firmId): StoredTheme | null`, `saveFirmTheme(firmId, stored)`, `clearFirmTheme(firmId)` in `store.ts`.

- [ ] **Step 1: Rewrite `store.ts` for themes**

Replace the body of `src/lib/report-template/store.ts` so it stores `StoredTheme`:

```ts
/**
 * Per-firm theme store (filesystem mirror of `firms.report_template`).
 * The DB column is authoritative; this exists for DB-less local dev.
 * Point `TEMPLATE_STORE_DIR` at a persistent volume if you rely on it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseStoredTheme, StoredThemeSchema, type StoredTheme } from "../report-theme/theme";

const STORE_DIR = process.env.TEMPLATE_STORE_DIR ?? path.resolve(process.cwd(), "data", "templates");

function fileFor(firmId: string): string {
  const safe = String(firmId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STORE_DIR, `${safe}.json`);
}

export function saveFirmTheme(firmId: string, stored: StoredTheme): void {
  StoredThemeSchema.parse(stored);
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(fileFor(firmId), JSON.stringify(stored), "utf8");
}

export function loadFirmTheme(firmId: string): StoredTheme | null {
  try {
    const f = fileFor(firmId);
    if (!existsSync(f)) return null;
    return parseStoredTheme(JSON.parse(readFileSync(f, "utf8")));
  } catch {
    return null;
  }
}

export function clearFirmTheme(firmId: string): void {
  try { rmSync(fileFor(firmId), { force: true }); } catch { /* best effort */ }
}
```

(`routes/firms.ts` still imports the old names — it is rewritten in Task 16; until then `pnpm typecheck` will report those two imports. To keep the tree green in this task, change the two imports in `routes/firms.ts` to `saveFirmTheme`/`clearFirmTheme` and, in the POST handler, temporarily replace the `ingestTemplateFromPdf(...)`/`saveFirmTemplate(...)` body with `res.status(503).json({ error: "Template import is being upgraded." }); return;` — Task 16 replaces the handler entirely.)

- [ ] **Step 2: Imports and margin accessor**

At the top of `pdf-export.ts` (after the existing `report-template` imports) add:

```ts
import { activeTheme, isDefaultTheme, pageMargin, withTheme } from "./report-theme/active";
import { DEFAULT_THEME, pageSizePoints, parseStoredTheme, type Theme } from "./report-theme/theme";
import { registerThemeFonts } from "./report-theme/fonts";
import * as themed from "./report-theme/draw";
import { loadFirmTheme } from "./report-template/store";
```

Remove `import { loadFirmTemplate } from "./report-template/store";` and, if `validateTemplate` becomes unused after Step 4, its import too.

Delete the line `const PAGE_MARGIN = 50;` (line 123) and replace every remaining use:

```bash
sed -i '' -E 's/\bPAGE_MARGIN\b/pageMargin()/g' src/lib/pdf-export.ts && grep -c "pageMargin()" src/lib/pdf-export.ts
```

Expected: several hundred replacements; `grep -n "const pageMargin()" src/lib/pdf-export.ts` prints nothing.

- [ ] **Step 3: Theme resolution**

Directly above `resolveTemplate`, add:

```ts
/**
 * The firm's imported theme (DB copy first, filesystem mirror second) or the
 * default. A malformed row falls back silently — a PDF the engineer needs
 * today must never 500 because a stored theme went stale.
 */
function resolveTheme(firm: FirmStamp): Theme {
  const fromDb = parseStoredTheme(firm.reportTemplate);
  if (fromDb) return fromDb.theme;
  if (firm.firmId) {
    const fromDisk = loadFirmTheme(firm.firmId);
    if (fromDisk) return fromDisk.theme;
  }
  return DEFAULT_THEME;
}
```

- [ ] **Step 4: Retire V1 template resolution**

In `resolveTemplate`, delete the `if (firm.reportTemplate) { … }` block and the `if (firm.firmId) { const t = loadFirmTemplate(...) … }` block, leaving only the coordinate/region checks and `if (region?.country === "UK") return { template: loadTemplate("velocity-ta"), locale }; return null;`. Update its doc comment: "A firm's imported *theme* is applied by the renderers; the only declarative template is the built-in Velocity TA for UK sites."

- [ ] **Step 5: Document setup in `renderStudyPdf`**

After `if (tplSel) return renderTemplateReport(project, firm, tplSel);` add `const theme = resolveTheme(firm);`. Change the `PDFDocument` construction to:

```ts
  const [pageW, pageH] = pageSizePoints(theme.page);
  const doc = new PDFDocument({
    size: typeof theme.page.size === "string" && theme.page.orientation === "portrait" ? theme.page.size : [pageW, pageH],
    margins: { top: theme.page.margins.top, bottom: theme.page.margins.bottom, left: theme.page.margins.left, right: theme.page.margins.right },
```

(keep `bufferPages` and `info` as they are). Replace the three `doc.registerFont(...)` lines with `registerThemeFonts(doc, theme);`.

- [ ] **Step 6: Wrap the draw pass**

Replace the block from `if (velocityMeta) {` (the cover branch, ~line 591) through `doc.end();` with:

```ts
  const tok: themed.TokenContext = {
    firmName: firm.name,
    projectName: project.projectName,
    address: String((project.resultPayload as { request?: { address?: unknown } } | null)?.request?.address ?? ""),
    dateLabel: project.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long" }),
    documentType: documentLabel(project),
    client: String((project.requestPayload as { clientName?: unknown } | null)?.clientName ?? ""),
  };
  // Synchronous draw pass under the firm's theme. No `await` may appear in
  // this block — the active theme is module state (see report-theme/active.ts).
  withTheme(theme, () => {
    if (velocityMeta) {
      drawVelocityCover(doc, project, firm, logoBuf, sitePhotoBuf, velocityMeta);
      doc.addPage();
      drawVelocityDocControlSheet(doc, velocityMeta, firm);
    } else if (isDefaultTheme()) {
      drawCover(doc, project, firm, logoBuf, sitePhotoBuf);
    } else {
      themed.cover(doc, { ...tok, firmLogo: logoBuf, sitePhoto: sitePhotoBuf });
    }
    doc.addPage();
    if (isDefaultTheme()) drawHeader(doc, project, firm);
    drawBody(doc, project);
    drawCitationsFooter(doc, project);

    const range = doc.bufferedPageRange();
    const bodyPages = range.count - 1; // cover is unnumbered
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      if (velocityMeta) {
        if (i > range.start) drawVelocityPageFooter(doc, velocityMeta, i - range.start);
      } else if (isDefaultTheme()) {
        drawPageFooter(doc);
      } else if (i > range.start) {
        themed.pageHeader(doc, tok, i - range.start, bodyPages);
        themed.pageFooter(doc, tok, i - range.start, bodyPages);
      }
    }
    doc.flushPages();
    doc.end();
  });
  return done;
```

Confirm nothing between `withTheme(theme, () => {` and `});` contains `await` (`awk` the line range).

- [ ] **Step 7: Gate the shared helpers**

Insert as the first statement of each function:

| Function | First statement |
|---|---|
| `section(doc, title)` | `if (!isDefaultTheme()) { themed.heading(doc, 1, title); return; }` |
| `gaSection`, `caSection`, `ldnSection` | same, level 1 |
| `gaSubsection`, `caSubsection`, `ldnSubsection` | `if (!isDefaultTheme()) { themed.heading(doc, 2, title); return; }` |
| `rows(doc, pairs)` | `if (!isDefaultTheme()) { themed.rows(doc, pairs); return; }` |
| `table(doc, spec)` | `if (!isDefaultTheme()) { themed.table(doc, spec); return; }` |
| `metricStrip(doc, metrics)` | `if (!isDefaultTheme()) { themed.metricStrip(doc, metrics); return; }` |
| `drawCitationsFooter` | change `drawHeader(doc, project, { name: "", logoUrl: null });` to `if (isDefaultTheme()) drawHeader(doc, project, { name: "", logoUrl: null });` |

`ldnChapterIntro` / `ldnNote` keep their code (prose, not structure) but read colours from the theme when non-default: replace `VELOCITY_GREEN`/`TEXT_GRAY` uses in those two with `isDefaultTheme() ? <existing> : activeTheme().palette.muted`.

- [ ] **Step 8: Typecheck and run the identity guard**

```bash
pnpm --filter @workspace/tis-api-server run typecheck && node ./scripts/verify-theme-default-identity.mjs
```

Expected: typecheck clean; identity `ALL PASS` (three fixtures match the pinned hashes). If a hash differs, diff the normalised outputs (`node -e` writing both to files and `cmp`) — the usual culprits are a changed `size:` string vs array (fix the conditional in Step 5) or a font registered under a different file (fix `registerThemeFonts`). Never re-pin to make it pass.

- [ ] **Step 9: Smoke a themed render**

Append to `scripts/verify-theme-render.mjs` (create it now; extended in Task 15):

```js
// Themed render smoke: each preview fixture renders under a synthetic theme
// without throwing, embeds the theme's fonts, and keeps a sane page count.
// Run: node ./scripts/verify-theme-render.mjs
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { FIXTURE_FAMILIES, loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pdfPageCount } from "./lib/pdf-norm.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const { mod, cleanup } = await loadRendererBundle(`export { DEFAULT_THEME } from "./report-theme/theme";`);
try {
  const D = mod.DEFAULT_THEME;
  const SYNTH = {
    version: 2,
    theme: {
      ...D, id: "firm-synth",
      page: { size: "LETTER", orientation: "portrait", margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      fonts: { body: { family: "carlito", requested: "Calibri", exact: false }, heading: { family: "liberation-serif", requested: "Times New Roman", exact: false } },
      headings: [{ ...D.headings[0], style: { font: "heading", size: 15, color: "#1f3a5f", bold: true }, case: "title", numbering: "1.", rule: { color: "#1f3a5f", width: 0.75, gap: 2 } }, { ...D.headings[1], style: { font: "heading", size: 12, color: "#1f3a5f", bold: true }, numbering: "1." }, D.headings[2]],
      palette: { primary: "#1f3a5f", accent: "#c0392b", text: "#222222", muted: "#666666", rule: "#bbbbbb" },
      table: { ...D.table, header: { fill: "#1f3a5f", color: "#ffffff", bold: true, size: 9 }, rules: { color: "#bbbbbb", width: 0.5, mode: "grid" } },
      header: { segments: [{ align: "left", text: "{{firm.name}}" }, { align: "right", text: "{{documentType}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: { color: "#1f3a5f", width: 0.5 }, height: 40 },
      footer: { segments: [{ align: "center", text: "Page {{page}} of {{pages}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: null, height: 40 },
      cover: { background: { kind: "none" }, bands: [{ y0: 0, y1: 120, color: "#1f3a5f" }], logo: null, elements: [{ role: "documentType", x: 72, y: 300, w: 468, align: "left", style: { font: "heading", size: 28, color: "#1f3a5f", bold: true } }, { role: "projectName", x: 72, y: 350, w: 468, align: "left", style: { font: "body", size: 16, color: "#222222" } }], hasMetaBlock: false },
      charts: { series: ["#1f3a5f", "#c0392b"] },
      synonyms: { "trip-generation": "Site Trip Generation" },
    },
    source: { pages: 10, fontsSeen: [], extractedAt: "2026-09-14T00:00:00Z", warnings: [] },
  };
  for (const fam of FIXTURE_FAMILIES) {
    const project = projectFromFixture(loadFixture(fam));
    const plain = await mod.renderStudyPdf(project, { name: "Render Check Firm", logoUrl: null });
    const themedBuf = await mod.renderStudyPdf(project, { name: "Render Check Firm", logoUrl: null, firmId: "f1", reportTemplate: SYNTH });
    const txt = themedBuf.toString("latin1");
    ok(themedBuf.length > 10_000, `${fam}: themed render produced a PDF (${themedBuf.length} bytes)`);
    ok(/\/BaseFont \/[A-Z]{6}\+Carlito/.test(txt), `${fam}: Carlito embedded`);
    ok(/\/BaseFont \/[A-Z]{6}\+LiberationSerif/.test(txt), `${fam}: Liberation Serif embedded`);
    const p0 = pdfPageCount(plain), p1 = pdfPageCount(themedBuf);
    ok(p1 >= p0 * 0.7 && p1 <= p0 * 1.6, `${fam}: page count sane (${p0} → ${p1})`);
  }
} finally { await cleanup(); }
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
```

Run `node ./scripts/verify-theme-render.mjs`. Expected: `ALL PASS` for all six families (GA/FL/NY may take a few seconds while enrichment fetches time out; that's fine). Add `"check:theme-render": "node ./scripts/verify-theme-render.mjs"` to `package.json`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/tis-api-server/src/lib/pdf-export.ts artifacts/tis-api-server/src/lib/report-template/store.ts artifacts/tis-api-server/src/routes/firms.ts artifacts/tis-api-server/scripts/verify-theme-render.mjs artifacts/tis-api-server/package.json
git commit -m "refactor(pdf): thread the report theme through pdf-export.ts

Default theme stays byte-identical (check:theme-default-identity).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Thread the theme through the other renderer modules and charts

**Files:**
- Modify: `src/lib/pdf-export-states.ts` (`PAGE_MARGIN` line 1053; closures `stateSection`/`stateSub`/`kv`/`tbl`/`strip` at 1090–1175), `src/lib/pdf-export-ny.ts` (`PAGE_MARGIN` line 53; `nySection`/`nySubsection`/`nyRows`/`nyTable`/`nyMetricStrip`), `src/lib/pdf-export-carolinas.ts` (`PAGE_MARGIN` line 39; `carSection`/`carSubsection`/`carRows`/`carTable`/`carMetricStrip`), `src/lib/pdf-export-distribution.ts` (`PAGE_MARGIN` line 14; `table`), `src/lib/pdf-charts.ts` (`PAGE_MARGIN` line 26; `CHART_COLORS` uses).

- [ ] **Step 1: Replace `PAGE_MARGIN` in all five files**

In each file delete its `const PAGE_MARGIN = 50;` line, add `import { activeTheme, isDefaultTheme, pageMargin } from "./report-theme/active";` and `import * as themed from "./report-theme/draw";` (charts: only `activeTheme`, `isDefaultTheme`, `pageMargin`), then:

```bash
for f in pdf-export-states pdf-export-ny pdf-export-carolinas pdf-export-distribution pdf-charts; do sed -i '' -E 's/\bPAGE_MARGIN\b/pageMargin()/g' src/lib/$f.ts; done; grep -n "const pageMargin()" src/lib/*.ts
```

Expected: the grep prints nothing.

- [ ] **Step 2: Gate the helpers**

Insert as the first statement:

| File | Function | First statement |
|---|---|---|
| states | `stateSection` | `if (!isDefaultTheme()) { themed.heading(doc, 1, title); return; }` |
| states | `stateSub` | `… themed.heading(doc, 2, title) …` |
| states | `kv` | `if (!isDefaultTheme()) { themed.rows(doc, pairs); return; }` |
| states | `tbl(headers, widths, aligns, dataRows)` | `if (!isDefaultTheme()) { themed.table(doc, { headers, widths, align: aligns as Array<"left" \| "right" \| "center">, rows: dataRows }); return; }` |
| states | `strip` | `if (!isDefaultTheme()) { themed.metricStrip(doc, metrics); return; }` |
| ny | `nySection` / `nySubsection` | heading 1 / 2 |
| ny | `nyRows` / `nyTable` / `nyMetricStrip` | `themed.rows` / `themed.table(doc, spec)` / `themed.metricStrip` |
| carolinas | `carSection` / `carSubsection` | heading 1 / 2 |
| carolinas | `carRows` / `carTable` / `carMetricStrip` | same as ny |
| distribution | `table` | `if (!isDefaultTheme()) { themed.table(doc, spec); return; }` |

`nyTable`/`carTable` take `NyTableSpec`/`CarTableSpec` with the same `{ headers, widths, align?, rows }` shape — pass through directly. In `states`, `body()` and `note()` set colours literally (`"black"`, `TEXT_GRAY`); make them `isDefaultTheme() ? "black" : activeTheme().text.body.color` and `isDefaultTheme() ? TEXT_GRAY : activeTheme().palette.muted`.

- [ ] **Step 3: Chart colours**

In `pdf-charts.ts` add below `CHART_COLORS`:

```ts
/** Chart palette: the Velocity constants by default, the firm's palette under a theme. */
function chartColors(): typeof CHART_COLORS {
  if (isDefaultTheme()) return CHART_COLORS;
  const t = activeTheme();
  return {
    inbound: t.charts.series[0],
    outbound: t.charts.series[1] ?? t.palette.accent,
    caption: t.palette.primary,
    line: t.palette.primary,
    grid: t.palette.rule,
    axis: t.palette.muted,
    baseline: t.palette.muted,
  };
}
```

Replace every `CHART_COLORS.` inside function bodies (lines 102–395, not the export itself) with `chartColors().`:

```bash
sed -i '' -E '/^export const CHART_COLORS/,/^};/!s/\bCHART_COLORS\./chartColors()./g' src/lib/pdf-charts.ts && grep -c "chartColors()" src/lib/pdf-charts.ts
```

Also replace `TEXT_GRAY` uses in draw functions with `chartColors().axis`.

- [ ] **Step 4: Typecheck, identity, render**

```bash
pnpm --filter @workspace/tis-api-server run typecheck && node ./scripts/verify-theme-default-identity.mjs && node ./scripts/verify-theme-render.mjs && pnpm --filter @workspace/tis-api-server run smoke:distribution-pdf
```

Expected: all `ALL PASS` / smoke green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/tis-api-server/src/lib/pdf-export-states.ts artifacts/tis-api-server/src/lib/pdf-export-ny.ts artifacts/tis-api-server/src/lib/pdf-export-carolinas.ts artifacts/tis-api-server/src/lib/pdf-export-distribution.ts artifacts/tis-api-server/src/lib/pdf-charts.ts
git commit -m "refactor(pdf): theme-aware states/NY/Carolinas/distribution renderers and charts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Theme the UK template engine path

**Files:**
- Modify: `src/lib/report-template/engine.ts` (`renderTemplatePdf`, `drawCover`, `drawTable`, `drawChapterHeading`, `stampFooters`), `src/lib/pdf-export.ts` (`renderTemplateReport`).

**Interfaces:**
- `renderTemplatePdf(t, ctx, providers, theme?: Theme)` — new optional 4th parameter. When `theme` is a non-default theme: page size/margins from it, `registerThemeFonts`, `brand.palette` overridden (`primary`, `accent`, `text`, `muted`, `rule` from `theme.palette`; `tableHeader` from `theme.table.header.fill ?? tint(primary, 0.86)`; `onPrimary` by luminance), `brand.logo` from `theme.cover.logo?.data` when the brand has none, `brand.footer` = the theme footer's segment texts joined by `"  ·  "` when the theme has a footer.

- [ ] **Step 1: Engine changes**

In `engine.ts`:
- Import `import { DEFAULT_THEME, isDefaultTheme, luminance, pageSizePoints, tint, type Theme } from "../report-theme/theme"; import { registerThemeFonts } from "../report-theme/fonts";`.
- Add a module-private `function applyThemeToTemplate(t: ReportTemplate, theme: Theme): ReportTemplate` that returns a shallow copy with the brand overrides listed above (leave chapters untouched).
- `renderTemplatePdf(t, ctx, providers, theme = DEFAULT_THEME)`: if `!isDefaultTheme(theme)`, `t = applyThemeToTemplate(t, theme)`; construct the `PDFDocument` with `pageSizePoints(theme.page)`/`theme.page.margins` (default: unchanged `LETTER`/`PAGE_MARGIN`); replace the two `registerFont` lines with `registerThemeFonts(doc, theme)`.
- In `pdf-export.ts` `renderTemplateReport`, pass `resolveTheme(firm)` as the 4th argument.

- [ ] **Step 2: Verify**

```bash
pnpm --filter @workspace/tis-api-server run typecheck && node ./scripts/verify-theme-default-identity.mjs
```

Add to `scripts/verify-theme-render.mjs` (inside the try, after the fixture loop) a UK smoke: build a project with `siteLat: "51.5136"`, `siteLon: "-0.0866"` (City of London) and the FL fixture's `report` payload, render it with and without `SYNTH`, and assert both return > 10 000 bytes and the themed one embeds Carlito. Run it: `ALL PASS`.

- [ ] **Step 3: Commit**

```bash
git add artifacts/tis-api-server/src/lib/report-template/engine.ts artifacts/tis-api-server/src/lib/pdf-export.ts artifacts/tis-api-server/scripts/verify-theme-render.mjs
git commit -m "feat(theme): apply the firm theme to the UK template-engine path

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase B — Extractor (pure JS, pdfjs-dist)

### Task 8: PNG helper and the operator-list scanner

**Files:**
- Create: `src/lib/report-theme/png.ts` (encoder moved from `report-template/pdf-assets.ts`), `src/lib/report-theme/pdf-scan.ts`
- Create: `scripts/lib/synthetic-pdf.mjs`, `scripts/verify-theme-scan.mjs`
- Modify: `package.json` (`check:theme-scan`)

**Interfaces:**
- Produces (`png.ts`): `encodePngRGBA(width, height, rgba: Uint8Array): Buffer`, `imagePixelsToPngDataUrl(px: ImagePixels): string | null` (kinds 1 = 1-bpp grey, 2 = RGB24, 3 = RGBA32 → PNG data URL; returns null over 4 M pixels).
- Produces (`pdf-scan.ts`): types `Matrix`, `TextRun`, `FillRect`, `StrokeLine`, `ImagePixels`, `ImagePlacement`, `ScannedPage`, `ScanResult`, `TextLine`; `scanPdf(pdf: Buffer, opts?: { maxPages?: number; imagePixelsOnPage?: number; maxImagePixels?: number }): Promise<ScanResult>`; `linesOf(page: ScannedPage): TextLine[]`; `interiorPages(pages: ScannedPage[]): ScannedPage[]`.
- Coordinates: PDF points, origin top-left, y grows downward. `TextRun.y` is the baseline; `TextRun.h` is the rendered font size.
- Produces (`synthetic-pdf.mjs`): `makeSyntheticTis(style: "blue-sans" | "serif-black"): Promise<Buffer>` — a 6-page PDFKit document with known fonts/colours/geometry (see Step 3 for the exact values the checks assert).

- [ ] **Step 1: Write `png.ts`**

Move `CRC_TABLE`, `crc32`, `pngChunk`, `encodePngRGBA` verbatim from `report-template/pdf-assets.ts` (lines under "Minimal PNG encoder") into `src/lib/report-theme/png.ts`, export `encodePngRGBA`, and add:

```ts
export type ImagePixels = { width: number; height: number; kind: 1 | 2 | 3; data: Uint8ClampedArray };

/** pdfjs decoded image (ImageKind GRAYSCALE_1BPP / RGB_24BPP / RGBA_32BPP) → PNG data URL. */
export function imagePixelsToPngDataUrl(px: ImagePixels): string | null {
  const n = px.width * px.height;
  if (n === 0 || n > 4_000_000) return null;
  const rgba = new Uint8Array(n * 4);
  if (px.kind === 3) {
    rgba.set(px.data.subarray(0, n * 4));
  } else if (px.kind === 2) {
    for (let i = 0; i < n; i++) { rgba[i * 4] = px.data[i * 3]; rgba[i * 4 + 1] = px.data[i * 3 + 1]; rgba[i * 4 + 2] = px.data[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  } else {
    // 1 bit per pixel, rows padded to a byte boundary, 1 = white.
    const stride = Math.ceil(px.width / 8);
    for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) {
      const bit = (px.data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = bit ? 255 : 0; const o = (y * px.width + x) * 4;
      rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
    }
  }
  return `data:image/png;base64,${encodePngRGBA(px.width, px.height, rgba).toString("base64")}`;
}
```

- [ ] **Step 2: Write `pdf-scan.ts`**

```ts
/**
 * Operator-list scanner: walks each page's pdfjs operator list with a small
 * graphics-state interpreter and emits positioned text runs (with real font
 * name, size and fill colour), filled rectangles, axis-aligned stroked lines
 * and image placements — everything the derive/* modules need.
 *
 * Why not getTextContent()? It has no colours, and a firm's heading/table
 * colours are the point. Facts about pdfjs-dist@5.7 this relies on (verified
 * against the bundled build):
 *  - every colour operator arrives normalised as setFillRGBColor /
 *    setStrokeRGBColor with ONE "#rrggbb" arg; patterns arrive as
 *    setFillColorN / setFillTransparent (→ we record null);
 *  - paths arrive as constructPath [paintOp, [Float32Array buffer], minMax]
 *    where the buffer is DrawOPS codes (0 moveTo x y, 1 lineTo x y,
 *    2 curveTo ×6, 3 quadraticCurveTo ×4, 4 closePath) in CURRENT user space;
 *  - setTextMatrix's arg is a Float32Array(6); showText's arg is an array of
 *    glyph objects { unicode, width, isSpace } and numbers (TJ adjustments);
 *  - setFont's args are [loadedName, size]; page.commonObjs.get(loadedName)
 *    yields { name, bold, italic, isSerifFont, isMonospace, isType3Font,
 *    fontMatrix } (isSerifFont needs fontExtraProperties: true);
 *  - paintImageXObject's first arg is the objId; the image fills the unit
 *    square under the CTM; page.objs.get(objId) → { width, height, kind, data }.
 */
import type { ImagePixels } from "./png";

export type Matrix = [number, number, number, number, number, number];
export type TextRun = { page: number; str: string; font: string; size: number; bold: boolean; italic: boolean; serif: boolean; mono: boolean; color: string | null; x: number; y: number; w: number; h: number };
export type FillRect = { page: number; x: number; y: number; w: number; h: number; color: string };
export type StrokeLine = { page: number; x1: number; y1: number; x2: number; y2: number; color: string; width: number };
export type ImagePlacement = { page: number; x: number; y: number; w: number; h: number; objId: string; pixels: ImagePixels | null };
export type ScannedPage = { page: number; width: number; height: number; runs: TextRun[]; rects: FillRect[]; lines: StrokeLine[]; images: ImagePlacement[] };
export type ScanResult = { numPages: number; pages: ScannedPage[]; fontsSeen: string[]; warnings: string[] };
export type ScanOptions = { maxPages?: number; imagePixelsOnPage?: number; maxImagePixels?: number };
export type { ImagePixels };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const toM = (a: ArrayLike<number>): Matrix => [a[0], a[1], a[2], a[3], a[4], a[5]];
const r2 = (v: number) => Math.round(v * 100) / 100;

type FontInfo = { name: string; bold: boolean; italic: boolean; serif: boolean; mono: boolean; type3: boolean; fontMatrix: number[] };
type GState = { ctm: Matrix; fill: string | null; stroke: string | null; lineWidth: number; font: FontInfo | null; fontSize: number; charSpacing: number; wordSpacing: number; hScale: number; leading: number; rise: number };

// pdfjs-dist@5 constructs a DOMMatrix at module load; Node has none. Inert shim (same as synchro-pdf-import.ts).
function shimDomGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrixShim {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[]) { if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init as Matrix; }
      scale(): DOMMatrixShim { return this; }
      translate(): DOMMatrixShim { return this; }
      multiply(): DOMMatrixShim { return this; }
      inverse(): DOMMatrixShim { return this; }
    };
  }
}

type PdfjsPage = {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  commonObjs: { get(id: string): unknown };
  objs: { get(id: string): unknown };
  cleanup(): void;
};
type PdfjsModule = {
  OPS: Record<string, number>;
  getDocument(p: Record<string, unknown>): { promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfjsPage>; destroy(): Promise<void> }> };
};

export async function scanPdf(pdf: Buffer, opts: ScanOptions = {}): Promise<ScanResult> {
  shimDomGlobals();
  const { getDocument, OPS } = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  const doc = await getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0, fontExtraProperties: true }).promise;
  const warnings: string[] = [];
  const fontsSeen = new Set<string>();
  const pages: ScannedPage[] = [];
  const maxPages = Math.min(doc.numPages, opts.maxPages ?? 31);
  try {
    for (let p = 1; p <= maxPages; p++) {
      let page: PdfjsPage | null = null;
      try { page = await doc.getPage(p); } catch { warnings.push(`Page ${p} could not be opened.`); continue; }
      try { pages.push(await scanPage(page, p, OPS, opts, fontsSeen)); }
      catch (e) { warnings.push(`Page ${p} skipped: ${(e as Error).message}`); }
      finally { try { page.cleanup(); } catch { /* ignore */ } }
    }
  } finally {
    await doc.destroy();
  }
  return { numPages: doc.numPages, pages, fontsSeen: [...fontsSeen], warnings };
}

async function scanPage(page: PdfjsPage, pageNo: number, OPS: Record<string, number>, opts: ScanOptions, fontsSeen: Set<string>): Promise<ScannedPage> {
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const out: ScannedPage = { page: pageNo, width: vp.width, height: vp.height, runs: [], rects: [], lines: [], images: [] };
  const fontCache = new Map<string, FontInfo | null>();
  const fontInfo = (id: string): FontInfo | null => {
    if (fontCache.has(id)) return fontCache.get(id)!;
    let f: Record<string, unknown> | null = null;
    try { f = page.commonObjs.get(id) as Record<string, unknown>; } catch { f = null; }
    const name = f ? String(f.name ?? id) : id;
    const info: FontInfo | null = f ? {
      name,
      bold: !!f.bold || /bold|black|heavy|semibold|demibold/i.test(name),
      italic: !!f.italic || /italic|oblique/i.test(name),
      serif: !!f.isSerifFont,
      mono: !!f.isMonospace,
      type3: !!f.isType3Font,
      fontMatrix: Array.isArray(f.fontMatrix) ? (f.fontMatrix as number[]) : [0.001, 0, 0, 0.001, 0, 0],
    } : null;
    if (info) fontsSeen.add(info.name);
    fontCache.set(id, info);
    return info;
  };

  let gs: GState = { ctm: toM(vp.transform), fill: "#000000", stroke: "#000000", lineWidth: 1, font: null, fontSize: 0, charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0 };
  const stack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let imagesDecoded = 0;

  const showText = (glyphs: unknown[]): Matrix => {
    const f = gs.font;
    const fs = gs.fontSize;
    if (!f || f.type3 || !Array.isArray(glyphs) || fs <= 0) return tm;
    const m = mul(gs.ctm, tm);
    const [x0, y0] = apply(m, 0, gs.rise);
    const sizeDev = fs * Math.hypot(m[2], m[3]);
    const xScale = Math.hypot(m[0], m[1]);
    let tx = 0;
    let str = "";
    for (const g of glyphs) {
      if (typeof g === "number") { tx += (-g / 1000) * fs * gs.hScale; continue; }
      const gl = g as { unicode?: string; width?: number; isSpace?: boolean };
      const w0 = Number(gl.width ?? 0) * (f.fontMatrix[0] ?? 0.001);
      tx += (w0 * fs + gs.charSpacing + (gl.isSpace ? gs.wordSpacing : 0)) * gs.hScale;
      str += gl.unicode ?? "";
    }
    const rotated = Math.abs(m[1]) > 0.02 || Math.abs(m[2]) > 0.02;
    if (str.trim() && !rotated && sizeDev > 0) {
      out.runs.push({ page: pageNo, str, font: f.name, size: r2(sizeDev), bold: f.bold, italic: f.italic, serif: f.serif, mono: f.mono, color: gs.fill, x: r2(x0), y: r2(y0), w: r2(tx * xScale), h: r2(sizeDev) });
    }
    return mul(tm, [1, 0, 0, 1, tx, 0]);
  };

  const asRect = (pts: Array<[number, number]>): { x: number; y: number; w: number; h: number } | null => {
    const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
    const p = pts.length === 5 && near(pts[0], pts[4]) ? pts.slice(0, 4) : pts;
    if (p.length !== 4) return null;
    const uniq = (vals: number[]) => vals.reduce<number[]>((acc, v) => (acc.some((u) => Math.abs(u - v) < 0.5) ? acc : [...acc, v]), []);
    const ux = uniq(p.map((q) => q[0]));
    const uy = uniq(p.map((q) => q[1]));
    if (ux.length !== 2 || uy.length !== 2) return null;
    const x = Math.min(...ux), y = Math.min(...uy);
    return { x: r2(x), y: r2(y), w: r2(Math.max(...ux) - x), h: r2(Math.max(...uy) - y) };
  };

  const handlePath = (paintOp: number, buf: Float32Array | null | undefined) => {
    if (!buf) return;
    const fillOps = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];
    const strokeOps = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];
    const fills = fillOps.includes(paintOp);
    const strokes = strokeOps.includes(paintOp);
    if (!fills && !strokes) return;
    const subpaths: Array<{ pts: Array<[number, number]>; curved: boolean }> = [];
    let cur: { pts: Array<[number, number]>; curved: boolean } | null = null;
    for (let k = 0; k < buf.length;) {
      const code = buf[k++];
      if (code === 0) { cur = { pts: [apply(gs.ctm, buf[k], buf[k + 1])], curved: false }; subpaths.push(cur); k += 2; }
      else if (code === 1) { cur?.pts.push(apply(gs.ctm, buf[k], buf[k + 1])); k += 2; }
      else if (code === 2) { if (cur) { cur.curved = true; cur.pts.push(apply(gs.ctm, buf[k + 4], buf[k + 5])); } k += 6; }
      else if (code === 3) { if (cur) { cur.curved = true; cur.pts.push(apply(gs.ctm, buf[k + 2], buf[k + 3])); } k += 4; }
      else if (code === 4) { /* closePath */ }
      else break;
    }
    const lw = r2(gs.lineWidth * Math.hypot(gs.ctm[0], gs.ctm[1]));
    const pushLine = (a: [number, number], b: [number, number], color: string, width: number) => {
      if (Math.abs(a[1] - b[1]) > 0.5 && Math.abs(a[0] - b[0]) > 0.5) return; // not axis-aligned
      out.lines.push({ page: pageNo, x1: r2(Math.min(a[0], b[0])), y1: r2(Math.min(a[1], b[1])), x2: r2(Math.max(a[0], b[0])), y2: r2(Math.max(a[1], b[1])), color, width });
    };
    for (const sp of subpaths) {
      if (sp.curved) continue;
      const rect = asRect(sp.pts);
      if (rect) {
        if (fills && gs.fill) {
          if (rect.w <= 1.5 || rect.h <= 1.5) {
            // Word/InDesign draw rules as hairline-thin filled rects.
            const thin = Math.min(rect.w, rect.h) || 0.5;
            if (rect.h <= 1.5) pushLine([rect.x, rect.y + rect.h / 2], [rect.x + rect.w, rect.y + rect.h / 2], gs.fill, r2(thin));
            else pushLine([rect.x + rect.w / 2, rect.y], [rect.x + rect.w / 2, rect.y + rect.h], gs.fill, r2(thin));
          } else {
            out.rects.push({ page: pageNo, ...rect, color: gs.fill });
          }
        }
        if (strokes && gs.stroke && rect.w > 1.5 && rect.h > 1.5) {
          const { x, y, w, h } = rect;
          pushLine([x, y], [x + w, y], gs.stroke, lw); pushLine([x, y + h], [x + w, y + h], gs.stroke, lw);
          pushLine([x, y], [x, y + h], gs.stroke, lw); pushLine([x + w, y], [x + w, y + h], gs.stroke, lw);
        }
        continue;
      }
      if (strokes && gs.stroke) for (let j = 1; j < sp.pts.length; j++) pushLine(sp.pts[j - 1], sp.pts[j], gs.stroke, lw);
    }
  };

  const handleImage = (objId: string) => {
    const m = gs.ctm;
    const corners = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 1, 1), apply(m, 0, 1)];
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    let pixels: ImagePixels | null = null;
    if (pageNo === (opts.imagePixelsOnPage ?? 1) && imagesDecoded < (opts.maxImagePixels ?? 8)) {
      try {
        const o = page.objs.get(objId) as { width?: number; height?: number; kind?: number; data?: Uint8ClampedArray } | null;
        if (o && o.data && o.width && o.height && (o.kind === 1 || o.kind === 2 || o.kind === 3) && o.width * o.height <= 4_000_000) {
          pixels = { width: o.width, height: o.height, kind: o.kind, data: o.data };
          imagesDecoded++;
        }
      } catch { pixels = null; }
    }
    out.images.push({ page: pageNo, x: r2(x), y: r2(y), w: r2(Math.max(...xs) - x), h: r2(Math.max(...ys) - y), objId, pixels });
  };

  const fn = ol.fnArray;
  const args = ol.argsArray as unknown[][];
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    const a = args[i] ?? [];
    switch (op) {
      case OPS.save: stack.push({ ...gs }); break;
      case OPS.restore: gs = stack.pop() ?? gs; break;
      case OPS.transform: gs.ctm = mul(gs.ctm, toM(a as number[])); break;
      case OPS.paintFormXObjectBegin: stack.push({ ...gs }); if (a[0]) gs.ctm = mul(gs.ctm, toM(a[0] as number[])); break;
      case OPS.paintFormXObjectEnd: gs = stack.pop() ?? gs; break;
      case OPS.setFillRGBColor: gs.fill = typeof a[0] === "string" ? (a[0] as string).toLowerCase() : null; break;
      case OPS.setStrokeRGBColor: gs.stroke = typeof a[0] === "string" ? (a[0] as string).toLowerCase() : null; break;
      case OPS.setFillColorN: case OPS.setFillTransparent: gs.fill = null; break;
      case OPS.setStrokeColorN: case OPS.setStrokeTransparent: gs.stroke = null; break;
      case OPS.setLineWidth: gs.lineWidth = Number(a[0] ?? 1); break;
      case OPS.setGState:
        for (const [k, v] of (a[0] ?? []) as Array<[string, unknown]>) {
          if (k === "LW") gs.lineWidth = Number(v);
          if (k === "Font" && Array.isArray(v)) { gs.font = fontInfo(String(v[0])); gs.fontSize = Number(v[1]); }
        }
        break;
      case OPS.beginText: tm = IDENTITY; tlm = IDENTITY; break;
      case OPS.setTextMatrix: tm = toM(a as number[]); tlm = tm; break;
      case OPS.moveText: tlm = mul(tlm, [1, 0, 0, 1, Number(a[0]), Number(a[1])]); tm = tlm; break;
      case OPS.setLeadingMoveText: gs.leading = -Number(a[1]); tlm = mul(tlm, [1, 0, 0, 1, Number(a[0]), Number(a[1])]); tm = tlm; break;
      case OPS.nextLine: tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.leading]); tm = tlm; break;
      case OPS.setLeading: gs.leading = Number(a[0]); break;
      case OPS.setCharSpacing: gs.charSpacing = Number(a[0]); break;
      case OPS.setWordSpacing: gs.wordSpacing = Number(a[0]); break;
      case OPS.setHScale: gs.hScale = Number(a[0]) / 100; break;
      case OPS.setTextRise: gs.rise = Number(a[0]); break;
      case OPS.setFont: gs.font = fontInfo(String(a[0])); gs.fontSize = Number(a[1]); break;
      case OPS.showText: tm = showText(a[0] as unknown[]); break;
      case OPS.showSpacedText: tm = showText(((a[0] ?? []) as unknown[]).flatMap((x) => (Array.isArray(x) ? x : [x]))); break;
      case OPS.nextLineShowText: tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.leading]); tm = tlm; tm = showText(a[0] as unknown[]); break;
      case OPS.nextLineSetSpacingShowText: gs.wordSpacing = Number(a[0]); gs.charSpacing = Number(a[1]); tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.leading]); tm = tlm; tm = showText(a[2] as unknown[]); break;
      case OPS.constructPath: handlePath(a[0] as number, (a[1] as Array<Float32Array | null>)?.[0]); break;
      case OPS.paintImageXObject: case OPS.paintJpegXObject: handleImage(String(a[0])); break;
      default: break;
    }
  }
  return out;
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export type TextLine = { page: number; x: number; y: number; w: number; size: number; text: string; runs: TextRun[]; font: string; bold: boolean; italic: boolean; color: string | null; uniform: boolean };

/** Group a page's runs into baseline-aligned lines (top → bottom, left → right). */
export function linesOf(page: ScannedPage): TextLine[] {
  const runs = [...page.runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const r of runs) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - r.y) <= Math.max(1.5, 0.3 * Math.min(last.size, r.size))) {
      const gap = r.x - (last.x + last.w);
      last.text += (gap > 0.2 * r.size && !last.text.endsWith(" ") && !r.str.startsWith(" ") ? " " : "") + r.str;
      last.w = Math.max(last.x + last.w, r.x + r.w) - last.x;
      last.size = Math.max(last.size, r.size);
      last.runs.push(r);
    } else {
      lines.push({ page: page.page, x: r.x, y: r.y, w: r.w, size: r.size, text: r.str, runs: [r], font: r.font, bold: r.bold, italic: r.italic, color: r.color, uniform: true });
    }
  }
  for (const ln of lines) {
    ln.text = ln.text.replace(/\s+/g, " ").trim();
    // Dominant run (most characters) sets the line's style.
    const dom = ln.runs.reduce((a, b) => (b.str.length > a.str.length ? b : a));
    ln.font = dom.font; ln.bold = dom.bold; ln.italic = dom.italic; ln.color = dom.color;
    ln.uniform = ln.runs.every((r) => r.font === dom.font && Math.abs(r.size - dom.size) <= 0.3 && r.bold === dom.bold && (r.color ?? "") === (dom.color ?? ""));
  }
  return lines;
}

export function interiorPages(pages: ScannedPage[]): ScannedPage[] {
  return pages.filter((p) => p.page > 1);
}
```

- [ ] **Step 3: Write the synthetic sample generator**

Create `scripts/lib/synthetic-pdf.mjs` — a PDFKit document whose geometry the scanner checks can assert exactly:

```js
// Two synthetic "firm sample" TIS PDFs with known styling, for scanner and
// extractor checks. Every number here is asserted by verify-theme-scan.mjs.
import PDFDocument from "pdfkit";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const F = (fam, style) => path.resolve(here, "../../data/fonts", fam, `${style}.ttf`);

export const STYLES = {
  "blue-sans": { body: ["carlito", 11, "#222222"], heading: ["carlito", 16, "#1f4e79"], h2: ["carlito", 13, "#1f4e79"], margins: { top: 72, bottom: 72, left: 72, right: 72 }, size: "LETTER", tableHeaderFill: "#1f4e79", tableHeaderText: "#ffffff", rule: "#9dc3e6", h1Rule: true, numbering: "1.", footerText: "Page {n} of {N}", headerText: "Acme Traffic Engineering | Traffic Impact Study", band: "#1f4e79" },
  "serif-black": { body: ["liberation-serif", 12, "#000000"], heading: ["liberation-serif", 14, "#000000"], h2: ["liberation-serif", 12, "#000000"], margins: { top: 54, bottom: 54, left: 90, right: 90 }, size: "A4", tableHeaderFill: "#d9d9d9", tableHeaderText: "#000000", rule: "#000000", h1Rule: false, numbering: "1.0", footerText: "Riverside Consulting  -  {n}", headerText: null, band: null },
};

export async function makeSyntheticTis(styleName) {
  const s = STYLES[styleName];
  const doc = new PDFDocument({ size: s.size, margins: s.margins, bufferPages: true, compress: true });
  doc.registerFont("body", F(s.body[0], "Regular")); doc.registerFont("bold", F(s.body[0], "Bold"));
  doc.registerFont("h", F(s.heading[0], "Bold"));
  const chunks = []; doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const W = doc.page.width, H = doc.page.height, L = s.margins.left, R = W - s.margins.right;

  // Cover
  if (s.band) doc.rect(0, 0, W, 140).fill(s.band);
  doc.font("h").fontSize(30).fillColor(s.band ? "#ffffff" : s.heading[2]).text("TRAFFIC IMPACT STUDY", L, 60, { width: R - L });
  doc.font("body").fontSize(18).fillColor(s.body[2]).text("Maple Grove Mixed-Use Development", L, 300, { width: R - L });
  doc.font("body").fontSize(12).fillColor(s.body[2]).text("Prepared for: Maple Grove Partners LLC", L, 420).text("Prepared by: Acme Traffic Engineering", L, 440).text("March 2025", L, 460);

  const h1 = (n, t) => { doc.font("h").fontSize(s.heading[1]).fillColor(s.heading[2]).text(s.numbering === "1." ? `${n}. ${t}` : `${n}.0 ${t.toUpperCase()}`, L, doc.y, { width: R - L }); if (s.h1Rule) { const y = doc.y + 2; doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(s.heading[2]).stroke(); doc.y = y + 8; } else doc.y += 6; };
  const h2 = (n, t) => { doc.font("h").fontSize(s.h2[1]).fillColor(s.h2[2]).text(`${n} ${t}`, L, doc.y, { width: R - L }); doc.y += 4; };
  const para = () => { doc.font("body").fontSize(s.body[1]).fillColor(s.body[2]).text("The proposed development is expected to generate new vehicle trips during the weekday AM and PM peak hours. This section describes the methodology and the data used to estimate those trips, and summarises the resulting operations at each study intersection under existing and future conditions.", L, doc.y, { width: R - L, paragraphGap: 8 }); };
  const table = (caption) => {
    doc.font("bold").fontSize(s.body[1] - 1).fillColor(s.body[2]).text(caption, L, doc.y); doc.y += 4;
    const cols = [200, 100, 100], x0 = L, rowH = 18; let y = doc.y; const tw = cols.reduce((a, b) => a + b, 0);
    doc.rect(x0, y, tw, rowH).fill(s.tableHeaderFill);
    doc.font("bold").fontSize(9).fillColor(s.tableHeaderText); let x = x0; ["Intersection", "AM LOS", "PM LOS"].forEach((h, i) => { doc.text(h, x + 4, y + 5, { width: cols[i] - 8 }); x += cols[i]; });
    y += rowH;
    for (const row of [["Main St & 1st Ave", "B", "C"], ["Main St & 2nd Ave", "C", "D"], ["Oak Rd & Main St", "B", "B"]]) {
      doc.font("body").fontSize(9).fillColor(s.body[2]); x = x0; row.forEach((c, i) => { doc.text(c, x + 4, y + 5, { width: cols[i] - 8 }); x += cols[i]; });
      y += rowH; doc.moveTo(x0, y).lineTo(x0 + tw, y).lineWidth(0.5).strokeColor(s.rule).stroke();
    }
    doc.y = y + 10;
  };
  const chapters = [["Introduction", ["Project Description", "Study Area"]], ["Existing Conditions", ["Roadway Network", "Traffic Volumes"]], ["Trip Generation", ["Trip Generation Rates", "Pass-by Trips"]], ["Capacity Analysis", ["Level of Service", "Queuing"]], ["Conclusions and Recommendations", []]];
  chapters.forEach(([title, subs], i) => {
    doc.addPage(); h1(i + 1, title); para();
    subs.forEach((st, j) => { h2(`${i + 1}.${j + 1}`, st); para(); });
    if (i === 1 || i === 3) table(`Table ${i + 1}-1: Intersection Level of Service`);
  });
  // Running header/footer on interior pages
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    const saved = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    if (s.headerText) { doc.font("body").fontSize(8).fillColor("#666666").text(s.headerText, L, 30, { width: R - L, align: "right", lineBreak: false }); doc.moveTo(L, 44).lineTo(R, 44).lineWidth(0.5).strokeColor(s.heading[2]).stroke(); }
    doc.font("body").fontSize(8).fillColor("#666666").text(s.footerText.replace("{n}", String(i)).replace("{N}", String(range.count - 1)), L, H - 40, { width: R - L, align: "center", lineBreak: false });
    doc.page.margins.bottom = saved;
  }
  doc.end();
  return done;
}
```

- [ ] **Step 4: Write the failing scanner check**

Create `scripts/verify-theme-scan.mjs`:

```js
// Scanner checks on PDFKit-generated synthetic samples with known styling.
// Run: node ./scripts/verify-theme-scan.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { makeSyntheticTis } from "./lib/synthetic-pdf.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const { scanPdf, linesOf } = await import(path.resolve(here, "../src/lib/report-theme/pdf-scan.ts"));

const blue = await makeSyntheticTis("blue-sans");
const scan = await scanPdf(blue);
ok(scan.numPages === 6 && scan.pages.length === 6, `blue-sans: 6 pages scanned (${scan.pages.length})`);
ok(scan.warnings.length === 0, `no warnings (${scan.warnings.join("; ")})`);
ok(scan.fontsSeen.some((f) => /Carlito/.test(f)), `fontsSeen includes Carlito (${scan.fontsSeen.join(", ")})`);
const p2 = scan.pages[1];
ok(near(p2.width, 612, 0.5) && near(p2.height, 792, 0.5), "page 2 is Letter");
const h1 = p2.runs.find((r) => r.str.startsWith("1. Introduction"));
ok(!!h1, "H1 run found");
ok(h1 && near(h1.size, 16, 0.3), `H1 size 16 (${h1?.size})`);
ok(h1 && h1.color === "#1f4e79", `H1 colour #1f4e79 (${h1?.color})`);
ok(h1 && h1.bold, "H1 bold from font name");
ok(h1 && near(h1.x, 72, 1), `H1 x at left margin 72 (${h1?.x})`);
ok(h1 && h1.y > 72 && h1.y < 100, `H1 baseline just under the top margin (${h1?.y})`);
const body = p2.runs.filter((r) => near(r.size, 11, 0.3) && r.color === "#222222");
ok(body.length >= 3, `body runs at 11pt #222222 (${body.length})`);
ok(body.some((r) => r.w > 300), "a body run spans most of the text width");
const rule = p2.lines.find((l) => l.color === "#1f4e79" && near(l.y1, l.y2, 0.1) && l.x2 - l.x1 > 400 && l.y1 > 72 && l.y1 < 110);
ok(!!rule, "H1 underline rule captured as a horizontal stroke");
const headerRule = p2.lines.find((l) => near(l.y1, 44, 1));
ok(!!headerRule, "running-header rule at y=44");
const footer = p2.runs.find((r) => /Page 1 of 5/.test(r.str));
ok(!!footer && footer.y > 740, `footer text near the bottom (${footer?.y})`);
const p3 = scan.pages[2];
const hdrFill = p3.rects.find((r) => r.color === "#1f4e79" && near(r.h, 18, 0.5) && near(r.w, 400, 0.5));
ok(!!hdrFill, "table header fill rect 400×18 #1f4e79");
const rowRules = p3.lines.filter((l) => l.color === "#9dc3e6");
ok(rowRules.length === 3, `three row rules in the table rule colour (${rowRules.length})`);
const white = p3.runs.find((r) => r.str === "Intersection" && r.color === "#ffffff");
ok(!!white, "table header text is white");
const lines2 = linesOf(p2);
ok(lines2.some((l) => l.text === "1. Introduction" && l.uniform), "linesOf joins the H1 into one uniform line");
ok(lines2.some((l) => l.text.startsWith("Acme Traffic Engineering | Traffic Impact Study")), "header line joined");
const cover = scan.pages[0];
ok(cover.rects.some((r) => r.color === "#1f4e79" && near(r.w, 612, 0.5) && near(r.h, 140, 0.5) && near(r.y, 0, 0.5)), "cover band rect 612×140 at top");
ok(cover.runs.some((r) => r.str === "TRAFFIC IMPACT STUDY" && near(r.size, 30, 0.3) && r.color === "#ffffff"), "cover title 30pt white");

const serif = await scanPdf(await makeSyntheticTis("serif-black"));
const s2 = serif.pages[1];
ok(near(s2.width, 595.28, 0.5) && near(s2.height, 841.89, 0.5), "serif-black is A4");
const sh1 = s2.runs.find((r) => r.str.startsWith("1.0 INTRODUCTION"));
ok(sh1 && sh1.serif === true, "serif flag set for Liberation Serif");
ok(sh1 && near(sh1.x, 90, 1), `serif left margin 90 (${sh1?.x})`);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
```

Run it before writing the scanner: `node ./scripts/verify-theme-scan.mjs` → module not found. After Steps 1–2: expected `ALL PASS`. If `serif flag` fails, first confirm `fontExtraProperties: true` is passed to `getDocument` (that option is what exports `isSerifFont`); if it is, inspect the bundled Liberation Serif's `OS/2.sFamilyClass` with fontkit — PDFKit only sets the PDF Serif flag for family classes 1–7, and if the file reports class 0 change the assertion to `/LiberationSerif/.test(sh1.font)` and move on (`matchFamily` resolves known serif names by alias; the flag only matters for unknown fonts). If `H1 bold` fails, the PostScript name fallback regex in `fontInfo` is the fix (pdfjs reports `bold: undefined` for most embedded fonts).

- [ ] **Step 5: Typecheck, wire, commit**

```bash
pnpm --filter @workspace/tis-api-server run typecheck && node ./scripts/verify-theme-scan.mjs
```

Add `"check:theme-scan": "node ./scripts/verify-theme-scan.mjs"` to `package.json`.

```bash
git add artifacts/tis-api-server/src/lib/report-theme/png.ts artifacts/tis-api-server/src/lib/report-theme/pdf-scan.ts artifacts/tis-api-server/scripts/lib/synthetic-pdf.mjs artifacts/tis-api-server/scripts/verify-theme-scan.mjs artifacts/tis-api-server/package.json
git commit -m "feat(theme): pdfjs operator-list scanner and PNG helper

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Typography derivation (body style, heading levels, numbering)

**Files:**
- Create: `src/lib/report-theme/derive/typography.ts`
- Modify: `scripts/verify-theme-units.mjs` (synthetic run-list checks), `scripts/verify-theme-scan.mjs` (end-to-end on synthetic PDFs)

**Interfaces:**
- Consumes: `ScannedPage`, `TextRun`, `TextLine`, `linesOf`, `interiorPages` from `pdf-scan.ts`; `Numbering` from `theme.ts`.
- Produces: `BodyStyle = { font: string; size: number; color: string; serif: boolean; mono: boolean; bold: boolean }`, `bodyStyle(pages): BodyStyle | null`, `HeadingLevel = { font: string; size: number; bold: boolean; italic: boolean; color: string; lines: TextLine[]; numbering: Numbering; upper: boolean; titleCase: boolean; rule: { color: string; width: number; gap: number } | null; band: { color: string; padX: number; padY: number } | null; spaceBefore: number; spaceAfter: number }`, `detectHeadings(pages, body): HeadingLevel[]` (≤ 3, largest first), `detectNumbering(texts: string[]): Numbering`, `median(nums)`, `mode(vals)`, `clamp(v, lo, hi)`.

- [ ] **Step 1: Failing checks**

Append to `scripts/verify-theme-units.mjs`:

```js
// ─── derive/typography.ts ────────────────────────────────────────────────────
const typo = await import(path.resolve(here, "../src/lib/report-theme/derive/typography.ts"));
eq(typo.detectNumbering(["1.0 INTRO", "2.0 METHODS", "3.0 RESULTS"]), "1.0", "numbering 1.0");
eq(typo.detectNumbering(["1. Intro", "2. Methods"]), "1.", "numbering 1.");
eq(typo.detectNumbering(["1 Intro", "2 Methods"]), "1", "numbering bare");
eq(typo.detectNumbering(["Section 1 – Intro", "Section 2: Methods"]), "section", "numbering section");
eq(typo.detectNumbering(["A. Intro", "B. Methods"]), "letter", "numbering letter");
eq(typo.detectNumbering(["Introduction", "Methods", "3. Results"]), "none", "numbering none when < 50%");
eq(typo.median([5, 1, 3]), 3, "median odd");
eq(typo.median([1, 2, 3, 4]), 2.5, "median even");
eq(typo.mode([1, 2, 2, 3]), 2, "mode");
// Synthetic pages: body 10pt black; H1 14pt blue bold ×3; H2 12pt bold ×2; one 30pt cover-ish run on page 1 (ignored).
const run = (page, str, size, color, x, y, w, extra = {}) => ({ page, str, font: extra.bold ? "ABCDEF+Arial-Bold" : "ABCDEF+Arial", size, bold: !!extra.bold, italic: false, serif: false, mono: false, color, x, y, w, h: size });
const mkPage = (n, runs, lines = [], rects = []) => ({ page: n, width: 612, height: 792, runs, rects, lines, images: [] });
const pagesA = [
  mkPage(1, [run(1, "BIG TITLE", 30, "#1a5276", 72, 300, 300, { bold: true })]),
  mkPage(2, [run(2, "1.0 INTRODUCTION", 14, "#1a5276", 72, 100, 200, { bold: true }), run(2, "Body text line one that is long enough to count as a paragraph line.", 10, "#000000", 72, 124, 460), run(2, "Second body line of similar length to the first one here.", 10, "#000000", 72, 138, 440), run(2, "1.1 Study Area", 12, "#000000", 72, 170, 120, { bold: true }), run(2, "Third body line again with enough words to be a paragraph.", 10, "#000000", 72, 190, 450)], [{ page: 2, x1: 72, y1: 104, x2: 540, y2: 104, color: "#1a5276", width: 1 }]),
  mkPage(3, [run(3, "2.0 EXISTING CONDITIONS", 14, "#1a5276", 72, 100, 240, { bold: true }), run(3, "Body body body body body body body body body body body.", 10, "#000000", 72, 124, 430), run(3, "2.1 Roadways", 12, "#000000", 72, 160, 100, { bold: true }), run(3, "More body text of typical paragraph length for the page.", 10, "#000000", 72, 180, 445)], [{ page: 3, x1: 72, y1: 104, x2: 540, y2: 104, color: "#1a5276", width: 1 }]),
  mkPage(4, [run(4, "3.0 CONCLUSIONS", 14, "#1a5276", 72, 100, 200, { bold: true }), run(4, "Closing body text that wraps like any other paragraph line.", 10, "#000000", 72, 124, 455)], [{ page: 4, x1: 72, y1: 104, x2: 540, y2: 104, color: "#1a5276", width: 1 }]),
];
const bodyA = typo.bodyStyle(pagesA);
eq(bodyA && [bodyA.size, bodyA.color, bodyA.bold], [10, "#000000", false], "bodyStyle picks 10pt black");
const heads = typo.detectHeadings(pagesA, bodyA);
eq(heads.map((h) => [h.size, h.color, h.numbering, h.upper]), [[14, "#1a5276", "1.0", true], [12, "#000000", "1", false]], "two heading levels, numbering and case per level");
ok(heads[0].rule && heads[0].rule.color === "#1a5276" && heads[0].rule.width === 1, "H1 rule detected");
ok(heads[1].rule === null, "H2 has no rule");
ok(heads[0].spaceAfter >= 8 && heads[0].spaceAfter <= 20, `H1 spaceAfter measured (${heads[0].spaceAfter})`);
```

- [ ] **Step 2: Write `derive/typography.ts`**

```ts
import { interiorPages, linesOf, type ScannedPage, type TextLine, type TextRun } from "../pdf-scan";
import type { Numbering } from "../theme";

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function mode<T>(vals: T[]): T {
  const n = new Map<T, number>();
  let best: T = vals[0];
  let bestN = 0;
  for (const v of vals) { const c = (n.get(v) ?? 0) + 1; n.set(v, c); if (c > bestN) { bestN = c; best = v; } }
  return best;
}
const sizeKey = (s: number) => Math.round(s * 2) / 2;
const isBoldName = (f: string) => /bold|black|heavy|semibold|demibold/i.test(f);

export type BodyStyle = { font: string; size: number; color: string; serif: boolean; mono: boolean; bold: boolean };

/** The (font, size, colour) carrying the most characters on interior pages. */
export function bodyStyle(pages: ScannedPage[]): BodyStyle | null {
  const counts = new Map<string, { n: number; run: TextRun }>();
  for (const p of interiorPages(pages)) for (const r of p.runs) {
    if (r.size < 6 || r.size > 16) continue;
    const k = `${r.font}|${sizeKey(r.size)}|${r.color ?? "#000000"}`;
    const e = counts.get(k) ?? { n: 0, run: r };
    e.n += r.str.length;
    counts.set(k, e);
  }
  let best: { n: number; run: TextRun } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best) return null;
  const r = best.run;
  return { font: r.font, size: sizeKey(r.size), color: r.color ?? "#000000", serif: r.serif, mono: r.mono, bold: r.bold };
}

export type HeadingLevel = {
  font: string; size: number; bold: boolean; italic: boolean; color: string;
  lines: TextLine[]; numbering: Numbering; upper: boolean; titleCase: boolean;
  rule: { color: string; width: number; gap: number } | null;
  band: { color: string; padX: number; padY: number } | null;
  spaceBefore: number; spaceAfter: number;
};

export function detectNumbering(texts: string[]): Numbering {
  const n = texts.length || 1;
  const share = (re: RegExp) => texts.filter((t) => re.test(t)).length / n;
  if (share(/^\s*\d{1,2}\.0\b/) >= 0.5) return "1.0";
  if (share(/^\s*\d{1,2}\.\s/) >= 0.5) return "1.";
  if (share(/^\s*section\s+\d/i) >= 0.5) return "section";
  if (share(/^\s*[A-Z]\.\s/) >= 0.5) return "letter";
  if (share(/^\s*\d{1,2}(\.\d{1,2})*\s+\S/) >= 0.5) return "1";
  return "none";
}

type Inst = { line: TextLine; page: ScannedPage; idx: number; all: TextLine[] };

function detectRule(insts: Inst[]): HeadingLevel["rule"] {
  const hits: Array<{ color: string; width: number; gap: number }> = [];
  for (const it of insts) {
    const usableW = it.page.width * 0.5;
    const l = it.page.lines.find((ln) => Math.abs(ln.y1 - ln.y2) <= 0.5 && ln.x2 - ln.x1 >= usableW && ln.y1 > it.line.y && ln.y1 <= it.line.y + 10);
    if (l) hits.push({ color: l.color, width: l.width, gap: clamp(l.y1 - it.line.y, 0, 10) });
  }
  if (hits.length < Math.max(1, insts.length * 0.5)) return null;
  return { color: mode(hits.map((h) => h.color)), width: clamp(median(hits.map((h) => h.width)), 0.25, 4), gap: median(hits.map((h) => h.gap)) };
}

function detectBand(insts: Inst[]): HeadingLevel["band"] {
  const hits: Array<{ color: string; padX: number; padY: number }> = [];
  for (const it of insts) {
    const top = it.line.y - it.line.size * 0.8;
    const r = it.page.rects.find((rc) => rc.x <= it.line.x + 1 && rc.x + rc.w >= it.line.x + it.line.w - 1 && rc.y <= top + 1 && rc.y + rc.h >= it.line.y + 1 && rc.h < it.line.size * 4);
    if (r) hits.push({ color: r.color, padX: clamp(it.line.x - r.x, 0, 20), padY: clamp(top - r.y, 0, 12) });
  }
  if (hits.length < Math.max(1, insts.length * 0.5)) return null;
  return { color: mode(hits.map((h) => h.color)), padX: median(hits.map((h) => h.padX)), padY: median(hits.map((h) => h.padY)) };
}

const gapBefore = (it: Inst) => { const prev = it.all[it.idx - 1]; return prev ? clamp(it.line.y - it.line.size - prev.y, 0, 48) : 12; };
const gapAfter = (it: Inst) => { const next = it.all[it.idx + 1]; return next ? clamp(next.y - next.size - it.line.y, 0, 36) : 6; };

/**
 * Heading levels = distinct (font, size, bold, colour) styles that stand alone
 * on a line, differ from the body, and recur (or are much larger), ranked by
 * size. At most three; running header/footer zones are excluded.
 */
export function detectHeadings(pages: ScannedPage[], body: BodyStyle): HeadingLevel[] {
  const groups = new Map<string, { insts: Inst[]; run: TextRun }>();
  for (const p of interiorPages(pages)) {
    const lines = linesOf(p);
    lines.forEach((ln, idx) => {
      if (!ln.uniform || !ln.text.trim() || ln.text.length > 90 || ln.text.split(" ").length > 14) return;
      if (ln.y < p.height * 0.08 || ln.y > p.height * 0.92) return;
      // Captions and table-header rows are bold but never headings.
      if (/^(table|figure)\s+\d/i.test(ln.text)) return;
      const r = ln.runs[0];
      if (sizeKey(r.size) < body.size - 0.5) return; // a heading is never smaller than body text
      const differs = sizeKey(r.size) > body.size + 0.5 || (r.bold && !body.bold) || (r.color ?? "#000000") !== body.color;
      if (!differs) return;
      const k = `${r.font}|${sizeKey(r.size)}|${r.bold}|${r.color ?? "#000000"}`;
      const g = groups.get(k) ?? { insts: [], run: r };
      g.insts.push({ line: ln, page: p, idx, all: lines });
      groups.set(k, g);
    });
  }
  const cands = [...groups.values()]
    .filter((g) => g.insts.length >= 2 || sizeKey(g.run.size) >= body.size + 4)
    .sort((a, b) => b.run.size - a.run.size || Number(b.run.bold) - Number(a.run.bold));
  const levels: typeof cands = [];
  for (const c of cands) {
    const same = levels.find((l) => l.run.font === c.run.font && Math.abs(l.run.size - c.run.size) <= 0.5 && (l.run.color ?? "") === (c.run.color ?? ""));
    if (same) same.insts.push(...c.insts); else levels.push(c);
  }
  return levels.slice(0, 3).map((g) => {
    const texts = g.insts.map((i) => i.line.text);
    const alpha = texts.filter((t) => /[A-Za-z]/.test(t));
    const upper = alpha.length > 0 && alpha.filter((t) => t === t.toUpperCase()).length >= alpha.length * 0.7;
    const words = alpha.flatMap((t) => t.replace(/^\s*[\dA-Z.]+\s+/, "").split(/\s+/)).filter((w) => /^[A-Za-z]/.test(w) && w.length > 3);
    const titleCase = !upper && words.length > 0 && words.filter((w) => /^[A-Z]/.test(w)).length >= words.length * 0.8;
    return {
      font: g.run.font, size: sizeKey(g.run.size), bold: g.run.bold || isBoldName(g.run.font), italic: g.run.italic, color: g.run.color ?? "#000000",
      lines: g.insts.map((i) => i.line), numbering: detectNumbering(texts), upper, titleCase,
      rule: detectRule(g.insts), band: detectBand(g.insts),
      spaceBefore: median(g.insts.map(gapBefore)), spaceAfter: median(g.insts.map(gapAfter)),
    };
  });
}
```

- [ ] **Step 3: End-to-end on the synthetic PDFs**

Append to `scripts/verify-theme-scan.mjs` (before the final `if (fails)`):

```js
const typo2 = await import(path.resolve(here, "../src/lib/report-theme/derive/typography.ts"));
const b1 = typo2.bodyStyle(scan.pages);
ok(b1 && near(b1.size, 11, 0.3) && b1.color === "#222222" && /Carlito/.test(b1.font), `blue-sans body = Carlito 11 #222222 (${JSON.stringify(b1)})`);
const hl = typo2.detectHeadings(scan.pages, b1);
ok(hl.length >= 2, `blue-sans: ≥2 heading levels (${hl.length})`);
ok(hl[0] && near(hl[0].size, 16, 0.3) && hl[0].color === "#1f4e79" && hl[0].numbering === "1." && hl[0].rule, `blue-sans H1 16pt blue, "1." numbering, ruled (${JSON.stringify({ s: hl[0]?.size, c: hl[0]?.color, n: hl[0]?.numbering, r: !!hl[0]?.rule })})`);
ok(hl[1] && near(hl[1].size, 13, 0.3) && hl[1].numbering === "1", `blue-sans H2 13pt with x.y numbering (${hl[1]?.numbering})`);
const b2 = typo2.bodyStyle(serif.pages);
const hl2 = typo2.detectHeadings(serif.pages, b2);
ok(hl2[0] && hl2[0].numbering === "1.0" && hl2[0].upper, "serif-black H1 uses 1.0 UPPER");
```

- [ ] **Step 4: Run both checks, typecheck, commit**

```bash
node ./scripts/verify-theme-units.mjs && node ./scripts/verify-theme-scan.mjs && pnpm --filter @workspace/tis-api-server run typecheck
git add artifacts/tis-api-server/src/lib/report-theme/derive/typography.ts artifacts/tis-api-server/scripts/verify-theme-units.mjs artifacts/tis-api-server/scripts/verify-theme-scan.mjs
git commit -m "feat(theme): derive body style and heading hierarchy from scanned runs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Page geometry and running header/footer derivation

**Files:**
- Create: `src/lib/report-theme/derive/page.ts`, `src/lib/report-theme/derive/header-footer.ts`
- Modify: `scripts/verify-theme-units.mjs`, `scripts/verify-theme-scan.mjs`

**Interfaces:**
- Consumes: `ScannedPage`, `linesOf`, `interiorPages`; `BodyStyle`, `median`, `mode`, `clamp` from `typography.ts`; `Theme`, `TextStyle` from `theme.ts`.
- Produces (`page.ts`): `pageGeometry(pages, body, zones: { headerBottom: number | null; footerTop: number | null }): Theme["page"] | null`.
- Produces (`header-footer.ts`): `DetectedZone = Theme["header"] & { edge: number }` (non-null), `detectRunningZones(pages, body, headingFont: string | null, ctx: TokenizeCtx): { header: DetectedZone | null; footer: DetectedZone | null; warnings: string[] }`, `TokenizeCtx = { firmName: string; coverTitle: string | null }`, `tokenizeSegment(text, ctx): { text: string; dropped: string[] }`, `classifyRunningText(part, ctx): string | null`, `normalizeName(s): string`.

- [ ] **Step 1: Failing checks**

Append to `scripts/verify-theme-units.mjs`:

```js
// ─── derive/header-footer.ts + derive/page.ts ────────────────────────────────
const hf = await import(path.resolve(here, "../src/lib/report-theme/derive/header-footer.ts"));
const CTX = { firmName: "Acme Traffic Engineering, Inc.", coverTitle: "Maple Grove Mixed-Use Development" };
eq(hf.classifyRunningText("Page 3 of 12", CTX), "Page {{page}} of {{pages}}", "page N of M");
eq(hf.classifyRunningText("Page 7", CTX), "Page {{page}}", "page N");
eq(hf.classifyRunningText("- 7 -", CTX), "{{page}}", "dashed number");
eq(hf.classifyRunningText("12", CTX), "{{page}}", "bare number");
eq(hf.classifyRunningText("Acme Traffic Engineering Inc", CTX), "{{firm.name}}", "firm name (punctuation-insensitive)");
eq(hf.classifyRunningText("Traffic Impact Study", CTX), "{{documentType}}", "document type");
eq(hf.classifyRunningText("Transport Assessment", CTX), "{{documentType}}", "UK document type");
eq(hf.classifyRunningText("March 2025", CTX), "{{project.dateLabel}}", "month year");
eq(hf.classifyRunningText("03/14/2025", CTX), "{{project.dateLabel}}", "numeric date");
eq(hf.classifyRunningText("Maple Grove Mixed-Use Development", CTX), "{{project.projectName}}", "cover title → project name");
eq(hf.classifyRunningText("Prepared for Maple Grove Partners LLC", CTX), null, "client line dropped");
eq(hf.tokenizeSegment("Acme Traffic Engineering, Inc. | Traffic Impact Study | Page 3", CTX), { text: "{{firm.name}} | {{documentType}} | Page {{page}}", dropped: [] }, "pipe-separated segment tokenised");
eq(hf.tokenizeSegment("Maple Grove Partners LLC  –  Page 3 of 9", CTX), { text: "Page {{page}} of {{pages}}", dropped: ["Maple Grove Partners LLC"] }, "unclassified part dropped, separator collapsed");
// Zones: 4 interior pages with a right-aligned header and a centred footer, one page missing the header.
const zrun = (page, str, x, y, w, size = 8, color = "#666666") => ({ page, str, font: "ABCDEF+Arial", size, bold: false, italic: false, serif: false, mono: false, color, x, y, w, h: size });
const bodyRun = (page, y) => ({ page, str: "Body text that is long enough to be a paragraph line for margins.", font: "ABCDEF+Arial", size: 10, bold: false, italic: false, serif: false, mono: false, color: "#000000", x: 72, y, w: 460, h: 10 });
const zpage = (n, withHeader) => ({ page: n, width: 612, height: 792, runs: [...(withHeader ? [zrun(n, "Acme Traffic Engineering, Inc. | Traffic Impact Study", 300, 34, 232)] : []), zrun(n, `Page ${n - 1} of 4`, 280, 760, 52), bodyRun(n, 90), bodyRun(n, 104), bodyRun(n, 700)], rects: [], lines: withHeader ? [{ page: n, x1: 72, y1: 44, x2: 540, y2: 44, color: "#1f4e79", width: 0.5 }] : [], images: [] });
const zpages = [{ page: 1, width: 612, height: 792, runs: [], rects: [], lines: [], images: [] }, zpage(2, true), zpage(3, true), zpage(4, false), zpage(5, true)];
const zbody = { font: "ABCDEF+Arial", size: 10, color: "#000000", serif: false, mono: false, bold: false };
const zones = hf.detectRunningZones(zpages, zbody, null, CTX);
ok(zones.header && zones.header.segments.length === 1 && zones.header.segments[0].align === "right" && zones.header.segments[0].text === "{{firm.name}} | {{documentType}}", `header detected on 3/4 pages, right-aligned, tokenised (${JSON.stringify(zones.header?.segments)})`);
ok(zones.header && zones.header.rule && zones.header.rule.color === "#1f4e79", "header rule detected");
ok(zones.header && zones.header.height >= 38 && zones.header.height <= 52, `header height ≈ 40–50 (${zones.header?.height})`);
ok(zones.footer && zones.footer.segments[0].align === "center" && zones.footer.segments[0].text === "Page {{page}} of {{pages}}", `footer centred + tokenised (${JSON.stringify(zones.footer?.segments)})`);
ok(zones.footer && zones.footer.style.size === 8 && zones.footer.style.color === "#666666", "footer style captured");
ok(zones.footer && zones.footer.edge > 740 && zones.footer.edge < 760, `footer edge (${zones.footer?.edge})`);
const pg = await import(path.resolve(here, "../src/lib/report-theme/derive/page.ts"));
const geom = pg.pageGeometry(zpages, zbody, { headerBottom: zones.header?.edge ?? null, footerTop: zones.footer?.edge ?? null });
eq(geom && geom.size, "LETTER", "geometry snaps to LETTER");
eq(geom && geom.margins.left, 76, "symmetric margin = mean(72, 612-532=80) = 76");
ok(geom && geom.margins.top >= 76 && geom.margins.top <= 84, `top margin from first body line (${geom?.margins.top})`);
ok(geom && geom.margins.bottom >= 88 && geom.margins.bottom <= 96, `bottom margin from last body line (${geom?.margins.bottom})`);
```

- [ ] **Step 2: Write `derive/header-footer.ts`**

```ts
import { interiorPages, linesOf, type ScannedPage, type TextLine } from "../pdf-scan";
import type { Theme } from "../theme";
import { clamp, median, mode, type BodyStyle } from "./typography";

export type TokenizeCtx = { firmName: string; coverTitle: string | null };
export type DetectedZone = NonNullable<Theme["header"]> & { edge: number };

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\b(inc|llc|ltd|pllc|plc|pc|pa|corp|co|company|limited)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2},?\s+)?\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const DOCTYPE_RE = /traffic (impact|study|assessment)|transportation impact|transport (assessment|statement)|trip generation (memo|letter)/i;

/** One header/footer fragment → token string, or null when it must be dropped (spec §5.3). */
export function classifyRunningText(part: string, ctx: TokenizeCtx): string | null {
  const p = part.trim();
  if (!p) return null;
  if (/\bpage\s+\d+\s+of\s+\d+\b/i.test(p)) return p.replace(/\bpage\s+\d+\s+of\s+\d+\b/i, "Page {{page}} of {{pages}}");
  if (/\bpage\s+\d+\b/i.test(p)) return p.replace(/\bpage\s+\d+\b/i, "Page {{page}}");
  if (/^[-–—]?\s*\d{1,3}\s*[-–—]?$/.test(p)) return "{{page}}";
  const firm = normalizeName(ctx.firmName);
  const np = normalizeName(p);
  if (firm && (np === firm || (np.length >= 6 && firm.includes(np)) || (firm.length >= 6 && np.includes(firm)))) return "{{firm.name}}";
  if (DOCTYPE_RE.test(p)) return "{{documentType}}";
  if (DATE_RE.test(p)) return "{{project.dateLabel}}";
  if (ctx.coverTitle && normalizeName(ctx.coverTitle) === np) return "{{project.projectName}}";
  return null;
}

/** Split on visual separators, classify each part, drop the unclassifiable, re-join. */
export function tokenizeSegment(text: string, ctx: TokenizeCtx): { text: string; dropped: string[] } {
  const parts = text.split(/(\s*[|•·]\s*|\s+[–—-]\s+|\s{3,})/);
  const dropped: string[] = [];
  const out: string[] = [];
  let pendingSep = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { pendingSep = parts[i]; continue; }
    const tok = classifyRunningText(parts[i], ctx);
    if (tok === null) { if (parts[i].trim()) dropped.push(parts[i].trim()); pendingSep = out.length ? pendingSep : ""; continue; }
    if (out.length && pendingSep) out.push(pendingSep.trim() ? ` ${pendingSep.trim()} ` : "   ");
    out.push(tok);
    pendingSep = "";
  }
  return { text: out.join("").replace(/\s+/g, " ").trim(), dropped };
}

const normKey = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
const alignOf = (ln: TextLine, W: number): "left" | "center" | "right" => { const c = (ln.x + ln.w / 2) / W; return c < 0.4 ? "left" : c > 0.6 ? "right" : "center"; };

function detectZone(pages: ScannedPage[], where: "top" | "bottom", body: BodyStyle, headingFont: string | null, ctx: TokenizeCtx, warnings: string[]): DetectedZone | null {
  const need = Math.max(2, Math.ceil(pages.length * 0.6));
  const byKey = new Map<string, TextLine[]>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const ln of linesOf(p)) {
      const inZone = where === "top" ? ln.y < p.height * 0.08 : ln.y > p.height * 0.92;
      if (!inZone || !ln.text) continue;
      const k = normKey(ln.text);
      if (seen.has(k)) continue;
      seen.add(k);
      byKey.set(k, [...(byKey.get(k) ?? []), ln]);
    }
  }
  const kept = [...byKey.entries()].filter(([, ls]) => ls.length >= need);
  if (!kept.length) return null;
  const W = pages[0].width, H = pages[0].height;
  const segments: DetectedZone["segments"] = [];
  for (const [, ls] of kept) {
    const first = ls[0];
    const { text, dropped } = tokenizeSegment(first.text, ctx);
    for (const d of dropped) warnings.push(`Dropped ${where === "top" ? "header" : "footer"} text that could not be mapped: "${d}".`);
    if (!text) continue;
    const align = mode(ls.map((l) => alignOf(l, W)));
    if (!segments.some((s) => s.text === text && s.align === align)) segments.push({ align, text });
  }
  if (!segments.length) return null;
  const all = kept.flatMap(([, ls]) => ls);
  const ref = all.reduce((a, b) => (b.runs[0].str.length > a.runs[0].str.length ? b : a));
  const style = { font: (headingFont && ref.font === headingFont && ref.font !== body.font ? "heading" : "body") as "heading" | "body", size: clamp(Math.round(ref.size * 2) / 2, 5, 14), color: ref.color ?? body.color, bold: ref.bold };
  const zoneTop = where === "top" ? 0 : Math.min(...all.map((l) => l.y - l.size));
  const zoneBottom = where === "top" ? Math.max(...all.map((l) => l.y)) : H;
  const rules = pages.flatMap((p) => p.lines.filter((l) => Math.abs(l.y1 - l.y2) <= 0.5 && l.x2 - l.x1 >= W * 0.5 && l.y1 >= zoneTop - 8 && l.y1 <= zoneBottom + 8));
  const rule = rules.length >= need ? { color: mode(rules.map((r) => r.color)), width: clamp(median(rules.map((r) => r.width)), 0.25, 3) } : null;
  const height = where === "top" ? Math.ceil(Math.max(zoneBottom, rule ? median(rules.map((r) => r.y1)) : 0) + 4) : Math.ceil(H - Math.min(zoneTop, rule ? median(rules.map((r) => r.y1)) : H) + 4);
  return { segments: segments.slice(0, 6), style, rule, height: clamp(height, 0, 144), edge: where === "top" ? height : H - height };
}

export function detectRunningZones(pages: ScannedPage[], body: BodyStyle, headingFont: string | null, ctx: TokenizeCtx): { header: DetectedZone | null; footer: DetectedZone | null; warnings: string[] } {
  const warnings: string[] = [];
  const interior = interiorPages(pages);
  if (interior.length < 2) {
    warnings.push("Fewer than two interior pages; running header/footer not detected.");
    return { header: null, footer: null, warnings };
  }
  return { header: detectZone(interior, "top", body, headingFont, ctx, warnings), footer: detectZone(interior, "bottom", body, headingFont, ctx, warnings), warnings };
}
```

- [ ] **Step 3: Write `derive/page.ts`**

```ts
import { interiorPages, type ScannedPage } from "../pdf-scan";
import type { Theme } from "../theme";
import { clamp, mode, type BodyStyle } from "./typography";

const SNAP: Array<["LETTER" | "A4" | "LEGAL" | "TABLOID", number, number]> = [["LETTER", 612, 792], ["A4", 595.28, 841.89], ["LEGAL", 612, 1008], ["TABLOID", 792, 1224]];
const pct = (nums: number[], q: number) => { const s = [...nums].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

/** Page size (snapped to a named size within 2 pt), orientation, and symmetric margins from the body text band. */
export function pageGeometry(pages: ScannedPage[], body: BodyStyle, zones: { headerBottom: number | null; footerTop: number | null }): Theme["page"] | null {
  const interior = interiorPages(pages);
  if (!interior.length) return null;
  const w = mode(interior.map((p) => Math.round(p.width * 100) / 100));
  const h = mode(interior.map((p) => Math.round(p.height * 100) / 100));
  const portrait = h >= w;
  const [pw, ph] = portrait ? [w, h] : [h, w];
  const snap = SNAP.find(([, sw, sh]) => Math.abs(sw - pw) <= 2 && Math.abs(sh - ph) <= 2);
  const size: Theme["page"]["size"] = snap ? snap[0] : [w, h];
  const lefts: number[] = [], rights: number[] = [], tops: number[] = [], bottoms: number[] = [];
  for (const p of interior) {
    const inBand = (r: { y: number }) => !(zones.headerBottom != null && r.y < zones.headerBottom) && !(zones.footerTop != null && r.y > zones.footerTop);
    // Left/right come from body-style lines wide enough to be paragraph text.
    const rs = p.runs.filter((r) => r.font === body.font && Math.abs(r.size - body.size) <= 0.5 && r.w >= 0.45 * p.width && inBand(r));
    // Top/bottom come from EVERY run in the band — pages usually open with a heading, not body text.
    const all = p.runs.filter(inBand);
    if (rs.length) {
      lefts.push(Math.round(Math.min(...rs.map((r) => r.x))));
      rights.push(Math.round(Math.max(...rs.map((r) => r.x + r.w))));
    }
    if (all.length) {
      tops.push(Math.min(...all.map((r) => r.y - r.h)));
      bottoms.push(Math.max(...all.map((r) => r.y)));
    }
  }
  if (!lefts.length || !tops.length) return null;
  const left = mode(lefts);
  // Ragged-right text never reaches the margin on every page; the longest lines do.
  const right = w - pct(rights, 0.95);
  const lr = clamp(Math.round((left + right) / 2), 18, 144);
  const top = clamp(Math.round(pct(tops, 0.2)), 18, 144);
  const bottom = clamp(Math.round(h - pct(bottoms, 0.8)), 18, 144);
  return { size, orientation: portrait ? "portrait" : "landscape", margins: { top, right: lr, bottom, left: lr } };
}
```

- [ ] **Step 4: End-to-end on the synthetic PDFs**

Append to `scripts/verify-theme-scan.mjs`:

```js
const hf2 = await import(path.resolve(here, "../src/lib/report-theme/derive/header-footer.ts"));
const pg2 = await import(path.resolve(here, "../src/lib/report-theme/derive/page.ts"));
const z1 = hf2.detectRunningZones(scan.pages, b1, hl[0]?.font ?? null, { firmName: "Acme Traffic Engineering", coverTitle: "Maple Grove Mixed-Use Development" });
ok(z1.header && z1.header.segments[0].text === "{{firm.name}} | {{documentType}}" && z1.header.segments[0].align === "right", `blue-sans header tokenised (${JSON.stringify(z1.header?.segments)})`);
ok(z1.header && z1.header.rule && z1.header.rule.color === "#1f4e79", "blue-sans header rule");
ok(z1.footer && z1.footer.segments[0].text === "Page {{page}} of {{pages}}", `blue-sans footer tokenised (${JSON.stringify(z1.footer?.segments)})`);
const g1 = pg2.pageGeometry(scan.pages, b1, { headerBottom: z1.header?.edge ?? null, footerTop: z1.footer?.edge ?? null });
ok(g1 && g1.size === "LETTER" && near(g1.margins.left, 72, 8) && near(g1.margins.right, 72, 8) && near(g1.margins.top, 72, 6), `blue-sans margins 72 (${JSON.stringify(g1?.margins)})`);
const z2 = hf2.detectRunningZones(serif.pages, b2, hl2[0]?.font ?? null, { firmName: "Riverside Consulting", coverTitle: null });
ok(z2.header === null, "serif-black has no header");
ok(z2.footer && z2.footer.segments[0].text === "{{firm.name}} - {{page}}", `serif-black footer firm + page (${JSON.stringify(z2.footer?.segments)})`);
const g2 = pg2.pageGeometry(serif.pages, b2, { headerBottom: null, footerTop: z2.footer?.edge ?? null });
ok(g2 && g2.size === "A4" && near(g2.margins.left, 90, 8), `serif-black A4 with 90pt margins (${JSON.stringify(g2)})`);
```

- [ ] **Step 5: Run, typecheck, commit**

```bash
node ./scripts/verify-theme-units.mjs && node ./scripts/verify-theme-scan.mjs && pnpm --filter @workspace/tis-api-server run typecheck
git add artifacts/tis-api-server/src/lib/report-theme/derive/page.ts artifacts/tis-api-server/src/lib/report-theme/derive/header-footer.ts artifacts/tis-api-server/scripts/verify-theme-units.mjs artifacts/tis-api-server/scripts/verify-theme-scan.mjs
git commit -m "feat(theme): derive page geometry and tokenised running header/footer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Palette and table-style derivation

**Files:**
- Create: `src/lib/report-theme/derive/palette.ts`, `src/lib/report-theme/derive/tables.ts`
- Modify: `scripts/verify-theme-units.mjs`, `scripts/verify-theme-scan.mjs`

**Interfaces:**
- Produces (`palette.ts`): `derivePalette(pages, body, headings: HeadingLevel[], mutedCandidates: string[]): Theme["palette"]`.
- Produces (`tables.ts`): `detectTables(pages, body, headingFont: string | null): { style: Theme["table"] | null; count: number }`, `detectFigureCaption(pages, body): Theme["figure"]["caption"] | null`.

- [ ] **Step 1: Failing checks**

Append to `scripts/verify-theme-units.mjs`:

```js
// ─── derive/palette.ts + derive/tables.ts ────────────────────────────────────
const pal = await import(path.resolve(here, "../src/lib/report-theme/derive/palette.ts"));
const palette = pal.derivePalette(pagesA, bodyA, heads, ["#6b7280"]);
eq(palette.primary, "#1a5276", "primary = heading blue");
eq(palette.text, "#000000", "text = body colour");
eq(palette.rule, "#1a5276", "rule = most common stroke colour");
eq(palette.muted, "#6b7280", "muted from candidates");
const tbl = await import(path.resolve(here, "../src/lib/report-theme/derive/tables.ts"));
// A table on page 3: header fill + 3 row rules + a caption above; vertical grid lines.
const tp = mkPage(3, [
  run(3, "Table 2-1: Level of Service Summary", 9, "#6b7280", 72, 296, 200, { bold: true }),
  run(3, "Intersection", 9, "#ffffff", 76, 313, 60, { bold: true }), run(3, "AM", 9, "#ffffff", 276, 313, 20, { bold: true }),
  run(3, "Main St", 9, "#000000", 76, 331, 40), run(3, "B", 9, "#000000", 276, 331, 8),
  run(3, "Oak Rd", 9, "#000000", 76, 349, 40), run(3, "C", 9, "#000000", 276, 349, 8),
  run(3, "Body paragraph text that is long enough to be a real line of text here.", 10, "#000000", 72, 420, 450),
], [
  { page: 3, x1: 72, y1: 320, x2: 372, y2: 320, color: "#9dc3e6", width: 0.5 }, { page: 3, x1: 72, y1: 338, x2: 372, y2: 338, color: "#9dc3e6", width: 0.5 }, { page: 3, x1: 72, y1: 356, x2: 372, y2: 356, color: "#9dc3e6", width: 0.5 },
  { page: 3, x1: 72, y1: 302, x2: 72, y2: 356, color: "#9dc3e6", width: 0.5 }, { page: 3, x1: 272, y1: 302, x2: 272, y2: 356, color: "#9dc3e6", width: 0.5 }, { page: 3, x1: 372, y1: 302, x2: 372, y2: 356, color: "#9dc3e6", width: 0.5 },
], [{ page: 3, x: 72, y: 302, w: 300, h: 18, color: "#1f4e79" }]);
const tres = tbl.detectTables([pagesA[0], pagesA[1], tp], bodyA, null);
ok(tres.count === 1, `one table region found (${tres.count})`);
ok(tres.style && tres.style.header.fill === "#1f4e79" && tres.style.header.color === "#ffffff" && tres.style.header.bold, `header fill/colour/bold (${JSON.stringify(tres.style?.header)})`);
ok(tres.style && tres.style.rules.mode === "grid" && tres.style.rules.color === "#9dc3e6", `grid rules in #9dc3e6 (${JSON.stringify(tres.style?.rules)})`);
ok(tres.style && tres.style.body.size === 9, "body size 9");
ok(tres.style && tres.style.caption.position === "above" && tres.style.caption.style.bold === true, `caption above, bold (${JSON.stringify(tres.style?.caption)})`);
ok(tres.style && tres.style.padX >= 2 && tres.style.padX <= 6, `padX ≈ 4 (${tres.style?.padX})`);
const fp = mkPage(4, [run(4, "Figure 3-1: Site Location Map", 9, "#6b7280", 72, 520, 200, { bold: true })], [], []);
fp.images.push({ page: 4, x: 72, y: 300, w: 468, h: 200, objId: "img1", pixels: null });
const fig = tbl.detectFigureCaption([pagesA[0], fp], bodyA);
ok(fig && fig.position === "below", `figure caption below the image (${JSON.stringify(fig)})`);
```

- [ ] **Step 2: Write `derive/palette.ts`**

```ts
import { interiorPages, type ScannedPage } from "../pdf-scan";
import { chroma, hueDistance, luminance, type Theme } from "../theme";
import type { BodyStyle, HeadingLevel } from "./typography";

/** Brand colours from what the sample actually draws — heading text, fills, rules — not from pixels. */
export function derivePalette(pages: ScannedPage[], body: BodyStyle, headings: HeadingLevel[], mutedCandidates: string[]): Theme["palette"] {
  const weight = new Map<string, number>();
  const add = (c: string | null, w: number) => { if (c) weight.set(c, (weight.get(c) ?? 0) + w); };
  for (const h of headings) add(h.color, 3 * Math.max(1, h.lines.length));
  const lineColors: string[] = [];
  for (const p of interiorPages(pages)) {
    for (const r of p.rects) {
      if (r.w * r.h >= 0.5 * p.width * p.height) continue; // page background
      if (luminance(r.color) > 245) continue;
      add(r.color, 1);
    }
    for (const l of p.lines) { add(l.color, 1); lineColors.push(l.color); }
  }
  const saturated = [...weight.entries()].filter(([c]) => chroma(c) > 25 && luminance(c) < 235).sort((a, b) => b[1] - a[1]);
  const primary = saturated[0]?.[0] ?? headings[0]?.color ?? "#000000";
  const accent = saturated.find(([c]) => hueDistance(c, primary) > 40)?.[0] ?? primary;
  const ruleCount = new Map<string, number>();
  for (const c of lineColors) ruleCount.set(c, (ruleCount.get(c) ?? 0) + 1);
  const rule = [...ruleCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#d1d5db";
  const muted = mutedCandidates.find((c) => chroma(c) <= 24 && luminance(c) >= 80 && luminance(c) <= 190) ?? "#6b7280";
  return { primary, accent, text: body.color, muted, rule };
}
```

- [ ] **Step 3: Write `derive/tables.ts`**

```ts
import { interiorPages, linesOf, type ScannedPage, type StrokeLine, type TextRun } from "../pdf-scan";
import { luminance, type Theme } from "../theme";
import { clamp, median, mode, type BodyStyle } from "./typography";

type Region = { page: ScannedPage; x1: number; x2: number; yTop: number; yBottom: number; hlines: StrokeLine[]; rowRects: ScannedPage["rects"] };

const key2 = (a: number, b: number) => `${Math.round(a / 2) * 2}|${Math.round(b / 2) * 2}`;

/** ≥3 equal-extent horizontal rules, or ≥2 equal-extent row fills, within 40 pt of each other = a table. */
function findRegions(p: ScannedPage): Region[] {
  const regions: Region[] = [];
  const hl = p.lines.filter((l) => Math.abs(l.y1 - l.y2) <= 0.5 && l.x2 - l.x1 >= 120);
  const groups = new Map<string, StrokeLine[]>();
  for (const l of hl) groups.set(key2(l.x1, l.x2), [...(groups.get(key2(l.x1, l.x2)) ?? []), l]);
  for (const ls of groups.values()) {
    const sorted = [...ls].sort((a, b) => a.y1 - b.y1);
    let runStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      if (i === sorted.length || sorted[i].y1 - sorted[i - 1].y1 > 40) {
        const chunk = sorted.slice(runStart, i);
        if (chunk.length >= 3) regions.push({ page: p, x1: chunk[0].x1, x2: chunk[0].x2, yTop: chunk[0].y1, yBottom: chunk[chunk.length - 1].y1, hlines: chunk, rowRects: [] });
        runStart = i;
      }
    }
  }
  const rr = p.rects.filter((r) => r.w >= 120 && r.h >= 8 && r.h <= 40);
  const rgroups = new Map<string, typeof rr>();
  for (const r of rr) rgroups.set(key2(r.x, r.x + r.w), [...(rgroups.get(key2(r.x, r.x + r.w)) ?? []), r]);
  for (const rs of rgroups.values()) {
    const sorted = [...rs].sort((a, b) => a.y - b.y);
    const yTop = sorted[0].y, yBottom = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h;
    const existing = regions.find((g) => Math.abs(g.x1 - sorted[0].x) <= 4 && yTop <= g.yBottom + 4 && yBottom >= g.yTop - 4);
    if (existing) { existing.rowRects.push(...sorted); existing.yTop = Math.min(existing.yTop, yTop); existing.yBottom = Math.max(existing.yBottom, yBottom); }
    else if (sorted.length >= 2) regions.push({ page: p, x1: sorted[0].x, x2: sorted[0].x + sorted[0].w, yTop, yBottom, hlines: [], rowRects: sorted });
  }
  return regions;
}

function captionNear(p: ScannedPage, yTop: number, yBottom: number, re: RegExp): { position: "above" | "below"; run: TextRun } | null {
  for (const ln of linesOf(p)) {
    if (!re.test(ln.text)) continue;
    if (ln.y <= yTop && ln.y >= yTop - 30) return { position: "above", run: ln.runs[0] };
    if (ln.y - ln.size >= yBottom && ln.y - ln.size <= yBottom + 30) return { position: "below", run: ln.runs[0] };
  }
  return null;
}
const styleOf = (r: TextRun, body: BodyStyle, headingFont: string | null): Theme["text"]["caption"] => ({ font: headingFont && r.font === headingFont && r.font !== body.font ? "heading" : "body", size: clamp(Math.round(r.size * 2) / 2, 5, 16), color: r.color ?? body.color, bold: r.bold });

export function detectTables(pages: ScannedPage[], body: BodyStyle, headingFont: string | null): { style: Theme["table"] | null; count: number } {
  const found: Array<{ header: Theme["table"]["header"]; bodySize: number; bodyColor: string; mode: Theme["table"]["rules"]["mode"]; ruleColor: string; ruleWidth: number; zebra: string | null; padX: number; padY: number; caption: Theme["table"]["caption"] | null }> = [];
  for (const p of interiorPages(pages)) {
    for (const g of findRegions(p)) {
      const inRegion = p.runs.filter((r) => r.x >= g.x1 - 2 && r.x <= g.x2 + 2 && r.y >= g.yTop - 2 && r.y <= g.yBottom + 2);
      if (!inRegion.length) continue;
      const headerBottom = g.hlines.length ? (g.hlines.find((l) => l.y1 > g.yTop + 2)?.y1 ?? g.yTop + 18) : g.rowRects[0].y + g.rowRects[0].h;
      const headerRuns = inRegion.filter((r) => r.y <= headerBottom + 1);
      const bodyRuns = inRegion.filter((r) => r.y > headerBottom + 1);
      const headerFillRect = [...g.rowRects, ...p.rects].find((r) => r.y <= g.yTop + 2 && r.y + r.h >= headerBottom - 2 && r.w >= (g.x2 - g.x1) * 0.9 && luminance(r.color) < 250);
      const vlines = p.lines.filter((l) => Math.abs(l.x1 - l.x2) <= 0.5 && l.x1 >= g.x1 - 2 && l.x1 <= g.x2 + 2 && l.y1 <= g.yBottom && l.y2 >= g.yTop);
      const rules = [...g.hlines, ...vlines];
      const rowFills = g.rowRects.filter((r) => r.y > headerBottom - 1 && luminance(r.color) < 250);
      const fillColors = rowFills.map((r) => r.color);
      const zebra = fillColors.length >= 2 && new Set(fillColors).size === 1 && rowFills.length * 2 <= bodyRuns.length + 2 ? fillColors[0] : null;
      const firstCol = bodyRuns.filter((r) => r.x - g.x1 < 30);
      const padYs = g.hlines.flatMap((l) => { const below = inRegion.filter((r) => r.y - r.h >= l.y1 - 1).sort((a, b) => a.y - b.y)[0]; return below ? [clamp(below.y - below.h - l.y1, 1, 10)] : []; });
      const cap = captionNear(p, g.yTop, g.yBottom, /^table\s+\d/i);
      found.push({
        header: { fill: headerFillRect?.color ?? null, color: headerRuns.length ? mode(headerRuns.map((r) => r.color ?? body.color)) : body.color, bold: headerRuns.length > 0 && headerRuns.filter((r) => r.bold).length >= headerRuns.length / 2, size: headerRuns.length ? clamp(Math.round(mode(headerRuns.map((r) => Math.round(r.size * 2) / 2))), 5, 16) : body.size },
        bodySize: bodyRuns.length ? clamp(Math.round(mode(bodyRuns.map((r) => Math.round(r.size * 2) / 2))), 5, 16) : body.size,
        bodyColor: bodyRuns.length ? mode(bodyRuns.map((r) => r.color ?? body.color)) : body.color,
        mode: vlines.length >= 2 ? "grid" : g.hlines.length >= 3 ? "horizontal" : "none",
        ruleColor: rules.length ? mode(rules.map((r) => r.color)) : body.color,
        ruleWidth: rules.length ? clamp(median(rules.map((r) => r.width)), 0.25, 3) : 0.5,
        zebra,
        padX: firstCol.length ? clamp(median(firstCol.map((r) => r.x - g.x1)), 2, 12) : 4,
        padY: padYs.length ? clamp(median(padYs), 1, 10) : 4,
        caption: cap ? { position: cap.position, style: styleOf(cap.run, body, headingFont) } : null,
      });
    }
  }
  if (!found.length) return { style: null, count: 0 };
  const caps = found.filter((f) => f.caption).map((f) => f.caption!);
  const style: Theme["table"] = {
    header: { fill: mode(found.map((f) => f.header.fill)), color: mode(found.map((f) => f.header.color)), bold: mode(found.map((f) => f.header.bold)), size: mode(found.map((f) => f.header.size)) },
    body: { size: mode(found.map((f) => f.bodySize)), color: mode(found.map((f) => f.bodyColor)) },
    rules: { color: mode(found.map((f) => f.ruleColor)), width: median(found.map((f) => f.ruleWidth)), mode: mode(found.map((f) => f.mode)) },
    zebra: mode(found.map((f) => f.zebra)),
    padX: median(found.map((f) => f.padX)),
    padY: median(found.map((f) => f.padY)),
    caption: caps.length ? { position: mode(caps.map((c) => c.position)), style: caps[0].style } : { position: "above", style: { font: "body", size: Math.max(6, body.size - 1), color: body.color, bold: true } },
  };
  return { style, count: found.length };
}

export function detectFigureCaption(pages: ScannedPage[], body: BodyStyle): Theme["figure"]["caption"] | null {
  const hits: Array<{ position: "above" | "below"; run: TextRun }> = [];
  for (const p of interiorPages(pages)) {
    for (const ln of linesOf(p)) {
      if (!/^figure\s+\d/i.test(ln.text)) continue;
      const above = p.images.find((im) => im.y + im.h <= ln.y - ln.size + 2 && im.y + im.h >= ln.y - ln.size - 40);
      const below = p.images.find((im) => im.y >= ln.y - 2 && im.y <= ln.y + 40);
      if (above) hits.push({ position: "below", run: ln.runs[0] });
      else if (below) hits.push({ position: "above", run: ln.runs[0] });
      else hits.push({ position: "below", run: ln.runs[0] });
    }
  }
  if (!hits.length) return null;
  return { position: mode(hits.map((h) => h.position)), style: styleOf(hits[0].run, body, null) };
}
```

- [ ] **Step 4: End-to-end on synthetic PDFs**

Append to `scripts/verify-theme-scan.mjs`:

```js
const pal2 = await import(path.resolve(here, "../src/lib/report-theme/derive/palette.ts"));
const tbl2 = await import(path.resolve(here, "../src/lib/report-theme/derive/tables.ts"));
const P1 = pal2.derivePalette(scan.pages, b1, hl, ["#666666"]);
ok(P1.primary === "#1f4e79" && P1.text === "#222222" && P1.muted === "#666666", `blue-sans palette (${JSON.stringify(P1)})`);
const T1 = tbl2.detectTables(scan.pages, b1, hl[0]?.font ?? null);
ok(T1.count === 2, `blue-sans: two tables (${T1.count})`);
ok(T1.style && T1.style.header.fill === "#1f4e79" && T1.style.header.color === "#ffffff" && T1.style.rules.color === "#9dc3e6" && T1.style.rules.mode === "horizontal", `blue-sans table style (${JSON.stringify(T1.style?.header)} ${JSON.stringify(T1.style?.rules)})`);
ok(T1.style && T1.style.caption.position === "above", "blue-sans caption above");
const T2 = tbl2.detectTables(serif.pages, b2, hl2[0]?.font ?? null);
ok(T2.style && T2.style.header.fill === "#d9d9d9" && T2.style.header.color === "#000000", `serif-black grey header (${JSON.stringify(T2.style?.header)})`);
```

- [ ] **Step 5: Run, typecheck, commit**

```bash
node ./scripts/verify-theme-units.mjs && node ./scripts/verify-theme-scan.mjs && pnpm --filter @workspace/tis-api-server run typecheck
git add artifacts/tis-api-server/src/lib/report-theme/derive/palette.ts artifacts/tis-api-server/src/lib/report-theme/derive/tables.ts artifacts/tis-api-server/scripts/verify-theme-units.mjs artifacts/tis-api-server/scripts/verify-theme-scan.mjs
git commit -m "feat(theme): derive palette and table style from drawn fills and rules

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Cover composition and heading synonyms

**Files:**
- Create: `src/lib/report-theme/derive/cover.ts`, `src/lib/report-theme/derive/synonyms.ts`
- Modify: `scripts/verify-theme-units.mjs`, `scripts/verify-theme-scan.mjs`

**Interfaces:**
- Consumes: `ScannedPage`, `linesOf`; `imagePixelsToPngDataUrl` from `png.ts`; `luminance` from `theme.ts`; `normalizeName`, `TokenizeCtx` from `header-footer.ts`; `canonicalKey`, `stripNumbering` from `canonical.ts`.
- Produces (`cover.ts`): `deriveCover(page1: ScannedPage | undefined, body: BodyStyle, headingFont: string | null, ctx: { firmName: string }): { cover: Theme["cover"]; coverTitle: string | null; warnings: string[] }`.
- Produces (`synonyms.ts`): `mapSynonyms(headingTexts: string[]): Record<string, string>`.

- [ ] **Step 1: Failing checks**

Append to `scripts/verify-theme-units.mjs`:

```js
// ─── derive/cover.ts + derive/synonyms.ts ────────────────────────────────────
const cov = await import(path.resolve(here, "../src/lib/report-theme/derive/cover.ts"));
const syn = await import(path.resolve(here, "../src/lib/report-theme/derive/synonyms.ts"));
eq(syn.mapSynonyms(["1.0 INTRODUCTION", "2.0 SITE TRIP GENERATION", "3.0 Intersection Capacity Analysis", "4.0 Conclusions", "5.0 Conclusions Again"]), { introduction: "INTRODUCTION", "trip-generation": "SITE TRIP GENERATION", "capacity-analysis": "Intersection Capacity Analysis", conclusions: "Conclusions" }, "synonyms keyed canonically, numbering stripped, first wins");
const coverPage = mkPage(1, [
  run(1, "TRAFFIC IMPACT STUDY", 30, "#ffffff", 72, 100, 380, { bold: true }),
  run(1, "Maple Grove Mixed-Use Development", 18, "#222222", 72, 320, 330),
  run(1, "Prepared for: Maple Grove Partners LLC", 12, "#222222", 72, 432, 240),
  run(1, "Prepared by: Acme Traffic Engineering", 12, "#222222", 72, 452, 230),
  run(1, "March 2025", 12, "#222222", 72, 472, 70),
  run(1, "123 Main Street, Suite 400, Springfield", 10, "#222222", 72, 700, 220),
], [], [{ page: 1, x: 0, y: 0, w: 612, h: 140, color: "#1f4e79" }]);
coverPage.images.push({ page: 1, x: 400, y: 20, w: 160, h: 50, objId: "logo", pixels: { width: 32, height: 10, kind: 2, data: new Uint8ClampedArray(32 * 10 * 3).fill(120) } });
const cres = cov.deriveCover(coverPage, bodyA, "ABCDEF+Arial-Bold", { firmName: "Acme Traffic Engineering" });
eq(cres.coverTitle, "Maple Grove Mixed-Use Development", "cover title = largest non-doctype run");
eq(cres.cover.bands, [{ y0: 0, y1: 140, color: "#1f4e79" }], "band captured");
ok(cres.cover.logo && cres.cover.logo.data.startsWith("data:image/png;base64,") && cres.cover.logo.w === 160, "logo exported as PNG with placement");
eq(cres.cover.elements.map((e) => e.role), ["documentType", "projectName", "preparedFor", "preparedBy", "dateLabel"], "elements classified in page order");
eq(cres.cover.elements.find((e) => e.role === "preparedFor").label, "Prepared for:", "preparedFor keeps its label");
ok(cres.cover.hasMetaBlock === true, "meta block present");
ok(!JSON.stringify(cres.cover).includes("Main Street"), "unclassified address line is NOT stored");
ok(cres.warnings.some((w) => /Main Street/.test(w)), "dropped cover text is reported");
const bare = cov.deriveCover(mkPage(1, [run(1, "TRAFFIC IMPACT STUDY", 24, "#000000", 72, 200, 300, { bold: true })]), bodyA, null, { firmName: "X" });
ok(bare.cover.hasMetaBlock === false && bare.coverTitle === null, "cover with only a doc type: no meta block, no title");
```

- [ ] **Step 2: Write `derive/synonyms.ts`**

```ts
import { canonicalKey, stripNumbering } from "../canonical";

/** Sample H1/H2 titles → { canonicalKey: firm's wording }. First occurrence per key wins. */
export function mapSynonyms(headingTexts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const text of headingTexts) {
    const clean = stripNumbering(text).trim();
    if (!clean || clean.length > 80) continue;
    const key = canonicalKey(clean);
    if (key && !out[key]) out[key] = clean;
  }
  return out;
}
```

- [ ] **Step 3: Write `derive/cover.ts`**

```ts
import { linesOf, type ScannedPage, type TextLine } from "../pdf-scan";
import { imagePixelsToPngDataUrl } from "../png";
import { luminance, type CoverElement, type Theme } from "../theme";
import { normalizeName } from "./header-footer";
import type { BodyStyle } from "./typography";

const DOCTYPE_RE = /traffic (impact|study|assessment)|transportation impact|transport (assessment|statement)/i;
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2},?\s+)?\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const PREPARED_FOR_RE = /^(prepared|submitted)\s+(for|to)\b:?/i;
const PREPARED_BY_RE = /^(prepared|submitted)\s+by\b:?/i;

const EMPTY: Theme["cover"] = { background: { kind: "none" }, bands: [], logo: null, elements: [], hasMetaBlock: false };

function elementFor(ln: TextLine, role: CoverElement["role"], W: number, body: BodyStyle, headingFont: string | null, label?: string): CoverElement {
  const c = (ln.x + ln.w / 2) / W;
  const align: CoverElement["align"] = c < 0.4 ? "left" : c > 0.6 ? "right" : "center";
  let x = ln.x, w = W - ln.x - 36;
  if (align === "center") { const m = Math.max(24, Math.min(ln.x, W - (ln.x + ln.w))); x = m; w = W - 2 * m; }
  if (align === "right") { x = 36; w = ln.x + ln.w - 36; }
  return {
    role, x: Math.round(x), y: Math.round(ln.y - ln.size), w: Math.max(20, Math.round(w)), align,
    style: { font: headingFont && ln.font === headingFont && ln.font !== body.font ? "heading" : "body", size: Math.max(4, Math.round(ln.size * 2) / 2), color: ln.color ?? body.color, bold: ln.bold },
    ...(label ? { label } : {}),
  };
}

export function deriveCover(page1: ScannedPage | undefined, body: BodyStyle, headingFont: string | null, ctx: { firmName: string }): { cover: Theme["cover"]; coverTitle: string | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!page1) return { cover: EMPTY, coverTitle: null, warnings: ["No cover page found."] };
  const W = page1.width, H = page1.height, area = W * H;
  const bgImage = page1.images.filter((im) => im.w * im.h >= 0.7 * area && im.pixels).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
  const bgData = bgImage?.pixels ? imagePixelsToPngDataUrl(bgImage.pixels) : null;
  const bgRect = page1.rects.find((r) => r.w * r.h >= 0.9 * area && luminance(r.color) < 250);
  const background: Theme["cover"]["background"] = bgData ? { kind: "image", data: bgData } : bgRect ? { kind: "color", color: bgRect.color } : { kind: "none" };
  if (bgImage && !bgData) warnings.push("Cover background image could not be decoded; using a plain cover.");
  const bands = page1.rects
    .filter((r) => r !== bgRect && r.w >= 0.9 * W && r.h >= 12 && r.h < 0.7 * H && luminance(r.color) < 250)
    .sort((a, b) => a.y - b.y).slice(0, 8)
    .map((r) => ({ y0: Math.round(r.y), y1: Math.round(r.y + r.h), color: r.color }));
  const logoIm = page1.images
    .filter((im) => im !== bgImage && im.pixels && im.w / im.h >= 1.6 && im.w / im.h <= 12 && im.h >= 24 && im.h <= 600)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
  const logoData = logoIm?.pixels ? imagePixelsToPngDataUrl(logoIm.pixels) : null;
  const logo = logoIm && logoData ? { x: Math.round(logoIm.x), y: Math.round(logoIm.y), w: Math.round(logoIm.w), h: Math.round(logoIm.h), data: logoData } : null;
  if (page1.images.length && !logo && !bgData) warnings.push("No logo-shaped image found on the cover.");

  const lines = linesOf(page1).filter((l) => l.text.length > 0);
  const used = new Set<TextLine>();
  const els: CoverElement[] = [];
  const firm = normalizeName(ctx.firmName);
  const docType = lines.filter((l) => DOCTYPE_RE.test(l.text)).sort((a, b) => b.size - a.size)[0];
  if (docType) { used.add(docType); els.push(elementFor(docType, "documentType", W, body, headingFont)); }
  const isMeta = (l: TextLine) => DATE_RE.test(l.text) || PREPARED_FOR_RE.test(l.text) || PREPARED_BY_RE.test(l.text) || normalizeName(l.text) === firm;
  const title = lines.filter((l) => !used.has(l) && !isMeta(l) && l.size >= Math.max(body.size * 1.3, 11)).sort((a, b) => b.size - a.size || a.y - b.y)[0];
  if (title) { used.add(title); els.push(elementFor(title, "projectName", W, body, headingFont)); }
  let hasMeta = false;
  for (const l of lines) {
    if (used.has(l)) continue;
    if (PREPARED_FOR_RE.test(l.text)) { used.add(l); hasMeta = true; els.push(elementFor(l, "preparedFor", W, body, headingFont, l.text.match(PREPARED_FOR_RE)![0])); continue; }
    if (PREPARED_BY_RE.test(l.text)) { used.add(l); hasMeta = true; els.push(elementFor(l, "preparedBy", W, body, headingFont, l.text.match(PREPARED_BY_RE)![0])); continue; }
    if (DATE_RE.test(l.text) && !els.some((e) => e.role === "dateLabel")) { used.add(l); hasMeta = true; els.push(elementFor(l, "dateLabel", W, body, headingFont)); continue; }
    if (firm && normalizeName(l.text) === firm && !els.some((e) => e.role === "firmName")) { used.add(l); els.push(elementFor(l, "firmName", W, body, headingFont)); continue; }
  }
  for (const l of lines) if (!used.has(l)) warnings.push(`Dropped cover text that could not be mapped: "${l.text.slice(0, 60)}".`);
  const elements = els.sort((a, b) => a.y - b.y).slice(0, 12);
  return { cover: { background, bands, logo, elements, hasMetaBlock: hasMeta }, coverTitle: title ? title.text : null, warnings };
}
```

- [ ] **Step 4: End-to-end on synthetic PDFs**

Append to `scripts/verify-theme-scan.mjs`:

```js
const cov2 = await import(path.resolve(here, "../src/lib/report-theme/derive/cover.ts"));
const C1 = cov2.deriveCover(scan.pages[0], b1, hl[0]?.font ?? null, { firmName: "Acme Traffic Engineering" });
ok(C1.coverTitle === "Maple Grove Mixed-Use Development", `blue-sans cover title (${C1.coverTitle})`);
ok(C1.cover.bands.length === 1 && C1.cover.bands[0].color === "#1f4e79" && C1.cover.bands[0].y1 === 140, `blue-sans band (${JSON.stringify(C1.cover.bands)})`);
ok(C1.cover.elements.map((e) => e.role).join(",") === "documentType,projectName,preparedFor,preparedBy,dateLabel", `blue-sans cover roles (${C1.cover.elements.map((e) => e.role).join(",")})`);
ok(C1.cover.elements[0].style.size === 30 && C1.cover.elements[0].style.color === "#ffffff", "blue-sans doc-type element style");
ok(C1.cover.hasMetaBlock, "blue-sans has meta block");
```

- [ ] **Step 5: Run, typecheck, commit**

```bash
node ./scripts/verify-theme-units.mjs && node ./scripts/verify-theme-scan.mjs && pnpm --filter @workspace/tis-api-server run typecheck
git add artifacts/tis-api-server/src/lib/report-theme/derive/cover.ts artifacts/tis-api-server/src/lib/report-theme/derive/synonyms.ts artifacts/tis-api-server/scripts/verify-theme-units.mjs artifacts/tis-api-server/scripts/verify-theme-scan.mjs
git commit -m "feat(theme): derive cover composition and heading synonyms

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: The extractor assembler

**Files:**
- Create: `src/lib/report-theme/extract.ts`
- Modify: `scripts/verify-theme-scan.mjs` (end-to-end `extractTheme` on both synthetic PDFs + error cases)

**Interfaces:**
- Consumes: everything above.
- Produces: `class ThemeExtractError extends Error { status: 400 | 422 }`, `ExtractOptions = { firmName: string; firmId: string; now?: Date }`, `extractTheme(pdf: Buffer, opts): Promise<StoredTheme>`.

- [ ] **Step 1: Failing end-to-end checks**

Append to `scripts/verify-theme-scan.mjs`:

```js
// ─── extract.ts end-to-end ───────────────────────────────────────────────────
const ex = await import(path.resolve(here, "../src/lib/report-theme/extract.ts"));
const themeMod = await import(path.resolve(here, "../src/lib/report-theme/theme.ts"));
const stored1 = await ex.extractTheme(blue, { firmName: "Acme Traffic Engineering", firmId: "f-1", now: new Date("2026-09-14T00:00:00Z") });
ok(themeMod.StoredThemeSchema.safeParse(stored1).success, "blue-sans: stored theme validates");
const t1 = stored1.theme;
ok(t1.id === "firm-f-1", "theme id from firm");
ok(t1.fonts.body.family === "carlito" && t1.fonts.body.requested === "Carlito", `body font Carlito (${JSON.stringify(t1.fonts.body)})`);
ok(t1.page.size === "LETTER" && near(t1.page.margins.left, 72, 8) && near(t1.page.margins.top, 72, 6), `page geometry (${JSON.stringify(t1.page)})`);
ok(t1.headings[0].style.size === 16 && t1.headings[0].style.color === "#1f4e79" && t1.headings[0].numbering === "1." && t1.headings[0].case === "title" && t1.headings[0].rule, `H1 style (${JSON.stringify(t1.headings[0])})`);
ok(t1.headings[1].style.size === 13, `H2 size 13 (${t1.headings[1].style.size})`);
ok(t1.headings[2].style.size < 13 && t1.headings[2].style.size >= 11, `H3 derived from H2 (${t1.headings[2].style.size})`);
ok(t1.palette.primary === "#1f4e79" && t1.palette.text === "#222222", `palette (${JSON.stringify(t1.palette)})`);
ok(t1.table.header.fill === "#1f4e79" && t1.table.rules.color === "#9dc3e6", `table (${JSON.stringify(t1.table.header)})`);
ok(t1.header && t1.header.segments[0].text === "{{firm.name}} | {{documentType}}", `header tokens (${JSON.stringify(t1.header?.segments)})`);
ok(t1.footer && t1.footer.segments[0].text === "Page {{page}} of {{pages}}", `footer tokens (${JSON.stringify(t1.footer?.segments)})`);
ok(t1.cover.bands.length === 1 && t1.cover.elements.length === 5 && t1.cover.hasMetaBlock, "cover carried through");
ok(t1.synonyms["trip-generation"] === "Trip Generation" && t1.synonyms["capacity-analysis"] === "Capacity Analysis", `synonyms (${JSON.stringify(t1.synonyms)})`);
ok(t1.charts.series.length >= 2 && t1.charts.series[0] === "#1f4e79", "chart series from palette");
ok(stored1.source.pages === 6 && stored1.source.extractedAt === "2026-09-14T00:00:00.000Z", "source metadata");
ok(!JSON.stringify(stored1).includes("Maple Grove Partners"), "the sample's client name never reaches the theme");
const stored2 = await ex.extractTheme(await makeSyntheticTis("serif-black"), { firmName: "Riverside Consulting", firmId: "f-2" });
ok(stored2.theme.fonts.body.family === "liberation-serif" && stored2.theme.page.size === "A4" && stored2.theme.headings[0].numbering === "1.0" && stored2.theme.headings[0].case === "upper", `serif-black theme (${stored2.theme.fonts.body.family} ${stored2.theme.page.size} ${stored2.theme.headings[0].numbering} ${stored2.theme.headings[0].case})`);
ok(stored2.theme.header === null && stored2.theme.footer && stored2.theme.footer.segments[0].text === "{{firm.name}} - {{page}}", "serif-black zones");
// Error paths
let e1 = null; try { await ex.extractTheme(Buffer.from("not a pdf at all"), { firmName: "X", firmId: "f" }); } catch (e) { e1 = e; }
ok(e1 instanceof ex.ThemeExtractError && e1.status === 400, `non-PDF → 400 (${e1?.message})`);
const onePage = await new Promise((res) => { const d = new PDFDocument(); const c = []; d.on("data", (x) => c.push(x)); d.on("end", () => res(Buffer.concat(c))); d.text("hello"); d.end(); });
let e2 = null; try { await ex.extractTheme(onePage, { firmName: "X", firmId: "f" }); } catch (e) { e2 = e; }
ok(e2 instanceof ex.ThemeExtractError && e2.status === 422, `one-page PDF → 422 (${e2?.message})`);
```

Add `import PDFDocument from "pdfkit";` at the top of `verify-theme-scan.mjs`.

- [ ] **Step 2: Write `extract.ts`**

```ts
/**
 * Sample TIS PDF → StoredTheme. Scans with pdfjs, runs each derivation,
 * substitutes DEFAULT_THEME values (with a warning) where a derivation finds
 * nothing, and refuses the upload when nearly everything fell back — a
 * scanned image must not silently become "the default theme".
 */
import { DEFAULT_THEME, StoredThemeSchema, tint, type HeadingStyle, type StoredTheme, type TextStyle, type Theme } from "./theme";
import { matchFamily, parsePostScriptName } from "./fonts";
import { scanPdf } from "./pdf-scan";
import { bodyStyle, detectHeadings, type BodyStyle, type HeadingLevel } from "./derive/typography";
import { pageGeometry } from "./derive/page";
import { detectRunningZones } from "./derive/header-footer";
import { derivePalette } from "./derive/palette";
import { detectFigureCaption, detectTables } from "./derive/tables";
import { deriveCover } from "./derive/cover";
import { mapSynonyms } from "./derive/synonyms";

export class ThemeExtractError extends Error {
  constructor(public readonly status: 400 | 422, message: string) {
    super(message);
    this.name = "ThemeExtractError";
  }
}
export type ExtractOptions = { firmName: string; firmId: string; now?: Date };

const EXTRACT_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new ThemeExtractError(422, msg)), ms); }),
  ]);
}

const sameFamily = (a: string, b: string) => parsePostScriptName(a).family === parsePostScriptName(b).family;

function headingStyles(heads: HeadingLevel[], body: BodyStyle, headingFontName: string | null): Theme["headings"] {
  const out: HeadingStyle[] = [];
  for (let i = 0; i < 3; i++) {
    const h = heads[i];
    if (h) {
      const font: TextStyle["font"] = headingFontName && sameFamily(h.font, headingFontName) && !sameFamily(h.font, body.font) ? "heading" : "body";
      out.push({
        style: { font, size: h.size, color: h.color, bold: h.bold, italic: h.italic },
        case: h.upper ? "upper" : h.titleCase ? "title" : "asis",
        numbering: i === 0 ? h.numbering : h.numbering === "none" ? "none" : out[0].numbering,
        rule: h.rule ? { color: h.rule.color, width: h.rule.width, gap: h.rule.gap } : null,
        band: h.band,
        spaceBefore: Math.round(h.spaceBefore), spaceAfter: Math.round(h.spaceAfter),
      });
    } else {
      const prev = out[i - 1] ?? DEFAULT_THEME.headings[0];
      out.push({ ...prev, style: { ...prev.style, size: Math.max(body.size, Math.round(prev.style.size * 0.85 * 2) / 2) }, rule: null, band: null, numbering: prev.numbering === "none" ? "none" : prev.numbering, spaceBefore: Math.round(prev.spaceBefore * 0.8), spaceAfter: Math.round(prev.spaceAfter * 0.8) });
    }
  }
  return [out[0], out[1], out[2]];
}

export async function extractTheme(pdf: Buffer, opts: ExtractOptions): Promise<StoredTheme> {
  if (!pdf.subarray(0, 1024).includes("%PDF-")) throw new ThemeExtractError(400, "Upload a PDF of an example report (this file has no %PDF header).");
  const scan = await withTimeout(scanPdf(pdf, { maxPages: 31 }), EXTRACT_TIMEOUT_MS, "Reading the PDF took longer than 20 seconds.").catch((e: unknown) => {
    if (e instanceof ThemeExtractError) throw e;
    throw new ThemeExtractError(400, `Could not read this PDF: ${(e as Error).message}`);
  });
  if (scan.pages.length < 2) throw new ThemeExtractError(422, "Could not read enough of this PDF — it needs at least two readable pages with a text layer.");

  const warnings = [...scan.warnings];
  let fallbacks = 0;
  const fallback = (msg: string) => { warnings.push(msg); fallbacks++; };

  const body = bodyStyle(scan.pages);
  if (!body) throw new ThemeExtractError(422, "No formatting could be detected (is this a scanned image?).");
  const bodyPs = parsePostScriptName(body.font);
  const bodyFont = matchFamily(bodyPs.family, { serif: body.serif, mono: body.mono });

  const heads = detectHeadings(scan.pages, body);
  if (!heads.length) fallback("No headings detected; using default heading styles.");
  const headPs = heads[0] ? parsePostScriptName(heads[0].font) : bodyPs;
  const headFont = heads[0] ? matchFamily(headPs.family, { serif: heads[0].lines[0]?.runs[0]?.serif ?? body.serif }) : bodyFont;

  const coverRes = deriveCover(scan.pages.find((p) => p.page === 1), body, heads[0]?.font ?? null, { firmName: opts.firmName });
  warnings.push(...coverRes.warnings);

  const zones = detectRunningZones(scan.pages, body, heads[0]?.font ?? null, { firmName: opts.firmName, coverTitle: coverRes.coverTitle });
  warnings.push(...zones.warnings);
  if (!zones.header && !zones.footer) fallback("No running header or footer detected; using the default footer.");

  const geom = pageGeometry(scan.pages, body, { headerBottom: zones.header?.edge ?? null, footerTop: zones.footer?.edge ?? null });
  if (!geom) fallback("Page margins not detected; using 50 pt margins.");

  const tables = detectTables(scan.pages, body, heads[0]?.font ?? null);
  if (!tables.style) fallback("No tables detected; using the default table style.");
  const fig = detectFigureCaption(scan.pages, body);

  const mutedCandidates = [tables.style?.caption.style.color, zones.header?.style.color, zones.footer?.style.color, fig?.style.color].filter((c): c is string => !!c);
  const palette = derivePalette(scan.pages, body, heads, mutedCandidates);

  if (fallbacks >= 4) throw new ThemeExtractError(422, "No formatting could be detected (is this a scanned image?).");

  const captionStyle: TextStyle = tables.style?.caption.style ?? { font: "body", size: Math.max(6, body.size - 1), color: palette.muted, bold: true };
  const strip = <T extends { edge: number }>(z: T | null) => { if (!z) return null; const { edge: _e, ...rest } = z; return rest; };
  const theme: Theme = {
    id: `firm-${opts.firmId}`,
    page: geom ?? DEFAULT_THEME.page,
    fonts: {
      body: { family: bodyFont.family, requested: bodyPs.family, exact: bodyFont.exact },
      heading: { family: headFont.family, requested: headPs.family, exact: headFont.exact },
    },
    text: {
      body: { font: "body", size: body.size, color: body.color },
      caption: captionStyle,
      muted: { font: "body", size: Math.max(6, body.size - 1), color: palette.muted },
    },
    headings: headingStyles(heads, body, heads[0]?.font ?? null),
    palette,
    table: tables.style ?? {
      ...DEFAULT_THEME.table,
      header: { ...DEFAULT_THEME.table.header, fill: tint(palette.primary, 0.86), color: palette.primary },
      rules: { ...DEFAULT_THEME.table.rules, color: palette.rule },
    },
    figure: { caption: fig ?? { position: "below", style: { ...captionStyle, bold: false } } },
    header: strip(zones.header),
    footer: strip(zones.footer),
    cover: coverRes.cover,
    charts: { series: [palette.primary, palette.accent !== palette.primary ? palette.accent : tint(palette.primary, 0.5), tint(palette.primary, 0.3), tint(palette.primary, 0.7)] },
    synonyms: mapSynonyms(heads.slice(0, 2).flatMap((h) => h.lines.map((l) => l.text))),
  };

  const stored = {
    version: 2 as const,
    theme,
    source: { pages: scan.numPages, fontsSeen: scan.fontsSeen.slice(0, 64), extractedAt: (opts.now ?? new Date()).toISOString(), warnings: warnings.slice(0, 64) },
  };
  const parsed = StoredThemeSchema.safeParse(stored);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ThemeExtractError(422, `Detected formatting failed validation at ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "unknown"}`);
  }
  return parsed.data;
}
```

Note on `synonyms`: `mapSynonyms` receives raw heading texts (e.g. `"3. Trip Generation"`); `stripNumbering` in `canonical.ts` removes the number so the stored wording is `"Trip Generation"`.

- [ ] **Step 3: Run, typecheck, commit**

```bash
node ./scripts/verify-theme-scan.mjs && pnpm --filter @workspace/tis-api-server run typecheck
```

Expected `ALL PASS`. If the `case === "title"` assertion fails for blue-sans, check `titleCase` in `detectHeadings` (words ≥ 4 letters, 80 % capitalised); if `H3 derived` fails, check the `0.85` derivation in `headingStyles`.

```bash
git add artifacts/tis-api-server/src/lib/report-theme/extract.ts artifacts/tis-api-server/scripts/verify-theme-scan.mjs
git commit -m "feat(theme): extractTheme assembler with fallback and refusal policy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Public TIS corpus and the accuracy gate

**Files:**
- Create: `scripts/fetch-tis-corpus.mjs`, `scripts/fixtures/tis-corpus/CORPUS.md`, `scripts/fixtures/tis-corpus/expected/<name>.json` (one per PDF), `scripts/verify-theme-extract.mjs`
- Modify: root `.gitignore` (`artifacts/tis-api-server/scripts/fixtures/tis-corpus/*.pdf`), `package.json`

**Interfaces:**
- `CORPUS.md` table columns: `name | url | firm | jurisdiction | why chosen`. `fetch-tis-corpus.mjs` parses that table (rows whose first cell is a slug) and downloads each URL to `scripts/fixtures/tis-corpus/<name>.pdf`.
- `expected/<name>.json`: `{ "bodyFamily": BundledFamily, "bodySize": number, "h1Size": number, "h1Color": "#rrggbb", "primary": "#rrggbb", "pageSize": "LETTER"|"A4"|…, "marginLeft": number, "numbering": Numbering, "footerHasPage": boolean, "headerPresent": boolean, "tableHeaderFill": "#rrggbb"|null }` — hand-verified once against the PDF by opening it.

- [ ] **Step 1: Find 6–8 public TIS PDFs**

Search (WebSearch) for `"traffic impact study" filetype:pdf site:.gov` plus variants (`"traffic impact analysis" pdf planning commission`, `"transportation impact study" pdf city council agenda`, `"traffic impact study" pdf county development review`). For each candidate, `curl -sI` to confirm `200` and `application/pdf`, download, and confirm with `node -e` + `scanPdf` that it has ≥ 10 pages and a text layer (`pages[1].runs.length > 50`). Choose the set so that it covers, at least once each: a serif body; a sans body; Calibri (Word export); an InDesign export (fonts like Myriad/Minion, or `Adobe` in producer); full-bleed cover art; a plain cover; page numbers in the header; page numbers in the footer; coloured headings; black headings; grid tables; rule-only tables. Record every pick in `CORPUS.md`:

```markdown
# Public TIS corpus

PDFs are downloaded by `node ./scripts/fetch-tis-corpus.mjs` and are gitignored — nothing copyrighted is committed. Each row is a publicly posted filing on a municipal or county planning portal.

| name | url | firm | jurisdiction | why chosen |
|---|---|---|---|---|
| example-city-2024 | https://… | Example Engineering | City of Example, ST | Calibri body, blue headings, header page numbers, grid tables |
```

- [ ] **Step 2: Write the fetcher**

```js
// Downloads the corpus listed in CORPUS.md (gitignored PDFs). Run: node ./scripts/fetch-tis-corpus.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "fixtures/tis-corpus");
const rows = readFileSync(path.join(dir, "CORPUS.md"), "utf8").split("\n").filter((l) => /^\|\s*[a-z0-9-]+\s*\|\s*https?:/.test(l)).map((l) => l.split("|").map((c) => c.trim()));
let failures = 0;
for (const [, name, url] of rows) {
  const dest = path.join(dir, `${name}.pdf`);
  if (existsSync(dest)) { console.log(`keep  ${name}.pdf`); continue; }
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "tis-study-corpus-fetch/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.subarray(0, 1024).includes("%PDF-")) throw new Error("not a PDF");
    writeFileSync(dest, buf);
    console.log(`fetch ${name}.pdf (${Math.round(buf.length / 1024)} KB)`);
  } catch (e) { console.error(`FAIL  ${name}: ${e.message}`); failures++; }
}
if (failures) process.exit(1);
```

- [ ] **Step 3: Write the accuracy gate**

Create `scripts/verify-theme-extract.mjs`:

```js
// Accuracy gate: extractTheme over the public corpus vs hand-verified expectations.
// Skips (with a notice, exit 0) when the corpus has not been fetched.
// Run: node ./scripts/fetch-tis-corpus.mjs && node ./scripts/verify-theme-extract.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const { extractTheme } = await import(path.resolve(here, "../src/lib/report-theme/extract.ts"));
const { hexToRgb } = await import(path.resolve(here, "../src/lib/report-theme/theme.ts"));
const dir = path.resolve(here, "fixtures/tis-corpus");
const expectedDir = path.join(dir, "expected");
const names = readdirSync(expectedDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const present = names.filter((n) => existsSync(path.join(dir, `${n}.pdf`)));
if (!present.length) { console.log("SKIP  corpus not fetched (node ./scripts/fetch-tis-corpus.mjs)"); process.exit(0); }
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const dE = (a, b) => { const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b); return Math.hypot(r1 - r2, g1 - g2, b1 - b2) / 2.55; };
for (const name of present) {
  const exp = JSON.parse(readFileSync(path.join(expectedDir, `${name}.json`), "utf8"));
  const t0 = Date.now();
  let stored;
  try { stored = await extractTheme(readFileSync(path.join(dir, `${name}.pdf`)), { firmName: exp.firmName ?? "Unknown Firm", firmId: name }); }
  catch (e) { ok(false, `${name}: extractTheme threw: ${e.message}`); continue; }
  const t = stored.theme;
  ok(Date.now() - t0 < 20_000, `${name}: extracted in ${Date.now() - t0} ms`);
  ok(t.fonts.body.family === exp.bodyFamily, `${name}: body family ${t.fonts.body.family} (expected ${exp.bodyFamily}; requested "${t.fonts.body.requested}")`);
  ok(Math.abs(t.text.body.size - exp.bodySize) <= 0.5, `${name}: body size ${t.text.body.size} (expected ${exp.bodySize})`);
  ok(Math.abs(t.headings[0].style.size - exp.h1Size) <= 1, `${name}: H1 size ${t.headings[0].style.size} (expected ${exp.h1Size})`);
  ok(dE(t.headings[0].style.color, exp.h1Color) < 8, `${name}: H1 colour ${t.headings[0].style.color} (expected ${exp.h1Color})`);
  ok(dE(t.palette.primary, exp.primary) < 8, `${name}: primary ${t.palette.primary} (expected ${exp.primary})`);
  ok(String(t.page.size) === String(exp.pageSize), `${name}: page size ${t.page.size} (expected ${exp.pageSize})`);
  ok(Math.abs(t.page.margins.left - exp.marginLeft) <= 4, `${name}: left margin ${t.page.margins.left} (expected ${exp.marginLeft} ± 4)`);
  ok(t.headings[0].numbering === exp.numbering, `${name}: numbering ${t.headings[0].numbering} (expected ${exp.numbering})`);
  ok(!!t.footer?.segments.some((s) => s.text.includes("{{page}}")) === exp.footerHasPage, `${name}: footer page token ${exp.footerHasPage ? "present" : "absent"}`);
  ok((t.header !== null) === exp.headerPresent, `${name}: header ${exp.headerPresent ? "present" : "absent"}`);
  if (exp.tableHeaderFill !== undefined) ok((t.table.header.fill === null) === (exp.tableHeaderFill === null) && (exp.tableHeaderFill === null || dE(t.table.header.fill, exp.tableHeaderFill) < 8), `${name}: table header fill ${t.table.header.fill} (expected ${exp.tableHeaderFill})`);
  const leaked = stored.source.warnings.filter((w) => /^Dropped/.test(w));
  console.log(`      ${name}: ${stored.source.warnings.length} warning(s), ${leaked.length} dropped segment(s)`);
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
```

- [ ] **Step 4: Write expectations by inspection, then iterate the extractor**

For each corpus PDF: open it (`open scripts/fixtures/tis-corpus/<name>.pdf`), note the body font/size, H1 size/colour, brand colour, page size, left margin (measure a body line's x in a PDF inspector or trust `scanPdf` output only after eyeballing), numbering style, whether page numbers sit in the header or footer, and the table header fill. Write `expected/<name>.json`. Run the gate. **Every FAIL here is an extractor bug on real-world input — fix the derive module, add a synthetic case for the pattern to `verify-theme-units.mjs`, re-run all checks.** Typical real-world issues to expect: Word draws heading rules as thin filled rects (handled), table borders drawn as one large stroked rectangle plus internal lines (grid detection via `vlines`), body text split into many runs with kerning numbers (run merging in `linesOf`), running headers on odd/even pages only (the 60 % threshold), page numbers as `3` alone (bare-number rule).

Stop when the gate passes for every corpus file. The gate must be green before Task 15.

- [ ] **Step 5: Wire, ignore, commit**

Add to `package.json`: `"fetch:tis-corpus": "node ./scripts/fetch-tis-corpus.mjs"`, `"check:theme-extract": "node ./scripts/verify-theme-extract.mjs"`. Add to root `.gitignore`: `artifacts/tis-api-server/scripts/fixtures/tis-corpus/*.pdf`.

```bash
git add .gitignore artifacts/tis-api-server/package.json artifacts/tis-api-server/scripts/fetch-tis-corpus.mjs artifacts/tis-api-server/scripts/fixtures/tis-corpus/CORPUS.md artifacts/tis-api-server/scripts/fixtures/tis-corpus/expected artifacts/tis-api-server/scripts/verify-theme-extract.mjs artifacts/tis-api-server/src/lib/report-theme artifacts/tis-api-server/scripts/verify-theme-units.mjs
git commit -m "chore(theme): public TIS corpus and the extractor accuracy gate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase C — Wiring: API, preview, frontend, docs

### Task 15: Preview fixtures module, routes, and retiring the V1 importer

**Files:**
- Create: `src/lib/report-theme/preview-fixtures.ts`
- Modify: `src/routes/firms.ts` (template routes, lines 276–405 in the original), `scripts/verify-theme-units.mjs`
- Delete: `src/lib/report-template/ingest.ts`, `src/lib/report-template/pdf-assets.ts`

**Interfaces:**
- Consumes: `extractTheme`, `ThemeExtractError` (`extract.ts`); `classifyStoredTemplate`, `parseStoredTheme`, `summarizeTheme` (`theme.ts`); `saveFirmTheme`, `clearFirmTheme` (`store.ts`); `renderStudyPdf` (`pdf-export.ts`); `regionForCoordinate` (`regions.ts`), `stateForCoordinate` (`state-boundaries.ts`); `db`, `tisProjectsTable`, `firmsTable` (`@workspace/db`); `generateRateLimiter` (`security.ts`).
- Produces (`preview-fixtures.ts`): `type FixtureFamily = "fl" | "ga" | "tx" | "ny" | "nc" | "sc"`, `regionFamilyForCoordinate(lat, lon): FixtureFamily` (FL→fl, GA→ga, TX→tx, NY→ny, NC→nc, SC→sc, anything else → fl), `loadPreviewFixture(family): PreviewFixture`, `projectFromFixture(fx): StoredProject-shaped object` (fixed `createdAt` of `2026-01-15T12:00:00Z`), `latestProjectFamily(firmId): Promise<FixtureFamily>` (most recent `tis_projects` row with coordinates, else `"fl"`).
- Routes: `POST /firms/report-template` → `{ ok: true, summary: ThemeSummary }` or `{ error }` with 400/422/500; `GET /firms/report-template` → `{ template: ThemeSummary | null, legacy?: true, invalid?: true }`; `GET /firms/report-template/preview.pdf` → `application/pdf` inline, 404 `{ error }` when the firm has no theme; `DELETE` unchanged.

- [ ] **Step 1: Failing unit checks**

Append to `scripts/verify-theme-units.mjs`:

```js
// ─── preview-fixtures.ts ─────────────────────────────────────────────────────
const pf = await import(path.resolve(here, "../src/lib/report-theme/preview-fixtures.ts"));
eq(pf.regionFamilyForCoordinate(25.8456, -80.2103), "fl", "Miami → fl");
eq(pf.regionFamilyForCoordinate(33.749, -84.388), "ga", "Atlanta → ga");
eq(pf.regionFamilyForCoordinate(29.4241, -98.4936), "tx", "San Antonio → tx");
eq(pf.regionFamilyForCoordinate(40.7128, -74.006), "ny", "NYC → ny");
eq(pf.regionFamilyForCoordinate(35.7796, -78.6382), "nc", "Raleigh → nc");
eq(pf.regionFamilyForCoordinate(34.0007, -81.0348), "sc", "Columbia → sc");
eq(pf.regionFamilyForCoordinate(40.4406, -79.9959), "fl", "Pittsburgh (no PA fixture) → fl fallback");
eq(pf.regionFamilyForCoordinate(NaN, NaN), "fl", "no coordinate → fl");
for (const fam of ["fl", "ga", "tx", "ny", "nc", "sc"]) { const fx = pf.loadPreviewFixture(fam); ok(fx.family === fam && typeof fx.report === "object" && fx.report.request, `fixture ${fam} loads with a report + request`); }
const proj = pf.projectFromFixture(pf.loadPreviewFixture("tx"));
ok(proj.studyType === "tis" && proj.siteLat && proj.createdAt.toISOString() === "2026-01-15T12:00:00.000Z" && proj.resultPayload === pf.loadPreviewFixture("tx").report, "projectFromFixture shape");
```

`preview-fixtures.ts` imports `@workspace/db` (for `latestProjectFamily`), which the ts-loader resolves through `lib/db`'s directory index; the check never calls `latestProjectFamily`, and the db module connects lazily, so no `DATABASE_URL` is needed. If the import throws at module evaluation, set `process.env.DATABASE_URL = "postgres://localhost/tis_check_stub_db"` at the top of the check script (same stub `verify-driveway-routing.mjs` uses).

- [ ] **Step 2: Write `preview-fixtures.ts`**

```ts
/**
 * Committed sample studies the preview endpoint renders through a firm's
 * theme, one per regional renderer family (copied from the sample masters by
 * scripts/build-preview-fixtures.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, tisProjectsTable } from "@workspace/db";
import { regionForCoordinate } from "../regions";
import { stateForCoordinate } from "../state-boundaries";

export type FixtureFamily = "fl" | "ga" | "tx" | "ny" | "nc" | "sc";
export type PreviewFixture = {
  family: FixtureFamily;
  key: string;
  projectName: string;
  latitude: number;
  longitude: number;
  landUseCode: string;
  report: { request?: unknown } & Record<string, unknown>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = (() => {
  for (const c of [
    path.resolve(__dirname, "../../../data/preview-fixtures"),
    path.resolve(__dirname, "../../data/preview-fixtures"),
    path.resolve(__dirname, "../data/preview-fixtures"),
  ]) {
    if (existsSync(path.join(c, "fl.json"))) return c;
  }
  return path.resolve(__dirname, "../../../data/preview-fixtures");
})();

const BY_STATE: Record<string, FixtureFamily> = { FL: "fl", GA: "ga", TX: "tx", NY: "ny", NC: "nc", SC: "sc" };

export function regionFamilyForCoordinate(lat: number, lon: number): FixtureFamily {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "fl";
  const region = regionForCoordinate(lat, lon);
  const state = stateForCoordinate(lat, lon) ?? region?.stateCode ?? null;
  return (state && BY_STATE[state]) || "fl";
}

const cache = new Map<FixtureFamily, PreviewFixture>();
export function loadPreviewFixture(family: FixtureFamily): PreviewFixture {
  const hit = cache.get(family);
  if (hit) return hit;
  const fx = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${family}.json`), "utf8")) as PreviewFixture;
  cache.set(family, fx);
  return fx;
}

/** StoredProject-shaped record; fixed createdAt so a preview is reproducible. */
export function projectFromFixture(fx: PreviewFixture) {
  return {
    id: `preview-${fx.key}`,
    studyType: "tis",
    projectName: fx.projectName,
    landUseCode: fx.landUseCode,
    siteLat: String(fx.latitude),
    siteLon: String(fx.longitude),
    version: 1,
    createdAt: new Date("2026-01-15T12:00:00Z"),
    requestPayload: fx.report.request,
    resultPayload: fx.report,
  };
}

/** Family of the firm's most recent TIS project with a coordinate, else Florida. */
export async function latestProjectFamily(firmId: string): Promise<FixtureFamily> {
  try {
    const rows = await db
      .select({ siteLat: tisProjectsTable.siteLat, siteLon: tisProjectsTable.siteLon })
      .from(tisProjectsTable)
      .where(and(eq(tisProjectsTable.firmId, firmId), isNotNull(tisProjectsTable.siteLat)))
      .orderBy(desc(tisProjectsTable.createdAt))
      .limit(1);
    const r = rows[0];
    return r ? regionFamilyForCoordinate(Number(r.siteLat), Number(r.siteLon)) : "fl";
  } catch {
    return "fl";
  }
}
```

Run `node ./scripts/verify-theme-units.mjs` → `ALL PASS`. If `Pittsburgh → fl` fails because `stateForCoordinate` returns `"PA"`, that is expected — the map has no PA entry, so the fallback is `fl`; check the `||` chain.

- [ ] **Step 3: Rewrite the template routes in `firms.ts`**

Replace the imports on lines 43–45 with:

```ts
import { extractTheme, ThemeExtractError } from "../lib/report-theme/extract";
import { classifyStoredTemplate, parseStoredTheme, summarizeTheme } from "../lib/report-theme/theme";
import { clearFirmTheme, saveFirmTheme } from "../lib/report-template/store";
import { latestProjectFamily, loadPreviewFixture, projectFromFixture } from "../lib/report-theme/preview-fixtures";
import { renderStudyPdf } from "../lib/pdf-export";
import { generateRateLimiter } from "../lib/security";
```

Add below the existing `upload` multer:

```ts
// Sample-report uploads: real filed TIS PDFs with figures run 5–15 MB.
const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
```

Replace the three template handlers (POST / GET / DELETE, plus the Task 5 placeholder) with:

```ts
/**
 * POST /firms/report-template — upload a sample TIS PDF; the firm's studies
 * then render in its format (page geometry, fonts, palette, headings,
 * header/footer, tables, cover). See report-theme/extract.ts.
 */
router.post("/firms/report-template", templateUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in to upload a report template." }); return; }
  const user = req.user!;
  const { firm, role } = await getOrCreateFirmForUser(user.id, { email: user.email, firstName: user.firstName, lastName: user.lastName });
  if (!requireRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Only owners or admins can set the firm report template." }); return; }
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) { res.status(400).json({ error: "No file uploaded. Use multipart/form-data with field 'file' (a PDF)." }); return; }
  if (!/pdf$/i.test(file.mimetype) && !/\.pdf$/i.test(file.originalname)) { res.status(400).json({ error: "Upload a PDF of an example report." }); return; }
  try {
    const stored = await extractTheme(file.buffer, { firmName: firm.name, firmId: firm.id });
    // DB column is the durable copy (Railway's filesystem is ephemeral); the
    // filesystem store keeps DB-less local dev working.
    await db.update(firmsTable).set({ reportTemplate: stored }).where(eq(firmsTable.id, firm.id));
    saveFirmTheme(firm.id, stored);
    res.json({ ok: true, summary: summarizeTheme(stored) });
  } catch (err) {
    if (err instanceof ThemeExtractError) { res.status(err.status).json({ error: err.message }); return; }
    req.log.error({ err }, "firms.template_upload_failed");
    res.status(500).json({ error: "Template import failed." });
  }
});

/** GET /firms/report-template — summary of the format this firm's studies render in. */
router.get("/firms/report-template", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in required." }); return; }
  const user = req.user!;
  const { firm } = await getOrCreateFirmForUser(user.id, { email: user.email, firstName: user.firstName, lastName: user.lastName });
  switch (classifyStoredTemplate(firm.reportTemplate)) {
    case "none": res.json({ template: null }); return;
    case "legacy": res.json({ template: null, legacy: true }); return;
    case "invalid": req.log.error({ firmId: firm.id }, "firms.template_invalid"); res.json({ template: null, invalid: true }); return;
    case "v2": res.json({ template: summarizeTheme(parseStoredTheme(firm.reportTemplate)!) }); return;
  }
});

/**
 * GET /firms/report-template/preview.pdf — a committed sample study rendered
 * through the firm's theme, region-matched to the firm's latest project.
 */
router.get("/firms/report-template/preview.pdf", generateRateLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in required." }); return; }
  const user = req.user!;
  const { firm } = await getOrCreateFirmForUser(user.id, { email: user.email, firstName: user.firstName, lastName: user.lastName });
  if (!parseStoredTheme(firm.reportTemplate)) { res.status(404).json({ error: "This firm has no imported report format yet." }); return; }
  try {
    const fixture = loadPreviewFixture(await latestProjectFamily(firm.id));
    const buffer = await renderStudyPdf(projectFromFixture(fixture) as Parameters<typeof renderStudyPdf>[0], {
      firmId: firm.id, reportTemplate: firm.reportTemplate, name: firm.name, logoUrl: firm.logoUrl,
      brandColor: firm.brandColor, addressLine: firm.addressLine, phone: firm.phone, website: firm.website,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="format-preview.pdf"');
    res.send(buffer);
  } catch (err) {
    req.log.error({ err }, "firms.template_preview_failed");
    res.status(500).json({ error: "Could not render the preview." });
  }
});

/** DELETE /firms/report-template — revert to the region's default format. */
router.delete("/firms/report-template", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in required." }); return; }
  const user = req.user!;
  const { firm, role } = await getOrCreateFirmForUser(user.id, { email: user.email, firstName: user.firstName, lastName: user.lastName });
  if (!requireRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Only owners or admins can change the firm report template." }); return; }
  await db.update(firmsTable).set({ reportTemplate: null }).where(eq(firmsTable.id, firm.id));
  clearFirmTheme(firm.id);
  res.json({ ok: true, template: null });
});
```

`StoredProject` is module-private in `pdf-export.ts`; the `Parameters<typeof renderStudyPdf>[0]` cast keeps the route honest without exporting it. `renderStudyPdf` is already exported (routes/projects.ts uses it). The now-unused `writeFileSync`/`rmSync`/`os`/`path` imports at the top of `firms.ts` can be removed if nothing else in the file uses them.

- [ ] **Step 4: Delete the V1 modules**

Delete `src/lib/report-template/ingest.ts` and `src/lib/report-template/pdf-assets.ts`. Search for remaining references to `report-template/ingest`, `report-template/pdf-assets`, `ingestTemplateFromPdf`, `extractBrand`, `writeTemplateJson`, `saveFirmTemplate`, `loadFirmTemplate`, `clearFirmTemplate` across `src/` and `scripts/` — expected: none in `src/`; if a script under `scripts/` references them, delete that script (it exercised the poppler path that no longer exists). `report-template/registry.ts` keeps `writeTemplateJson` (used by nothing now — leave it; `noUnusedLocals` is off and it is an export).

- [ ] **Step 5: Typecheck and all checks**

```bash
pnpm --filter @workspace/tis-api-server run typecheck && node ./scripts/verify-theme-units.mjs && node ./scripts/verify-theme-default-identity.mjs && node ./scripts/verify-theme-render.mjs
```

- [ ] **Step 6: Manual route smoke (only if a local DB is running)**

Start the API (`pnpm --filter @workspace/tis-api-server run dev`), sign in through the app, export the `tis_sid` cookie, then:

```bash
curl -s -b cookies.txt -F "file=@artifacts/tis-api-server/scripts/fixtures/tis-corpus/<name>.pdf" http://localhost:8090/tis-api/firms/report-template | head -c 600
curl -s -b cookies.txt http://localhost:8090/tis-api/firms/report-template
curl -s -b cookies.txt -o /tmp/preview.pdf -w "%{http_code} %{content_type}\n" http://localhost:8090/tis-api/firms/report-template/preview.pdf
```

Expected: `{"ok":true,"summary":{…}}`, the same summary from GET, and `200 application/pdf`.

- [ ] **Step 7: Commit**

```bash
git add -A artifacts/tis-api-server/src/lib/report-theme/preview-fixtures.ts artifacts/tis-api-server/src/routes/firms.ts artifacts/tis-api-server/src/lib/report-template artifacts/tis-api-server/scripts/verify-theme-units.mjs
git commit -m "feat(theme): template routes extract a theme, report a summary, and render a preview

Retires the poppler-based V1 importer, which never ran in production.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Settings page — summary card and Preview PDF

**Files:**
- Modify: `artifacts/atlanta-tis/src/pages/settings-firm.tsx` (type `FirmTemplate` ~line 38, state ~85, the load effect ~95–100, `uploadTemplateFile` ~151, `removeTemplate` ~185, the "Report format" card ~396–450)

- [ ] **Step 1: Replace the summary type**

```ts
/** Summary of the firm's imported report format (GET /firms/report-template). */
type FirmTemplate = {
  pageSize: string;
  orientation: "portrait" | "landscape";
  margins: { top: number; right: number; bottom: number; left: number };
  fonts: Array<{ role: "body" | "heading"; requested: string; used: string; exact: boolean }>;
  palette: { primary: string; accent: string; text: string; muted: string; rule: string };
  header: string | null;
  footer: string | null;
  cover: "image" | "color" | "plain";
  table: { headerFill: string | null; mode: "horizontal" | "grid" | "none" };
  numbering: string;
  warnings: string[];
  extractedAt: string;
};
```

Add state `const [templateLegacy, setTemplateLegacy] = useState(false);` next to `templateInvalid`. Wherever `setTemplateInvalid(!!tpl?.invalid)` / `setTemplateInvalid(!!next?.invalid)` runs, also run `setTemplateLegacy(!!tpl?.legacy)` / `setTemplateLegacy(!!next?.legacy)`; in `removeTemplate` add `setTemplateLegacy(false)`.

- [ ] **Step 2: Upload feedback**

In `uploadTemplateFile`, replace the `setInfo(...)` call with:

```ts
      const s = data.summary as FirmTemplate | undefined;
      const subs = s?.fonts.filter((f) => !f.exact).map((f) => `${f.requested} → ${f.used}`) ?? [];
      setInfo(
        `Format imported — ${s?.pageSize ?? "?"} pages, ${s?.fonts.map((f) => f.requested).join(" / ") ?? "?"}` +
          (subs.length ? ` (substituted: ${subs.join(", ")})` : "") +
          (s?.warnings.length ? `. ${s.warnings.length} note${s.warnings.length === 1 ? "" : "s"} below.` : "."),
      );
```

- [ ] **Step 3: Replace the card JSX**

Replace the `{template ? ( … ) : templateInvalid ? ( … ) : ( … )}` block with:

```tsx
              {template ? (
                <div className="border rounded-md p-3 bg-muted/20 space-y-2" data-testid="card-firm-template">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(["primary", "accent", "text", "muted", "rule"] as const).map((k) => (
                      <span key={k} title={`${k} ${template.palette[k]}`} className="inline-block w-4 h-4 rounded-sm border" style={{ backgroundColor: template.palette[k] }} aria-label={`${k} colour ${template.palette[k]}`} />
                    ))}
                    <span className="text-sm font-medium ml-1">{template.pageSize} {template.orientation}</span>
                    <span className="text-xs text-muted-foreground">· margins {Math.round(template.margins.left)} / {Math.round(template.margins.top)} pt</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {template.fonts.map((f) => (
                      <span key={f.role} className="mr-3">
                        {f.role}: <span className="font-medium text-foreground">{f.requested}</span>
                        {!f.exact && <span className="ml-1 rounded bg-amber-100 text-amber-800 px-1">substituted → {f.used}</span>}
                      </span>
                    ))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Headings {template.numbering === "none" ? "unnumbered" : `numbered "${template.numbering}"`} · tables {template.table.mode}
                    {template.table.headerFill ? " with filled header" : ""} · {template.cover} cover
                  </p>
                  {(template.header || template.footer) && (
                    <p className="text-xs text-muted-foreground font-mono">
                      {template.header && <span className="block">header: {template.header}</span>}
                      {template.footer && <span className="block">footer: {template.footer}</span>}
                    </p>
                  )}
                  {template.warnings.length > 0 && (
                    <ul className="text-xs text-amber-700 list-disc pl-4" data-testid="list-firm-template-warnings">
                      {template.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
                      {template.warnings.length > 6 && <li>…and {template.warnings.length - 6} more</li>}
                    </ul>
                  )}
                </div>
              ) : templateLegacy ? (
                <p className="text-xs text-amber-700" data-testid="text-firm-template-legacy">
                  Your example report was uploaded with an earlier version. Re-upload it to enable the new format matching; until then studies render in the standard format.
                </p>
              ) : templateInvalid ? (
                <p className="text-xs text-amber-700">
                  A format was uploaded but can no longer be read, so studies are rendering in the standard format. Re-upload the example report to fix it.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Studies render in the standard format for each site's region.
                </p>
              )}
```

In the button row, before the Remove button, add:

```tsx
                {template && (
                  <a
                    href="/tis-api/firms/report-template/preview.pdf"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                    data-testid="link-firm-template-preview"
                  >
                    Preview PDF
                  </a>
                )}
```

Update the help paragraph to: "Upload one of your own finished studies as a PDF (up to 20 MB). We read its page size and margins, fonts, colours, heading style, running header and footer, table style and cover, and your future studies come out in that format. It needs a text layer — a scanned report won't import."

- [ ] **Step 4: Typecheck, build, look at it**

```bash
pnpm --filter @workspace/atlanta-tis run typecheck && pnpm --filter @workspace/atlanta-tis run build
```

Then run the app (the `run` skill, or `pnpm dev` at the repo root), open `/tis/settings/firm` as a firm owner, upload a corpus PDF, confirm the card shows swatches/fonts/warnings, click **Preview PDF** and confirm a PDF opens in a new tab. Screenshot the card and the first two preview pages for the user.

- [ ] **Step 5: Commit**

```bash
git add artifacts/atlanta-tis/src/pages/settings-firm.tsx
git commit -m "feat(tis): report-format summary card with Preview PDF in firm settings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Corpus render check, docs, and acceptance

**Files:**
- Modify: `scripts/verify-theme-render.mjs` (corpus themes + margin guard), `replit.md`, `package.json`

- [ ] **Step 1: Render every fixture through every corpus theme**

Change the bundle call at the top of `scripts/verify-theme-render.mjs` to export the extractor and scanner as well:

```js
const { mod, cleanup } = await loadRendererBundle(`export { DEFAULT_THEME } from "./report-theme/theme";
export { extractTheme } from "./report-theme/extract";
export { scanPdf } from "./report-theme/pdf-scan";`);
```

Append inside the `try` (after the synthetic loop and the UK smoke):

```js
  // Corpus themes: every fixture × every extracted real-world theme.
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const corpusDir = new URL("./fixtures/tis-corpus/", import.meta.url).pathname;
  const pdfs = existsSync(corpusDir) ? readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")) : [];
  if (!pdfs.length) console.log("SKIP  corpus not fetched; corpus render checks skipped");
  const FONT_RE = { "carlito": /Carlito/, "liberation-sans": /LiberationSans/, "liberation-serif": /LiberationSerif/, "liberation-mono": /LiberationMono/, "caladea": /Caladea/, "gelasio": /Gelasio/, "open-sans": /OpenSans/, "roboto": /Roboto/, "lato": /Lato/, "montserrat": /Montserrat/, "source-sans-3": /SourceSans3/, "dejavu-sans": /DejaVuSans/ };
  for (const f of pdfs) {
    const stored = await mod.extractTheme(readFileSync(path.join(corpusDir, f)), { firmName: "Corpus Firm", firmId: f.replace(/\.pdf$/, "") });
    for (const fam of FIXTURE_FAMILIES) {
      const project = projectFromFixture(loadFixture(fam));
      let buf;
      try { buf = await mod.renderStudyPdf(project, { name: "Corpus Firm", logoUrl: null, firmId: "c", reportTemplate: stored }); }
      catch (e) { ok(false, `${f} × ${fam}: threw ${e.message}`); continue; }
      const txt = buf.toString("latin1");
      const famUsed = stored.theme.fonts.body.family;
      ok(FONT_RE[famUsed].test(txt), `${f} × ${fam}: body font ${famUsed} embedded`);
      const p = pdfPageCount(buf);
      ok(p >= 4 && p <= 120, `${f} × ${fam}: ${p} pages`);
      // Margin guard: nothing drawn outside the theme's text band on body pages
      // (cover excluded). A hit means a renderer call site still assumes 50 pt.
      const sc = await mod.scanPdf(buf, { maxPages: 12 });
      const L = stored.theme.page.margins.left;
      const R = (sc.pages[1]?.width ?? 612) - stored.theme.page.margins.right;
      const overflow = sc.pages.slice(1).flatMap((pg) => pg.runs.filter((r) => r.x < L - 2 || r.x + r.w > R + 2));
      ok(overflow.length === 0, `${f} × ${fam}: no text outside the margins (${overflow.length} runs${overflow[0] ? `, e.g. "${overflow[0].str.slice(0, 30)}" at x=${overflow[0].x} on page ${overflow[0].page}` : ""})`);
    }
  }
```

Run `node ./scripts/verify-theme-render.mjs` → `ALL PASS` (6 fixtures × N corpus themes; allow a few minutes). Running header/footer runs sit inside `[L, R]` by construction; if a body run overflows, find the call site (the run's text tells you which section) and make it use `pageMargin()` / `doc.page.width - pageMargin()`.

- [ ] **Step 2: Update `replit.md`**

In "Where things live", add:

```
- **Report theme (firm format import)**: `artifacts/tis-api-server/src/lib/report-theme/` — `extract.ts` (sample PDF → Theme via the pdfjs operator-list scanner `pdf-scan.ts` and `derive/*`), `theme.ts` (schema + DEFAULT_THEME), `active.ts` (per-render module state), `draw.ts` (themed primitives the regional renderers delegate to), `fonts.ts` (bundled substitute fonts under `data/fonts/<family>/`), `preview-fixtures.ts` (`data/preview-fixtures/*.json`). Routes: `POST/GET/DELETE /tis-api/firms/report-template`, `GET /tis-api/firms/report-template/preview.pdf`. Checks: `pnpm --filter @workspace/tis-api-server run check:theme`. Spec: `docs/superpowers/specs/2026-09-14-report-theme-import-design.md`.
```

Add to "Gotchas":

```
- **Report theme is module state**: `withTheme()` in `report-theme/active.ts` sets the active theme for the synchronous draw pass in `renderStudyPdf`. Never `await` inside that block — a concurrent request would read the wrong theme. `withTheme` throws if the callback returns a Promise.
- **Themed margins are symmetric**: every renderer uses `pageMargin()` for both edges, so a theme's `margins.left` must equal `margins.right` (the extractor averages them). Top/bottom are independent.
- **Default theme is byte-pinned**: `check:theme-default-identity` compares three fixture renders against `scripts/fixtures/theme-identity-baseline.json`. Re-pin (`--pin`) only for a deliberate render change, in the same PR that makes it.
- **The V1 poppler importer is gone**: rows in `firms.report_template` with a `chapters` array are "legacy" and ignored; the settings page tells the firm to re-upload.
- **Corpus PDFs are not committed**: `pnpm --filter @workspace/tis-api-server run fetch:tis-corpus` downloads them from the URLs in `scripts/fixtures/tis-corpus/CORPUS.md`; `check:theme-extract` and the corpus part of `check:theme-render` skip when they are absent.
- **Themed footers carry the firm's segments only**: the screening disclaimer is part of the default footer; a firm that imports a format takes responsibility for its own footer text.
```

- [ ] **Step 3: Run everything**

Add `"check:theme": "pnpm run check:theme-units && pnpm run check:theme-scan && pnpm run check:theme-default-identity && pnpm run check:theme-extract && pnpm run check:theme-render"` to `package.json`, then:

```bash
pnpm --filter @workspace/tis-api-server run typecheck && pnpm --filter @workspace/atlanta-tis run typecheck && \
pnpm --filter @workspace/tis-api-server run check:theme && \
pnpm --filter @workspace/tis-api-server run check:conserved-assignment && pnpm --filter @workspace/tis-api-server run check:region-parity && pnpm --filter @workspace/tis-api-server run check:state-dispatch && pnpm --filter @workspace/tis-api-server run smoke:distribution-pdf
```

Expected: all green.

- [ ] **Step 4: Side-by-side acceptance rasters**

For each corpus PDF: render the TX fixture through its theme to `<scratchpad>/theme-accept/<name>.pdf` (a short script using `loadRendererBundle` + `extractTheme`, same as the corpus loop above but writing the buffer out), then rasterise page 1, one body page and one table page of both the sample and the render at 60 dpi (`pdftoppm -r 60 -f N -l N -png`; poppler is installed locally) into the same folder. Send the PNGs to the user with `SendUserFile`, one caption per corpus file naming what matched and what did not. Do not claim the work is complete until the user has seen them.

- [ ] **Step 5: Commit and open the PR**

```bash
git add artifacts/tis-api-server/scripts/verify-theme-render.mjs artifacts/tis-api-server/package.json replit.md
git commit -m "chore(theme): corpus render checks, check:theme aggregate, docs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin feat/report-theme-import
```

Then `gh pr create` — title "Report theme import: a firm's sample TIS drives the format of every study"; body: link to the spec, the five checks and what each guards, the byte-identity guarantee, the deleted V1 importer (never ran in production), and the known limitations (symmetric margins; preview fixtures only for FL/GA/TX/NY/NC/SC — other regions preview with the Florida fixture; themed footers drop the screening disclaimer). End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review

**Spec coverage.** §4 flow → Tasks 15–16. §5.1 scanner → Task 8. §5.2 derivations → Tasks 9–12. §5.3 tokenisation → Task 10. §5.4 cover → Task 12. §5.5 fonts → Task 2. §6 schema → Task 1. §7.1–7.8 threading → Tasks 4–6. §7.9 UK path → Task 7. §8 API/frontend → Tasks 15–16 (the OpenAPI line is intentionally not done — firms routes have never been in `openapi.yaml`, the settings page uses raw `fetch`). §9 corpus + checks → Tasks 3, 8, 14, 17. §10 error handling → Task 13 (`ThemeExtractError` 400/422, 20 s timeout, refusal when ≥ 4 derivations fell back) and Task 5 (`resolveTheme` falls back silently to the default). §11 rollout → Task 17 docs.

**Deliberate deviations from the spec.** (1) `velocityPaletteActive` stays as a boolean instead of becoming `theme.id === "velocity"` — the London path is untouched and the flag is harmless. (2) Preview fixtures exist for FL/GA/TX/NY/NC/SC only (no IL/CA/PA/UK masters are on disk); other regions preview with the Florida fixture. (3) The themed footer omits the screening disclaimer (spec §7.7 draws the firm's segments); recorded as a Gotcha.

**Type consistency.** `TokenContext` (`firmName, projectName, address, dateLabel, documentType, client`) is identical in Task 4 (`draw.ts`), Task 5 (`tok` in `renderStudyPdf`) and the unit checks. `DetectedZone = RunningZone & { edge }` is stripped to `RunningZone` in `extract.ts` before storage. `ImagePixels` is declared in `png.ts` and re-exported from `pdf-scan.ts`; `derive/cover.ts` imports `imagePixelsToPngDataUrl` from `png.ts`. `HeadingLevel.titleCase` is produced in Task 9 and consumed by `headingStyles` in Task 13. The `StoredTheme` object passed as `firm.reportTemplate` in the render checks is the exact shape `parseStoredTheme` accepts (`{ version: 2, theme, source }`). `scaleWidths`, `formatHeading`, `interpolate`, `takeSynonym` names match between Task 4's implementation and every later caller.
