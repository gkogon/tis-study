/**
 * Generic city-signal overlay fetcher.
 *
 * For each configured slug, rebuilds `<slug>-signals.json` from the archived
 * OSM baseline and the authoritative ArcGIS layers configured for it, in
 * order (city or county layer first, FDOT statewide second):
 *
 *   1. Paginate each layer's REST endpoint with its outFields.
 *   2. Classify every record from the source's own type fields as a signal,
 *      a device OSM also maps as a signal (flasher, beacon, school sign,
 *      emergency or ped signal), or excluded (see signal-device-types.ts).
 *   3. Drop OSM nodes that map a device, unless any layer puts a signal
 *      within 50 m.
 *   4. Overlay each layer's signals: the nearest OSM node within 50 m takes
 *      the record's position and name and keeps its OSM id; otherwise the
 *      record is appended with a negative id. An appended record keeps the id
 *      the previous output gave it, so ids -- and the AADT records keyed by
 *      them -- survive upstream renumbering.
 *   5. Drop AADT records whose tuple is gone, moved, or was shared.
 *
 * Starting from the archive rather than the previous output means a record
 * the classifiers now exclude cannot survive from an earlier run, and a
 * second run writes the same bytes.
 *
 * The earlier per-city scripts (fetch-charlotte-cdot-signals.ts,
 * fetch-miami-dade-county-signals.ts) are superseded and exit without
 * merging; they are kept as documentation of the original discovery work.
 *
 * Layers:
 *   - charlotte_metro      → CDOT layer (UNITDESC "A_B_C" → "A & B & C")
 *   - miami_dade_metro     → County layer (INTRSECTN already "A & B"), then FDOT
 *   - orlando_metro        → City of Orlando ITS Devices layer/3, then FDOT
 *   - raleigh_durham_metro → Raleigh signals (Intersecti "A / B/C" → "A & B & C")
 *   - tampa_metro          → FDOT only; no public city inventory surfaced
 *   - nashville_metro      → no public vehicle-signal dataset surfaced
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-city-signals.ts orlando
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-city-signals.ts --all
 */

import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FDOT_ID_NAMESPACE,
  buildSignalInventory,
  classifyCdot,
  classifyFdot,
  classifyMiamiDadeCounty,
  classifyOrlandoCity,
  classifyRaleigh,
  formatCdotIntersectionName,
  formatRaleighIntersectionName,
  reconcileAadtKeys,
  titleCase,
  type AuthorityRecord,
  type Pass,
  type RecordClass,
  type SignalTuple,
} from "../../artifacts/api-server/src/lib/signal-device-types";

const PAGE_SIZE = 1000;

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
  /** Signal, look-alike device, or excluded, from the source's own fields. */
  classify: (attrs: Record<string, unknown>) => RecordClass;
  /** See Pass.idNamespace; 0 for layers whose ids are stable. */
  idNamespace?: number;
  /** See Pass.coarseSignalType. */
  coarseSignalType?: boolean;
};

const str = (a: Record<string, unknown>, k: string) => (a[k] as string | null | undefined) ?? null;
const num = (a: Record<string, unknown>, k: string) => (a[k] as number | null | undefined) ?? null;

const CITIES: CityConfig[] = [
  {
    regionCode: "charlotte_metro",
    slug: "charlotte",
    layerUrl: "https://gis.charlottenc.gov/arcgis/rest/services/Accela/Accela/MapServer/11",
    outFields: "OBJECTID,SIGNAL_ID,UNITDESC,UNITTYPE,UNITTYPEDESC,SERVSTAT",
    where: "SERVSTAT='OP'",
    idField: "SIGNAL_ID",
    fallbackIdField: "OBJECTID",
    buildName: (a) => formatCdotIntersectionName(str(a, "UNITDESC")),
    // The layer holds every device CDOT maintains: a third of its operational
    // records are school flashers, ped beacons, stop flashers, fire-station
    // signals, RRFBs and wayfinding signs (UNITDESC "OAKHURST ELEMENTARY
    // SCHOOL", "FLASHER SHEFFIELD DR_WOODLAND DR").
    classify: (a) => classifyCdot(str(a, "UNITTYPE"), str(a, "UNITTYPEDESC")),
  },
  {
    regionCode: "miami_dade_metro",
    slug: "miami-dade",
    // Every county asset: school signs, flashing beacons and signals,
    // cameras, reversible lanes, and records marked Future or Removed sit
    // next to the traffic signals; the ASSETTYPE and CNSTRSTAT domains name
    // them. The county types ped and emergency signals as traffic signals,
    // so FDOT's more specific types override it where they coincide.
    layerUrl: "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/TrafficSignals_gdb/FeatureServer/0",
    outFields: "OBJECTID,ASSETID,INTRSECTN,LAT,LON,ASSETTYPE,CNSTRSTAT",
    idField: "ASSETID",
    fallbackIdField: "OBJECTID",
    buildName: (a) => {
      const v = (a["INTRSECTN"] as string | null)?.replace(/\s+/g, " ").trim();
      return v && v.length > 0 ? v : null;
    },
    classify: (a) => classifyMiamiDadeCounty(num(a, "ASSETTYPE"), num(a, "CNSTRSTAT")),
    coarseSignalType: true,
  },
  {
    regionCode: "orlando_metro",
    slug: "orlando",
    // City of Orlando's "Traffic Signals" layer: Type is the controller class
    // (RCSS 420, ISOL 30, EAGLE 6, TRAFSIG 4 on 2026-09-28) plus flashing
    // beacons (FLBEA 39) and school flashers (SCHFL 25). The city annotates
    // crosswalk, ped-crossing, bike-path and fire-department signals in the
    // street text. State-road signals come from the FDOT pass that follows.
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
    classify: (a) => classifyOrlandoCity(str(a, "Type"), `${str(a, "Intersecti") ?? ""} & ${str(a, "Intersec_1") ?? ""}`),
    coarseSignalType: true,
  },
  {
    regionCode: "raleigh_durham_metro",
    slug: "raleigh-durham",
    layerUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Raleigh_Traffic_Signals_Public_for_PowerBI/FeatureServer/0",
    outFields: "FID,Intersecti,Intersec_1,Signal_Status,Subtype",
    where: "Signal_Status='Existing'",
    idField: "FID",
    // Raleigh separates every street with a slash. HAWK and ped-only signals
    // carry a "(HAWK)" / "(PED ONLY)" prefix; the classifier excludes them.
    buildName: (a) => formatRaleighIntersectionName(str(a, "Intersecti")),
    classify: (a) => classifyRaleigh(str(a, "Subtype"), str(a, "Intersecti") ?? ""),
  },
  // ── FDOT statewide overlay ────────────────────────────────────────────
  // FDOT's roadway-characteristics inventory of signals on the State Highway
  // System. On 2026-09-28 (SEC_STAT='ON'): Tampa MSA 1,052 records, Orlando
  // MSA 975, Miami-Dade 1,559. VALUE_ types each as a signal (02), beacon
  // (01), mid-block ped control (03), emergency signal (04) or at-school (05).
  //
  // Tampa has no public *city* signal inventory we could find, so FDOT is the
  // only authoritative source there. For Orlando and Miami-Dade it follows the
  // city/county pass.
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
      outFields: "FID,SIGNALID,SDESTRET,MAINTAGC,COUNTY,SEC_STAT,VALUE_,SIGNALNC",
      where:
        `SEC_STAT='ON' AND COUNTY IN (${counties[slug]!.map((c) => `'${c}'`).join(",")})`,
      idField: "FID",
      buildName: (a: Record<string, unknown>) => {
        const side = ((a["SDESTRET"] as string | null) ?? "").trim();
        if (!side || side.toUpperCase() === "N/A") return null;
        return titleCase(side);
      },
      classify: (a: Record<string, unknown>) => classifyFdot(str(a, "VALUE_"), str(a, "SIGNALNC"), str(a, "SDESTRET")),
      // FIDs are renumbered upstream between fetches; SIGNALID is "N/A" on
      // every Tampa record and repeats elsewhere, so neither identifies one.
      idNamespace: FDOT_ID_NAMESPACE,
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

/** Prefer geometry (server-projected to WGS84); some layers also stash
 *  LAT/LON as attribute fields. */
function featurePoint(f: ArcFeature): { lat: number; lon: number } | null {
  const lat = f.geometry?.y ?? (f.attributes["LAT"] as number | undefined);
  const lon = f.geometry?.x ?? (f.attributes["LON"] as number | undefined);
  if (typeof lat !== "number" || typeof lon !== "number" || !isFinite(lat) || !isFinite(lon)) return null;
  return { lat, lon };
}

/** One layer's features as classified records, in fetch order. */
function toPass(cfg: CityConfig, features: ArcFeature[]): { pass: Pass; skipped: number } {
  const records: AuthorityRecord[] = [];
  let skipped = 0;
  for (const f of features) {
    const p = featurePoint(f);
    const id =
      (f.attributes[cfg.idField] as number | null | undefined) ??
      (cfg.fallbackIdField ? (f.attributes[cfg.fallbackIdField] as number | null | undefined) : undefined);
    if (!p || typeof id !== "number") {
      skipped++;
      continue;
    }
    records.push({ id, lat: p.lat, lon: p.lon, name: cfg.buildName(f.attributes), cls: cfg.classify(f.attributes) });
  }
  return { pass: { records, idNamespace: cfg.idNamespace ?? 0, coarseSignalType: cfg.coarseSignalType }, skipped };
}

async function rebuildSlug(slug: string, configs: CityConfig[]): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");
  const archiveDir = path.resolve(dataDir, "_osm-archive");
  const signalsPath = path.resolve(dataDir, `${slug}-signals.json`);
  const archivePath = path.resolve(archiveDir, `${slug}-signals.json`);

  if (!existsSync(signalsPath)) {
    throw new Error(`Missing OSM baseline at ${signalsPath}. Run fetch-osm-signals first.`);
  }
  mkdirSync(archiveDir, { recursive: true });
  if (!existsSync(archivePath)) {
    // First run for this slug: the file on disk is still pure OSM.
    copyFileSync(signalsPath, archivePath);
    console.log(`  archived OSM baseline → ${archivePath}`);
  }

  console.log(`\n=== ${configs[0]!.regionCode} ===`);
  const archive = JSON.parse(readFileSync(archivePath, "utf8")) as SignalTuple[];
  const previous = JSON.parse(readFileSync(signalsPath, "utf8")) as SignalTuple[];
  console.log(`  OSM baseline (archived): ${archive.length} signals`);

  const passes: Pass[] = [];
  for (const cfg of configs) {
    const { pass, skipped } = toPass(cfg, await fetchAllFeatures(cfg));
    const n = (c: RecordClass) => pass.records.filter((r) => r.cls === c).length;
    console.log(`  ${new URL(cfg.layerUrl).hostname}: ${pass.records.length} records ` +
      `(signal ${n("signal")}, device ${n("device")}, excluded ${n("exclude")}, bad coords/id ${skipped})`);
    passes.push(pass);
  }

  const built = buildSignalInventory(archive, passes, previous);
  writeFileSync(signalsPath, JSON.stringify(built.tuples));
  console.log(`  Coarse signals reclassified as devices: ${built.reclassified.length}`);
  console.log(`  OSM nodes dropped at devices:           ${built.dropped.length}`);
  console.log(`  Appended ids: ${built.ids.continued} kept from the previous output, ${built.ids.fresh} new`);
  console.log(`  Total signals: ${previous.length} → ${built.tuples.length}`);

  const aadtPath = path.resolve(dataDir, `${slug}-aadt.json`);
  if (existsSync(aadtPath)) {
    const aadt = JSON.parse(readFileSync(aadtPath, "utf8")) as Record<string, unknown>;
    const r = reconcileAadtKeys(aadt, previous, built.tuples);
    const droppedKeys = r.orphaned.length + r.moved.length + r.shared.length;
    if (droppedKeys > 0) writeFileSync(aadtPath, JSON.stringify(r.kept));
    console.log(`  AADT records: ${Object.keys(r.kept).length} kept; dropped ${r.orphaned.length} orphaned, ` +
      `${r.moved.length} on a tuple that moved, ${r.shared.length} on a shared id`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const requested = args.filter((a) => !a.startsWith("--"));
  const slugs = [...new Set(CITIES.map((c) => c.slug))].filter(
    (s) => wantAll || CITIES.some((c) => c.slug === s && (requested.includes(c.slug) || requested.includes(c.regionCode))),
  );

  if (slugs.length === 0) {
    console.error("Usage: tsx src/fetch-city-signals.ts <slug> [<slug>...]");
    console.error("       tsx src/fetch-city-signals.ts --all");
    console.error(`Available: ${[...new Set(CITIES.map((c) => c.slug))].join(", ")}`);
    process.exit(2);
  }

  for (const slug of slugs) {
    try {
      await rebuildSlug(slug, CITIES.filter((c) => c.slug === slug));
    } catch (e) {
      console.error(`✗ ${slug}: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
