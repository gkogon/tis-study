/**
 * Sample TIS PDF → StoredTheme. Scans with pdfjs, runs each derivation,
 * substitutes DEFAULT_THEME values (with a warning) where a derivation finds
 * nothing, and refuses the upload when nearly everything fell back — a
 * scanned image must not silently become "the default theme".
 */
import { DEFAULT_THEME, StoredThemeSchema, tint, type HeadingStyle, type StoredTheme, type TextStyle, type Theme } from "./theme";
import { matchFamily, parsePostScriptName } from "./fonts";
import { interiorPages, scanPdf } from "./pdf-scan";
import { bodyStyle, detectHeadings, type BodyStyle, type HeadingLevel } from "./derive/typography";
import { beforeAppendix, reportPages, tablePages } from "./derive/report-pages";
import { pageGeometry } from "./derive/page";
import { detectRunningZones } from "./derive/header-footer";
import { derivePalette } from "./derive/palette";
import { detectFigureCaption, detectTables } from "./derive/tables";
import { deriveCover } from "./derive/cover";
import { mapSynonyms } from "./derive/synonyms";

export class ThemeExtractError extends Error {
  readonly status: 400 | 422;
  constructor(status: 400 | 422, message: string) {
    super(message);
    this.status = status;
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

/**
 * Copies every key of `z` except `edge` (the running-zone detector's internal
 * margin hint, never part of the stored `Theme`). A zone with no surviving
 * segments is stored as null: its extent has already shaped the page
 * geometry, and a zone with nothing to draw is not a zone.
 */
function omitEdge<T extends { edge: number; segments: unknown[] }>(z: T | null): Omit<T, "edge"> | null {
  if (!z || !z.segments.length) return null;
  const out = {} as Omit<T, "edge">;
  for (const k in z) if (k !== "edge") (out as Record<string, unknown>)[k] = (z as Record<string, unknown>)[k];
  return out;
}

/** A thrown `ThemeExtractError` (e.g. a derivation's own `if (!x) throw ...`) passes through unchanged; anything else — a bug surfacing as a plain `Error` — becomes a 422 so a malformed-but-`%PDF-`-prefixed upload never escapes as an unhandled crash. */
export function mapDerivationError(e: unknown): ThemeExtractError {
  if (e instanceof ThemeExtractError) return e;
  return new ThemeExtractError(422, `Could not derive formatting from this PDF: ${(e as Error).message}`);
}

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
      out.push({ ...prev, style: { ...prev.style, size: Math.max(body.size, Math.round(prev.style.size * 0.85 * 2) / 2) }, rule: null, band: null, numbering: prev.numbering, spaceBefore: Math.round(prev.spaceBefore * 0.8), spaceAfter: Math.round(prev.spaceAfter * 0.8) });
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

  let theme: Theme;
  try {
    // Everything the firm designed lives before the first appendix divider;
    // every derivation below reads only the pages that carry the report's
    // own prose (see derive/report-pages.ts). A report too short to yield
    // two such pages falls back to the whole pre-appendix interior.
    const prefix = beforeAppendix(scan.pages);
    const body = bodyStyle(prefix);
    if (!body) throw new ThemeExtractError(422, "No formatting could be detected (is this a scanned image?).");
    const bodyPs = parsePostScriptName(body.font);
    const bodyFont = matchFamily(bodyPs.family, { serif: body.serif, mono: body.mono });
    let report = reportPages(prefix, body);
    if (report.length < 2) report = interiorPages(prefix);

    const heads = detectHeadings(report, body);
    if (!heads.length) fallback("No headings detected; using default heading styles.");
    const headPs = heads[0] ? parsePostScriptName(heads[0].font) : bodyPs;
    const headFont = heads[0] ? matchFamily(headPs.family, { serif: heads[0].lines[0]?.runs[0]?.serif ?? body.serif }) : bodyFont;

    const coverRes = deriveCover(scan.pages.find((p) => p.page === 1), body, heads[0]?.font ?? null, { firmName: opts.firmName });
    warnings.push(...coverRes.warnings);

    const zones = detectRunningZones(report, body, heads[0]?.font ?? null, { firmName: opts.firmName, coverTitle: coverRes.coverTitle });
    warnings.push(...zones.warnings);
    if (!zones.header && !zones.footer) fallback("No running header or footer detected; using the default footer.");
    for (const [name, z] of [["header", zones.header], ["footer", zones.footer]] as const) {
      if (z && !z.segments.length) warnings.push(`The running ${name} carried only text that could not be mapped to tokens; its band is kept clear.`);
    }

    const geom = pageGeometry(report, body, { headerBottom: zones.header?.edge ?? null, footerTop: zones.footer?.edge ?? null });
    if (!geom) fallback("Page margins not detected; using 50 pt margins.");

    const tables = detectTables(tablePages(scan.pages, body), body, heads[0]?.font ?? null);
    if (!tables.style) fallback("No tables detected; using the default table style.");
    const fig = detectFigureCaption(interiorPages(prefix), body);

    const mutedCandidates = [tables.style?.caption.style.color, zones.header?.style.color, zones.footer?.style.color, fig?.style.color].filter((c): c is string => !!c);
    const palette = derivePalette(report, body, heads, mutedCandidates, coverRes.cover);

    if (fallbacks >= 4) throw new ThemeExtractError(422, "No formatting could be detected (is this a scanned image?).");

    const captionStyle: TextStyle = tables.style?.caption.style ?? { font: "body", size: Math.max(6, body.size - 1), color: palette.muted, bold: true };
    theme = {
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
      header: omitEdge(zones.header),
      footer: omitEdge(zones.footer),
      cover: coverRes.cover,
      charts: { series: [palette.primary, palette.accent !== palette.primary ? palette.accent : tint(palette.primary, 0.5), tint(palette.primary, 0.3), tint(palette.primary, 0.7)] },
      synonyms: mapSynonyms(heads.slice(0, 2).flatMap((h) => h.lines.map((l) => l.text))),
    };
  } catch (e) {
    throw mapDerivationError(e);
  }

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
