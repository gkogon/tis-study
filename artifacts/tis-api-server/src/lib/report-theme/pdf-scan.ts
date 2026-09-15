/**
 * Operator-list scanner: walks each page's pdfjs operator list with a small
 * graphics-state interpreter and emits positioned text runs (with real font
 * name, size and fill colour), filled rectangles, axis-aligned stroked lines
 * and image placements — everything the derive/* modules need.
 *
 * Why not getTextContent()? It has no colours, and a firm's heading/table
 * colours are the point. Facts about pdfjs-dist@5.7 this relies on (verified
 * against the bundled build):
 *  - every colour operator arrives normalised as setFillRGBColor /
 *    setStrokeRGBColor with ONE "#rrggbb" arg; patterns arrive as
 *    setFillColorN / setFillTransparent (→ we record null);
 *  - paths arrive as constructPath [paintOp, [Float32Array buffer], minMax]
 *    where the buffer is DrawOPS codes (0 moveTo x y, 1 lineTo x y,
 *    2 curveTo ×6, 3 quadraticCurveTo ×4, 4 closePath) in CURRENT user space;
 *  - setTextMatrix's arg is a Float32Array(6); showText's arg is an array of
 *    glyph objects { unicode, width, isSpace } and numbers (TJ adjustments);
 *  - setFont's args are [loadedName, size]; page.commonObjs.get(loadedName)
 *    yields { name, bold, italic, isSerifFont, isMonospace, isType3Font,
 *    fontMatrix } (isSerifFont needs fontExtraProperties: true);
 *  - paintImageXObject's first arg is the objId; the image fills the unit
 *    square under the CTM; page.objs.get(objId, cb) → { width, height, kind,
 *    data } (the callback form — decoded pixels arrive asynchronously and
 *    may not be resolved when getOperatorList() settles).
 */
import type { ImagePixels } from "./png";

export type Matrix = [number, number, number, number, number, number];
export type TextRun = { page: number; str: string; font: string; size: number; bold: boolean; italic: boolean; serif: boolean; mono: boolean; color: string | null; x: number; y: number; w: number; h: number };
export type FillRect = { page: number; x: number; y: number; w: number; h: number; color: string };
export type StrokeLine = { page: number; x1: number; y1: number; x2: number; y2: number; color: string; width: number };
export type ImagePlacement = { page: number; x: number; y: number; w: number; h: number; objId: string; pixels: ImagePixels | null };
export type ScannedPage = { page: number; width: number; height: number; runs: TextRun[]; rects: FillRect[]; lines: StrokeLine[]; images: ImagePlacement[] };
export type ScanResult = { numPages: number; pages: ScannedPage[]; fontsSeen: string[]; warnings: string[] };
export type ScanOptions = { maxPages?: number; imagePixelsOnPage?: number; maxImagePixels?: number };
export type { ImagePixels };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const toM = (a: ArrayLike<number>): Matrix => [a[0], a[1], a[2], a[3], a[4], a[5]];
const r2 = (v: number) => Math.round(v * 100) / 100;

type FontInfo = { name: string; bold: boolean; italic: boolean; serif: boolean; mono: boolean; type3: boolean; fontMatrix: number[] };
type GState = { ctm: Matrix; fill: string | null; stroke: string | null; lineWidth: number; font: FontInfo | null; fontSize: number; charSpacing: number; wordSpacing: number; hScale: number; leading: number; rise: number; renderMode: number };

// pdfjs-dist@5 constructs a DOMMatrix at module load; Node has none. Inert shim (same as synchro-pdf-import.ts).
function shimDomGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrixShim {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[]) { if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init as Matrix; }
      scale(): DOMMatrixShim { return this; }
      translate(): DOMMatrixShim { return this; }
      multiply(): DOMMatrixShim { return this; }
      inverse(): DOMMatrixShim { return this; }
    };
  }
}

type PdfjsPage = {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  commonObjs: { get(id: string, callback?: (obj: unknown) => void): unknown };
  objs: { get(id: string, callback?: (obj: unknown) => void): unknown };
  cleanup(): void;
};
type PdfjsModule = {
  OPS: Record<string, number>;
  getDocument(p: Record<string, unknown>): { promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfjsPage>; destroy(): Promise<void> }> };
};

export async function scanPdf(pdf: Buffer, opts: ScanOptions = {}): Promise<ScanResult> {
  shimDomGlobals();
  const { getDocument, OPS } = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  const doc = await getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0, fontExtraProperties: true }).promise;
  const warnings: string[] = [];
  const fontsSeen = new Set<string>();
  const pages: ScannedPage[] = [];
  const maxPages = Math.min(doc.numPages, opts.maxPages ?? 31);
  try {
    for (let p = 1; p <= maxPages; p++) {
      let page: PdfjsPage | null = null;
      try { page = await doc.getPage(p); } catch { warnings.push(`Page ${p} could not be opened.`); continue; }
      try { pages.push(await scanPage(page, p, OPS, opts, fontsSeen, warnings)); }
      catch (e) { warnings.push(`Page ${p} skipped: ${(e as Error).message}`); }
      finally { try { page.cleanup(); } catch { /* ignore */ } }
    }
  } finally {
    await doc.destroy();
  }
  return { numPages: doc.numPages, pages, fontsSeen: [...fontsSeen], warnings };
}

async function scanPage(page: PdfjsPage, pageNo: number, OPS: Record<string, number>, opts: ScanOptions, fontsSeen: Set<string>, warnings: string[]): Promise<ScannedPage> {
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const out: ScannedPage = { page: pageNo, width: vp.width, height: vp.height, runs: [], rects: [], lines: [], images: [] };
  const fontCache = new Map<string, FontInfo | null>();
  const fontInfo = (id: string): FontInfo | null => {
    if (fontCache.has(id)) return fontCache.get(id)!;
    let f: Record<string, unknown> | null = null;
    try { f = page.commonObjs.get(id) as Record<string, unknown>; } catch { f = null; }
    // The cache makes this one warning per unresolved font id per page.
    if (!f) warnings.push(`Page ${pageNo}: font ${id} could not be resolved; its text was skipped.`);
    const name = f ? String(f.name ?? id) : id;
    const info: FontInfo | null = f ? {
      name,
      bold: !!f.bold || /bold|black|heavy|semibold|demibold/i.test(name),
      italic: !!f.italic || /italic|oblique/i.test(name),
      serif: !!f.isSerifFont,
      mono: !!f.isMonospace,
      type3: !!f.isType3Font,
      fontMatrix: Array.isArray(f.fontMatrix) ? (f.fontMatrix as number[]) : [0.001, 0, 0, 0.001, 0, 0],
    } : null;
    if (info) fontsSeen.add(info.name);
    fontCache.set(id, info);
    return info;
  };

  let gs: GState = { ctm: toM(vp.transform), fill: "#000000", stroke: "#000000", lineWidth: 1, font: null, fontSize: 0, charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0, renderMode: 0 };
  const stack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let imagesDecoded = 0;

  const showText = (glyphs: unknown[]): Matrix => {
    const f = gs.font;
    const fs = gs.fontSize;
    if (!f || f.type3 || !Array.isArray(glyphs) || fs <= 0) return tm;
    const m = mul(gs.ctm, tm);
    const [x0, y0] = apply(m, 0, gs.rise);
    const sizeDev = fs * Math.hypot(m[2], m[3]);
    const xScale = Math.hypot(m[0], m[1]);
    let tx = 0;
    let str = "";
    for (const g of glyphs) {
      if (typeof g === "number") { tx += (-g / 1000) * fs * gs.hScale; continue; }
      const gl = g as { unicode?: string; width?: number; isSpace?: boolean };
      const w0 = Number(gl.width ?? 0) * (f.fontMatrix[0] ?? 0.001);
      tx += (w0 * fs + gs.charSpacing + (gl.isSpace ? gs.wordSpacing : 0)) * gs.hScale;
      str += gl.unicode ?? "";
    }
    const rotated = Math.abs(m[1]) > 0.02 || Math.abs(m[2]) > 0.02;
    // Text render mode 3 is invisible (OCR layers on scanned samples) and 7 is
    // clip-only; neither paints, so neither is a real text layer. Modes 4-6
    // paint (fill/stroke plus clip) and are kept. The matrix still advances.
    const unpainted = gs.renderMode === 3 || gs.renderMode === 7;
    if (str.trim() && !rotated && !unpainted && sizeDev > 0) {
      out.runs.push({ page: pageNo, str, font: f.name, size: r2(sizeDev), bold: f.bold, italic: f.italic, serif: f.serif, mono: f.mono, color: gs.fill, x: r2(x0), y: r2(y0), w: r2(tx * xScale), h: r2(sizeDev) });
    }
    return mul(tm, [1, 0, 0, 1, tx, 0]);
  };

  const asRect = (pts: Array<[number, number]>): { x: number; y: number; w: number; h: number } | null => {
    const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
    const p = pts.length === 5 && near(pts[0], pts[4]) ? pts.slice(0, 4) : pts;
    if (p.length !== 4) return null;
    const uniq = (vals: number[]) => vals.reduce<number[]>((acc, v) => (acc.some((u) => Math.abs(u - v) < 0.5) ? acc : [...acc, v]), []);
    const ux = uniq(p.map((q) => q[0]));
    const uy = uniq(p.map((q) => q[1]));
    if (ux.length !== 2 || uy.length !== 2) return null;
    const x = Math.min(...ux), y = Math.min(...uy);
    return { x: r2(x), y: r2(y), w: r2(Math.max(...ux) - x), h: r2(Math.max(...uy) - y) };
  };

  const handlePath = (paintOp: number, buf: Float32Array | null | undefined) => {
    if (!buf) return;
    const fillOps = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];
    const strokeOps = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];
    const fills = fillOps.includes(paintOp);
    const strokes = strokeOps.includes(paintOp);
    if (!fills && !strokes) return;
    const subpaths: Array<{ pts: Array<[number, number]>; curved: boolean }> = [];
    let cur: { pts: Array<[number, number]>; curved: boolean } | null = null;
    for (let k = 0; k < buf.length;) {
      const code = buf[k++];
      if (code === 0) { cur = { pts: [apply(gs.ctm, buf[k], buf[k + 1])], curved: false }; subpaths.push(cur); k += 2; }
      else if (code === 1) { cur?.pts.push(apply(gs.ctm, buf[k], buf[k + 1])); k += 2; }
      else if (code === 2) { if (cur) { cur.curved = true; cur.pts.push(apply(gs.ctm, buf[k + 4], buf[k + 5])); } k += 6; }
      else if (code === 3) { if (cur) { cur.curved = true; cur.pts.push(apply(gs.ctm, buf[k + 2], buf[k + 3])); } k += 4; }
      else if (code === 4) { /* closePath */ }
      else break;
    }
    const lw = r2(gs.lineWidth * Math.hypot(gs.ctm[0], gs.ctm[1]));
    const pushLine = (a: [number, number], b: [number, number], color: string, width: number) => {
      if (Math.abs(a[1] - b[1]) > 0.5 && Math.abs(a[0] - b[0]) > 0.5) return; // not axis-aligned
      out.lines.push({ page: pageNo, x1: r2(Math.min(a[0], b[0])), y1: r2(Math.min(a[1], b[1])), x2: r2(Math.max(a[0], b[0])), y2: r2(Math.max(a[1], b[1])), color, width });
    };
    for (const sp of subpaths) {
      if (sp.curved) continue;
      const rect = asRect(sp.pts);
      if (rect) {
        if (fills && gs.fill) {
          if (rect.w <= 1.5 || rect.h <= 1.5) {
            // Word/InDesign draw rules as hairline-thin filled rects.
            const thin = Math.min(rect.w, rect.h) || 0.5;
            if (rect.h <= 1.5) pushLine([rect.x, rect.y + rect.h / 2], [rect.x + rect.w, rect.y + rect.h / 2], gs.fill, r2(thin));
            else pushLine([rect.x + rect.w / 2, rect.y], [rect.x + rect.w / 2, rect.y + rect.h], gs.fill, r2(thin));
          } else {
            out.rects.push({ page: pageNo, ...rect, color: gs.fill });
          }
        }
        if (strokes && gs.stroke && rect.w > 1.5 && rect.h > 1.5) {
          const { x, y, w, h } = rect;
          pushLine([x, y], [x + w, y], gs.stroke, lw); pushLine([x, y + h], [x + w, y + h], gs.stroke, lw);
          pushLine([x, y], [x, y + h], gs.stroke, lw); pushLine([x + w, y], [x + w, y + h], gs.stroke, lw);
        }
        continue;
      }
      if (strokes && gs.stroke) for (let j = 1; j < sp.pts.length; j++) pushLine(sp.pts[j - 1], sp.pts[j], gs.stroke, lw);
    }
  };

  // Images are decoded asynchronously by pdfjs and delivered as a separate
  // "obj" message that can land AFTER getOperatorList() settles, so a
  // synchronous page.objs.get(objId) here throws "not resolved yet". The
  // placement is recorded now; the pixels are awaited after the op loop via
  // the callback form of objs.get, which waits for resolution.
  const pendingPixels: ImagePlacement[] = [];
  const handleImage = (objId: string) => {
    const m = gs.ctm;
    const corners = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 1, 1), apply(m, 0, 1)];
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const placement: ImagePlacement = { page: pageNo, x: r2(x), y: r2(y), w: r2(Math.max(...xs) - x), h: r2(Math.max(...ys) - y), objId, pixels: null };
    if (pageNo === (opts.imagePixelsOnPage ?? 1)) pendingPixels.push(placement);
    out.images.push(placement);
  };
  // pdfjs promotes an image seen on >= 2 pages to the document-wide store
  // under a "g_"-prefixed id, and routes those to commonObjs (pdf.mjs
  // getObject: data.startsWith("g_") ? commonObjs.get(data) : objs.get(data)).
  const getImageObj = (objId: string, timeoutMs = 5000): Promise<unknown> =>
    new Promise((res) => {
      const store = objId.startsWith("g_") ? page.commonObjs : page.objs;
      const t = setTimeout(() => res(null), timeoutMs);
      try { store.get(objId, (o: unknown) => { clearTimeout(t); res(o); }); }
      catch { clearTimeout(t); res(null); }
    });
  const resolvePendingPixels = async () => {
    for (const placement of pendingPixels) {
      if (imagesDecoded >= (opts.maxImagePixels ?? 8)) break;
      const o = (await getImageObj(placement.objId)) as { width?: number; height?: number; kind?: number; data?: Uint8ClampedArray } | null;
      if (o && o.data && o.width && o.height && (o.kind === 1 || o.kind === 2 || o.kind === 3) && o.width * o.height <= 4_000_000) {
        placement.pixels = { width: o.width, height: o.height, kind: o.kind, data: o.data };
        imagesDecoded++;
      }
    }
  };

  const fn = ol.fnArray;
  const args = ol.argsArray as unknown[][];
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    const a = args[i] ?? [];
    switch (op) {
      case OPS.save: stack.push({ ...gs }); break;
      case OPS.restore: gs = stack.pop() ?? gs; break;
      case OPS.transform: gs.ctm = mul(gs.ctm, toM(a as number[])); break;
      case OPS.paintFormXObjectBegin: stack.push({ ...gs }); if (a[0]) gs.ctm = mul(gs.ctm, toM(a[0] as number[])); break;
      case OPS.paintFormXObjectEnd: gs = stack.pop() ?? gs; break;
      case OPS.setFillRGBColor: gs.fill = typeof a[0] === "string" ? (a[0] as string).toLowerCase() : null; break;
      case OPS.setStrokeRGBColor: gs.stroke = typeof a[0] === "string" ? (a[0] as string).toLowerCase() : null; break;
      case OPS.setFillColorN: case OPS.setFillTransparent: gs.fill = null; break;
      case OPS.setStrokeColorN: case OPS.setStrokeTransparent: gs.stroke = null; break;
      case OPS.setLineWidth: gs.lineWidth = Number(a[0] ?? 1); break;
      case OPS.setGState:
        for (const [k, v] of (a[0] ?? []) as Array<[string, unknown]>) {
          if (k === "LW") gs.lineWidth = Number(v);
          if (k === "Font" && Array.isArray(v)) { gs.font = fontInfo(String(v[0])); gs.fontSize = Number(v[1]); }
        }
        break;
      case OPS.beginText: tm = IDENTITY; tlm = IDENTITY; break;
      case OPS.setTextMatrix: tm = toM(a[0] as ArrayLike<number>); tlm = tm; break; // single Float32Array(6) arg
      case OPS.moveText: tlm = mul(tlm, [1, 0, 0, 1, Number(a[0]), Number(a[1])]); tm = tlm; break;
      case OPS.setLeadingMoveText: gs.leading = -Number(a[1]); tlm = mul(tlm, [1, 0, 0, 1, Number(a[0]), Number(a[1])]); tm = tlm; break;
      case OPS.nextLine: tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.leading]); tm = tlm; break;
      case OPS.setLeading: gs.leading = Number(a[0]); break;
      case OPS.setCharSpacing: gs.charSpacing = Number(a[0]); break;
      case OPS.setWordSpacing: gs.wordSpacing = Number(a[0]); break;
      case OPS.setHScale: gs.hScale = Number(a[0]) / 100; break;
      case OPS.setTextRise: gs.rise = Number(a[0]); break;
      case OPS.setTextRenderingMode: gs.renderMode = Number(a[0] ?? 0); break;
      case OPS.setFont: gs.font = fontInfo(String(a[0])); gs.fontSize = Number(a[1]); break;
      case OPS.showText: tm = showText(a[0] as unknown[]); break;
      case OPS.showSpacedText: tm = showText(((a[0] ?? []) as unknown[]).flatMap((x) => (Array.isArray(x) ? x : [x]))); break;
      case OPS.nextLineShowText: tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.leading]); tm = tlm; tm = showText(a[0] as unknown[]); break;
      case OPS.nextLineSetSpacingShowText: gs.wordSpacing = Number(a[0]); gs.charSpacing = Number(a[1]); tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.leading]); tm = tlm; tm = showText(a[2] as unknown[]); break;
      case OPS.constructPath: handlePath(a[0] as number, (a[1] as Array<Float32Array | null>)?.[0]); break;
      case OPS.paintImageXObject: handleImage(String(a[0])); break;
      default: break;
    }
  }
  await resolvePendingPixels();
  return out;
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export type TextLine = { page: number; x: number; y: number; w: number; size: number; text: string; runs: TextRun[]; font: string; bold: boolean; italic: boolean; color: string | null; uniform: boolean };

/** Group a page's runs into baseline-aligned lines (top → bottom, left → right). */
export function linesOf(page: ScannedPage): TextLine[] {
  // 1. Group by baseline (tolerance against the group's first baseline and
  //    its largest size so far), in y order.
  const sorted = [...page.runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: Array<{ y: number; size: number; runs: TextRun[] }> = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.y - r.y) <= Math.max(1.5, 0.3 * Math.min(g.size, r.size))) { g.runs.push(r); g.size = Math.max(g.size, r.size); }
    else groups.push({ y: r.y, size: r.size, runs: [r] });
  }
  // 2. Order each line's runs by x before building text/w, so sub-point
  //    baseline differences cannot interleave words.
  const lines: TextLine[] = [];
  for (const g of groups) {
    const runs = [...g.runs].sort((a, b) => a.x - b.x);
    const first = runs[0];
    const ln: TextLine = { page: page.page, x: first.x, y: g.y, w: first.w, size: first.size, text: first.str, runs: [first], font: first.font, bold: first.bold, italic: first.italic, color: first.color, uniform: true };
    for (const r of runs.slice(1)) {
      const gap = r.x - (ln.x + ln.w);
      ln.text += (gap > 0.2 * r.size && !ln.text.endsWith(" ") && !r.str.startsWith(" ") ? " " : "") + r.str;
      ln.w = Math.max(ln.x + ln.w, r.x + r.w) - ln.x;
      ln.size = Math.max(ln.size, r.size);
      ln.runs.push(r);
    }
    lines.push(ln);
  }
  for (const ln of lines) {
    ln.text = ln.text.replace(/\s+/g, " ").trim();
    // Dominant run (most characters) sets the line's style.
    const dom = ln.runs.reduce((a, b) => (b.str.length > a.str.length ? b : a));
    ln.font = dom.font; ln.bold = dom.bold; ln.italic = dom.italic; ln.color = dom.color;
    ln.uniform = ln.runs.every((r) => r.font === dom.font && Math.abs(r.size - dom.size) <= 0.3 && r.bold === dom.bold && (r.color ?? "") === (dom.color ?? ""));
  }
  return lines;
}

export function interiorPages(pages: ScannedPage[]): ScannedPage[] {
  return pages.filter((p) => p.page > 1);
}
