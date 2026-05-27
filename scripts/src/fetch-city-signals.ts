/**
 * Generic city-signal overlay fetcher.
 *
 * For a configured city (Charlotte, Miami-Dade, Orlando, Raleigh, ...),
 * pulls the authoritative ArcGIS signal layer, overlays it onto the existing
 * OSM baseline using the same merge strategy as fetch-charlotte-cdot-signals
 * / fetch-miami-dade-county-signals:
 *
 *   1. Paginate the city's REST endpoint with that city's outFields.
 *   2. Build a spatial grid over the OSM baseline.
 *   3. For each city signal, find nearest OSM (within 50m).
 *      - Match → overlay name+coords, keep OSM id.
 *      - No match → emit with negative id (CDOT/county provenance flag).
 *   4. OSM signals with no nearby city signal pass through untouched
 *      (preserves suburb coverage outside the city's jurisdiction).
 *
 * The earlier per-city scripts (fetch-charlotte-cdot-signals.ts,
 * fetch-miami-dade-county-signals.ts) are now redundant; left in place as
 * documentation of the original discovery work.
 *
 * Cities surveyed:
 *   - charlotte_metro  → CDOT layer (UNITDESC "A_B" → "A & B")
 *   - miami_dade_metro → County layer (INTRSECTN already "A & B")
 *   - orlando_metro    → ITS Devices layer/3 (Intersecti + Intersec_1)
 *   - raleigh_durham_metro → Raleigh signals (Intersecti "A / B" → "A & B")
 *   - nashville_metro  → no public vehicle-signal dataset surfaced
 *   - tampa_metro      → no public vehicle-signal dataset surfaced
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-city-signals.ts orlando
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-city-signals.ts --all
 */

import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MATCH_RADIUS_M = 50;
const PAGE_SIZE = 1000;

type SignalTuple = [number, number, number, string | null, number];

type CityConfig = {
  regionCode: string;
  /** Slug used for the signals filename (matches fetch-osm-signals output). */
  slug: string;
  /** ArcGIS REST layer URL ending in /FeatureServer/N or /MapServer/N. */
  layerUrl: string;
  /** Comma-separated outFields to request. */
  outFields: string;
  /** Optional `where` clause (default 1=1). */
  where?: string;
  /** Field name (in `attributes`) to use as the city-internal ID. */
  idField: string;
  /** Optional fallback ID field if the primary is null. */
  fallbackIdField?: string;
  /** Build the canonical "Street A & Street B" label from a feature. */
  buildName: (attrs: Record<string, unknown>) => string | null;
};

/** Title-case helper; preserves common acronyms / road suffixes. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      const up = w.toUpperCase();
      if (["NC", "SC", "FL", "US", "I", "II", "III", "IV", "NW", "NE", "SW", "SE", "SR"].includes(up)) return up;
      return w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1);
    })
    .join(" ");
}

const CITIES: CityConfig[] = [
  {
    regionCode: "charlotte_metro",
    slug: "charlotte",
    layerUrl: "https://gis.charlottenc.gov/arcgis/rest/services/Accela/Accela/MapServer/11",
    outFields: "OBJECTID,SIGNAL_ID,UNITDESC,SERVSTAT",
    where: "SERVSTAT='OP'",
    idField: "SIGNAL_ID",
    fallbackIdField: "OBJECTID",
    buildName: (a) => {
      const d = (a["UNITDESC"] as string | null)?.trim();
      if (!d) return null;
      // CDOT uses "STREET A_STREET B" (single underscore).
      const parts = d.split("_");
      if (parts.length < 2) return titleCase(d);
      return `${titleCase(parts[0]!.trim())} & ${titleCase(parts.slice(1).join("_").trim())}`;
    },
  },
  {
    regionCode: "miami_dade_metro",
    slug: "miami-dade",
    layerUrl: "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/TrafficSignals_gdb/FeatureServer/0",
    outFields: "OBJECTID,ASSETID,INTRSECTN,LAT,LON",
    idField: "ASSETID",
    fallbackIdField: "OBJECTID",
    buildName: (a) => {
      const v = (a["INTRSECTN"] as string | null)?.replace(/\s+/g, " ").trim();
      return v && v.length > 0 ? v : null;
    },
  },
  {
    regionCode: "orlando_metro",
    slug: "orlando",
    // City of Orlando's "Traffic Signals" layer holds all signalized
    // devices, not just full traffic signals (Type=TRAFSIG is only 4 of 524
    // records — the rest are school flashers, RRFBs, flashing beacons).
    // We accept all of them: even pedestrian/school-flasher locations are
    // real signalized intersections worth naming in the TIS engine, and the
    // few full-vehicle signals are the most authoritative records there are.
    // Coverage of true City-of-Orlando-maintained vehicle signals comes from
    // FDOT's statewide Traffic Signal Locations TDA (separate overlay pass).
    layerUrl: "https://services.arcgis.com/Ie0K5n4UyLAfvdiX/arcgis/rest/services/City_of_Orlando_ITS_Devices/FeatureServer/3",
    outFields: "OBJECTID,SignalNumb,Intersecti,Intersec_1,StreetDir1,StreetDir2,Type",
    idField: "OBJECTID",
    buildName: (a) => {
      // Orlando carries the two streets in separate fields. Either can be
      // empty (e.g. ramp meters with one street + one ramp descriptor).
      const dir1 = (a["StreetDir1"] as string | null)?.trim();
      const s1 = (a["Intersecti"] as string | null)?.trim();
      const dir2 = (a["StreetDir2"] as string | null)?.trim();
      const s2 = (a["Intersec_1"] as string | null)?.trim();
      const left = [dir1, s1].filter((p) => p && p !== "").join(" ").trim();
      const right = [dir2, s2].filter((p) => p && p !== "").join(" ").trim();
      if (left && right) return `${titleCase(left)} & ${titleCase(right)}`;
      if (left) return titleCase(left);
      if (right) return titleCase(right);
      return null;
    },
  },
  {
    regionCode: "raleigh_durham_metro",
    slug: "raleigh-durham",
    layerUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Raleigh_Traffic_Signals_Public_for_PowerBI/FeatureServer/0",
    outFields: "FID,Intersecti,Intersec_1,Signal_Status,Subtype",
    where: "Signal_Status='Existing'",
    idField: "FID",
    buildName: (a) => {
      const d = (a["Intersecti"] as string | null)?.trim();
      if (!d) return null;
      // Raleigh uses "STREET A / STREET B" (slash). Some have leading tags
      // like "(HAWK)" or "(RRFB)" prepended — keep them as part of the label
      // since they're useful operational context.
      const parts = d.split("/");
      if (parts.length < 2) return titleCase(d);
      return `${titleCase(parts[0]!.trim())} & ${titleCase(parts.slice(1).join("/").trim())}`;
    },
  },
  // ── FDOT statewide overlay ────────────────────────────────────────────
  // 10,784 signals in FDOT's roadway-characteristics database. Per-metro
  // coverage: Tampa MSA ~1,426, Orlando MSA ~1,011, Miami-Dade ~1,572.
  //
  // Tampa and Orlando have no public *city* signal inventory we could find,
  // so FDOT is the only authoritative source for those two metros. For
  // Miami-Dade it supplements the county dataset already loaded.
  //
  // The naming is weaker than OSM roads-derived (SDESTRET only carries the
  // *side* street; the primary road is implicit in the RDWYID). When OSM
  // already named the signal well, the merge keeps the OSM coords + lets
  // OSM-roads naming win at serve time (regional-intersections prefers
  // embedded names only when present; we emit name=null when SDESTRET is
  // null/N/A so OSM naming takes over).
  ...["tampa", "orlando", "miami-dade"].map((slug) => {
    const counties: Record<string, string[]> = {
      tampa: ["HILLSBOROUGH", "PINELLAS", "PASCO", "HERNANDO"],
      orlando: ["ORANGE", "SEMINOLE", "LAKE", "OSCEOLA"],
      "miami-dade": ["MIAMI-DADE"],
    };
    return {
      regionCode: slug === "miami-dade" ? "miami_dade_metro" : `${slug}_metro`,
      slug,
      layerUrl:
        "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Traffic_Signal_Locations_TDA/FeatureServer/0",
      outFields: "FID,SIGNALID,SDESTRET,MAINTAGC,COUNTY,SEC_STAT",
      where:
        `SEC_STAT='ON' AND COUNTY IN (${counties[slug]!.map((c) => `'${c}'`).join(",")})`,
      idField: "FID",
      buildName: (a: Record<string, unknown>) => {
        const side = ((a["SDESTRET"] as string | null) ?? "").trim();
        if (!side || side.toUpperCase() === "N/A") return null;
        return titleCase(side);
      },
    } satisfies CityConfig;
  }),
];

type ArcFeature = { attributes: Record<string, unknown>; geometry?: { x: number; y: number } };

async function fetchAllFeatures(cfg: CityConfig): Promise<ArcFeature[]> {
  const out: ArcFeature[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${cfg.layerUrl}/query` +
      `?where=${encodeURIComponent(cfg.where ?? "1=1")}` +
      `&outFields=${encodeURIComponent(cfg.outFields)}` +
      `&outSR=4326` +
      `&resultRecordCount=${PAGE_SIZE}` +
      `&resultOffset=${offset}` +
      `&f=json`;
    console.log(`  [${cfg.slug}] fetching offset=${offset}`);
    const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
    if (!res.ok) throw new Error(`${cfg.slug} query failed at offset ${offset}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { features?: ArcFeature[]; exceededTransferLimit?: boolean };
    const features = json.features ?? [];
    out.push(...features);
    if (!json.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }
  return out;
}

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const M_PER_DEG_LAT = 111_320;
  const midLat = (lat1 + lat2) / 2;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  return Math.sqrt(((lat1 - lat2) * M_PER_DEG_LAT) ** 2 + ((lon1 - lon2) * mPerDegLon) ** 2);
}

function buildOsmIndex(osm: SignalTuple[]): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (let i = 0; i < osm.length; i++) {
    const [, lat, lon] = osm[i]!;
    const k = `${Math.floor(lat / 0.005)}_${Math.floor(lon / 0.005)}`;
    let b = idx.get(k);
    if (!b) { b = []; idx.set(k, b); }
    b.push(i);
  }
  return idx;
}

function findNearest(
  osm: SignalTuple[],
  idx: Map<string, number[]>,
  lat: number,
  lon: number,
  maxM: number,
): { i: number; d: number } | null {
  const latCell = Math.floor(lat / 0.005);
  const lonCell = Math.floor(lon / 0.005);
  let best: { i: number; d: number } | null = null;
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlon = -1; dlon <= 1; dlon++) {
      const bucket = idx.get(`${latCell + dlat}_${lonCell + dlon}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const [, olat, olon] = osm[i]!;
        const d = distMeters(lat, lon, olat, olon);
        if (d <= maxM && (best === null || d < best.d)) best = { i, d };
      }
    }
  }
  return best;
}

async function mergeOne(cfg: CityConfig): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");
  const archiveDir = path.resolve(dataDir, "_osm-archive");
  const signalsPath = path.resolve(dataDir, `${cfg.slug}-signals.json`);

  if (!existsSync(signalsPath)) {
    throw new Error(`Missing OSM baseline at ${signalsPath}. Run fetch-osm-signals first.`);
  }

  mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.resolve(archiveDir, `${cfg.slug}-signals.json`);
  if (!existsSync(archivePath)) {
    copyFileSync(signalsPath, archivePath);
    console.log(`  archived OSM baseline → ${archivePath}`);
  }

  console.log(`\n=== ${cfg.regionCode} ===`);
  const osm = JSON.parse(readFileSync(signalsPath, "utf8")) as SignalTuple[];
  console.log(`  OSM baseline: ${osm.length} signals`);

  const features = await fetchAllFeatures(cfg);
  console.log(`  ${cfg.slug} city signals: ${features.length}`);

  const idx = buildOsmIndex(osm);
  const merged: SignalTuple[] = osm.map((t) => [...t] as SignalTuple);
  let matched = 0;
  let unmatched = 0;
  let badCoord = 0;
  const newTuples: SignalTuple[] = [];

  for (const f of features) {
    // Prefer geometry (server-projected to WGS84); some layers also stash
    // LAT/LON as attribute fields.
    const lat = f.geometry?.y ?? (f.attributes["LAT"] as number | undefined);
    const lon = f.geometry?.x ?? (f.attributes["LON"] as number | undefined);
    if (typeof lat !== "number" || typeof lon !== "number" || !isFinite(lat) || !isFinite(lon)) {
      badCoord++;
      continue;
    }
    const idRaw =
      (f.attributes[cfg.idField] as number | null | undefined) ??
      (cfg.fallbackIdField ? (f.attributes[cfg.fallbackIdField] as number | null | undefined) : undefined);
    if (typeof idRaw !== "number") {
      badCoord++;
      continue;
    }
    const name = cfg.buildName(f.attributes);

    const m = findNearest(merged, idx, lat, lon, MATCH_RADIUS_M);
    if (m) {
      const [osmId] = merged[m.i]!;
      merged[m.i] = [osmId, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, name, 2];
      matched++;
    } else {
      newTuples.push([-idRaw, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, name, 2]);
      unmatched++;
    }
  }

  const final = [...merged, ...newTuples];
  writeFileSync(signalsPath, JSON.stringify(final));

  console.log(`  Matched (OSM ←city overlay):  ${matched}`);
  console.log(`  Unmatched city (added new):   ${unmatched}`);
  console.log(`  Bad coords/id skipped:        ${badCoord}`);
  console.log(`  OSM-only (suburb signals):    ${osm.length - matched}`);
  console.log(`  Total signals after merge:    ${final.length}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const requested = args.filter((a) => !a.startsWith("--"));
  const cities = wantAll
    ? CITIES
    : CITIES.filter((c) => requested.includes(c.slug) || requested.includes(c.regionCode));

  if (cities.length === 0) {
    console.error("Usage: tsx src/fetch-city-signals.ts <slug> [<slug>...]");
    console.error("       tsx src/fetch-city-signals.ts --all");
    console.error(`Available: ${CITIES.map((c) => c.slug).join(", ")}`);
    process.exit(2);
  }

  for (const c of cities) {
    try {
      await mergeOne(c);
    } catch (e) {
      console.error(`✗ ${c.slug}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
