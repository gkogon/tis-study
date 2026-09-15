import { interiorPages, linesOf, type ScannedPage, type StrokeLine, type TextLine, type TextRun } from "../pdf-scan";
import { luminance, type Theme } from "../theme";
import { clamp, median, mode, type BodyStyle } from "./typography";

type Region = { page: ScannedPage; x1: number; x2: number; yTop: number; yBottom: number; hlines: StrokeLine[]; rowRects: ScannedPage["rects"] };

const key2 = (a: number, b: number) => `${Math.round(a / 2) * 2}|${Math.round(b / 2) * 2}`;

/** Split a y-sorted list into runs separated by a gap over 40pt (a table's own rows/rules never spread further apart than that). */
function chunkByGap<T>(sorted: T[], gapBetween: (prev: T, next: T) => number): T[][] {
  const chunks: T[][] = [];
  let runStart = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i === sorted.length || gapBetween(sorted[i - 1], sorted[i]) > 40) { chunks.push(sorted.slice(runStart, i)); runStart = i; }
  }
  return chunks;
}

/** ≥3 equal-extent horizontal rules, or ≥2 equal-extent row fills, within 40 pt of each other = a table. */
function findRegions(p: ScannedPage): Region[] {
  const regions: Region[] = [];
  const hl = p.lines.filter((l) => Math.abs(l.y1 - l.y2) <= 0.5 && l.x2 - l.x1 >= 120);
  const groups = new Map<string, StrokeLine[]>();
  for (const l of hl) groups.set(key2(l.x1, l.x2), [...(groups.get(key2(l.x1, l.x2)) ?? []), l]);
  for (const ls of groups.values()) {
    const sorted = [...ls].sort((a, b) => a.y1 - b.y1);
    for (const chunk of chunkByGap(sorted, (a, b) => b.y1 - a.y1)) {
      if (chunk.length >= 3) regions.push({ page: p, x1: chunk[0].x1, x2: chunk[0].x2, yTop: chunk[0].y1, yBottom: chunk[chunk.length - 1].y1, hlines: chunk, rowRects: [] });
    }
  }
  // Row-rect groups are keyed by x-extent only, page-wide, so two distinct
  // tables sharing the same columns land in the same key — chunkByGap splits
  // that bucket back into one cluster per table before any merge decision is
  // made, the same way the hline groups above already are.
  const rr = p.rects.filter((r) => r.w >= 120 && r.h >= 8 && r.h <= 40);
  const rgroups = new Map<string, typeof rr>();
  for (const r of rr) rgroups.set(key2(r.x, r.x + r.w), [...(rgroups.get(key2(r.x, r.x + r.w)) ?? []), r]);
  for (const rs of rgroups.values()) {
    const sorted = [...rs].sort((a, b) => a.y - b.y);
    for (const chunk of chunkByGap(sorted, (a, b) => b.y - (a.y + a.h))) {
      const yTop = chunk[0].y, yBottom = chunk[chunk.length - 1].y + chunk[chunk.length - 1].h;
      const rowH = median(chunk.map((r) => r.h));
      // A header row's own fill can sit a full row above a region whose
      // topmost rule is the one below the first BODY row, not under the
      // header (tables ruled only between body rows) — so that direction
      // loosens to 1.5 row-heights. A fill sitting BELOW a region (a second,
      // closely stacked table's header, or a shaded note box) must not fuse
      // in just because it is close; that direction keeps the original ±4.
      const existing = regions.find((g) => Math.abs(g.x1 - chunk[0].x) <= 4 && (yBottom <= g.yTop ? yBottom >= g.yTop - 1.5 * rowH : yTop <= g.yBottom + 4 && yBottom >= g.yTop - 4));
      if (existing) { existing.rowRects.push(...chunk); existing.yTop = Math.min(existing.yTop, yTop); existing.yBottom = Math.max(existing.yBottom, yBottom); }
      else if (chunk.length >= 2) regions.push({ page: p, x1: chunk[0].x, x2: chunk[0].x + chunk[0].w, yTop, yBottom, hlines: [], rowRects: chunk });
    }
  }
  return regions;
}

/**
 * The zebra signature: the region's row rects in `top`'s colour, read
 * downward from `top`, are each separated from the previous one by exactly
 * one unfilled row (a gap of 0.5–1.5 rect heights), and there is at least
 * one of them. A touching same-coloured rect (a two-row header, a group
 * band right under the header) or one several rows down fails it.
 */
function alternates(top: ScannedPage["rects"][number], rowRects: ScannedPage["rects"]): boolean {
  const same = rowRects.filter((r) => r.color === top.color && r.y >= top.y + top.h - 1).sort((a, b) => a.y - b.y);
  if (!same.length) return false;
  let prev = top;
  for (const r of same) {
    if (Math.abs(r.y - prev.y) <= 1) continue; // another cell of the same row
    const gap = r.y - (prev.y + prev.h);
    if (gap < 0.5 * prev.h || gap > 1.5 * prev.h) return false;
    prev = r;
  }
  return true;
}

/** The colour of the cell fills under a header row, or null when they cover less than 60 % of the region's width. Only header-sized rects count — at most 3 × the taller of the header band and the row pitch, so a multi-row header block still qualifies but a tint box behind the whole table (many rows tall) does not. */
function headerBandFill(p: ScannedPage, g: Region, headerRuns: TextRun[], rowPitch: number): string | null {
  const top = Math.min(...headerRuns.map((r) => r.y - r.h));
  const bottom = Math.max(...headerRuns.map((r) => r.y));
  const maxH = 3 * Math.max(bottom - top, rowPitch);
  const widthBy = new Map<string, number>();
  for (const r of p.rects) {
    if (luminance(r.color) >= 250 || r.y > top + 1 || r.y + r.h < bottom - 1 || r.h > maxH) continue;
    const x1 = Math.max(r.x, g.x1), x2 = Math.min(r.x + r.w, g.x2);
    if (x2 - x1 <= 0) continue;
    widthBy.set(r.color, (widthBy.get(r.color) ?? 0) + (x2 - x1));
  }
  const best = [...widthBy.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 0.6 * (g.x2 - g.x1) ? best[0] : null;
}

/** One continuous line of text: no gap over 2 × the font size between consecutive runs (a table row's cells are separated by wider gaps). */
function contiguous(ln: TextLine): boolean {
  const runs = [...ln.runs].sort((a, b) => a.x - b.x);
  for (let i = 1; i < runs.length; i++) if (runs[i].x - (runs[i - 1].x + runs[i - 1].w) > 2 * ln.size) return false;
  return true;
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
    // A "Table N" / "Figure N" caption line sits above a table for the same
    // reason detectHeadings (typography.ts) excludes it from heading
    // candidates: it is bold, styled like the table's own header, and often
    // the nearest bold text above the region — so it must never be eligible
    // as a header candidate itself.
    const captionRuns = new Set<TextRun>();
    const pageLines = linesOf(p);
    pageLines.forEach((ln, i) => {
      if (!/^(table|figure)\s+\d/i.test(ln.text)) return;
      for (const r of ln.runs) captionRuns.add(r);
      // A long caption wraps: its second line carries no "Table N" prefix
      // but the caption's own font, size, weight and colour, one line-height
      // below, and reads as one continuous line. It is still caption, never
      // a header row. A header row directly under a caption differs in at
      // least one of those, or — being cells — is broken by column gaps.
      const next = pageLines[i + 1];
      if (next && next.y - ln.y <= 1.6 * ln.size && next.font === ln.font && Math.abs(next.size - ln.size) <= 0.5 && next.bold === ln.bold && next.color === ln.color && contiguous(next)) for (const r of next.runs) captionRuns.add(r);
    });
    for (const g of findRegions(p)) {
      const inRegion = p.runs.filter((r) => r.x >= g.x1 - 2 && r.x <= g.x2 + 2 && r.y >= g.yTop - 2 && r.y <= g.yBottom + 2);
      if (!inRegion.length) continue;
      // The header/body boundary is best read off the header's own fill rect
      // (found by proximity to the region's top, not by a headerBottom this
      // rect itself determines): a header row is not always followed
      // immediately by a rule — some table styles rule only between body rows
      // — so hunting for "the next line after the top" can land on the
      // row1/row2 rule instead of the header/row1 one.
      // The region's row pitch (median gap between its DISTINCT rules; 40pt
      // when there are fewer than 2 to measure from) scales every "one row"
      // distance below. Distinct matters: Word draws each rule twice (a
      // 0.49 and a 0.5 pt stroke on the same y), and the zero gaps between
      // the twins used to drag the median to nothing.
      const ruleYs = g.hlines.map((l) => l.y1).sort((a, b) => a - b).filter((y, i, arr) => i === 0 || y - arr[i - 1] > 1);
      const gaps: number[] = [];
      for (let i = 1; i < ruleYs.length; i++) gaps.push(ruleYs[i] - ruleYs[i - 1]);
      const rowPitch = gaps.length ? median(gaps) : 40;
      // The fill at the region's top is a header fill only if it is header-
      // sized — at most three rows tall and ending above the region's bottom
      // rule: a shading box drawn behind the whole table also starts at the
      // top rule and spans the width, but reaches the bottom, and must not
      // become the header (and make every row "header" through headerBottom).
      const topFill = [...g.rowRects, ...p.rects].find((r) => Math.abs(r.y - g.yTop) <= 2 && r.w >= (g.x2 - g.x1) * 0.9 && r.h <= 3 * rowPitch && r.y + r.h < g.yBottom - 1 && luminance(r.color) < 250);
      // With no fill at all (spec §5.2: "header row = first row with bold
      // runs OR on a fill"), the header can likewise sit a row above the
      // region's raw top with nothing there to widen it the way a fill rect's
      // own bounds do — so, absent a fill, the search also looks above
      // g.yTop, bounded by the row pitch rather than a fixed distance, so a
      // caption sitting further up than a real header would still be
      // excluded even without the line-text check above. Real body text
      // sitting there is never mostly bold, so this cannot mistake a
      // preceding paragraph for a header either.
      const aboveRegion = p.runs.filter((r) => r.x >= g.x1 - 2 && r.x <= g.x2 + 2 && r.y < g.yTop - 2 && r.y >= g.yTop - 1.5 * rowPitch && !captionRuns.has(r));
      // A zebra table whose header row carries no fill starts its region at
      // the FIRST BODY row's fill, so that fill sits exactly where a header
      // fill would. It is body shading, not a header, only when its colour
      // ALTERNATES — every same-coloured row rect below it is separated from
      // the previous one by exactly one unfilled row — and the bold header
      // row sits just above it on no fill at all. Mere recurrence is not
      // enough: a filled header whose group-band rows ("AM Peak Hour") reuse
      // the header fill several rows down recurs too, and must keep its fill.
      const boldAbove = aboveRegion.length > 0 && aboveRegion.filter((r) => r.bold).length / aboveRegion.length >= 0.5;
      const headerFillRect = topFill && boldAbove && alternates(topFill, g.rowRects) ? null : topFill;
      const above = headerFillRect ? [] : aboveRegion;
      const regionRuns = [...above, ...inRegion];
      const firstY = Math.min(...regionRuns.map((r) => r.y));
      const firstRow = regionRuns.filter((r) => r.y - firstY <= 0.6 * r.size);
      const firstRowBold = !headerFillRect && firstRow.length > 0 && firstRow.filter((r) => r.bold).length / firstRow.length >= 0.5;
      const headerBottom = headerFillRect
        ? headerFillRect.y + headerFillRect.h
        : firstRowBold
          ? Math.max(...firstRow.map((r) => r.y)) + 0.3 * median(firstRow.map((r) => r.size))
          : g.hlines.length ? (g.hlines.find((l) => l.y1 > g.yTop + 2)?.y1 ?? g.yTop + 18) : g.rowRects[0].y + g.rowRects[0].h;
      const headerRuns = firstRowBold ? firstRow : inRegion.filter((r) => r.y <= headerBottom + 1);
      const bodyRuns = (firstRowBold ? regionRuns : inRegion).filter((r) => r.y > headerBottom + 1);
      // Word and AcroPlot fill a header row PER CELL — five narrow rects of
      // one colour standing side by side — and when the region's first rule
      // is the one under the header, that row sits above g.yTop as well, so
      // no single rect ever spans 90 % of the region at its top. Read the
      // fill off the header row itself: the rects covering the header runs'
      // vertical band, one colour, adding up (clipped to the region) to most
      // of the region's width.
      const headerFill = headerFillRect?.color ?? (headerRuns.length ? headerBandFill(p, g, headerRuns, rowPitch) : null);
      const vlines = p.lines.filter((l) => Math.abs(l.x1 - l.x2) <= 0.5 && l.x1 >= g.x1 - 2 && l.x1 <= g.x2 + 2 && l.y1 <= g.yBottom && l.y2 >= g.yTop);
      const rules = [...g.hlines, ...vlines];
      const rowFills = g.rowRects.filter((r) => r.y > headerBottom - 1 && luminance(r.color) < 250);
      const fillColors = rowFills.map((r) => r.color);
      const zebra = fillColors.length >= 2 && new Set(fillColors).size === 1 && rowFills.length * 2 <= bodyRuns.length + 2 ? fillColors[0] : null;
      const firstCol = bodyRuns.filter((r) => r.x - g.x1 < 30);
      const padYs = g.hlines.flatMap((l) => { const below = inRegion.filter((r) => r.y - r.h >= l.y1 - 1).sort((a, b) => a.y - b.y)[0]; return below ? [clamp(below.y - below.h - l.y1, 1, 10)] : []; });
      // The caption sits above the TABLE's top, which is the header row's
      // top when that row stands above the region (unfilled header over
      // zebra rows or between-body-row rules), not the region's first rect.
      const tableTop = firstRowBold ? Math.min(g.yTop, ...firstRow.map((r) => r.y - r.h)) : g.yTop;
      const cap = captionNear(p, tableTop, g.yBottom, /^table\s+\d/i);
      found.push({
        header: { fill: headerFill, color: headerRuns.length ? mode(headerRuns.map((r) => r.color ?? body.color)) : body.color, bold: headerRuns.length > 0 && headerRuns.filter((r) => r.bold).length >= headerRuns.length / 2, size: headerRuns.length ? clamp(Math.round(mode(headerRuns.map((r) => Math.round(r.size * 2) / 2))), 5, 16) : body.size },
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
  // The firm's table style is read from its CAPTIONED regions when it has
  // any: a "Table N" line marks a table's own top, while a caption-less
  // region is a fragment of one — a totals sub-block under its own bold
  // label, an intersection group band, a continuation on the next page —
  // whose "header" is not the firm's header style at all, and fragments
  // outnumber tables.
  const captioned = found.filter((f) => f.caption);
  const pool = captioned.length ? captioned : found;
  const caps = captioned.map((f) => f.caption!);
  const style: Theme["table"] = {
    header: { fill: mode(pool.map((f) => f.header.fill)), color: mode(pool.map((f) => f.header.color)), bold: mode(pool.map((f) => f.header.bold)), size: mode(pool.map((f) => f.header.size)) },
    body: { size: mode(pool.map((f) => f.bodySize)), color: mode(pool.map((f) => f.bodyColor)) },
    rules: { color: mode(pool.map((f) => f.ruleColor)), width: median(pool.map((f) => f.ruleWidth)), mode: mode(pool.map((f) => f.mode)) },
    zebra: mode(pool.map((f) => f.zebra)),
    padX: median(pool.map((f) => f.padX)),
    padY: median(pool.map((f) => f.padY)),
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
