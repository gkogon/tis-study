/**
 * Ingest FDOT statewide crash records from the FDOT SSO/SSOGIS ArcGIS
 * FeatureServer into the `crashes` table. Powers the §5 Mitigation /
 * Crash Analysis block in renderTisFlorida (per MTSIH 2024 + HSM
 * crash-history conventions).
 *
 * Source: gis.fdot.gov/arcgis/rest/services/sso/ssogis/featureserver/2000
 *   ("Crashes All"). Statewide, lat/lon, ~3.3M records 2011-2019. The
 *   public service has become incomplete after 2019 (FDOT data
 *   agreements changed; current crash records require Signal4
 *   Analytics login at signal4lab.geoplan.ufl.edu — not public). For
 *   the screening output we ingest the most-recent-comprehensive
 *   3-year window (2017-2019, ~1.3M records). The §5 renderer prose
 *   declares this vintage so an engineer knows what they're looking
 *   at — better than a missing section but not the latest data.
 *
 * KABCO mapping from FDOT INJSEVER (DHSMV injury severity codes):
 *   5 = Fatal                      → K
 *   4 = Incapacitating Injury      → A
 *   3 = Non-incapacitating Injury  → B
 *   2 = Possible Injury            → C
 *   1 = No Injury                  → O
 *   blank/null/other               → UNKNOWN
 *
 * Idempotent ingest via crashes_source_record_unique on
 * (source, sourceRecordId). Source = `fdot_sso`, sourceRecordId = XID.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-fl.ts
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-fl.ts --year=2018
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-fl.ts --dry
 */
import { sql } from "drizzle-orm";
import { db, pool, crashesTable, type InsertCrash } from "@workspace/db";

const LAYER_URL =
  "https://gis.fdot.gov/arcgis/rest/services/sso/ssogis/featureserver/2000/query";
const PAGE_SIZE = 2000; // ArcGIS REST max
const BATCH_INSERT_SIZE = 500;
const DEFAULT_YEARS = [2017, 2018, 2019];

type ArcGisFeature = {
  attributes: {
    XID?: string;
    CRASH_NUMBER?: string;
    CALENDAR_YEAR?: number;
    CRASH_DATE?: number; // ms since epoch
    CRASH_TIME?: string; // "HHMM" e.g. "0625"
    COUNTY_TXT?: string;
    ON_ROADWAY_NAME?: string;
    INT_ROADWAY_NAME?: string;
    SAFETYLAT?: number;
    SAFETYLON?: number;
    OFFICER_LATITUDE?: number;
    OFFICER_LONGITUDE?: number;
    LATITUDE?: number;
    LONGITUDE?: number;
    NUMBER_OF_KILLED?: number;
    NUMBER_OF_INJURED?: number;
    NUMBER_OF_SERIOUS_INJURIES?: number;
    NUMBER_OF_PEDESTRIANS?: number;
    NUMBER_OF_BICYCLISTS?: number;
    NUMBER_OF_VEHICLES?: number;
    INJSEVER?: string; // 1-5
    IMPCT_TYP_CD?: string;
    LGHT_COND_CD?: string;
    EVNT_WTHR_COND_CD?: string;
    RD_SRFC_COND_CD?: string;
    PEDESTRIAN_RELATED_IND?: string; // Y/N
    BICYCLIST_RELATED_IND?: string;
  };
};

type ParsedArgs = { years: number[]; dry: boolean };
function parseArgs(): ParsedArgs {
  let years = DEFAULT_YEARS;
  let dry = false;
  for (const a of process.argv.slice(2)) {
    if (a === "--dry") dry = true;
    else if (a.startsWith("--year=")) {
      const y = Number(a.slice(7));
      if (Number.isFinite(y)) years = [y];
    } else if (a.startsWith("--years=")) {
      years = a
        .slice(8)
        .split(",")
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));
    }
  }
  return { years, dry };
}

function severityFor(injsever: string | undefined): InsertCrash["severity"] {
  switch (injsever) {
    case "5": return "K";
    case "4": return "A";
    case "3": return "B";
    case "2": return "C";
    case "1": return "O";
    default: return "UNKNOWN";
  }
}

// IMPCT_TYP_CD lookups per FDOT crash codes. The 2-digit codes are
// canonical — many TIS deliverables paraphrase them, so we keep the
// raw code as-is for traceability and produce a human-readable
// label.
function mannerFor(code: string | undefined): string | null {
  switch (code) {
    case "01": return "rear-end";
    case "02": return "head-on";
    case "03": return "angle";
    case "04": return "sideswipe (same direction)";
    case "05": return "sideswipe (opposite direction)";
    case "06": return "rear-to-side";
    case "07": return "rear-to-rear";
    case "08": return "left-turn";
    case "09": return "right-turn";
    case "10": return "head-on (left-turn)";
    default: return code ?? null;
  }
}

function occurredAtFor(row: ArcGisFeature["attributes"]): Date | null {
  if (typeof row.CRASH_DATE !== "number") return null;
  let dt = row.CRASH_DATE;
  // CRASH_TIME is "HHMM" string — overlay onto the date when present.
  if (row.CRASH_TIME && /^\d{3,4}$/.test(row.CRASH_TIME)) {
    const hhmm = row.CRASH_TIME.padStart(4, "0");
    const hh = Number(hhmm.slice(0, 2));
    const mm = Number(hhmm.slice(2, 4));
    if (Number.isFinite(hh) && Number.isFinite(mm)) {
      dt += hh * 3600_000 + mm * 60_000;
    }
  }
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapRow(f: ArcGisFeature): InsertCrash | null {
  const a = f.attributes;
  if (!a.XID) return null;
  const occurred = occurredAtFor(a);
  if (!occurred) return null;

  // Coord preference: SAFETYLAT (FDOT-geocoded) is the most reliable.
  // Officer coords are often (0, 0) when not captured. Fall back to
  // ARBM LATITUDE/LONGITUDE when both SAFETY and Officer are blank.
  let lat: number | null = null;
  let lon: number | null = null;
  if (Number.isFinite(a.SAFETYLAT) && Number.isFinite(a.SAFETYLON) && (a.SAFETYLAT ?? 0) !== 0) {
    lat = a.SAFETYLAT!;
    lon = a.SAFETYLON!;
  } else if (Number.isFinite(a.OFFICER_LATITUDE) && Number.isFinite(a.OFFICER_LONGITUDE) && (a.OFFICER_LATITUDE ?? 0) !== 0) {
    lat = a.OFFICER_LATITUDE!;
    lon = a.OFFICER_LONGITUDE!;
  } else if (Number.isFinite(a.LATITUDE) && Number.isFinite(a.LONGITUDE)) {
    lat = a.LATITUDE!;
    lon = a.LONGITUDE!;
  }
  // FL bounds sanity: 24.5-31.0 N, -87.7 to -80.0 W.
  if (lat !== null && (lat < 24.0 || lat > 31.5 || lon === null || lon < -88.0 || lon > -79.5)) {
    lat = null;
    lon = null;
  }
  const hasCoords = lat !== null && lon !== null;

  return {
    source: "fdot_sso",
    sourceRecordId: a.XID,
    occurredAt: occurred,
    severity: severityFor(a.INJSEVER),
    latitude: lat,
    longitude: lon,
    locationPrecision: hasCoords ? "precise" : "approximate",
    municipality: null, // FDOT extract has city codes not names; skip.
    county: a.COUNTY_TXT ?? null,
    onStreet: a.ON_ROADWAY_NAME?.trim() || null,
    crossStreet: a.INT_ROADWAY_NAME?.trim() || null,
    mannerOfCollision: mannerFor(a.IMPCT_TYP_CD),
    lighting: a.LGHT_COND_CD ?? null,
    weather: a.EVNT_WTHR_COND_CD ?? null,
    surface: a.RD_SRFC_COND_CD ?? null,
    numVehicles: Number.isFinite(a.NUMBER_OF_VEHICLES) ? a.NUMBER_OF_VEHICLES! : null,
    pedestrianInvolved: a.PEDESTRIAN_RELATED_IND === "Y",
    cyclistInvolved: a.BICYCLIST_RELATED_IND === "Y",
  };
}

async function fetchPage(year: number, offset: number): Promise<ArcGisFeature[]> {
  const params = new URLSearchParams({
    where: `CALENDAR_YEAR=${year}`,
    outFields: "*",
    returnGeometry: "false",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: "OBJECTID ASC",
    f: "json",
  });
  // ArcGIS doesn't always like very-long where; 3 attempts w/ backoff.
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${LAYER_URL}?${params.toString()}`);
      if (!r.ok) throw new Error(`ArcGIS ${r.status}`);
      const j = (await r.json()) as { features?: ArcGisFeature[]; error?: unknown };
      if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error).slice(0, 200)}`);
      return j.features ?? [];
    } catch (e) {
      last = e;
      const wait = 2000 * (attempt + 1);
      console.warn(`    retry ${attempt + 1} after ${wait}ms (${(e as Error).message?.slice(0, 80)})`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw last;
}

async function upsertBatch(rows: InsertCrash[], dry: boolean): Promise<void> {
  if (rows.length === 0) return;
  if (dry) return;
  // Dedupe within batch by (source, sourceRecordId) — defensive.
  const seen = new Map<string, InsertCrash>();
  for (const r of rows) seen.set(`${r.source}|${r.sourceRecordId}`, r);
  const deduped = Array.from(seen.values());
  await db
    .insert(crashesTable)
    .values(deduped)
    .onConflictDoUpdate({
      target: [crashesTable.source, crashesTable.sourceRecordId],
      set: {
        severity: sql`EXCLUDED.severity`,
        latitude: sql`EXCLUDED.latitude`,
        longitude: sql`EXCLUDED.longitude`,
        locationPrecision: sql`EXCLUDED.location_precision`,
        mannerOfCollision: sql`EXCLUDED.manner_of_collision`,
        numVehicles: sql`EXCLUDED.num_vehicles`,
        pedestrianInvolved: sql`EXCLUDED.pedestrian_involved`,
        cyclistInvolved: sql`EXCLUDED.cyclist_involved`,
      },
    });
}

async function ingestYear(year: number, dry: boolean): Promise<{ fetched: number; upserted: number }> {
  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  while (true) {
    process.stdout.write(`  year=${year} offset=${offset.toLocaleString()}… `);
    const t0 = Date.now();
    const page = await fetchPage(year, offset);
    const dt = Date.now() - t0;
    console.log(`${page.length.toLocaleString()} features in ${dt}ms`);
    if (page.length === 0) break;
    fetched += page.length;
    const mapped: InsertCrash[] = [];
    for (const f of page) {
      const m = mapRow(f);
      if (m) mapped.push(m);
    }
    for (let i = 0; i < mapped.length; i += BATCH_INSERT_SIZE) {
      await upsertBatch(mapped.slice(i, i + BATCH_INSERT_SIZE), dry);
    }
    upserted += mapped.length;
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { fetched, upserted };
}

async function main(): Promise<void> {
  const { years, dry } = parseArgs();
  console.log(`ingest-crashes-fl: years=${years.join(",")} dry=${dry}`);
  const startedAt = Date.now();
  let totalFetched = 0;
  let totalUpserted = 0;
  for (const y of years) {
    const { fetched, upserted } = await ingestYear(y, dry);
    totalFetched += fetched;
    totalUpserted += upserted;
  }
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `ingest-crashes-fl: fetched=${totalFetched.toLocaleString()} upserted=${totalUpserted.toLocaleString()} elapsed=${elapsedSec}s`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("ingest-crashes-fl FAILED:", err);
  pool.end().finally(() => process.exit(1));
});
