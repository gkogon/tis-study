/**
 * Google Street View Static image fetch for the PDF cover.
 *
 * Caltran-style consultant covers lead with a photo of the site. We fetch
 * a Street View Static image at the project lat/lon and embed it on the
 * cover band. Requires GOOGLE_MAPS_API_KEY; without it (or when Street
 * View has no imagery at the coordinate) this returns null and the cover
 * falls back to a clean brand-color band — never a broken "no imagery"
 * gray tile.
 *
 * Two-step to avoid the gray placeholder: the metadata endpoint (free, not
 * billed) reports whether a panorama exists at the point; we only fetch the
 * billed image when status === "OK".
 *
 * In-process LRU cache keyed by 4-decimal coord so re-rendering the same
 * project doesn't re-hit the API.
 */
import { logger } from "./logger";

const META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMG_URL = "https://maps.googleapis.com/maps/api/streetview";
const TIMEOUT_MS = 6000;
const CACHE_MAX = 200;

// `undefined` = not cached; `null` = cached miss (no key / no imagery / error).
const cache = new Map<string, Buffer | null>();

function keyOf(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * Returns a JPEG Buffer of the Street View image at (lat, lon), or null
 * when unavailable. Fails open: any error → null. Size is a 640×400
 * landscape banner (the Static API's keyless-tier max width).
 */
export async function fetchStreetViewImage(
  lat: number,
  lon: number,
): Promise<Buffer | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const ck = keyOf(lat, lon);
  if (cache.has(ck)) return cache.get(ck) ?? null;

  const loc = `${lat},${lon}`;
  try {
    // 1. Metadata probe — confirms a panorama exists (and isn't billed).
    const metaUrl = `${META_URL}?location=${encodeURIComponent(loc)}&key=${encodeURIComponent(key)}`;
    const metaCtrl = new AbortController();
    const metaT = setTimeout(() => metaCtrl.abort(), TIMEOUT_MS);
    const metaRes = await fetch(metaUrl, { signal: metaCtrl.signal });
    clearTimeout(metaT);
    if (!metaRes.ok) return cacheMiss(ck);
    const meta = (await metaRes.json()) as { status?: string };
    if (meta.status !== "OK") return cacheMiss(ck);

    // 2. Fetch the image. return_error_code keeps a no-imagery response a
    //    real HTTP error rather than a gray placeholder JPEG.
    const imgUrl =
      `${IMG_URL}?size=640x400&location=${encodeURIComponent(loc)}` +
      `&fov=80&pitch=0&return_error_code=true&key=${encodeURIComponent(key)}`;
    const imgCtrl = new AbortController();
    const imgT = setTimeout(() => imgCtrl.abort(), TIMEOUT_MS);
    const imgRes = await fetch(imgUrl, { signal: imgCtrl.signal });
    clearTimeout(imgT);
    if (!imgRes.ok) return cacheMiss(ck);
    const ct = imgRes.headers.get("content-type") ?? "";
    if (!ct.includes("image")) return cacheMiss(ck);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length < 1000) return cacheMiss(ck); // implausibly small → treat as miss
    if (cache.size < CACHE_MAX) cache.set(ck, buf);
    return buf;
  } catch (err) {
    logger.warn({ err, lat, lon }, "streetview.fetch_failed");
    return cacheMiss(ck);
  }
}

function cacheMiss(ck: string): null {
  if (cache.size < CACHE_MAX) cache.set(ck, null);
  return null;
}
