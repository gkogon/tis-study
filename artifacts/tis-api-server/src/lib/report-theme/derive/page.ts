import { interiorPages, type ScannedPage } from "../pdf-scan";
import type { Theme } from "../theme";
import { clamp, mode, type BodyStyle } from "./typography";

const SNAP: Array<["LETTER" | "A4" | "LEGAL" | "TABLOID", number, number]> = [["LETTER", 612, 792], ["A4", 595.28, 841.89], ["LEGAL", 612, 1008], ["TABLOID", 792, 1224]];
const pct = (nums: number[], q: number) => { const s = [...nums].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

/** Page size (snapped to a named size within 2 pt), orientation, and symmetric margins from the body text band. */
export function pageGeometry(pages: ScannedPage[], body: BodyStyle, zones: { headerBottom: number | null; footerTop: number | null }): Theme["page"] | null {
  const interior = interiorPages(pages);
  if (!interior.length) return null;
  const w = mode(interior.map((p) => Math.round(p.width * 100) / 100));
  const h = mode(interior.map((p) => Math.round(p.height * 100) / 100));
  const portrait = h >= w;
  const [pw, ph] = portrait ? [w, h] : [h, w];
  const snap = SNAP.find(([, sw, sh]) => Math.abs(sw - pw) <= 2 && Math.abs(sh - ph) <= 2);
  const size: Theme["page"]["size"] = snap ? snap[0] : [w, h];
  const lefts: number[] = [], rights: number[] = [], tops: number[] = [], bottoms: number[] = [];
  for (const p of interior) {
    const inBand = (r: { y: number }) => !(zones.headerBottom != null && r.y < zones.headerBottom) && !(zones.footerTop != null && r.y > zones.footerTop);
    // Left/right come from body-style lines wide enough to be paragraph text.
    const rs = p.runs.filter((r) => r.font === body.font && Math.abs(r.size - body.size) <= 0.5 && r.w >= 0.45 * p.width && inBand(r));
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
