/**
 * The sample's figure caption convention — "Figure 3 – Title", "Exhibit 2:
 * Title", "Figure 4.1. Title" — read off its caption lines. Label word,
 * numbering shape and the punctuation after the number are what a firm
 * recognises as "their" captions; the caption's type style and position are
 * derived separately (tables.ts detectFigureCaption).
 */
import { interiorPages, linesOf, type ScannedPage } from "../pdf-scan";

export type FigureConventionDerived = {
  label: "Figure" | "Exhibit";
  numbering: "sequential" | "chapter";
  /** Punctuation after the number, with the spacing the sample uses: ": ", ". ", " – ", " ". */
  separator: string;
};

// Table captions count as evidence for the numbering shape and separator — a
// firm uses one convention for both, and a short study may carry two figures
// but thirty tables. Only figure/exhibit lines vote on the label word.
const CAPTION_RE = /^\s*(Figure|Fig\.|Exhibit|Table)\s+(\d+)(?:([-.–])(\d+))?\s*([:.–—-])?\s*(\S.*)$/i;

function modal<T extends string>(xs: T[]): T | null {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

/** Null when the sample has fewer than two caption lines (figures and tables together) — nothing to imitate. */
export function deriveFigureConvention(pages: ScannedPage[]): FigureConventionDerived | null {
  const labels: Array<"Figure" | "Exhibit"> = [];
  const chaptered: boolean[] = [];
  const seps: string[] = [];
  for (const p of interiorPages(pages)) {
    for (const ln of linesOf(p)) {
      const m = CAPTION_RE.exec(ln.text);
      if (!m) continue;
      const rest = m[6].trim();
      // Not captions: a prose sentence that happens to open with a figure
      // reference ("Figure 3 for the weekday morning…", "Exhibit 5 for the
      // warehousing uses…" — no punctuation after the number; "Figure 1. A
      // conceptual site plan is included in Appendix A." — a full sentence),
      // and list-of-figures entries with dot leaders and a page number.
      if (!m[5]) continue;
      if (rest.length < 3 || rest.length > 90) continue;
      if (/\.{3,}\s*\d+$/.test(rest) || /\.$/.test(rest)) continue;
      if (rest.split(/\s+/).length > 10) continue;
      if (!/^table/i.test(m[1])) labels.push(/^exhibit/i.test(m[1]) ? "Exhibit" : "Figure");
      chaptered.push(m[4] !== undefined);
      seps.push(m[5]);
    }
  }
  if (seps.length < 2) return null;
  const sep = modal(seps) ?? "–";
  const separator = sep === ":" ? ": " : sep === "." ? ". " : " – ";
  return {
    label: modal(labels) ?? "Figure",
    numbering: chaptered.filter(Boolean).length * 2 >= chaptered.length ? "chapter" : "sequential",
    separator,
  };
}
