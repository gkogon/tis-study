import { linesOf, type ImagePlacement, type ScannedPage, type TextLine } from "../pdf-scan";
import { imagePixelsToPngDataUrl } from "../png";
import { luminance, type CoverElement, type Theme } from "../theme";
import { normalizeName } from "./header-footer";
import type { BodyStyle } from "./typography";

const DOCTYPE_RE = /traffic (impact|study|assessment)|transportation impact|transport (assessment|statement)/i;
// A line counts as a date only when the WHOLE line is a date (optionally
// labelled "Date:") — a substring test would misclassify a title that merely
// mentions a date ("Riverside Crossing – December 2024 Update") as the
// dateLabel instead of the projectName.
const DATE_LINE_RE = /^\s*(date:?\s*)?((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2},?\s+)?\d{4}|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\s*$/i;
const PREPARED_FOR_RE = /^(prepared|submitted)\s+(for|to)\b:?/i;
const PREPARED_BY_RE = /^(prepared|submitted)\s+by\b:?/i;

const EMPTY: Theme["cover"] = { background: { kind: "none" }, bands: [], logo: null, elements: [], hasMetaBlock: false };

/** Stored images are downsampled to this multiple of their placement size in points. */
const STORED_IMAGE_SCALE = 2;

const aspect = (im: { w: number; h: number }) => im.w / im.h;
const sameAspect = (a: { w: number; h: number }, b: { w: number; h: number }) => Math.abs(aspect(a) - aspect(b)) <= 0.03 * aspect(a);
/** Two placements that share a full horizontal edge (same x-extent, one's bottom on the other's top) are slices of one picture. */
function sharesEdge(a: ImagePlacement, b: ImagePlacement): boolean {
  if (a === b || Math.abs(a.x - b.x) > 1 || Math.abs(a.w - b.w) > 1) return false;
  return Math.abs(a.y + a.h - b.y) <= 1 || Math.abs(b.y + b.h - a.y) <= 1;
}
/** A placement in the running-header or running-footer band of its page. */
const inRunningBand = (im: ImagePlacement, H: number) => im.y + im.h <= 0.12 * H || im.y >= 0.88 * H;

/**
 * The firm's logo among the cover's images (spec §5.4, tightened):
 *  1. logo-shaped (aspect 1.6–12, 24–600 pt high), decoded, not the
 *     background, and not one of several same-width strips stacked edge to
 *     edge — a site map sliced into bands is never a logo;
 *  2. preferred: the same aspect as an image placed in the running header
 *     or footer band on ≥ 2 interior pages — a firm's mark recurs there, a
 *     client's logo or a site photo does not;
 *  3. otherwise at most 120 pt high, preferring a masthead (top 20 %) or
 *     foot (bottom 30 %) placement over the middle of the page, where the
 *     client's logo and the site image live; then the largest.
 */
export function pickLogo(page1: ScannedPage, bgImage: ImagePlacement | null, interior: ScannedPage[]): ImagePlacement | null {
  const H = page1.height;
  const shaped = page1.images.filter((im) => im !== bgImage && im.pixels && aspect(im) >= 1.6 && aspect(im) <= 12 && im.h >= 24 && im.h <= 600);
  const candidates = shaped.filter((im) => !page1.images.some((o) => sharesEdge(im, o)));
  const byArea = (a: ImagePlacement, b: ImagePlacement) => b.w * b.h - a.w * a.h;
  const recurring = candidates.filter((im) => interior.filter((p) => p.images.some((o) => inRunningBand(o, p.height) && sameAspect(im, o))).length >= 2);
  if (recurring.length) return recurring.sort(byArea)[0];
  const small = candidates.filter((im) => im.h <= 120);
  const edge = small.filter((im) => im.y + im.h <= 0.2 * H || im.y >= 0.7 * H);
  return (edge.length ? edge : small).sort(byArea)[0] ?? null;
}

/**
 * A cover line's alignment. Lines that share an edge with other lines of
 * differing length reveal the column they sit in — a title block right-
 * aligned against a vertical rule at 0.68 W has its centre near 0.55 W,
 * which the position rule alone would call "centred" and then spread across
 * the page (and over the logo in the other column). Position decides only
 * when no other line shares an edge.
 */
export function alignOfLine(ln: TextLine, lines: TextLine[], W: number): CoverElement["align"] {
  const others = lines.filter((o) => o !== ln && o.text.length > 0);
  const differs = (o: TextLine) => Math.abs(o.w - ln.w) > 4;
  const sharesRight = others.filter((o) => differs(o) && Math.abs(o.x + o.w - (ln.x + ln.w)) <= 2).length;
  const sharesLeft = others.filter((o) => differs(o) && Math.abs(o.x - ln.x) <= 2).length;
  const sharesCentre = others.filter((o) => differs(o) && Math.abs(o.x + o.w / 2 - (ln.x + ln.w / 2)) <= 3).length;
  const best = Math.max(sharesRight, sharesLeft, sharesCentre);
  if (best >= 1) {
    if (sharesCentre === best) return "center";
    if (sharesLeft === best) return "left";
    return "right";
  }
  const c = (ln.x + ln.w / 2) / W;
  return c < 0.4 ? "left" : c > 0.6 ? "right" : "center";
}

function elementFor(ln: TextLine, role: CoverElement["role"], W: number, body: BodyStyle, headingFont: string | null, layout: { lines: TextLine[]; images: ImagePlacement[] }, label?: string): CoverElement {
  const align = alignOfLine(ln, layout.lines, W);
  // Box widths are the room a NEW study's text gets, not the sample line's
  // own extent: a centred title box exactly as wide as the sample's title
  // would wrap a longer project name word-by-word. Centred → the full usable
  // width, less any image beside the line (the logo in the other column);
  // left → out to the right margin; right → from the left margin to the
  // run's right edge.
  let x = ln.x, w = W - ln.x - 36;
  if (align === "center") {
    let x0 = 36, x1 = W - 36;
    const top = ln.y - ln.size, bottom = ln.y + 0.3 * ln.size;
    for (const im of layout.images) {
      if (im.y > bottom || im.y + im.h < top || im.w >= 0.9 * W) continue;
      if (im.x >= ln.x + ln.w - 2) x1 = Math.min(x1, im.x - 8);
      else if (im.x + im.w <= ln.x + 2) x0 = Math.max(x0, im.x + im.w + 8);
    }
    if (x1 - x0 >= ln.w) { x = x0; w = x1 - x0; } else { x = 36; w = W - 72; }
  }
  if (align === "right") { x = 36; w = ln.x + ln.w - 36; }
  return {
    role, x: Math.round(x), y: Math.round(ln.y - ln.size), w: Math.max(20, Math.round(w)), align,
    style: { font: headingFont && ln.font === headingFont && ln.font !== body.font ? "heading" : "body", size: Math.max(4, Math.round(ln.size * 2) / 2), color: ln.color ?? body.color, bold: ln.bold },
    ...(label ? { label } : {}),
  };
}

export function deriveCover(page1: ScannedPage | undefined, body: BodyStyle, headingFont: string | null, ctx: { firmName: string }, interior: ScannedPage[] = []): { cover: Theme["cover"]; coverTitle: string | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!page1) return { cover: EMPTY, coverTitle: null, warnings: ["No cover page found."] };
  const W = page1.width, H = page1.height, area = W * H;
  const bgImage = page1.images.filter((im) => im.w * im.h >= 0.7 * area && im.pixels).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
  const bgData = bgImage?.pixels ? imagePixelsToPngDataUrl(bgImage.pixels, { w: W * STORED_IMAGE_SCALE, h: H * STORED_IMAGE_SCALE }) : null;
  const bgRect = page1.rects.find((r) => r.w * r.h >= 0.9 * area && luminance(r.color) < 250);
  const background: Theme["cover"]["background"] = bgData ? { kind: "image", data: bgData } : bgRect ? { kind: "color", color: bgRect.color } : { kind: "none" };
  if (bgImage && !bgData) warnings.push("Cover background image could not be decoded; using a plain cover.");
  const bands = page1.rects
    .filter((r) => r !== bgRect && r.w >= 0.9 * W && r.h >= 12 && r.h < 0.7 * H && luminance(r.color) < 250)
    .sort((a, b) => a.y - b.y).slice(0, 8)
    .map((r) => ({ y0: Math.round(r.y), y1: Math.round(r.y + r.h), color: r.color }));
  const logoIm = pickLogo(page1, bgImage, interior);
  const logoData = logoIm?.pixels ? imagePixelsToPngDataUrl(logoIm.pixels, { w: logoIm.w * STORED_IMAGE_SCALE, h: logoIm.h * STORED_IMAGE_SCALE }) : null;
  const logo = logoIm && logoData ? { x: Math.round(logoIm.x), y: Math.round(logoIm.y), w: Math.round(logoIm.w), h: Math.round(logoIm.h), data: logoData } : null;
  if (page1.images.length && !logo && !bgData) warnings.push("No logo-shaped image found on the cover.");

  const lines = linesOf(page1).filter((l) => l.text.length > 0);
  const layout = { lines, images: page1.images };
  const used = new Set<TextLine>();
  const els: CoverElement[] = [];
  const firm = normalizeName(ctx.firmName);
  const docType = lines.filter((l) => DOCTYPE_RE.test(l.text)).sort((a, b) => b.size - a.size)[0];
  if (docType) { used.add(docType); els.push(elementFor(docType, "documentType", W, body, headingFont, layout)); }
  const isMeta = (l: TextLine) => DATE_LINE_RE.test(l.text) || PREPARED_FOR_RE.test(l.text) || PREPARED_BY_RE.test(l.text) || normalizeName(l.text) === firm;
  // A second document-type-like line (a subtitle such as "Traffic Impact
  // Assessment Report") must never win the projectName slot even when it is
  // larger than the real title — it is dropped below with a warning instead.
  const title = lines.filter((l) => !used.has(l) && !isMeta(l) && !DOCTYPE_RE.test(l.text) && l.size >= Math.max(body.size * 1.3, 11)).sort((a, b) => b.size - a.size || a.y - b.y)[0];
  if (title) { used.add(title); els.push(elementFor(title, "projectName", W, body, headingFont, layout)); }
  let hasMeta = false;
  for (const l of lines) {
    if (used.has(l)) continue;
    if (PREPARED_FOR_RE.test(l.text) && !els.some((e) => e.role === "preparedFor")) { used.add(l); hasMeta = true; els.push(elementFor(l, "preparedFor", W, body, headingFont, layout, l.text.match(PREPARED_FOR_RE)![0])); continue; }
    if (PREPARED_BY_RE.test(l.text) && !els.some((e) => e.role === "preparedBy")) { used.add(l); hasMeta = true; els.push(elementFor(l, "preparedBy", W, body, headingFont, layout, l.text.match(PREPARED_BY_RE)![0])); continue; }
    if (DATE_LINE_RE.test(l.text) && !els.some((e) => e.role === "dateLabel")) { used.add(l); hasMeta = true; els.push(elementFor(l, "dateLabel", W, body, headingFont, layout)); continue; }
    if (firm && normalizeName(l.text) === firm && !els.some((e) => e.role === "firmName")) { used.add(l); els.push(elementFor(l, "firmName", W, body, headingFont, layout)); continue; }
  }
  // A stray glyph or a bare number is not text worth a warning (fewer than three alphanumerics).
  for (const l of lines) if (!used.has(l) && (l.text.match(/[a-z0-9]/gi) ?? []).length >= 3) warnings.push(`Dropped cover text that could not be mapped: "${l.text.slice(0, 60)}".`);
  const elements = els.sort((a, b) => a.y - b.y).slice(0, 12);
  return { cover: { background, bands, logo, elements, hasMetaBlock: hasMeta }, coverTitle: title ? title.text : null, warnings };
}
