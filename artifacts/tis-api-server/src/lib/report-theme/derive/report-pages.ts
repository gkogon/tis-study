import { interiorPages, linesOf, type ScannedPage } from "../pdf-scan";
import type { BodyStyle } from "./typography";

/**
 * A real TIS is a short report followed by a long tail of appendices —
 * Synchro/HCM output sheets, count data, scoping letters — and, at the
 * front, a title page, a signature page and the contents lists. None of that
 * is styled like the report, and on a public filing the tail is usually
 * longer than the report itself, so every recurrence-based derivation
 * (running zones need the same text on 60 % of pages) and every census-based
 * one (table style, heading levels, palette) is diluted or captured outright
 * by pages the firm never designed.
 */

const DIVIDER_RE = /^appendi(x|ces)\b/i;

/** Interior pages before the first appendix divider — a page carrying at most six text lines whose largest line starts "Appendix …" / "Appendices". Everything from that page on is appendix content. */
export function beforeAppendix(pages: ScannedPage[]): ScannedPage[] {
  const out: ScannedPage[] = [];
  for (const p of pages) {
    if (p.page > 1) {
      const lines = linesOf(p);
      if (lines.length > 0 && lines.length <= 6) {
        const biggest = lines.reduce((a, b) => (b.size > a.size ? b : a));
        if (DIVIDER_RE.test(biggest.text)) break;
      }
    }
    out.push(p);
  }
  return out;
}

/** Number of body-style lines wide enough to be paragraph text (the same 45 %-of-page-width rule pageGeometry uses for margins). */
export function paragraphLineCount(page: ScannedPage, body: BodyStyle): number {
  return linesOf(page).filter((l) => l.font === body.font && Math.abs(l.size - body.size) <= 0.5 && l.w >= 0.45 * page.width).length;
}

/**
 * The pages that carry the report's own prose: interior pages before the
 * first appendix divider with at least three paragraph-width body lines.
 * That keeps text and contents pages and drops the second title page, the
 * signature page, full-page figures, divider pages and appendix sheets —
 * whose text is in other faces and sizes, so they never reach three.
 */
export function reportPages(pages: ScannedPage[], body: BodyStyle): ScannedPage[] {
  return interiorPages(beforeAppendix(pages)).filter((p) => paragraphLineCount(p, body) >= 3);
}

/**
 * Pages table detection reads: the report pages plus every interior page
 * between the first and last of them that carries a "Table N" caption — a
 * full-page table has no paragraph text of its own, but it is the firm's
 * table style all the same, and it can only sit inside the report's span
 * (the appendix tail starts after the last prose page).
 */
export function tablePages(pages: ScannedPage[], body: BodyStyle): ScannedPage[] {
  const prefix = beforeAppendix(pages);
  const prose = reportPages(prefix, body);
  if (!prose.length) return interiorPages(prefix);
  const first = prose[0].page, last = prose[prose.length - 1].page;
  const isProse = new Set(prose);
  return interiorPages(prefix).filter((p) => isProse.has(p) || (p.page > first && p.page < last && linesOf(p).some((l) => /^table\s+\d/i.test(l.text))));
}
