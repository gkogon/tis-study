import { interiorPages, type ScannedPage } from "../pdf-scan";
import { chroma, hueDistance, luminance, type Theme } from "../theme";
import type { BodyStyle, HeadingLevel } from "./typography";

/** Brand colours from what the sample actually draws — heading text, fills, rules — not from pixels. */
export function derivePalette(pages: ScannedPage[], body: BodyStyle, headings: HeadingLevel[], mutedCandidates: string[]): Theme["palette"] {
  const weight = new Map<string, number>();
  const add = (c: string | null, w: number) => { if (c) weight.set(c, (weight.get(c) ?? 0) + w); };
  for (const h of headings) add(h.color, 3 * Math.max(1, h.lines.length));
  const lineColors: string[] = [];
  for (const p of interiorPages(pages)) {
    for (const r of p.rects) {
      if (r.w * r.h >= 0.5 * p.width * p.height) continue; // page background
      if (luminance(r.color) > 245) continue;
      add(r.color, 1);
    }
    for (const l of p.lines) { add(l.color, 1); lineColors.push(l.color); }
  }
  const saturated = [...weight.entries()].filter(([c]) => chroma(c) > 25 && luminance(c) < 235).sort((a, b) => b[1] - a[1]);
  const primary = saturated[0]?.[0] ?? headings[0]?.color ?? "#000000";
  const accent = saturated.find(([c]) => hueDistance(c, primary) > 40)?.[0] ?? primary;
  const ruleCount = new Map<string, number>();
  for (const c of lineColors) ruleCount.set(c, (ruleCount.get(c) ?? 0) + 1);
  const rule = [...ruleCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#d1d5db";
  const muted = mutedCandidates.find((c) => chroma(c) <= 24 && luminance(c) >= 80 && luminance(c) <= 190) ?? "#6b7280";
  return { primary, accent, text: body.color, muted, rule };
}
