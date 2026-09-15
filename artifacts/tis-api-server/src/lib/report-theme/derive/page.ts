import { interiorPages, linesOf, type ScannedPage } from "../pdf-scan";
import type { Theme } from "../theme";
import { clamp, mode, type BodyStyle } from "./typography";

const SNAP: Array<["LETTER" | "A4" | "LEGAL" | "TABLOID", number, number]> = [["LETTER", 612, 792], ["A4", 595.28, 841.89], ["LEGAL", 612, 1008], ["TABLOID", 792, 1224]];
const pct = (nums: number[], q: number) => { const s = [...nums].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))]; };

/** Keep only the interior pages whose (width, height), rounded to 1pt, is the most common — a stray landscape plan sheet or oversize exhibit must not corrupt the geometry math derived from the report's real page size. */
function modalSizePages(pages: ScannedPage[]): ScannedPage[] {
  const key = (p: ScannedPage) => `${Math.round(p.width)}x${Math.round(p.height)}`;
  const modal = mode(pages.map(key));
  return pages.filter((p) => key(p) === modal);
}

/** Page size (snapped to a named size within 2 pt), orientation, and symmetric margins from the body text band. */
export function pageGeometry(pages: ScannedPage[], body: BodyStyle, zones: { headerBottom: number | null; footerTop: number | null }): Theme["page"] | null {
  const interior = modalSizePages(interiorPages(pages));
  if (!interior.length) return null;
  const w = mode(interior.map((p) => Math.round(p.width * 100) / 100));
  const h = mode(interior.map((p) => Math.round(p.height * 100) / 100));
  const portrait = h >= w;
  const [pw, ph] = portrait ? [w, h] : [h, w];
  const snap = SNAP.find(([, sw, sh]) => Math.abs(sw - pw) <= 2 && Math.abs(sh - ph) <= 2);
  // Unsnapped sizes are stored portrait-normalised ([pw, ph], pw <= ph, same
  // convention as SNAP) because pageSizePoints (theme.ts) swaps the tuple
  // back for a landscape page — storing the raw, possibly-landscape [w, h]
  // here would get swapped a second time and come out wrong.
  const size: Theme["page"]["size"] = snap ? snap[0] : [pw, ph];
  const lefts: number[] = [], rights: number[] = [], tops: number[] = [], bottoms: number[] = [];
  for (const p of interior) {
    const inBand = (r: { y: number }) => !(zones.headerBottom != null && r.y < zones.headerBottom) && !(zones.footerTop != null && r.y > zones.footerTop);
    // Left/right come from body-style LINES wide enough to be paragraph
    // text — lines, not runs: a Distiller/CID print splits one justified
    // Palatino line into ten kerned runs, none of them 45 % of the page, so a
    // run-based census sees no paragraph text at all and the margin ends up
    // read off whatever stray wide run exists (a contents page's dot
    // leaders, indented 200 pt).
    const rs = linesOf(p).filter((l) => l.font === body.font && Math.abs(l.size - body.size) <= 0.5 && l.w >= 0.45 * p.width && inBand(l));
    // Top/bottom come from EVERY run in the band — pages usually open with a heading, not body text.
    const all = p.runs.filter(inBand);
    if (rs.length) {
      lefts.push(Math.round(Math.min(...rs.map((r) => r.x))));
      rights.push(Math.round(Math.max(...rs.map((r) => r.x + r.w))));
    }
    if (all.length) {
      tops.push(Math.min(...all.map((r) => r.y - r.h)));
      bottoms.push(Math.max(...all.map((r) => r.y)));
    }
  }
  if (!lefts.length || !tops.length) return null;
  const left = mode(lefts);
  // Ragged-right text never reaches the margin on every page; the longest lines do.
  const right = w - pct(rights, 0.95);
  const lr = clamp(Math.round((left + right) / 2), 18, 144);
  const top = clamp(Math.round(pct(tops, 0.2)), 18, 144);
  const bottom = clamp(Math.round(h - pct(bottoms, 0.8)), 18, 144);
  return { size, orientation: portrait ? "portrait" : "landscape", margins: { top, right: lr, bottom, left: lr } };
}
