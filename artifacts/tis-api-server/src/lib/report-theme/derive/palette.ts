import { interiorPages, type ScannedPage } from "../pdf-scan";
import { chroma, hueDistance, luminance, type Theme } from "../theme";
import type { BodyStyle, HeadingLevel } from "./typography";

/** Brand colours from what the sample actually draws — heading text, fills, rules — not from pixels. A report whose interior is set entirely in black (serif firms often are) still carries its brand in the cover's bands, so those stand in when nothing saturated is drawn inside. */
export function derivePalette(pages: ScannedPage[], body: BodyStyle, headings: HeadingLevel[], mutedCandidates: string[], cover?: Theme["cover"]): Theme["palette"] {
  const weight = new Map<string, number>();
  const add = (c: string | null, w: number) => { if (c) weight.set(c, (weight.get(c) ?? 0) + w); };
  for (const h of headings) add(h.color, 3 * Math.max(1, h.lines.length));
  const lineColors: string[] = [];
  for (const p of interiorPages(pages)) {
    // A fill or rule colour counts once per PAGE it appears on, not once per
    // rect: a LOS table shades its rows cell by cell, so one page of pale
    // green cells would otherwise outvote the teal every heading is set in.
    const onPage = new Set<string>();
    for (const r of p.rects) {
      if (r.w * r.h >= 0.5 * p.width * p.height) continue; // page background
      if (luminance(r.color) > 245) continue;
      onPage.add(r.color);
    }
    for (const l of p.lines) { onPage.add(l.color); lineColors.push(l.color); }
    for (const c of onPage) add(c, 1);
  }
  // Pale tints (luminance ≥ 220 — zebra rows, LOS shading, highlight) are
  // shading applied over a brand colour, never the brand colour itself.
  const isBrand = (c: string) => chroma(c) > 25 && luminance(c) < 220;
  const saturated = [...weight.entries()].filter(([c]) => isBrand(c)).sort((a, b) => b[1] - a[1]);
  if (!saturated.length && cover) {
    // Ranked by the total height a colour's bands cover — a cover often
    // repeats its brand colour in several strips around one accent band.
    const coverage = new Map<string, number>();
    for (const b of cover.bands) coverage.set(b.color, (coverage.get(b.color) ?? 0) + (b.y1 - b.y0));
    if (cover.background.kind === "color") coverage.set(cover.background.color, (coverage.get(cover.background.color) ?? 0) + 1);
    for (const [c, h] of [...coverage.entries()].sort((a, b) => b[1] - a[1])) if (isBrand(c)) saturated.push([c, h]);
  }
  const primary = saturated[0]?.[0] ?? headings[0]?.color ?? "#000000";
  const accent = saturated.find(([c]) => hueDistance(c, primary) > 40)?.[0] ?? primary;
  const ruleCount = new Map<string, number>();
  for (const c of lineColors) ruleCount.set(c, (ruleCount.get(c) ?? 0) + 1);
  const rule = [...ruleCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#d1d5db";
  const muted = mutedCandidates.find((c) => chroma(c) <= 24 && luminance(c) >= 80 && luminance(c) <= 190) ?? "#6b7280";
  return { primary, accent, text: body.color, muted, rule };
}
