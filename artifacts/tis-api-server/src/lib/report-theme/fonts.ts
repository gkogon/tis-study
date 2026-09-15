/**
 * Bundled substitute fonts + PostScript-name matching.
 *
 * A firm's PDF names its fonts ("ABCDEF+Calibri-Bold"); we can't reuse the
 * embedded subset (it only holds the sample's glyphs), so the family is
 * matched to a metric-compatible open font we ship under data/fonts/<family>/.
 * `exact` is false when a substitute stands in — the settings page says so.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
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

// Whole-segment style tokens (longest first, so e.g. "semibold" wins over
// "semi"+"bold" — either decomposition is still "all style", but this keeps
// the token list a segment decomposes into meaningful for the italic check).
const STYLE_TOKENS = [
  "extrabold", "ultrabold", "demibold", "condensed", "semibold",
  "oblique", "regular", "italic", "medium",
  "black", "heavy", "light", "extra", "ultra",
  "bold", "book", "demi", "semi", "thin",
  "it",
];

/**
 * A separator-delimited segment (or a trailing camel-split word of `base`)
 * is a "style segment" only when it is, in full, a concatenation of style
 * tokens with nothing left over — never a substring match inside an
 * unrelated word. Returns the matched tokens (so callers can tell whether
 * "it" specifically was one of them) or null if the segment doesn't fully
 * decompose.
 */
function tokenizeStyle(segment: string): string[] | null {
  let s = segment.toLowerCase();
  const tokens: string[] = [];
  while (s.length > 0) {
    const tok = STYLE_TOKENS.find((t) => s.startsWith(t));
    if (!tok) return null;
    tokens.push(tok);
    s = s.slice(tok.length);
  }
  return tokens;
}

function camelSplitWords(s: string): string[] {
  return s
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
}

export function parsePostScriptName(name: string): { family: string; bold: boolean; italic: boolean } {
  const n = name.replace(/^[A-Z]{6}\+/, "").replace(/(PSMT|PS|MT)$/, "");
  const bold = /bold|black|heavy|semibold|demibold|extrabold|ultrabold/i.test(n);
  let italic = /italic|oblique/i.test(n);

  // Split on explicit separators only — never inside a camelCase run — so a
  // style word is only recognized when it stands as its own whole segment.
  const segments = n.split(/[-,_ ]+/).filter(Boolean);
  const base = segments[0] ?? n;
  const rest = segments.slice(1);

  // Camel-split the base ("TimesNewRoman" → ["Times","New","Roman"]), then
  // drop trailing style words (e.g. "CalibriBold" → "Calibri") — but never
  // "roman": it's part of the family name here ("Times New Roman"), not a
  // style suffix, whenever it's attached to base with no separator.
  const baseWords = camelSplitWords(base);
  while (baseWords.length > 1) {
    const last = baseWords[baseWords.length - 1];
    if (last.toLowerCase() === "roman") break;
    const toks = tokenizeStyle(last);
    if (!toks) break;
    if (toks.includes("it")) italic = true;
    baseWords.pop();
  }

  // Drop whole-segment style words from `rest` ("Bold", "SemiBold", "It").
  // "Roman" is not a generic style token (it collides with real family
  // names like "Bookman"), so it's kept unless, after the generic drop, it
  // is the *only* thing left in `rest` — that's the "-Roman" style suffix
  // ("Times-Roman", "Bookman-Roman"), as opposed to "New Roman" where
  // "Roman" survives alongside a kept non-style segment.
  const keptRest: string[] = [];
  for (const seg of rest) {
    const toks = tokenizeStyle(seg);
    if (toks) {
      if (toks.includes("it")) italic = true;
      continue;
    }
    keptRest.push(seg);
  }
  if (keptRest.length === 1 && keptRest[0].toLowerCase() === "roman") keptRest.length = 0;

  const family = [...baseWords, ...keptRest].join(" ") || n;
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

// ─── Glyph fallback for substitute faces ────────────────────────────────────
//
// DejaVu Sans (the default) carries every symbol the LOS tables use; the
// metric-compatible substitutes do not (▲ is missing from Carlito, Caladea,
// Gelasio, Lato, Open Sans and Roboto; ⇒ from all but Source Sans 3). PDFKit
// paints .notdef for a missing glyph, and its declared width disagrees with
// the wrap measurement, so the line spills past the margin. Under a
// non-default theme every string handed to doc.text is passed through
// substituteMissingGlyphs against the face in use.

type FontkitFace = { hasGlyphForCodePoint(cp: number): boolean };
type Fontkit = { openSync(file: string): FontkitFace };

let fontkitMod: Fontkit | null | undefined;
/** pdfkit's own fontkit. pnpm keeps it beside pdfkit rather than in our node_modules, so resolve it from pdfkit's location. */
function loadFontkit(): Fontkit | null {
  if (fontkitMod !== undefined) return fontkitMod;
  try {
    const here = createRequire(import.meta.url);
    fontkitMod = createRequire(here.resolve("pdfkit"))("fontkit") as Fontkit;
  } catch {
    fontkitMod = null;
  }
  return fontkitMod;
}

const faceCache = new Map<string, FontkitFace | null>();
function faceForFile(file: string): FontkitFace | null {
  const hit = faceCache.get(file);
  if (hit !== undefined) return hit;
  let face: FontkitFace | null = null;
  try { face = loadFontkit()?.openSync(file) ?? null; } catch { face = null; }
  faceCache.set(file, face);
  return face;
}

/** Whether a bundled face has a glyph for the code point; true when the face cannot be inspected (never substitute blindly). */
export function familyHasGlyph(family: BundledFamily, style: FontStyle, cp: number): boolean {
  const face = faceForFile(fontPath(family, style));
  return face ? face.hasGlyphForCodePoint(cp) : true;
}

/** ASCII stand-ins for the symbols the renderers use that substitute faces may lack. */
export const GLYPH_FALLBACK: Record<string, string> = {
  "▲": "^", "▼": "v", "→": "->", "⇒": "=>", "←": "<-", "↑": "^", "↓": "v", "∝": "~", "Δ": "d", "Σ": "sum", "λ": "lambda", "⚠": "!",
  "≤": "<=", "≥": ">=", "•": "*", "—": "-", "–": "-", "−": "-", "·": "*", "×": "x", "±": "+/-", "≈": "~", "≠": "!=", "…": "...",
};

/** Replace every non-ASCII code point the face lacks with its ASCII stand-in (unlisted ones are left as they are). */
export function substituteMissingGlyphs(str: string, hasGlyph: (cp: number) => boolean): string {
  let out = "";
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 128 || hasGlyph(cp)) { out += ch; continue; }
    out += GLYPH_FALLBACK[ch] ?? ch;
  }
  return out;
}

/** substituteMissingGlyphs against the theme's body and heading Regular faces (a glyph counts as present only when both have it). */
export function substituteMissingGlyphsForTheme(str: string, theme: Theme): string {
  const b = theme.fonts.body.family, h = theme.fonts.heading.family;
  return substituteMissingGlyphs(str, (cp) => familyHasGlyph(b, "regular", cp) && familyHasGlyph(h, "regular", cp));
}

/**
 * Wrap doc.text once so every string is checked against the face in use
 * (pdfkit exposes the loaded fontkit font on doc._font.font). Never under
 * the default theme: its bytes are pinned by the identity guard.
 */
export function installGlyphFallback(doc: PDFKit.PDFDocument, theme: Theme): void {
  if (isDefaultTheme(theme)) return;
  const orig = doc.text.bind(doc) as (...a: unknown[]) => PDFKit.PDFDocument;
  const live = (cp: number): boolean => {
    const face = (doc as unknown as { _font?: { font?: Partial<FontkitFace> } })._font?.font;
    if (face && typeof face.hasGlyphForCodePoint === "function") return face.hasGlyphForCodePoint(cp);
    return familyHasGlyph(theme.fonts.body.family, "regular", cp) && familyHasGlyph(theme.fonts.heading.family, "regular", cp);
  };
  doc.text = ((text: unknown, ...rest: unknown[]) => orig(typeof text === "string" ? substituteMissingGlyphs(text, live) : text, ...rest)) as typeof doc.text;
}
