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
  // A firm that styles chapter and section headings identically ("3. EXISTING
  // CONDITIONS" and "3.1 ROADWAYS" both white on a band) lands both in one
  // level, and the sections outnumber the chapters — so the top-level FORM
  // ("3.0" / "3." / "3") is read from the single-number lines only; the
  // sub-numbered lines can only say that the scheme is numeric at all.
  const top = texts.filter((t) => !/^\s*\d{1,2}\.[1-9]\d?\b/.test(t));
  const share = (re: RegExp, over: string[]) => over.filter((t) => re.test(t)).length / (over.length || 1);
  if (share(/^\s*\d{1,2}\.0\b/, top) >= 0.5) return "1.0";
  if (share(/^\s*\d{1,2}\.\s/, top) >= 0.5) return "1.";
  if (share(/^\s*section\s+\d/i, top) >= 0.5) return "section";
  if (share(/^\s*[A-Z]\.\s/, top) >= 0.5) return "letter";
  if (share(/^\s*\d{1,2}(\.\d{1,2})*\s+\S/, texts) >= 0.5) return "1";
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

/** Digit-normalised, whitespace-collapsed, lowercased line text — the key a
 *  running header/footer repeats under even when it carries a page number. */
const normText = (t: string) => t.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
const FRONT_MATTER_RE = /^(table of contents|contents|(list|table) of (tables|figures|exhibits|appendices|acronyms|abbreviations))\s*:?$/i;

/**
 * Heading levels = distinct (font, size, bold, colour) styles that stand alone
 * on a line, differ from the body, and recur (or are much larger), ranked by
 * size. At most three; running headers/footers are excluded by their
 * structural signature — the same (digit-normalised) text repeating at
 * nearly the same baseline on most interior pages — not by page position,
 * which a real margin can put anywhere near a genuine heading too.
 */
export function detectHeadings(pages: ScannedPage[], body: BodyStyle): HeadingLevel[] {
  const perPage = interiorPages(pages).map((p) => ({ page: p, lines: linesOf(p) }));

  const occurrences = new Map<string, Array<{ page: number; y: number }>>();
  for (const { page: p, lines } of perPage) for (const ln of lines) {
    const key = normText(ln.text);
    if (!key) continue;
    const arr = occurrences.get(key) ?? [];
    arr.push({ page: p.page, y: ln.y });
    occurrences.set(key, arr);
  }
  const minPages = Math.max(2, Math.ceil(perPage.length * 0.6));
  const runningHeaders = new Set<string>();
  for (const [key, occ] of occurrences) {
    const pageCount = new Set(occ.map((o) => o.page)).size;
    if (pageCount < minPages) continue;
    const ys = occ.map((o) => o.y);
    if (Math.max(...ys) - Math.min(...ys) <= 3) runningHeaders.add(key);
  }

  const groups = new Map<string, { insts: Inst[]; run: TextRun }>();
  for (const { page: p, lines } of perPage) {
    lines.forEach((ln, idx) => {
      if (!ln.uniform || !ln.text.trim() || ln.text.length > 90 || ln.text.split(" ").length > 14) return;
      if (runningHeaders.has(normText(ln.text))) return; // running header/footer, not a heading
      // Captions and table-header rows are bold but never headings.
      if (/^(table|figure)\s+\d/i.test(ln.text)) return;
      // Contents-list titles are set in the firm's display style, often
      // larger than any chapter heading, and appear once each — so they
      // would win H1 by size while the real chapter style is demoted.
      if (FRONT_MATTER_RE.test(ln.text)) return;
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
