/**
 * Geometry-aware page layout for themed renders.
 *
 * Every fixed height in the regional renderers — 200 pt chart plots, the
 * 330 pt distribution plan, the 132 pt turning-movement diagrams, the
 * unconditional page break before a major section — was tuned to the default
 * text box (LETTER, 50 pt margins: 512 × 692 pt at 10 pt body). A firm theme
 * shrinks that box to roughly 430–470 × 600–630 pt at 11 pt, and the same code
 * then leaves half-empty pages: figures that used to pair on one page each
 * take their own, and a section break lands after a three-line page.
 *
 * Under the default theme every helper here is the identity (a scale of 1, an
 * unconditional `addPage`), so default output stays byte-identical.
 */
import { isDefaultTheme } from "./active";

/** The default renderer's text box, the geometry the fixed heights assume. */
export const DEFAULT_BOX = { w: 512, h: 692 } as const;

export function textBox(doc: PDFKit.PDFDocument): { x: number; y: number; w: number; h: number } {
  const m = doc.page.margins;
  return { x: m.left, y: m.top, w: doc.page.width - m.left - m.right, h: doc.page.height - m.top - m.bottom };
}

/**
 * Factor by which the active theme's text box is smaller than the default
 * one (1 under the default theme; never above 1, floored at 0.6 so a figure
 * stays legible on a very tight page).
 */
export function figureScale(doc: PDFKit.PDFDocument): number {
  if (isDefaultTheme()) return 1;
  const b = textBox(doc);
  return Math.max(0.6, Math.min(1, b.w / DEFAULT_BOX.w, b.h / DEFAULT_BOX.h));
}

/** A renderer-fixed figure height, scaled to the active theme's text box. */
export function scaledHeight(doc: PDFKit.PDFDocument, defaultHeight: number): number {
  return isDefaultTheme() ? defaultHeight : Math.round(defaultHeight * figureScale(doc));
}

/** Fraction of the text box still free below the cursor. */
export function remainingFraction(doc: PDFKit.PDFDocument): number {
  const b = textBox(doc);
  return (b.y + b.h - doc.y) / b.h;
}

/** Page-break unless `needed` points fit below the cursor. */
export function keepTogether(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

/**
 * Start a major section. Default theme: always a fresh page. Firm theme: a
 * fresh page only when less than `minFree` of the text box remains, so the
 * section does not strand the previous page's last few lines on their own.
 */
export function sectionBreak(doc: PDFKit.PDFDocument, minFree = 0.45): void {
  if (isDefaultTheme()) { doc.addPage(); return; }
  if (doc.y <= doc.page.margins.top + 0.01) return; // already at the top of a fresh page
  if (remainingFraction(doc) < minFree) { doc.addPage(); return; }
  doc.y += 16;
  doc.x = doc.page.margins.left;
}
