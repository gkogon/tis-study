/**
 * Template-driven report engine — "format = data".
 *
 * A report's FORMAT (cover, branding, ordered chapters/sections, the prose, and
 * which computed block goes where) is expressed as a declarative `ReportTemplate`
 * value, NOT a hand-coded renderer function. One generic engine consumes
 * `(template + study data) → PDF`. The dynamic, computed bits (tables, charts,
 * metric strips) are pulled by *named providers* from a registry, so the typed
 * computation stays in a reusable library while structure/branding/prose are
 * importable, swappable data.
 *
 * This is what lets the same study render into Velocity's Transport-Assessment
 * format OR any other firm's template: author a different `ReportTemplate`,
 * reuse the same providers. See ./templates/velocity.ts and
 * ./templates/generic-us.ts for two templates over identical study data.
 */
import PDFDocument from "pdfkit";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  drawColumnChart,
  drawLineChart,
  type ColumnChartSpec,
  type LineChartSpec,
} from "../pdf-charts";

const PAGE_MARGIN = 50;

// Reuse the repo's bundled Unicode fonts (same resolution as pdf-export.ts).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = (() => {
  for (const c of [
    path.resolve(__dirname, "../../data/fonts"),
    path.resolve(__dirname, "../../../data/fonts"),
    path.resolve(__dirname, "../data/fonts"),
  ]) {
    if (existsSync(path.join(c, "DejaVuSans.ttf"))) return c;
  }
  return path.resolve(__dirname, "../../data/fonts");
})();

// ─────────────────────────────── Types ───────────────────────────────

/** Everything a provider / interpolation can read about the study. */
export type RenderContext = {
  /** The study result payload (the engine's `r`). */
  report: any;
  /** The StoredProject-shaped record. */
  project: any;
  /** The resolved Region. */
  region: any;
  /** Firm identity for branding interpolation. */
  firm: { name: string; logoUrl?: string | null };
};

export type TableData = {
  headers: string[];
  widths?: number[];
  align?: Array<"left" | "right" | "center">;
  rows: string[][];
};

export type MetricData = Array<{ label: string; value: string }>;
export type KeyValueData = Array<[string, string]>;
export type ChartData =
  | { type: "column"; spec: ColumnChartSpec }
  | { type: "line"; spec: LineChartSpec };

/**
 * Named, typed computations over the study data. A template references these by
 * id; the engine calls them and draws the result. Returning null skips the block.
 */
export type ProviderRegistry = {
  tables?: Record<string, (ctx: RenderContext) => TableData | null>;
  metrics?: Record<string, (ctx: RenderContext) => MetricData | null>;
  keyvalues?: Record<string, (ctx: RenderContext) => KeyValueData | null>;
  charts?: Record<string, (ctx: RenderContext) => ChartData | null>;
  /** Boolean flags for conditional blocks. */
  flags?: Record<string, (ctx: RenderContext) => boolean>;
};

/** A unit of content inside a section. Prose supports `{{path}}` interpolation. */
export type Block =
  | { kind: "prose"; text: string }
  | { kind: "note"; text: string } // muted "to be completed at submittal" note
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; provider: string }
  | { kind: "metrics"; provider: string }
  | { kind: "keyvalue"; provider: string }
  | { kind: "chart"; provider: string }
  | { kind: "if"; flag: string; then: Block[]; else?: Block[] };

export type Section = { number?: string; title: string; blocks: Block[] };
export type Chapter = { number?: string; title: string; intro?: string; sections: Section[] };

export type Brand = {
  /** Static firm name, or `{{firm.name}}` to bind to the running firm. */
  firmName: string;
  url?: string;
  /** Cover logo as a PNG/JPEG data URL (e.g. extracted from an imported PDF). */
  logo?: string;
  palette: {
    primary: string;
    onPrimary: string;
    accent: string;
    text: string;
    muted: string;
    tableHeader: string;
    rule: string;
  };
  cover:
    | { style: "gradient"; colors: string[]; wordmark?: string; tagline?: string }
    | { style: "band"; tagline?: string }
    | { style: "image"; image: string; tagline?: string };
  /** Per-page footer, interpolated. Use `{{page}}` for the page number. */
  footer: string;
  /** Render a Velocity-style Document Control Sheet as page i. */
  docControl?: boolean;
};

export type ReportTemplate = {
  id: string;
  name: string;
  /** Big cover label, e.g. "TRANSPORT ASSESSMENT" or "TRAFFIC IMPACT STUDY". */
  documentType: string;
  brand: Brand;
  chapters: Chapter[];
};

// ───────────────────────────── Interpolation ─────────────────────────────

function resolvePath(scope: any, dotted: string): unknown {
  return dotted.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), scope);
}

function fmt(value: unknown, formatter?: string): string {
  if (value == null || value === "") return "—";
  // Never let a non-finite number (NaN / Infinity) leak into rendered text.
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  const n = Number(value);
  switch (formatter) {
    case "num":
      return Number.isFinite(n) ? Math.round(n).toLocaleString() : "—";
    case "num1":
      return Number.isFinite(n) ? n.toFixed(1) : "—";
    case "num2":
      return Number.isFinite(n) ? n.toFixed(2) : "—";
    default:
      return String(value);
  }
}

/** Resolve `{{path}}` and `{{path|num}}` tokens against the context (+ page no.). */
function interp(text: string, ctx: RenderContext, page?: number): string {
  const scope = {
    ...ctx.report,
    report: ctx.report,
    project: ctx.project,
    region: ctx.region,
    firm: ctx.firm,
    page: page ?? "",
  };
  return text.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+))?\s*\}\}/g, (_m, p: string, f?: string) =>
    fmt(resolvePath(scope, p), f),
  );
}

// ─────────────────────────── Draw primitives ───────────────────────────

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - PAGE_MARGIN - 36) doc.addPage();
}

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl);
  return m ? Buffer.from(m[2], "base64") : null;
}

function drawCover(doc: PDFKit.PDFDocument, t: ReportTemplate, ctx: RenderContext): void {
  const W = doc.page.width;
  const H = doc.page.height;
  const b = t.brand;
  const logoBuf = b.logo ? dataUrlToBuffer(b.logo) : null;
  if (b.cover.style === "gradient") {
    const grad = doc.linearGradient(0, 0, W, H);
    const stops = b.cover.colors;
    stops.forEach((c, i) => grad.stop(i / Math.max(1, stops.length - 1), c));
    doc.rect(0, 0, W, H).fill(grad);
    if (logoBuf) {
      try { doc.image(logoBuf, PAGE_MARGIN, 120, { fit: [260, 96] }); } catch { /* fall back to text */ }
    } else {
      doc.fillColor("#ffffff").font("bold").fontSize(46).text(b.cover.wordmark ?? interp(b.firmName, ctx), PAGE_MARGIN, 150, { width: W - PAGE_MARGIN * 2 });
    }
    if (b.cover.tagline) doc.font("body").fontSize(15).fillColor("#eef6ff").text(b.cover.tagline, PAGE_MARGIN, 224);
  } else if (b.cover.style === "image") {
    const coverBuf = dataUrlToBuffer(b.cover.image);
    if (coverBuf) {
      try { doc.image(coverBuf, 0, 0, { width: W, height: H }); } catch { doc.rect(0, 0, W, H).fill(b.palette.primary); }
    } else {
      doc.rect(0, 0, W, H).fill(b.palette.primary);
    }
    if (logoBuf) {
      try { doc.image(logoBuf, PAGE_MARGIN, 120, { fit: [260, 96] }); } catch { /* image-only cover */ }
    }
    if (b.cover.tagline) doc.font("body").fontSize(15).fillColor("#ffffff").text(b.cover.tagline, PAGE_MARGIN, 224);
  } else {
    doc.rect(0, 0, W, 200).fill(b.palette.primary);
    if (logoBuf) {
      try { doc.image(logoBuf, PAGE_MARGIN, 64, { fit: [240, 84] }); } catch { /* fall back to text */ }
    } else {
      doc.fillColor(b.palette.onPrimary).font("bold").fontSize(30).text(interp(b.firmName, ctx), PAGE_MARGIN, 90, { width: W - PAGE_MARGIN * 2 });
    }
    if (b.cover.tagline) doc.font("body").fontSize(12).fillColor(b.palette.onPrimary).text(b.cover.tagline, PAGE_MARGIN, 156);
  }

  // Title block.
  const onArt = b.cover.style === "gradient" || b.cover.style === "image";
  const ty = onArt ? 360 : 300;
  doc.fillColor(onArt ? "#ffffff" : b.palette.text);
  doc.font("bold").fontSize(30).text(t.documentType.toUpperCase(), PAGE_MARGIN, ty, { width: W - PAGE_MARGIN * 2 });
  doc.font("body").fontSize(16).text(interp("{{project.projectName}}", ctx), PAGE_MARGIN, ty + 44, { width: W - PAGE_MARGIN * 2 });
  doc.font("body").fontSize(11).text(interp("{{project.address}}", ctx), PAGE_MARGIN, ty + 74, { width: W - PAGE_MARGIN * 2 });

  // Doc-control mini block.
  const dy = ty + 130;
  const fields: Array<[string, string]> = [
    ["DATE", interp("{{project.dateLabel}}", ctx)],
    ["CLIENT", interp("{{firm.name}}", ctx)],
    ["PREPARED BY", interp(t.brand.firmName, ctx)],
  ];
  doc.fontSize(9);
  fields.forEach(([k, v], i) => {
    const yy = dy + i * 18;
    doc.font("bold").text(k, PAGE_MARGIN, yy, { width: 110, continued: false });
    doc.font("body").text(v && v !== "—" ? v : "—", PAGE_MARGIN + 120, yy, { width: W - PAGE_MARGIN * 2 - 120 });
  });
  if (t.brand.url) doc.font("body").fontSize(10).fillColor(onArt ? "#ffffff" : b.palette.muted).text(t.brand.url, PAGE_MARGIN, H - 90);
  doc.addPage();
}

function drawDocControl(doc: PDFKit.PDFDocument, t: ReportTemplate, ctx: RenderContext): void {
  const b = t.brand;
  doc.fillColor(b.palette.primary).font("bold").fontSize(18).text("Document Control Sheet", PAGE_MARGIN, doc.y);
  doc.moveDown(0.6);
  const rows: Array<[string, string]> = [
    ["Document Title", t.documentType],
    ["Project", interp("{{project.projectName}}", ctx)],
    ["Site", interp("{{project.address}}", ctx)],
    ["Date", interp("{{project.dateLabel}}", ctx)],
    ["Prepared By", interp(b.firmName, ctx)],
    ["Client", interp("{{firm.name}}", ctx)],
  ];
  drawKeyValues(doc, rows, b);
  doc.moveDown(0.9);

  // Issue / revision record — fills the control sheet the way a filed TA does,
  // rather than leaving most of the page blank under six key-value rows.
  doc.fillColor(b.palette.primary).font("bold").fontSize(12).text("Issue Record", PAGE_MARGIN, doc.y);
  doc.moveDown(0.35);
  const today = interp("{{project.dateLabel}}", ctx);
  drawTable(
    doc,
    {
      headers: ["Rev", "Date", "Description", "Prepared", "Checked", "Approved"],
      widths: [38, 92, 150, 78, 78, 76],
      align: ["left", "left", "left", "left", "left", "left"],
      rows: [
        ["P01", today, "Draft screening assessment for comment", interp(b.firmName, ctx).split(" ")[0] || "VTP", "—", "—"],
        ["—", "—", "Issued for planning", "—", "—", "—"],
        ["—", "—", "—", "—", "—", "—"],
      ],
    },
    b,
  );
  doc.moveDown(0.7);
  doc.font("body").fontSize(8).fillColor(b.palette.muted).text(`© ${interp(b.firmName, ctx)} — extracts may be reproduced provided the source is acknowledged. This document is issued in draft for review and seal by a chartered engineer (CEng MCIHT).`, PAGE_MARGIN, doc.y, { width: doc.page.width - PAGE_MARGIN * 2 });
  doc.fillColor(b.palette.text);
  doc.addPage();
}

function drawChapterHeading(doc: PDFKit.PDFDocument, c: Chapter, b: Brand): void {
  // Reserve enough for the heading, its rule and the first line of intro/section
  // so a chapter title is never stranded alone at the foot of a page.
  ensureSpace(doc, 104);
  doc.x = PAGE_MARGIN;
  const label = [c.number, c.title.toUpperCase()].filter(Boolean).join("  ");
  doc.font("bold").fontSize(17).fillColor(b.palette.primary).text(label, { characterSpacing: 0.3 });
  doc.moveDown(0.25);
  doc.strokeColor(b.palette.primary).lineWidth(1.5).moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y).stroke();
  doc.moveDown(0.4);
  doc.x = PAGE_MARGIN;
}

function drawSectionHeading(doc: PDFKit.PDFDocument, s: Section, b: Brand): void {
  // Keep a section heading with at least its first line of content.
  ensureSpace(doc, 56);
  doc.x = PAGE_MARGIN;
  const label = [s.number, s.title].filter(Boolean).join("  ");
  doc.font("bold").fontSize(11.5).fillColor(b.palette.text).text(label);
  doc.moveDown(0.2);
  doc.x = PAGE_MARGIN;
}

function drawProse(doc: PDFKit.PDFDocument, text: string, b: Brand): void {
  doc.x = PAGE_MARGIN;
  doc.font("body").fontSize(10).fillColor(b.palette.text).text(text, { paragraphGap: 6, align: "left" });
  doc.x = PAGE_MARGIN;
}

function drawNote(doc: PDFKit.PDFDocument, text: string, b: Brand): void {
  doc.x = PAGE_MARGIN;
  doc.font("body").fontSize(9.5).fillColor(b.palette.muted).text(text, { paragraphGap: 6 });
  doc.fillColor(b.palette.text);
  doc.x = PAGE_MARGIN;
}

function drawBullets(doc: PDFKit.PDFDocument, items: string[], b: Brand): void {
  doc.x = PAGE_MARGIN;
  doc.font("body").fontSize(10).fillColor(b.palette.text);
  for (const it of items) doc.text(`•  ${it}`, { paragraphGap: 3, indent: 6 });
  doc.moveDown(0.2);
  doc.x = PAGE_MARGIN;
}

function drawKeyValues(doc: PDFKit.PDFDocument, pairs: KeyValueData, b: Brand): void {
  const labelW = 200;
  const startX = PAGE_MARGIN;
  const valueW = doc.page.width - startX - labelW - PAGE_MARGIN - 10;
  // Keep a small block together so a single row doesn't widow onto the next page.
  const blockH = pairs.length * 16;
  const pageBottom = doc.page.height - PAGE_MARGIN - 30;
  if (pairs.length <= 8 && doc.y + blockH > pageBottom && blockH < doc.page.height - PAGE_MARGIN * 2) doc.addPage();
  for (const [label, value] of pairs) {
    ensureSpace(doc, 16);
    const y = doc.y;
    const v = value == null || value === "" ? "—" : String(value);
    doc.font("body").fontSize(10);
    const lh = doc.heightOfString(label, { width: labelW });
    const vh = doc.heightOfString(v, { width: valueW });
    doc.fillColor(b.palette.muted).text(label, startX, y, { width: labelW });
    doc.fillColor(b.palette.text).text(v, startX + labelW + 10, y, { width: valueW });
    // Advance by the taller column (min one line) so an empty/short value can't
    // leave doc.y un-advanced and collide the next row's label.
    doc.y = y + Math.max(lh, vh, 13) + 1;
  }
  doc.x = PAGE_MARGIN;
}

function drawTable(doc: PDFKit.PDFDocument, spec: TableData, b: Brand): void {
  const headers = spec.headers;
  const widths = spec.widths ?? headers.map(() => (doc.page.width - PAGE_MARGIN * 2) / headers.length);
  const align = spec.align ?? headers.map(() => "left" as const);
  const startX = PAGE_MARGIN;
  const totalW = widths.reduce((s, w) => s + w, 0);
  const PADX = 4;
  const PADY = 4;
  const measure = (cells: string[], header: boolean) => {
    doc.font(header ? "bold" : "body").fontSize(9);
    let h = 0;
    cells.forEach((c, i) => {
      const hh = doc.heightOfString(c ?? "", { width: (widths[i] ?? 60) - PADX * 2, align: align[i] ?? "left" });
      if (hh > h) h = hh;
    });
    return Math.max(13, h) + PADY * 2;
  };
  const drawRow = (cells: string[], y: number, header: boolean, h: number) => {
    if (header) doc.rect(startX, y, totalW, h).fill(b.palette.tableHeader);
    let x = startX;
    doc.font(header ? "bold" : "body").fontSize(9).fillColor(b.palette.text);
    cells.forEach((c, i) => {
      doc.text(c ?? "", x + PADX, y + PADY, { width: (widths[i] ?? 60) - PADX * 2, align: align[i] ?? "left" });
      x += widths[i] ?? 60;
    });
  };
  let y = doc.y;
  const hh = measure(headers, true);
  ensureSpace(doc, hh + 20);
  y = doc.y;
  drawRow(headers, y, true, hh);
  y += hh;
  for (const r of spec.rows) {
    const rh = measure(r, false);
    if (y + rh > doc.page.height - PAGE_MARGIN - 40) {
      doc.addPage();
      y = doc.y;
      const h2 = measure(headers, true);
      drawRow(headers, y, true, h2);
      y += h2;
    }
    drawRow(r, y, false, rh);
    doc.strokeColor(b.palette.rule).lineWidth(0.5).moveTo(startX, y + rh).lineTo(startX + totalW, y + rh).stroke();
    y += rh;
  }
  doc.y = y + 6;
  doc.x = PAGE_MARGIN;
}

function drawMetrics(doc: PDFKit.PDFDocument, metrics: MetricData, b: Brand): void {
  ensureSpace(doc, 60);
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const cellW = usableW / Math.max(1, metrics.length);
  const startX = PAGE_MARGIN;
  const y = doc.y;
  const h = 50;
  metrics.forEach((m, i) => {
    const x = startX + i * cellW;
    doc.rect(x, y, cellW, h).fillAndStroke("#f9fafb", b.palette.rule);
    // Shrink the value to fit one line in the card (long text like "September
    // 2021" otherwise wraps and overlaps the caption beneath).
    doc.font("bold");
    let fs = 19;
    while (fs > 9 && doc.fontSize(fs).widthOfString(m.value) > cellW - 14) fs -= 1;
    doc.fontSize(fs).fillColor(b.palette.primary).text(m.value, x, y + 8 + (19 - fs) / 2, { width: cellW, align: "center", lineBreak: false, ellipsis: true });
    doc.font("body").fontSize(8).fillColor(b.palette.muted).text(m.label.toUpperCase(), x, y + 32, { width: cellW, align: "center", characterSpacing: 1, lineBreak: false });
  });
  doc.fillColor(b.palette.text);
  doc.x = startX;
  doc.y = y + h + 8;
}

// ───────────────────────────── Block dispatch ─────────────────────────────

function renderBlocks(
  doc: PDFKit.PDFDocument,
  blocks: Block[],
  t: ReportTemplate,
  ctx: RenderContext,
  providers: ProviderRegistry,
): void {
  const b = t.brand;
  for (const block of blocks) {
    switch (block.kind) {
      case "prose":
        drawProse(doc, interp(block.text, ctx), b);
        break;
      case "note":
        drawNote(doc, interp(block.text, ctx), b);
        break;
      case "bullets":
        drawBullets(doc, block.items.map((i) => interp(i, ctx)), b);
        break;
      case "table": {
        const data = providers.tables?.[block.provider]?.(ctx);
        if (data) drawTable(doc, data, b);
        break;
      }
      case "metrics": {
        const data = providers.metrics?.[block.provider]?.(ctx);
        if (data && data.length) drawMetrics(doc, data, b);
        break;
      }
      case "keyvalue": {
        const data = providers.keyvalues?.[block.provider]?.(ctx);
        if (data && data.length) drawKeyValues(doc, data, b);
        break;
      }
      case "chart": {
        const data = providers.charts?.[block.provider]?.(ctx);
        if (data) {
          ensureSpace(doc, 240);
          if (data.type === "column") drawColumnChart(doc, data.spec);
          else drawLineChart(doc, data.spec);
        }
        break;
      }
      case "if": {
        const on = providers.flags?.[block.flag]?.(ctx) ?? false;
        renderBlocks(doc, on ? block.then : block.else ?? [], t, ctx, providers);
        break;
      }
    }
  }
}

function stampFooters(doc: PDFKit.PDFDocument, t: ReportTemplate, ctx: RenderContext): void {
  const b = t.brand;
  const range = doc.bufferedPageRange();
  // Front matter (cover + optional Document Control Sheet) is unnumbered.
  const frontMatter = b.docControl ? 2 : 1;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pageIdx = i - range.start;
    if (pageIdx < frontMatter) continue; // no footer on cover / control sheet
    const logicalPage = pageIdx - frontMatter + 1;
    const y = doc.page.height - PAGE_MARGIN + 8;
    // Draw into the bottom margin WITHOUT triggering PDFKit auto-pagination: a
    // text position past the bottom margin otherwise spawns a blank page per
    // stamp (which the pre-captured page range can't number → "Page 1" blanks).
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("body").fontSize(7.5).fillColor(b.palette.muted);
    doc.text(interp(b.footer, ctx, logicalPage), PAGE_MARGIN, y, { width: doc.page.width - PAGE_MARGIN * 2, align: "center", lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
}

/** Draw an entire template into an existing doc (cover → chapters → footers). */
export function renderTemplate(
  doc: PDFKit.PDFDocument,
  t: ReportTemplate,
  ctx: RenderContext,
  providers: ProviderRegistry,
): void {
  drawCover(doc, t, ctx);
  if (t.brand.docControl) drawDocControl(doc, t, ctx);
  for (const ch of t.chapters) {
    drawChapterHeading(doc, ch, t.brand);
    if (ch.intro) drawNote(doc, interp(ch.intro, ctx), t.brand);
    for (const s of ch.sections) {
      drawSectionHeading(doc, s, t.brand);
      renderBlocks(doc, s.blocks, t, ctx, providers);
      doc.moveDown(0.3);
    }
    doc.moveDown(0.4);
  }
  stampFooters(doc, t, ctx);
}

/** Build a complete PDF buffer for a template + study data. Self-contained. */
export function renderTemplatePdf(
  t: ReportTemplate,
  ctx: RenderContext,
  providers: ProviderRegistry,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: { Title: `${t.documentType} — ${ctx.project?.projectName ?? ""}`, Author: interp(t.brand.firmName, ctx) },
  });
  doc.registerFont("body", path.join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont("bold", path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));
  doc.font("body");
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      renderTemplate(doc, t, ctx, providers);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
