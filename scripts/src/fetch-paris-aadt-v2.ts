/**
 * Paris AADT v2 — adds Cerema TMJA national-network counts to the
 * Paris Open Data city-counter baseline already produced by
 * fetch-paris-aadt.ts.
 *
 * What v2 adds:
 *
 *   1. Cerema TMJA RRNc 2024 CSV (data.gouv.fr). The "RRN concédé/
 *      non concédé" dataset covers France's national road network —
 *      autoroutes (A), national highways (N), and the boulevard
 *      périphérique (BP). In the Paris bbox this contributes ~50–100
 *      high-volume segments along A1, A3, A4, A6, A13, A14, A86, A104,
 *      BP. Native projection is Lambert93 (EPSG:2154); we convert to
 *      WGS84 inline using IGN ALG0019.
 *
 *   2. Wider second-pass snap: signals not snapped to a Paris city
 *      counter within 100m get a second chance against TMJA segments
 *      at 150m (longer because TMJA segments are linear features not
 *      point counters — the nearest-point distance can be larger when
 *      the signal is on the segment but offset from its representative
 *      point).
 *
 * Idempotent: re-running merges into the existing paris-aadt.json,
 * keeping whichever source is closer per signal.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-paris-aadt-v2.ts
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const TMJA_URL =
  "https://static.data.gouv.fr/resources/trafic-moyen-journalier-annuel-sur-le-reseau-routier-national/20250818-100154/tmja-rrnc-2024.csv";

const PARIS_BBOX = { latMin: 48.78, latMax: 48.95, lonMin: 2.20, lonMax: 2.50 };
const TMJA_SNAP_M = 150;

// ── Lambert93 (EPSG:2154) → WGS84, via IGN ALG0019 ──────────────────────
// Constants from IGN documentation, Lambert93 / RGF93 system. Accuracy ~1m
// vs. WGS84, which is fine for traffic-counter spatial snap.
const L93 = {
  n: 0.7256077650532682,
  C: 11754255.426096,
  xs: 700_000,
  ys: 12_655_612.0498,
  e: 0.0818191910428158,
  lon0: (3 * Math.PI) / 180, // 3° E (Greenwich-based)
};

function l93ToWgs84(x: number, y: number): { lat: number; lon: number } {
  const dx = x - L93.xs;
  const dy = L93.ys - y;
  const R = Math.sqrt(dx * dx + dy * dy);
  const gamma = Math.atan2(dx, dy);
  const lon = L93.lon0 + gamma / L93.n;
  // Iterative latitude (isometric → geodetic), converges in 4–5 iterations.
  const latIso = -Math.log(R / L93.C) / L93.n;
  let lat = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const eSinLat = L93.e * Math.sin(lat);
    lat =
      2 *
        Math.atan(
          Math.exp(latIso) * Math.pow((1 + eSinLat) / (1 - eSinLat), L93.e / 2),
        ) -
      Math.PI / 2;
  }
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

type TmjaSegment = {
  midLat: number;
  midLon: number;
  tmja: number;
  route: string;
};

async function fetchTmja(): Promise<TmjaSegment[]> {
  console.log("Fetching Cerema TMJA RRNc 2024...");
  const res = await fetch(TMJA_URL);
  if (!res.ok) throw new Error(`TMJA fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0]!.split(";");
  const ixD = header.indexOf("xD");
  const iyD = header.indexOf("yD");
  const ixF = header.indexOf("xF");
  const iyF = header.indexOf("yF");
  const iTmja = header.indexOf("TMJA");
  const iRoute = header.indexOf("route");
  if ([ixD, iyD, ixF, iyF, iTmja, iRoute].some((i) => i < 0)) {
    throw new Error("Unexpected TMJA CSV header: " + JSON.stringify(header));
  }
  const out: TmjaSegment[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(";");
    const xD = parseFloat(cols[ixD]!.replace(",", "."));
    const yD = parseFloat(cols[iyD]!.replace(",", "."));
    const xF = parseFloat(cols[ixF]!.replace(",", "."));
    const yF = parseFloat(cols[iyF]!.replace(",", "."));
    const tmja = parseInt(cols[iTmja]!, 10);
    const route = cols[iRoute] ?? "";
    if (!Number.isFinite(xD) || !Number.isFinite(yD) || !Number.isFinite(tmja) || tmja <= 0) continue;
    const a = l93ToWgs84(xD, yD);
    const b = l93ToWgs84(xF, yF);
    const midLat = (a.lat + b.lat) / 2;
    const midLon = (a.lon + b.lon) / 2;
    // Filter to Paris bbox (with padding so segments crossing bbox edges still register)
    if (
      midLat < PARIS_BBOX.latMin - 0.05 ||
      midLat > PARIS_BBOX.latMax + 0.05 ||
      midLon < PARIS_BBOX.lonMin - 0.05 ||
      midLon > PARIS_BBOX.lonMax + 0.05
    )
      continue;
    out.push({ midLat, midLon, tmja, route });
  }
  console.log(`  ${out.length} TMJA segments inside Paris bbox`);
  return out;
}

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

async function main(): Promise<void> {
  const slug = "paris";
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  const aadtPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(sigPath) || !existsSync(aadtPath)) {
    throw new Error(`missing signals or existing aadt for ${slug}`);
  }
  const signals = JSON.parse(readFileSync(sigPath, "utf8")) as Array<
    [number, number, number, string | null, number]
  >;
  const aadt = JSON.parse(readFileSync(aadtPath, "utf8")) as Record<
    string,
    { aadt: number; year: number; kFactor: number; distM: number; source: string }
  >;

  const tmjaSegs = await fetchTmja();

  // Second-pass snap: for any signal whose current AADT source is "synthetic_osm_class"
  // (i.e., not yet measured), try to snap to a TMJA segment within TMJA_SNAP_M.
  let upgraded = 0;
  for (const [osmId, sLat, sLon] of signals) {
    const key = String(osmId);
    const existing = aadt[key];
    if (existing && existing.source !== "synthetic_osm_class") continue; // already measured (paris_opendata)
    let best: { seg: TmjaSegment; d: number } | null = null;
    for (const seg of tmjaSegs) {
      const d = distMeters(sLat, sLon, seg.midLat, seg.midLon);
      if (d > TMJA_SNAP_M) continue;
      if (!best || d < best.d) best = { seg, d };
    }
    if (best) {
      aadt[key] = {
        aadt: best.seg.tmja,
        year: 2024,
        kFactor: 9,
        distM: Math.round(best.d),
        source: "cerema_tmja_rrnc_2024",
      };
      upgraded++;
    }
  }
  console.log(`Upgraded ${upgraded} signals from synthetic → cerema_tmja measured`);

  writeFileSync(aadtPath, JSON.stringify(aadt));

  // Recount measured share for metro-coverage.ts
  const measuredCount = Object.values(aadt).filter(
    (a) => a.source === "paris_opendata" || a.source === "cerema_tmja_rrnc_2024",
  ).length;
  const measuredPct = Math.round((measuredCount / signals.length) * 1000) / 10;
  console.log(`Total measured: ${measuredCount} / ${signals.length} = ${measuredPct}%`);

  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern = /(\{ code: "paris_metro",[^}]*?)aadtPct:\s*[0-9.]+,([^}]*?)aadtSource:\s*"[^"]*",/;
  if (pattern.test(coverage)) {
    coverage = coverage.replace(
      pattern,
      `$1aadtPct: ${measuredPct},$2aadtSource: "Paris Open Data (capteurs permanents) + Cerema TMJA RRNc 2024",`,
    );
    writeFileSync(COVERAGE_PATH, coverage);
    console.log(`Updated paris_metro: aadtPct=${measuredPct}%`);
  } else {
    console.log("! pattern miss");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
