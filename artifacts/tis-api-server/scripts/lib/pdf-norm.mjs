import { createHash } from "node:crypto";
/**
 * PDFKit stamps the wall clock into CreationDate and derives /ID from it — mask
 * both (same length, so xref offsets are unchanged).
 *
 * With this renderer's PDFKit config, /CreationDate in the Info dict is an
 * indirect reference (`/CreationDate 46 0 R`) rather than an inline literal,
 * so the actual `(D:YYYYMMDDHHMMSSZ)` value lives in its own `46 0 obj (...)
 * endobj` block elsewhere in the file. The inline-form regex below is kept for
 * forward-compat but never matches this renderer's output; the dedicated
 * date-literal regex is what actually masks the clock value (confirmed via
 * byte-diff of two cross-process renders: this was the only source of
 * non-determinism found).
 */
export function normalizePdf(buf) {
  return buf.toString("latin1")
    .replace(/\/CreationDate \([^)]*\)/g, "/CreationDate (XXXXXXXXXXXXXXXXXX)")
    .replace(/\(D:\d{14}Z\)/g, "(D:XXXXXXXXXXXXXXZ)")
    .replace(/\/ID \[<[0-9a-fA-F]+> <[0-9a-fA-F]+>\]/g, "/ID [<X> <X>]");
}
export function pdfHash(buf) { return createHash("sha256").update(normalizePdf(buf)).digest("hex"); }
export function pdfPageCount(buf) {
  const counts = [...buf.toString("latin1").matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}
