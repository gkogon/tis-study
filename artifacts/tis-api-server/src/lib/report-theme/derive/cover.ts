import { linesOf, type ScannedPage, type TextLine } from "../pdf-scan";
import { imagePixelsToPngDataUrl } from "../png";
import { luminance, type CoverElement, type Theme } from "../theme";
import { normalizeName } from "./header-footer";
import type { BodyStyle } from "./typography";

const DOCTYPE_RE = /traffic (impact|study|assessment)|transportation impact|transport (assessment|statement)/i;
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2},?\s+)?\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const PREPARED_FOR_RE = /^(prepared|submitted)\s+(for|to)\b:?/i;
const PREPARED_BY_RE = /^(prepared|submitted)\s+by\b:?/i;

const EMPTY: Theme["cover"] = { background: { kind: "none" }, bands: [], logo: null, elements: [], hasMetaBlock: false };

function elementFor(ln: TextLine, role: CoverElement["role"], W: number, body: BodyStyle, headingFont: string | null, label?: string): CoverElement {
  const c = (ln.x + ln.w / 2) / W;
  const align: CoverElement["align"] = c < 0.4 ? "left" : c > 0.6 ? "right" : "center";
  let x = ln.x, w = W - ln.x - 36;
  if (align === "center") { const m = Math.max(24, Math.min(ln.x, W - (ln.x + ln.w))); x = m; w = W - 2 * m; }
  if (align === "right") { x = 36; w = ln.x + ln.w - 36; }
  return {
    role, x: Math.round(x), y: Math.round(ln.y - ln.size), w: Math.max(20, Math.round(w)), align,
    style: { font: headingFont && ln.font === headingFont && ln.font !== body.font ? "heading" : "body", size: Math.max(4, Math.round(ln.size * 2) / 2), color: ln.color ?? body.color, bold: ln.bold },
    ...(label ? { label } : {}),
  };
}

export function deriveCover(page1: ScannedPage | undefined, body: BodyStyle, headingFont: string | null, ctx: { firmName: string }): { cover: Theme["cover"]; coverTitle: string | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!page1) return { cover: EMPTY, coverTitle: null, warnings: ["No cover page found."] };
  const W = page1.width, H = page1.height, area = W * H;
  const bgImage = page1.images.filter((im) => im.w * im.h >= 0.7 * area && im.pixels).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
  const bgData = bgImage?.pixels ? imagePixelsToPngDataUrl(bgImage.pixels) : null;
  const bgRect = page1.rects.find((r) => r.w * r.h >= 0.9 * area && luminance(r.color) < 250);
  const background: Theme["cover"]["background"] = bgData ? { kind: "image", data: bgData } : bgRect ? { kind: "color", color: bgRect.color } : { kind: "none" };
  if (bgImage && !bgData) warnings.push("Cover background image could not be decoded; using a plain cover.");
  const bands = page1.rects
    .filter((r) => r !== bgRect && r.w >= 0.9 * W && r.h >= 12 && r.h < 0.7 * H && luminance(r.color) < 250)
    .sort((a, b) => a.y - b.y).slice(0, 8)
    .map((r) => ({ y0: Math.round(r.y), y1: Math.round(r.y + r.h), color: r.color }));
  const logoIm = page1.images
    .filter((im) => im !== bgImage && im.pixels && im.w / im.h >= 1.6 && im.w / im.h <= 12 && im.h >= 24 && im.h <= 600)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
  const logoData = logoIm?.pixels ? imagePixelsToPngDataUrl(logoIm.pixels) : null;
  const logo = logoIm && logoData ? { x: Math.round(logoIm.x), y: Math.round(logoIm.y), w: Math.round(logoIm.w), h: Math.round(logoIm.h), data: logoData } : null;
  if (page1.images.length && !logo && !bgData) warnings.push("No logo-shaped image found on the cover.");

  const lines = linesOf(page1).filter((l) => l.text.length > 0);
  const used = new Set<TextLine>();
  const els: CoverElement[] = [];
  const firm = normalizeName(ctx.firmName);
  const docType = lines.filter((l) => DOCTYPE_RE.test(l.text)).sort((a, b) => b.size - a.size)[0];
  if (docType) { used.add(docType); els.push(elementFor(docType, "documentType", W, body, headingFont)); }
  const isMeta = (l: TextLine) => DATE_RE.test(l.text) || PREPARED_FOR_RE.test(l.text) || PREPARED_BY_RE.test(l.text) || normalizeName(l.text) === firm;
  const title = lines.filter((l) => !used.has(l) && !isMeta(l) && l.size >= Math.max(body.size * 1.3, 11)).sort((a, b) => b.size - a.size || a.y - b.y)[0];
  if (title) { used.add(title); els.push(elementFor(title, "projectName", W, body, headingFont)); }
  let hasMeta = false;
  for (const l of lines) {
    if (used.has(l)) continue;
    if (PREPARED_FOR_RE.test(l.text)) { used.add(l); hasMeta = true; els.push(elementFor(l, "preparedFor", W, body, headingFont, l.text.match(PREPARED_FOR_RE)![0])); continue; }
    if (PREPARED_BY_RE.test(l.text)) { used.add(l); hasMeta = true; els.push(elementFor(l, "preparedBy", W, body, headingFont, l.text.match(PREPARED_BY_RE)![0])); continue; }
    if (DATE_RE.test(l.text) && !els.some((e) => e.role === "dateLabel")) { used.add(l); hasMeta = true; els.push(elementFor(l, "dateLabel", W, body, headingFont)); continue; }
    if (firm && normalizeName(l.text) === firm && !els.some((e) => e.role === "firmName")) { used.add(l); els.push(elementFor(l, "firmName", W, body, headingFont)); continue; }
  }
  for (const l of lines) if (!used.has(l)) warnings.push(`Dropped cover text that could not be mapped: "${l.text.slice(0, 60)}".`);
  const elements = els.sort((a, b) => a.y - b.y).slice(0, 12);
  return { cover: { background, bands, logo, elements, hasMetaBlock: hasMeta }, coverTitle: title ? title.text : null, warnings };
}
