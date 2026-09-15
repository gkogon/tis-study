/**
 * Themed drawing primitives. The regional renderers' own helpers
 * (`section`, `gaSection`, `table`, `rows`, `metricStrip`, `drawHeader`,
 * `drawPageFooter`, `drawCover` …) delegate here whenever a non-default theme
 * is active; with the default theme they keep their original code paths so
 * output stays byte-identical.
 */
import { activeTheme, takeSynonym } from "./active";
import { canonicalKey } from "./canonical";
import { luminance, type Numbering, type TextStyle, type Theme } from "./theme";

export type TokenContext = {
  firmName: string;
  projectName: string;
  address: string;
  dateLabel: string;
  documentType: string;
  client: string;
};

export function interpolate(text: string, ctx: TokenContext, page = 0, pages = 0): string {
  const map: Record<string, string> = {
    "firm.name": ctx.firmName,
    "project.projectName": ctx.projectName,
    "project.address": ctx.address,
    "project.dateLabel": ctx.dateLabel,
    "project.client": ctx.client,
    documentType: ctx.documentType,
    page: page ? String(page) : "",
    pages: pages ? String(pages) : "",
  };
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => map[k] ?? "");
}

function fontName(style: TextStyle): string {
  if (style.font === "heading") return style.bold ? "headingbold" : "heading";
  if (style.bold && style.italic) return "bolditalic";
  if (style.bold) return "bold";
  if (style.italic) return "italic";
  return "body";
}
export function applyStyle(doc: PDFKit.PDFDocument, style: TextStyle): void {
  doc.font(fontName(style)).fontSize(style.size).fillColor(style.color);
}
const usable = (doc: PDFKit.PDFDocument) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc: PDFKit.PDFDocument) => doc.page.height - doc.page.margins.bottom;

// ─── Headings ────────────────────────────────────────────────────────────────

export function splitHeading(title: string): { parts: number[]; text: string } {
  const m = /^\s*(\d+(?:\.\d+)*)\.?\s+(.+)$/.exec(title);
  if (!m) return { parts: [], text: title.trim() };
  let parts = m[1].split(".").map(Number);
  if (parts.length === 2 && parts[1] === 0) parts = [parts[0]]; // "3.0" numbers a level-1 heading
  return { parts, text: m[2].trim() };
}

export function formatNumber(parts: number[], numbering: Numbering): string {
  if (!parts.length || numbering === "none") return "";
  const dotted = parts.join(".");
  switch (numbering) {
    case "1.0": return parts.length === 1 ? `${parts[0]}.0` : dotted;
    case "1.": return parts.length === 1 ? `${parts[0]}.` : dotted;
    case "1": return dotted;
    case "section": return parts.length === 1 ? `Section ${parts[0]}` : dotted;
    case "letter": {
      const L = String.fromCharCode(64 + Math.min(26, Math.max(1, parts[0])));
      return parts.length === 1 ? `${L}.` : [L, ...parts.slice(1)].join(".");
    }
  }
}

const SMALL_WORDS = new Set(["and", "or", "of", "for", "the", "to", "a", "an", "in", "on", "at", "by", "with"]);
export function applyCase(text: string, c: "upper" | "title" | "asis"): string {
  if (c === "upper") return text.toUpperCase();
  if (c === "title") {
    return text
      .toLowerCase()
      .split(/\s+/)
      .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }
  return text;
}

/** Re-express one of our heading titles in the theme's numbering, case and wording. */
export function formatHeading(title: string, level: 1 | 2 | 3, theme: Theme, synonymFor: (key: string) => string | null): string {
  const { parts, text } = splitHeading(title);
  const h = theme.headings[level - 1];
  const key = canonicalKey(text);
  const wording = (key && synonymFor(key)) || text;
  const num = formatNumber(parts, h.numbering);
  const sep = h.numbering === "section" && parts.length === 1 ? " – " : "  ";
  return (num ? num + sep : "") + applyCase(wording, h.case);
}

export function heading(doc: PDFKit.PDFDocument, level: 1 | 2 | 3, title: string): void {
  const t = activeTheme();
  const h = t.headings[level - 1];
  const label = formatHeading(title, level, t, takeSynonym);
  const x = doc.page.margins.left;
  const w = usable(doc);
  applyStyle(doc, h.style);
  const textH = doc.heightOfString(label, { width: w });
  const need = h.spaceBefore + textH + (h.band ? h.band.padY * 2 : 0) + (h.rule ? h.rule.gap + h.rule.width : 0) + h.spaceAfter + 24;
  if (doc.y + need > bottomLimit(doc)) doc.addPage();
  doc.y += h.spaceBefore;
  doc.x = x;
  if (h.band) {
    doc.save().rect(x, doc.y, w, textH + h.band.padY * 2).fill(h.band.color).restore();
    const ty = doc.y + h.band.padY;
    applyStyle(doc, h.style);
    doc.text(label, x + h.band.padX, ty, { width: w - h.band.padX * 2 });
    doc.y = ty + textH + h.band.padY;
  } else {
    doc.text(label, x, doc.y, { width: w });
  }
  if (h.rule) {
    const ry = doc.y + h.rule.gap;
    doc.save().strokeColor(h.rule.color).lineWidth(h.rule.width).moveTo(x, ry).lineTo(x + w, ry).stroke().restore();
    doc.y = ry + h.rule.width;
  }
  doc.y += h.spaceAfter;
  doc.x = x;
  doc.fillColor(t.text.body.color);
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export type TableSpec = {
  headers: string[];
  widths: number[];
  align?: Array<"left" | "right" | "center">;
  rows: string[][];
};

/** Renderers hard-code widths for a 512 pt usable width; shrink when the theme's margins leave less. */
export function scaleWidths(widths: number[], usableW: number): number[] {
  const sum = widths.reduce((s, w) => s + w, 0);
  if (sum <= usableW || sum === 0) return widths;
  const k = usableW / sum;
  return widths.map((w) => Math.floor(w * k * 100) / 100);
}

export function table(doc: PDFKit.PDFDocument, spec: TableSpec): void {
  const t = activeTheme();
  const tb = t.table;
  const startX = doc.page.margins.left;
  const widths = scaleWidths(spec.widths, usable(doc));
  const totalW = widths.reduce((s, w) => s + w, 0);
  const align = spec.align ?? spec.headers.map(() => "left" as const);
  const headerStyle: TextStyle = { font: "body", size: tb.header.size, color: tb.header.color, bold: tb.header.bold };
  const bodyStyle: TextStyle = { font: "body", size: tb.body.size, color: tb.body.color };
  const measure = (cells: string[], isHeader: boolean): number => {
    applyStyle(doc, isHeader ? headerStyle : bodyStyle);
    let h = 0;
    cells.forEach((c, i) => {
      const hh = doc.heightOfString(c ?? "", { width: (widths[i] ?? 60) - tb.padX * 2, align: align[i] ?? "left" });
      if (hh > h) h = hh;
    });
    return Math.max(tb.body.size + 4, h) + tb.padY * 2;
  };
  const hrule = (y: number) => {
    if (tb.rules.mode === "none") return;
    doc.save().strokeColor(tb.rules.color).lineWidth(tb.rules.width).moveTo(startX, y).lineTo(startX + totalW, y).stroke().restore();
  };
  const vrules = (y: number, h: number) => {
    if (tb.rules.mode !== "grid") return;
    doc.save().strokeColor(tb.rules.color).lineWidth(tb.rules.width);
    let x = startX;
    for (const w of [...widths, 0]) {
      doc.moveTo(x, y).lineTo(x, y + h).stroke();
      x += w;
    }
    doc.restore();
  };
  const drawRow = (cells: string[], y: number, isHeader: boolean, h: number, rowIdx: number) => {
    if (isHeader && tb.header.fill) doc.save().rect(startX, y, totalW, h).fill(tb.header.fill).restore();
    else if (!isHeader && tb.zebra && rowIdx % 2 === 1) doc.save().rect(startX, y, totalW, h).fill(tb.zebra).restore();
    applyStyle(doc, isHeader ? headerStyle : bodyStyle);
    let x = startX;
    cells.forEach((c, i) => {
      doc.text(c ?? "", x + tb.padX, y + tb.padY, { width: (widths[i] ?? 60) - tb.padX * 2, align: align[i] ?? "left" });
      x += widths[i] ?? 60;
    });
    vrules(y, h);
  };
  let y = doc.y;
  const headerH = measure(spec.headers, true);
  const firstRowH = spec.rows.length ? measure(spec.rows[0], false) : 0;
  if (y + headerH + firstRowH > bottomLimit(doc) - 40) {
    doc.addPage();
    y = doc.y;
  }
  hrule(y);
  drawRow(spec.headers, y, true, headerH, -1);
  y += headerH;
  hrule(y);
  spec.rows.forEach((r, idx) => {
    const rh = measure(r, false);
    if (y + rh > bottomLimit(doc) - 40) {
      doc.addPage();
      y = doc.y;
      const hh = measure(spec.headers, true);
      hrule(y);
      drawRow(spec.headers, y, true, hh, -1);
      y += hh;
      hrule(y);
    }
    drawRow(r, y, false, rh, idx);
    y += rh;
    hrule(y);
  });
  doc.y = y + 6;
  doc.x = startX;
  doc.fillColor(t.text.body.color);
}

// ─── Key/value rows and metric strip ────────────────────────────────────────

export function rows(doc: PDFKit.PDFDocument, pairs: Array<[string, string | undefined]>): void {
  const t = activeTheme();
  const startX = doc.page.margins.left;
  const labelW = Math.min(220, usable(doc) * 0.42);
  const valueW = usable(doc) - labelW - 10;
  for (const [label, value] of pairs) {
    const val = value ?? "—";
    applyStyle(doc, t.text.body);
    const rowH = Math.max(doc.heightOfString(label, { width: labelW }), doc.heightOfString(val, { width: valueW }));
    if (doc.y + rowH > bottomLimit(doc)) doc.addPage();
    const y = doc.y;
    doc.fillColor(t.palette.muted).text(label, startX, y, { width: labelW });
    doc.fillColor(t.text.body.color).text(val, startX + labelW + 10, y, { width: valueW });
    doc.y = y + rowH + 1;
  }
  doc.x = startX;
}

export function metricStrip(doc: PDFKit.PDFDocument, metrics: Array<{ label: string; value: string }>): void {
  const t = activeTheme();
  const startX = doc.page.margins.left;
  const cellW = usable(doc) / Math.max(1, metrics.length);
  const h = 50;
  if (doc.y + h + 8 > bottomLimit(doc)) doc.addPage();
  const y = doc.y;
  const fill = t.table.header.fill ?? "#f9fafb";
  // A firm whose table headers are a dark band usually has palette.primary in
  // the same hue, so primary-on-fill would vanish; the header's own text
  // colour is what the sample proves legible on that fill.
  const dark = luminance(fill) < 128;
  const valueColor = dark ? t.table.header.color : t.palette.primary;
  const labelColor = dark ? t.table.header.color : t.palette.muted;
  metrics.forEach((m, i) => {
    const x = startX + i * cellW;
    doc.save().rect(x, y, cellW, h).fillAndStroke(fill, t.palette.rule).restore();
    doc.font("headingbold");
    let fs = 20;
    while (fs > 9 && doc.fontSize(fs).widthOfString(m.value) > cellW - 14) fs -= 1;
    doc.fontSize(fs).fillColor(valueColor).text(m.value, x, y + 8 + (20 - fs) / 2, { width: cellW, align: "center", lineBreak: false });
    doc.font("body").fontSize(8).fillColor(labelColor).text(m.label.toUpperCase(), x, y + 32, { width: cellW, align: "center", characterSpacing: 1, lineBreak: false });
  });
  doc.fillColor(t.text.body.color);
  doc.x = startX;
  doc.y = y + h + 4;
}

// ─── Running header / footer ─────────────────────────────────────────────────

function drawZone(doc: PDFKit.PDFDocument, zone: NonNullable<Theme["header"]>, ctx: TokenContext, page: number, pages: number, where: "top" | "bottom"): void {
  const x = doc.page.margins.left;
  const w = usable(doc);
  // Stamping outside the body band must not trip PDFKit's end-of-page check
  // (it would append blank pages) — same trick as drawPageFooter in pdf-export.ts.
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  applyStyle(doc, zone.style);
  const lineH = zone.style.size * 1.2;
  const y = where === "top" ? Math.max(6, doc.page.margins.top - zone.height + 2) : doc.page.height - zone.height + 2;
  // Segments that share an alignment came from stacked lines in the sample
  // (the extractor emits them in reading order), so stack them again rather
  // than painting them over each other on one baseline.
  const lines = { left: 0, center: 0, right: 0 };
  for (const seg of zone.segments) {
    doc.text(interpolate(seg.text, ctx, page, pages), x, y + lines[seg.align] * lineH, { width: w, align: seg.align, lineBreak: false });
    lines[seg.align]++;
  }
  if (zone.rule) {
    const depth = Math.max(1, lines.left, lines.center, lines.right);
    const ry = where === "top" ? y + lineH * depth + 2 : y - 3;
    doc.strokeColor(zone.rule.color).lineWidth(zone.rule.width).moveTo(x, ry).lineTo(x + w, ry).stroke();
  }
  doc.restore();
  doc.page.margins.bottom = savedBottom;
}
export function pageHeader(doc: PDFKit.PDFDocument, ctx: TokenContext, page: number, pages: number): void {
  const z = activeTheme().header;
  if (z && z.segments.length) drawZone(doc, z, ctx, page, pages, "top");
}
export function pageFooter(doc: PDFKit.PDFDocument, ctx: TokenContext, page: number, pages: number): void {
  const z = activeTheme().footer;
  if (z && z.segments.length) drawZone(doc, z, ctx, page, pages, "bottom");
}

// ─── Cover ───────────────────────────────────────────────────────────────────

export type CoverInput = TokenContext & { firmLogo: Buffer | null; sitePhoto: Buffer | null };

function dataUrlToBuffer(d: string): Buffer | null {
  const m = /^data:image\/png;base64,(.+)$/i.exec(d);
  return m ? Buffer.from(m[1], "base64") : null;
}
function roleToken(role: Theme["cover"]["elements"][number]["role"]): string {
  switch (role) {
    case "documentType": return "{{documentType}}";
    case "projectName": return "{{project.projectName}}";
    case "dateLabel": return "{{project.dateLabel}}";
    case "preparedFor": return "{{project.client}}";
    case "preparedBy": return "{{firm.name}}";
    case "firmName": return "{{firm.name}}";
  }
}

export function cover(doc: PDFKit.PDFDocument, input: CoverInput): void {
  const t = activeTheme();
  const c = t.cover;
  const W = doc.page.width;
  const H = doc.page.height;
  if (c.background.kind === "image") {
    const b = dataUrlToBuffer(c.background.data);
    if (b) { try { doc.image(b, 0, 0, { width: W, height: H }); } catch { /* white page */ } }
  } else if (c.background.kind === "color") {
    doc.rect(0, 0, W, H).fill(c.background.color);
  }
  for (const band of c.bands) doc.rect(0, band.y0, W, band.y1 - band.y0).fill(band.color);
  // The firm's uploaded logo wins over the one lifted from the sample (spec §7.6).
  const logoBuf = input.firmLogo ?? (c.logo ? dataUrlToBuffer(c.logo.data) : null);
  if (logoBuf) {
    const box = c.logo ?? { x: doc.page.margins.left, y: 40, w: 220, h: 64 };
    try { doc.image(logoBuf, box.x, box.y, { fit: [box.w, box.h] }); } catch { /* ignore */ }
  }
  let lowest = 0;
  let lowestAboveMid = 0;
  let highestBelowMid = H;
  for (const el of c.elements) {
    const value = interpolate(roleToken(el.role), input);
    if (!value) continue;
    const text = el.label ? `${el.label} ${value}` : value;
    applyStyle(doc, el.style);
    const h = doc.heightOfString(text, { width: el.w });
    doc.text(text, el.x, el.y, { width: el.w, align: el.align });
    const bottom = el.y + h;
    if (bottom > lowest) lowest = bottom;
    if (el.y < H / 2 && bottom > lowestAboveMid) lowestAboveMid = bottom;
    if (el.y >= H / 2 && el.y < highestBelowMid) highestBelowMid = el.y;
  }
  if (!c.hasMetaBlock) {
    const x = doc.page.margins.left;
    const w = usable(doc);
    let yy = Math.max(lowest + 36, H - 200);
    applyStyle(doc, t.text.body);
    for (const [k, v] of [["Prepared for", input.client], ["Prepared by", input.firmName], ["Date", input.dateLabel]] as const) {
      if (!v) continue;
      doc.font("bold").text(k, x, yy, { width: 110 });
      doc.font("body").text(v, x + 120, yy, { width: w - 120 });
      yy += t.text.body.size * 1.6;
    }
  }
  if (input.sitePhoto && c.background.kind !== "image") {
    const top = lowestAboveMid + 24;
    const bottom = (c.elements.some((e) => e.y >= H / 2) ? highestBelowMid : c.hasMetaBlock ? H - 60 : H - 220) - 24;
    if (bottom - top >= 220) {
      try {
        doc.save().rect(doc.page.margins.left, top, usable(doc), bottom - top).clip();
        doc.image(input.sitePhoto, doc.page.margins.left, top, { cover: [usable(doc), bottom - top], align: "center", valign: "center" });
        doc.restore();
      } catch { /* no photo */ }
    }
  }
  doc.fillColor(t.text.body.color);
}
