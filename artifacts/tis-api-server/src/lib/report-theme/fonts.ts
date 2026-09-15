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
    .replace(/[-,_ ]?(?:bold|black|heavy|semibold|demibold|extrabold|ultrabold|italic|oblique|regular|book|medium|light|thin|condensed)+/gi, "")
    .replace(/it$/i, "")
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
  { re: /^source ?sans ?(pro|3)?$/i, family: "source-sans-3", exact: true },
  { re: /^deja ?vu sans$/i, family: "dejavu-sans", exact: true },
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
