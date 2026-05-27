/**
 * Pull neighborhood polygons for regions where a public dataset exists.
 *
 * Currently configured:
 *   - nashville_metro → Nashville_Neighborhood_Boundaries_20240430 (288 polys,
 *     hosted on Temple Univ's services org; official Metro Nashville
 *     "Neighborhood Boundaries" service only has 1 record so we use this).
 *   - orlando_metro   → OrlandoPoliticalNeighborhoods (125 polys, official
 *     City of Orlando OpenData_Orlando account).
 *
 * Output: artifacts/api-server/src/data/<slug>-neighborhoods.geojson
 *   { type: "FeatureCollection", features: [{ properties: { name }, geometry }] }
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-neighborhoods.ts --all
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_SIZE = 1000;

type RegionNeighborhoodConfig = {
  slug: string;
  layerUrl: string;
  /** Field that holds the human-readable neighborhood name. */
  nameField: string;
  /** Optional: filter `where`. */
  where?: string;
};

type RegionNeighborhoodConfigExt = RegionNeighborhoodConfig & {
  /** Prefix added to nameField values (e.g. "NPA " → "NPA 154"). Optional. */
  namePrefix?: string;
  /** Title-case the name (for ALL-CAPS sources like Miami-Dade municipalities). */
  titleCase?: boolean;
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w)
    .join(" ");
}

const REGIONS: RegionNeighborhoodConfigExt[] = [
  {
    slug: "nashville",
    layerUrl:
      "https://services.arcgis.com/6fiE7QkLWSPMd0N5/arcgis/rest/services/Nashville_Neighborhood_Boundaries_20240430/FeatureServer/0",
    nameField: "name",
  },
  {
    slug: "orlando",
    layerUrl:
      "https://services5.arcgis.com/mMuoPCaIYD4wEgDl/arcgis/rest/services/OrlandoPoliticalNeighborhoods/FeatureServer/0",
    nameField: "NeighborhoodName",
  },
  {
    // Raleigh Neighborhood Registry (412 named HOAs / neighborhood orgs).
    // Note: this is the *Registry* — registered HOAs only. Coverage in
    // unincorporated suburbs and Durham/Wake outside Raleigh proper will be
    // sparse. Compass fallback handles those.
    slug: "raleigh-durham",
    layerUrl:
      "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Raleigh_Neighborhood_Registry/FeatureServer/0",
    nameField: "Name",
  },
  {
    // Charlotte NPA (Neighborhood Profile Area) Housing Locational Tool.
    // 462 unique NPAs covering Mecklenburg County. Records are NUMBERED,
    // not named, so labels render as "NPA 154". Still strictly better than
    // "SE Charlotte" because each NPA is a real planning area.
    slug: "charlotte",
    layerUrl:
      "https://gis.charlottenc.gov/arcgis/rest/services/HNS/NPA_HLT/FeatureServer/0",
    nameField: "NPAs_NPA",
    namePrefix: "NPA ",
  },
  {
    // Tampa: Hillsborough County has only 3 incorporated CITIES (Tampa,
    // Plant City, Temple Terrace). Coverage will be low (~30-40% of metro
    // signals in city limits). The 10K+ Subdivisions dataset is too granular
    // (individual condo complexes). Compass fallback handles unincorporated.
    slug: "tampa",
    layerUrl:
      "https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/Cities/FeatureServer/0",
    nameField: "CITY",
    titleCase: true,
  },
  {
    // Miami-Dade Municipal Boundary: 28 incorporated cities (Miami, Miami
    // Beach, Coral Gables, etc.) plus "UNINCORPORATED MIAMI-DADE" chunks.
    // Coarser than true neighborhoods but a reasonable zone label.
    slug: "miami-dade",
    layerUrl:
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/Municipal_Boundary_30/FeatureServer/0",
    nameField: "NAME",
    titleCase: true,
  },
];

type ArcFeature = {
  attributes: Record<string, unknown>;
  geometry?: {
    rings?: Array<Array<[number, number]>>; // Polygon
    paths?: Array<Array<[number, number]>>; // Polyline (unused)
  };
};

async function fetchAllPolygons(cfg: RegionNeighborhoodConfig): Promise<ArcFeature[]> {
  const out: ArcFeature[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${cfg.layerUrl}/query` +
      `?where=${encodeURIComponent(cfg.where ?? "1=1")}` +
      `&outFields=${encodeURIComponent(cfg.nameField)}` +
      `&outSR=4326` +
      `&returnGeometry=true` +
      `&resultRecordCount=${PAGE_SIZE}` +
      `&resultOffset=${offset}` +
      `&f=json`;
    const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
    if (!res.ok) throw new Error(`Neighborhoods query failed at offset ${offset}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { features?: ArcFeature[]; exceededTransferLimit?: boolean };
    const features = json.features ?? [];
    out.push(...features);
    if (!json.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }
  return out;
}

/** Convert ArcGIS rings → GeoJSON Polygon coordinates ([[[lon,lat]...]]).
 *  Round to 5 decimals (~1m) — saves ~30% bundle size with no visible effect. */
function ringsToGeoJsonCoords(rings: Array<Array<[number, number]>>): number[][][] {
  return rings.map((ring) =>
    ring.map(([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]),
  );
}

async function processRegion(cfg: RegionNeighborhoodConfigExt): Promise<void> {
  console.log(`\n=== ${cfg.slug} ===`);
  const features = await fetchAllPolygons(cfg);
  console.log(`  fetched ${features.length} polygons`);

  // GeoJSON FeatureCollection. We only need name + polygon coords for the
  // serve-time point-in-polygon lookup; everything else is dropped.
  //
  // Dedup strategy: by (name, first-vertex) — catches Charlotte NPA_HLT's
  // 6 identical-geometry rows per NPA (stat join) without collapsing
  // Miami-Dade's 28 "UNINCORPORATED" polygons (real distinct pieces of
  // unincorporated county with the same label).
  const seen = new Set<string>();
  const geojson = {
    type: "FeatureCollection",
    features: features
      .map((f) => {
        const raw = f.attributes[cfg.nameField];
        if (raw === null || raw === undefined) return null;
        let name = String(raw).trim();
        if (!name) return null;
        if (cfg.titleCase) name = titleCase(name);
        if (cfg.namePrefix) name = cfg.namePrefix + name;
        if (!f.geometry?.rings || !f.geometry.rings[0] || !f.geometry.rings[0][0]) return null;
        const [lon0, lat0] = f.geometry.rings[0][0]!;
        const key = `${name}|${Math.round(lat0 * 1e4)}|${Math.round(lon0 * 1e4)}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          type: "Feature",
          properties: { name },
          geometry: {
            type: "Polygon",
            coordinates: ringsToGeoJsonCoords(f.geometry.rings),
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");
  mkdirSync(dataDir, { recursive: true });
  const outPath = path.resolve(dataDir, `${cfg.slug}-neighborhoods.geojson`);
  writeFileSync(outPath, JSON.stringify(geojson));
  console.log(`  ${geojson.features.length} named polygons → ${outPath}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const requested = args.filter((a) => !a.startsWith("--"));
  const regions = wantAll ? REGIONS : REGIONS.filter((r) => requested.includes(r.slug));
  if (regions.length === 0) {
    console.error("Usage: tsx src/fetch-neighborhoods.ts <slug> [<slug>...] | --all");
    console.error(`Available: ${REGIONS.map((r) => r.slug).join(", ")}`);
    process.exit(2);
  }
  for (const r of regions) {
    try { await processRegion(r); } catch (e) { console.error(`✗ ${r.slug}: ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
