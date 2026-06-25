/**
 * Brand-asset extraction from a firm's example PDF — "reads the logo and colours".
 *
 * Palette: rasterise the cover (poppler `pdftoppm`), decode the PNG in pure Node
 * (`node:zlib` — no native image dependency), and derive a brand palette from a
 * colour histogram. Logo: pull the cover's embedded images (`pdfimages`) and
 * pick the wordmark-shaped one as a data URL.
 *
 * The only external dependency is poppler (already needed for text ingestion);
 * PNG decoding is built-in. Best-effort by design: a vector-only cover yields no
 * raster logo, and the caller can always override the derived brand.
 */
import { execFileSync } from "node:child_process";
import { inflateSync, deflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Brand } from "./engine";

type Decoded = { width: number; height: number; rgb: Uint8Array };

/** Decode an 8-bit PNG (colour types 0/2/3/4/6, non-interlaced) to RGB. */
export function decodePng(buf: Buffer): Decoded {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error("not a PNG");
  let pos = 8;
  let width = 0,
    height = 0,
    bitDepth = 8,
    colorType = 6;
  const idat: Buffer[] = [];
  let plte: Buffer | null = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "PLTE") plte = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const recon = Buffer.alloc(height * stride);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let ri = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[ri++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[ri++];
      const a = x >= channels ? recon[y * stride + x - channels] : 0;
      const b = y > 0 ? recon[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= channels ? recon[(y - 1) * stride + x - channels] : 0;
      let val = rawByte;
      if (ft === 1) val = rawByte + a;
      else if (ft === 2) val = rawByte + b;
      else if (ft === 3) val = rawByte + ((a + b) >> 1);
      else if (ft === 4) val = rawByte + paeth(a, b, c);
      recon[y * stride + x] = val & 0xff;
    }
  }
  // Normalise to RGB.
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, p = 0; i < width * height; i++) {
    let r: number, g: number, bl: number;
    if (colorType === 2 || colorType === 6) {
      r = recon[i * channels];
      g = recon[i * channels + 1];
      bl = recon[i * channels + 2];
    } else if (colorType === 0 || colorType === 4) {
      r = g = bl = recon[i * channels];
    } else {
      const idx = recon[i] * 3;
      r = plte ? plte[idx] : 0;
      g = plte ? plte[idx + 1] : 0;
      bl = plte ? plte[idx + 2] : 0;
    }
    rgb[p++] = r;
    rgb[p++] = g;
    rgb[p++] = bl;
  }
  return { width, height, rgb };
}

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const sat = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const mix = (c: [number, number, number], w: [number, number, number], t: number): [number, number, number] => [c[0] + (w[0] - c[0]) * t, c[1] + (w[1] - c[1]) * t, c[2] + (w[2] - c[2]) * t];

/** Derive a Brand palette from decoded cover pixels via a colour histogram. */
export function derivePalette(dec: Decoded): Brand["palette"] {
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < dec.rgb.length; i += 3) {
    const r = dec.rgb[i],
      g = dec.rgb[i + 1],
      b = dec.rgb[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = hist.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    hist.set(key, e);
  }
  const bins = [...hist.values()].map((e) => ({ n: e.n, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }));
  // Most-frequent saturated, mid-dark colour = primary brand colour.
  const branded = bins
    .filter((c) => sat(c.r, c.g, c.b) > 35 && lum(c.r, c.g, c.b) < 225)
    .sort((a, b) => b.n - a.n);
  const primaryC = branded[0] ?? { r: 43, g: 58, b: 85 };
  const primary: [number, number, number] = [primaryC.r, primaryC.g, primaryC.b];
  // Accent = next saturated colour with a distinct hue from primary.
  const accentC = branded.find((c) => Math.hypot(c.r - primary[0], c.g - primary[1], c.b - primary[2]) > 80) ?? branded[1] ?? primaryC;
  const accent: [number, number, number] = [accentC.r, accentC.g, accentC.b];
  const onPrimary = lum(...primary) > 150 ? "#1a1a1a" : "#ffffff";
  return {
    primary: hex(...primary),
    onPrimary,
    accent: hex(...accent),
    text: "#1f2937",
    muted: "#6b7280",
    tableHeader: hex(...mix(primary, [255, 255, 255], 0.86)),
    rule: hex(...mix(primary, [255, 255, 255], 0.72)),
  };
}

function decodeDirPngs(dir: string): Decoded[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => {
      try {
        return decodePng(readFileSync(path.join(dir, f)));
      } catch {
        return null;
      }
    })
    .filter((d): d is Decoded => !!d);
}

function mergeDecoded(decs: Decoded[]): Decoded {
  const total = decs.reduce((s, d) => s + d.rgb.length, 0);
  const rgb = new Uint8Array(total);
  let o = 0;
  for (const d of decs) {
    rgb.set(d.rgb, o);
    o += d.rgb.length;
  }
  return { width: 1, height: total / 3, rgb };
}

/**
 * Extract a brand palette. The brand colour lives in the heading/rule colour on
 * CONTENT pages (a cover gradient is dominated by its background by area), so we
 * sample interior pages 2–4 and fall back to the cover. Returns null on failure.
 */
export function extractPalette(pdfPath: string): Brand["palette"] | null {
  const dir = mkdtempSync(path.join(tmpdir(), "tpl-pal-"));
  try {
    execFileSync("pdftoppm", ["-f", "2", "-l", "4", "-r", "30", "-png", pdfPath, path.join(dir, "pg")], { stdio: ["ignore", "ignore", "ignore"] });
    let decs = decodeDirPngs(dir);
    if (!decs.length) {
      // No interior pages — fall back to the cover.
      execFileSync("pdftoppm", ["-f", "1", "-l", "1", "-r", "24", "-png", pdfPath, path.join(dir, "cov")], { stdio: ["ignore", "ignore", "ignore"] });
      decs = decodeDirPngs(dir);
    }
    if (!decs.length) return null;
    return derivePalette(mergeDecoded(decs));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Read just IHDR width/height without full decode. */
function quickPngSize(buf: Buffer): { width: number; height: number } | null {
  try {
    if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

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
function encodePngRGBA(width: number, height: number, rgba: Uint8Array): Buffer {
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

function isGrayscale(dec: Decoded): boolean {
  for (let i = 0; i < dec.rgb.length; i += 3) {
    if (dec.rgb[i] !== dec.rgb[i + 1] || dec.rgb[i + 1] !== dec.rgb[i + 2]) return false;
  }
  return true;
}
function composeRGBA(img: Decoded, mask: Decoded): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = img.rgb[i * 3];
    out[i * 4 + 1] = img.rgb[i * 3 + 1];
    out[i * 4 + 2] = img.rgb[i * 3 + 2];
    out[i * 4 + 3] = mask.rgb[i * 3]; // soft mask grey level → alpha
  }
  return out;
}

type ImgEntry = { f: string; buf: Buffer; width: number; height: number; aspect: number; area: number };

/**
 * Extract page-1 embedded images once and pick a cover background (near
 * full-page portrait) and a logo (wordmark-shaped, alpha-merged with its soft
 * mask when one is present — so it isn't an opaque box on the brand colour).
 */
function extractCoverAssets(pdfPath: string): { logo: string | null; coverImage: string | null } {
  const dir = mkdtempSync(path.join(tmpdir(), "tpl-img-"));
  try {
    execFileSync("pdfimages", ["-png", "-f", "1", "-l", "1", pdfPath, path.join(dir, "img")], { stdio: ["ignore", "ignore", "ignore"] });
    const entries: ImgEntry[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".png"))) {
      const buf = readFileSync(path.join(dir, f));
      const s = quickPngSize(buf);
      if (s) entries.push({ f, buf, width: s.width, height: s.height, aspect: s.width / s.height, area: s.width * s.height });
    }

    // Cover background: largest near-portrait-page image (full-bleed gradient/art).
    const cover = entries.filter((e) => e.aspect >= 0.6 && e.aspect <= 0.85 && e.width >= 700).sort((a, b) => b.area - a.area)[0];
    const coverImage = cover ? `data:image/png;base64,${cover.buf.toString("base64")}` : null;

    // Logo: wide-aspect, moderate size; merge a same-size grayscale soft mask.
    const logoCands = entries
      .filter((e) => e.aspect >= 1.6 && e.aspect <= 12 && e.height >= 24 && e.height <= 600 && e.area <= 500_000)
      .sort((a, b) => b.area - a.area);
    let logo: string | null = null;
    for (const cand of logoCands) {
      try {
        const img = decodePng(cand.buf);
        const maskE = entries.find((e) => e.f !== cand.f && e.width === cand.width && e.height === cand.height);
        if (maskE) {
          const mask = decodePng(maskE.buf);
          if (isGrayscale(mask)) {
            logo = `data:image/png;base64,${encodePngRGBA(img.width, img.height, composeRGBA(img, mask)).toString("base64")}`;
            break;
          }
        }
        logo = `data:image/png;base64,${cand.buf.toString("base64")}`; // opaque or already-alpha
        break;
      } catch {
        /* try next candidate */
      }
    }
    return { logo, coverImage };
  } catch {
    return { logo: null, coverImage: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Extract just the cover logo (alpha-merged when a soft mask is present). */
export function extractLogo(pdfPath: string): string | null {
  return extractCoverAssets(pdfPath).logo;
}

/** Full brand extraction: palette + logo + (when present) a full-bleed cover image. */
export function extractBrand(pdfPath: string, base: Brand): Brand {
  const palette = extractPalette(pdfPath);
  const { logo, coverImage } = extractCoverAssets(pdfPath);
  const cover: Brand["cover"] = coverImage
    ? { style: "image", image: coverImage, tagline: (base.cover as { tagline?: string }).tagline }
    : base.cover;
  return {
    ...base,
    palette: palette ?? base.palette,
    logo: logo ?? base.logo,
    cover,
  };
}
