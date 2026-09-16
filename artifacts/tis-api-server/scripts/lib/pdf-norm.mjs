import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/**
 * Normalise a PDFKit render so its hash is stable across runs AND machines.
 *
 * Two sources of byte churn are removed:
 *
 * 1. The wall clock. PDFKit stamps CreationDate and derives /ID from it. With
 *    this renderer's PDFKit config /CreationDate is an indirect reference, so
 *    the `(D:YYYYMMDDHHMMSSZ)` literal lives in its own object — the
 *    date-literal regex is what masks it; the inline form is kept for
 *    forward-compat.
 *
 * 2. Deflate. Every content stream and embedded font is FlateDecode'd, and
 *    Node's bundled zlib (the Chromium fork) takes different SIMD paths on
 *    arm64 and x86_64, so the SAME input compresses to DIFFERENT bytes on a
 *    Mac and on the Linux CI runner (the identity baseline pinned on one
 *    failed on the other, every family, while both were internally
 *    deterministic). Each stream is inflated before hashing, its /Length and
 *    the xref offsets that move with it masked, so the hash covers what the
 *    renderer drew rather than how zlib packed it.
 */
export function normalizePdf(buf) {
  // "\nstream\n" — the bare word would also match "endstream\n".
  const needle = Buffer.from("\nstream\n", "latin1");
  const objMark = Buffer.from(" obj", "latin1");
  const parts = [];
  let pos = 0;
  for (;;) {
    const s = buf.indexOf(needle, pos);
    if (s < 0) break;
    const objStart = buf.lastIndexOf(objMark, s);
    const dict = objStart >= 0 && objStart >= pos ? buf.subarray(objStart, s).toString("latin1") : "";
    const m = /\/Length (\d+)/.exec(dict);
    if (!m) { parts.push(buf.subarray(pos, s + needle.length)); pos = s + needle.length; continue; }
    const len = Number(m[1]);
    const dataStart = s + needle.length;
    const data = buf.subarray(dataStart, dataStart + len);
    let payload = data;
    if (/\/FlateDecode/.test(dict)) { try { payload = inflateSync(data); } catch { /* keep the raw bytes */ } }
    const head = buf.subarray(pos, s + needle.length).toString("latin1").replace(/\/Length \d+/, "/Length X");
    parts.push(Buffer.from(head, "latin1"), payload);
    pos = dataStart + len;
  }
  parts.push(buf.subarray(pos));
  return Buffer.concat(parts).toString("latin1")
    .replace(/\/CreationDate \([^)]*\)/g, "/CreationDate (XXXXXXXXXXXXXXXXXX)")
    .replace(/\(D:\d{14}Z\)/g, "(D:XXXXXXXXXXXXXXZ)")
    .replace(/\/ID \[<[0-9a-fA-F]+> <[0-9a-fA-F]+>\]/g, "/ID [<X> <X>]")
    .replace(/^\d{10} \d{5} [nf]\s*$/gm, "XXXXXXXXXX XXXXX X")
    .replace(/startxref\s+\d+/g, "startxref X");
}
export function pdfHash(buf) { return createHash("sha256").update(normalizePdf(buf)).digest("hex"); }
export function pdfPageCount(buf) {
  const counts = [...buf.toString("latin1").matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}
