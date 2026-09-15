import { interiorPages, linesOf, type ScannedPage, type TextLine, type TextRun } from "../pdf-scan";
import type { Theme } from "../theme";
import { clamp, median, mode, type BodyStyle } from "./typography";

export type TokenizeCtx = { firmName: string; coverTitle: string | null };
export type DetectedZone = NonNullable<Theme["header"]> & { edge: number };

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\b(inc|llc|ltd|pllc|plc|pc|pa|corp|co|company|limited)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2},?\s+)?\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const DOCTYPE_RE = /traffic (impact|study|assessment)|transportation impact|transport (assessment|statement)|trip generation (memo|letter)/i;
const PAGE_OF_RE = /\bpage\s+\d+\s+of\s+\d+\b/i;
const PAGE_N_RE = /\bpage\s+\d+\b/i;
const PAGE_BARE_RE = /^[-–—]?\s*\d{1,3}\s*[-–—]?$/;

/** One header/footer fragment → token string, or null when it must be dropped (spec §5.3). */
export function classifyRunningText(part: string, ctx: TokenizeCtx): string | null {
  const p = part.trim();
  if (!p) return null;
  // Page patterns return ONLY the token, never the surrounding text: a
  // scanner-joined, tab-stop footer line ("Client Name   Doc Type   Page 3 of
  // 12") arrives as one un-separated part, and if a page marker matches
  // anywhere inside it the rest is sample text that must never reach the
  // template (spec §5.3) — tokenizeSegment recovers that remainder and drops
  // it explicitly rather than letting it ride along via String.replace.
  if (PAGE_OF_RE.test(p)) return "Page {{page}} of {{pages}}";
  if (PAGE_N_RE.test(p)) return "Page {{page}}";
  if (PAGE_BARE_RE.test(p)) return "{{page}}";
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
    const raw = parts[i];
    const tok = classifyRunningText(raw, ctx);
    if (tok === null) { if (raw.trim()) dropped.push(raw.trim()); pendingSep = out.length ? pendingSep : ""; continue; }
    // A page token may have matched only part of `raw` (no separator to have
    // split it out already) — recover whatever is left after removing the
    // matched page marker and drop it, rather than letting it silently ride
    // along inside the returned token string.
    const leftover =
      tok === "Page {{page}} of {{pages}}" ? raw.replace(PAGE_OF_RE, " ").replace(/\s+/g, " ").trim() :
      tok === "Page {{page}}" ? raw.replace(PAGE_N_RE, " ").replace(/\s+/g, " ").trim() :
      "";
    if (leftover) dropped.push(leftover);
    if (out.length && pendingSep) out.push(pendingSep.trim() ? ` ${pendingSep.trim()} ` : "   ");
    out.push(tok);
    pendingSep = "";
  }
  return { text: out.join("").replace(/\s+/g, " ").trim(), dropped };
}

const normKey = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
const alignOfXW = (x: number, w: number, W: number): "left" | "center" | "right" => { const c = (x + w / 2) / W; return c < 0.4 ? "left" : c > 0.6 ? "right" : "center"; };

/** Join a subset of a line's runs the same way pdf-scan's linesOf joins a whole line's runs into text. */
function joinRuns(runs: TextRun[]): string {
  const sorted = [...runs].sort((a, b) => a.x - b.x);
  let text = sorted[0]?.str ?? "";
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], r = sorted[i];
    const gap = r.x - (prev.x + prev.w);
    text += (gap > 0.2 * r.size && !text.endsWith(" ") && !r.str.startsWith(" ") ? " " : "") + r.str;
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split a line's own runs at gaps wider than 2× its font size — tab stops.
 * A Word footer laid out as "Client Name<TAB>Doc Type<TAB>Page N of M"
 * arrives from the scanner joined into one TextLine.text with ordinary
 * single spaces (linesOf only ever inserts a single space between runs, it
 * never records how wide the gap actually was), so recovering the tab-stop
 * columns has to look at the underlying runs' x/w instead of the flattened
 * text.
 */
function tabStopParts(ln: TextLine): Array<{ text: string; x: number; w: number }> {
  const runs = [...ln.runs].sort((a, b) => a.x - b.x);
  const groups: TextRun[][] = [];
  for (const r of runs) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (g && prev && r.x - (prev.x + prev.w) <= 2 * ln.size) g.push(r);
    else groups.push([r]);
  }
  return groups.map((g) => {
    const x = Math.min(...g.map((r) => r.x));
    const w = Math.max(...g.map((r) => r.x + r.w)) - x;
    return { text: joinRuns(g), x, w };
  });
}

/** Keep only the interior pages whose (width, height), rounded to 1pt, is the most common — a stray landscape plan sheet or oversize exhibit must not corrupt the zone/geometry math derived from the report's real page size. */
function modalSizePages(pages: ScannedPage[]): ScannedPage[] {
  const key = (p: ScannedPage) => `${Math.round(p.width)}x${Math.round(p.height)}`;
  const modal = mode(pages.map(key));
  return pages.filter((p) => key(p) === modal);
}

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
    for (const part of tabStopParts(first)) {
      const { text, dropped } = tokenizeSegment(part.text, ctx);
      for (const d of dropped) warnings.push(`Dropped ${where === "top" ? "header" : "footer"} text that could not be mapped: "${d}".`);
      if (!text) continue;
      const align = alignOfXW(part.x, part.w, W);
      if (!segments.some((s) => s.text === text && s.align === align)) segments.push({ align, text });
    }
  }
  // A zone whose every segment was dropped (an address-only footer, a firm's
  // contact band) still occupies its band on every page: its extent must
  // reach the geometry pass or the footer lines count as body text and the
  // bottom margin collapses onto them. It is returned with `segments: []`;
  // the assembler stores null for it (a zone with no segments draws nothing).
  const all = kept.flatMap(([, ls]) => ls);
  const ref = all.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  const style = { font: (headingFont && ref.font === headingFont && ref.font !== body.font ? "heading" : "body") as "heading" | "body", size: clamp(Math.round(ref.size * 2) / 2, 5, 14), color: ref.color ?? body.color, bold: ref.bold };
  const zoneTop = where === "top" ? 0 : Math.min(...all.map((l) => l.y - l.size));
  const maxY = Math.max(...all.map((l) => l.y));
  // The rule search uses a fixed, generous window around the zone (whether
  // the rule sits just above or just below the text) that is independent of
  // the zone's own vertical extent below — so a rule-less zone doesn't
  // inherit the search window's slack, and a found rule doesn't get
  // shadowed by an unrelated "one line height" guess.
  const rules = pages.flatMap((p) => p.lines.filter((l) => Math.abs(l.y1 - l.y2) <= 0.5 && l.x2 - l.x1 >= W * 0.5 && l.y1 >= zoneTop - 8 && l.y1 <= maxY + 12));
  const rule = rules.length >= need ? { color: mode(rules.map((r) => r.color)), width: clamp(median(rules.map((r) => r.width)), 0.25, 3) } : null;
  const ruleY = rule ? median(rules.map((r) => r.y1)) : null;
  const extent = where === "top" ? (ruleY ?? maxY + 0.25 * ref.size) : (ruleY ?? zoneTop);
  const height = where === "top" ? Math.ceil(extent + 4) : Math.ceil(H - extent + 4);
  return { segments: segments.slice(0, 6), style, rule, height: clamp(height, 0, 144), edge: where === "top" ? height : H - height };
}

export function detectRunningZones(pages: ScannedPage[], body: BodyStyle, headingFont: string | null, ctx: TokenizeCtx): { header: DetectedZone | null; footer: DetectedZone | null; warnings: string[] } {
  const warnings: string[] = [];
  const interior = modalSizePages(interiorPages(pages));
  if (interior.length < 2) {
    warnings.push("Fewer than two interior pages; running header/footer not detected.");
    return { header: null, footer: null, warnings };
  }
  return { header: detectZone(interior, "top", body, headingFont, ctx, warnings), footer: detectZone(interior, "bottom", body, headingFont, ctx, warnings), warnings };
}
