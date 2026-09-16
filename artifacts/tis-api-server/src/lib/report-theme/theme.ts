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
    // A band is a solid strip of colour; `photo: true` marks a strip the sample
    // filled with a picture (cover art under the title). The renderer puts the
    // project's own site photo there and falls back to the band's mean colour.
    bands: z.array(z.object({ y0: z.number(), y1: z.number(), color: HexSchema, photo: z.boolean().optional() })).max(8),
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
  cover: "image" | "photo" | "color" | "plain";
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
    cover: t.cover.background.kind === "image" ? "image" : t.cover.bands.some((b) => b.photo) ? "photo" : t.cover.background.kind === "color" || t.cover.bands.length ? "color" : "plain",
    table: { headerFill: t.table.header.fill, mode: t.table.rules.mode },
    numbering: t.headings[0].numbering,
    warnings: s.source.warnings,
    extractedAt: s.source.extractedAt,
  };
}
