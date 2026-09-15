/**
 * Minimal PNG encoder (RGBA), a box-filter downsampler, and the pdfjs
 * decoded-image → PNG data URL helper used by the report-theme extractor.
 * Pure Node (`node:zlib`) — no native image dependency.
 */
import { deflateSync } from "node:zlib";

// --- Minimal PNG encoder (RGBA) so a logo + its soft mask can be re-emitted. ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
export function encodePngRGBA(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x];
  }
  const idat = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([SIG, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

export type ImagePixels = { width: number; height: number; kind: 1 | 2 | 3; data: Uint8ClampedArray };
export type RgbaImage = { width: number; height: number; rgba: Uint8Array };

/** pdfjs decoded image (ImageKind GRAYSCALE_1BPP / RGB_24BPP / RGBA_32BPP) → straight RGBA. */
export function toRgba(px: ImagePixels): RgbaImage {
  const n = px.width * px.height;
  const rgba = new Uint8Array(n * 4);
  if (px.kind === 3) {
    rgba.set(px.data.subarray(0, n * 4));
  } else if (px.kind === 2) {
    for (let i = 0; i < n; i++) { rgba[i * 4] = px.data[i * 3]; rgba[i * 4 + 1] = px.data[i * 3 + 1]; rgba[i * 4 + 2] = px.data[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  } else {
    // 1 bit per pixel, rows padded to a byte boundary, 1 = white.
    const stride = Math.ceil(px.width / 8);
    for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) {
      const bit = (px.data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = bit ? 255 : 0; const o = (y * px.width + x) * 4;
      rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
    }
  }
  return { width: px.width, height: px.height, rgba };
}

/**
 * Box-filter downsample so the image fits `maxW × maxH` (aspect kept). A
 * sample's logo arrives at print resolution (a 329 × 133 pt box holding
 * 685 × 277 px); stored at 2× its placement it is indistinguishable in the
 * rendered PDF and a fraction of the row size. Returns the input untouched
 * when it already fits.
 */
export function downsampleRgba(img: RgbaImage, maxW: number, maxH: number): RgbaImage {
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8Array(w * h * 4);
  for (let oy = 0; oy < h; oy++) {
    const y0 = Math.floor((oy * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * img.height) / h));
    for (let ox = 0; ox < w; ox++) {
      const x0 = Math.floor((ox * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * 4;
        r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; a += img.rgba[i + 3]; n++;
      }
      const o = (oy * w + ox) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * pdfjs decoded image → PNG data URL, downsampled to at most `maxDims`
 * (pixels) when given — callers pass 2× the placement size in points.
 */
export function imagePixelsToPngDataUrl(px: ImagePixels, maxDims?: { w: number; h: number }): string | null {
  const n = px.width * px.height;
  if (n === 0 || n > 4_000_000) return null;
  let img = toRgba(px);
  if (maxDims) img = downsampleRgba(img, Math.max(1, Math.ceil(maxDims.w)), Math.max(1, Math.ceil(maxDims.h)));
  return `data:image/png;base64,${encodePngRGBA(img.width, img.height, img.rgba).toString("base64")}`;
}
