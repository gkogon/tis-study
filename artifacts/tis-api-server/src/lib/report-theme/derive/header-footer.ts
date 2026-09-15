import { interiorPages, linesOf, type ScannedPage, type TextLine } from "../pdf-scan";
import type { Theme } from "../theme";
import { clamp, median, mode, type BodyStyle } from "./typography";

export type TokenizeCtx = { firmName: string; coverTitle: string | null };
export type DetectedZone = NonNullable<Theme["header"]> & { edge: number };

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\b(inc|llc|ltd|pllc|plc|pc|pa|corp|co|company|limited)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2},?\s+)?\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const DOCTYPE_RE = /traffic (impact|study|assessment)|transportation impact|transport (assessment|statement)|trip generation (memo|letter)/i;

/** One header/footer fragment → token string, or null when it must be dropped (spec §5.3). */
export function classifyRunningText(part: string, ctx: TokenizeCtx): string | null {
  const p = part.trim();
  if (!p) return null;
  if (/\bpage\s+\d+\s+of\s+\d+\b/i.test(p)) return p.replace(/\bpage\s+\d+\s+of\s+\d+\b/i, "Page {{page}} of {{pages}}");
  if (/\bpage\s+\d+\b/i.test(p)) return p.replace(/\bpage\s+\d+\b/i, "Page {{page}}");
  if (/^[-–—]?\s*\d{1,3}\s*[-–—]?$/.test(p)) return "{{page}}";
  const firm = normalizeName(ctx.firmName);
  const np = normalizeName(p);
  if (firm && (np === firm || (np.length >= 6 && firm.includes(np)) || (firm.length >= 6 && np.includes(firm)))) return "{{firm.name}}";
  if (DOCTYPE_RE.test(p)) return "{{documentType}}";
  if (DATE_RE.test(p)) return "{{project.dateLabel}}";
  if (ctx.coverTitle && normalizeName(ctx.coverTitle) === np) return "{{project.projectName}}";
  return null;
}

/** Split on visual separators, classify each part, drop the unclassifiable, re-join. */
export function tokenizeSegment(text: string, ctx: TokenizeCtx): { text: string; dropped: string[] } {
  const parts = text.split(/(\s*[|•·]\s*|\s+[–—-]\s+|\s{3,})/);
  const dropped: string[] = [];
  const out: string[] = [];
  let pendingSep = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { pendingSep = parts[i]; continue; }
    const tok = classifyRunningText(parts[i], ctx);
    if (tok === null) { if (parts[i].trim()) dropped.push(parts[i].trim()); pendingSep = out.length ? pendingSep : ""; continue; }
    if (out.length && pendingSep) out.push(pendingSep.trim() ? ` ${pendingSep.trim()} ` : "   ");
    out.push(tok);
    pendingSep = "";
  }
  return { text: out.join("").replace(/\s+/g, " ").trim(), dropped };
}

const normKey = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
const alignOf = (ln: TextLine, W: number): "left" | "center" | "right" => { const c = (ln.x + ln.w / 2) / W; return c < 0.4 ? "left" : c > 0.6 ? "right" : "center"; };

function detectZone(pages: ScannedPage[], where: "top" | "bottom", body: BodyStyle, headingFont: string | null, ctx: TokenizeCtx, warnings: string[]): DetectedZone | null {
  const need = Math.max(2, Math.ceil(pages.length * 0.6));
  const byKey = new Map<string, TextLine[]>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const ln of linesOf(p)) {
      const inZone = where === "top" ? ln.y < p.height * 0.08 : ln.y > p.height * 0.92;
      if (!inZone || !ln.text) continue;
      const k = normKey(ln.text);
      if (seen.has(k)) continue;
      seen.add(k);
      byKey.set(k, [...(byKey.get(k) ?? []), ln]);
    }
  }
  const kept = [...byKey.entries()].filter(([, ls]) => ls.length >= need);
  if (!kept.length) return null;
  const W = pages[0].width, H = pages[0].height;
  const segments: DetectedZone["segments"] = [];
  for (const [, ls] of kept) {
    const first = ls[0];
    const { text, dropped } = tokenizeSegment(first.text, ctx);
    for (const d of dropped) warnings.push(`Dropped ${where === "top" ? "header" : "footer"} text that could not be mapped: "${d}".`);
    if (!text) continue;
    const align = mode(ls.map((l) => alignOf(l, W)));
    if (!segments.some((s) => s.text === text && s.align === align)) segments.push({ align, text });
  }
  if (!segments.length) return null;
  const all = kept.flatMap(([, ls]) => ls);
  const ref = all.reduce((a, b) => (b.runs[0].str.length > a.runs[0].str.length ? b : a));
  const style = { font: (headingFont && ref.font === headingFont && ref.font !== body.font ? "heading" : "body") as "heading" | "body", size: clamp(Math.round(ref.size * 2) / 2, 5, 14), color: ref.color ?? body.color, bold: ref.bold };
  const zoneTop = where === "top" ? 0 : Math.min(...all.map((l) => l.y - l.size));
  // Symmetric with zoneTop above: extend past the header text's own baseline
  // by its size so a rule sitting a few points below the last header line
  // (the common case — see the divider under the running header) still
  // falls inside the ±8 search window below.
  const zoneBottom = where === "top" ? Math.max(...all.map((l) => l.y + l.size)) : H;
  const rules = pages.flatMap((p) => p.lines.filter((l) => Math.abs(l.y1 - l.y2) <= 0.5 && l.x2 - l.x1 >= W * 0.5 && l.y1 >= zoneTop - 8 && l.y1 <= zoneBottom + 8));
  const rule = rules.length >= need ? { color: mode(rules.map((r) => r.color)), width: clamp(median(rules.map((r) => r.width)), 0.25, 3) } : null;
  const height = where === "top" ? Math.ceil(Math.max(zoneBottom, rule ? median(rules.map((r) => r.y1)) : 0) + 4) : Math.ceil(H - Math.min(zoneTop, rule ? median(rules.map((r) => r.y1)) : H) + 4);
  return { segments: segments.slice(0, 6), style, rule, height: clamp(height, 0, 144), edge: where === "top" ? height : H - height };
}

export function detectRunningZones(pages: ScannedPage[], body: BodyStyle, headingFont: string | null, ctx: TokenizeCtx): { header: DetectedZone | null; footer: DetectedZone | null; warnings: string[] } {
  const warnings: string[] = [];
  const interior = interiorPages(pages);
  if (interior.length < 2) {
    warnings.push("Fewer than two interior pages; running header/footer not detected.");
    return { header: null, footer: null, warnings };
  }
  return { header: detectZone(interior, "top", body, headingFont, ctx, warnings), footer: detectZone(interior, "bottom", body, headingFont, ctx, warnings), warnings };
}
