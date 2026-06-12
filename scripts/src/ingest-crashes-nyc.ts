/**
 * Ingest NYC TLC / NYPD crash records from NYC OpenData (Socrata) into
 * the `crashes` table. Powers the §4 (NYSDOT renderer) crash-analysis
 * section the engine currently leaves as a placeholder.
 *
 * Source: data.cityofnewyork.us "Motor Vehicle Collisions - Crashes"
 *   dataset id h9gi-nx95 — police-reported, 2012-present, ~2.1M rows
 *   total, ~600K rows in the trailing-3-year window the TIS module
 *   queries against.
 *
 * KABCO mapping:
 *   - persons_killed > 0           → K  (fatal)
 *   - persons_injured > 0 & no K   → C  (NYC does NOT classify injury
 *                                        severity, so we conservatively
 *                                        tag every injury as "minor"
 *                                        and disclose this in §4 prose
 *                                        — better than fabricating A/B)
 *   - otherwise                    → O  (PDO)
 *
 * Idempotent. Re-running updates existing rows by (source,
 * source_record_id). Default window is the trailing 3 years; pass
 * --years=N to override (NYSDOT submittals typically cite 3-year
 * windows; some jurisdictions use 5-year).
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-nyc.ts
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-nyc.ts --years=5
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-nyc.ts --dry
 *
 * Auth: NYC OpenData allows anonymous queries at ~1k req/hr, which is
 * comfortably above what this script needs (~13 paginated requests for
 * a 3-year ingest at 50k/page). For higher throughput register a
 * Socrata app token and set SOCRATA_APP_TOKEN — passed via the
 * X-App-Token header.
 */
import { sql } from "drizzle-orm";
import { db, pool, crashesTable, type InsertCrash } from "@workspace/db";

const DATASET = "h9gi-nx95";
const BASE_URL = `https://data.cityofnewyork.us/resource/${DATASET}.json`;
const PAGE_SIZE = 50_000; // Socrata hard cap is 50k per request
const BATCH_INSERT_SIZE = 1_000;

type SocrataCrash = {
  collision_id: string;
  crash_date: string;
  crash_time?: string;
  borough?: string;
  zip_code?: string;
  latitude?: string;
  longitude?: string;
  on_street_name?: string;
  off_street_name?: string;
  cross_street_name?: string;
  number_of_persons_injured?: string;
  number_of_persons_killed?: string;
  number_of_pedestrians_injured?: string;
  number_of_pedestrians_killed?: string;
  number_of_cyclist_injured?: string;
  number_of_cyclist_killed?: string;
  contributing_factor_vehicle_1?: string;
  vehicle_type_code1?: string;
  vehicle_type_code2?: string;
  vehicle_type_code_3?: string;
  vehicle_type_code_4?: string;
  vehicle_type_code_5?: string;
};

function parseArgs(): { years: number; dry: boolean } {
  let years = 3;
  let dry = false;
  for (const a of process.argv.slice(2)) {
    if (a === "--dry") dry = true;
    else if (a.startsWith("--years=")) years = Math.max(1, Math.min(20, Number(a.slice(8))));
  }
  return { years, dry };
}

function severityFor(row: SocrataCrash): InsertCrash["severity"] {
  const killed = Number(row.number_of_persons_killed ?? 0);
  const injured = Number(row.number_of_persons_injured ?? 0);
  if (killed > 0) return "K";
  if (injured > 0) return "C";
  return "O";
}

/**
 * Manner-of-collision heuristic from the vehicle-type pattern. NYC's
 * dataset doesn't directly publish a manner-of-collision field; the
 * contributing-factor + vehicle-type combinations approximate it well
 * enough for an aggregate §4 breakdown. Engineers verifying any
 * specific row can pull the full PDF police report via the collision
 * id at NYPD.
 */
function mannerFor(row: SocrataCrash): string | null {
  const pedInj = Number(row.number_of_pedestrians_injured ?? 0) + Number(row.number_of_pedestrians_killed ?? 0);
  const cycInj = Number(row.number_of_cyclist_injured ?? 0) + Number(row.number_of_cyclist_killed ?? 0);
  if (pedInj > 0) return "pedestrian";
  if (cycInj > 0) return "cyclist";
  // Crude two-vehicle vs single-vehicle proxy. Real classification
  // requires the per-vehicle direction of travel which NYC doesn't
  // publish.
  const vehicleCount = [row.vehicle_type_code1, row.vehicle_type_code2, row.vehicle_type_code_3, row.vehicle_type_code_4, row.vehicle_type_code_5].filter(Boolean).length;
  return vehicleCount >= 2 ? "multi-vehicle" : "single-vehicle";
}

function occurredAtFor(row: SocrataCrash): Date | null {
  if (!row.crash_date) return null;
  // crash_date arrives as "2024-03-15T00:00:00.000"; combine with
  // crash_time ("HH:MM") when present so the timestamp survives any
  // later time-of-day analysis (rush-hour vs midnight crash patterns).
  const datePart = row.crash_date.slice(0, 10);
  const timePart = row.crash_time && /^\d{1,2}:\d{2}/.test(row.crash_time) ? row.crash_time : "00:00";
  const iso = `${datePart}T${timePart.padStart(5, "0")}:00-05:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapRow(row: SocrataCrash): InsertCrash | null {
  if (!row.collision_id) return null;
  const occurred = occurredAtFor(row);
  if (!occurred) return null;
  const lat = row.latitude ? Number(row.latitude) : NaN;
  const lon = row.longitude ? Number(row.longitude) : NaN;
  // Discard the 0/0 sentinels that NYC's pipeline writes when the
  // officer couldn't geocode the crash.
  const hasCoords =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) > 1 && Math.abs(lon) > 1;
  return {
    source: "nyc_opendata",
    sourceRecordId: row.collision_id,
    occurredAt: occurred,
    severity: severityFor(row),
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lon : null,
    locationPrecision: hasCoords ? "precise" : "approximate",
    municipality: row.borough ?? null,
    county: row.borough ? boroughToCounty(row.borough) : null,
    onStreet: row.on_street_name?.trim() || null,
    crossStreet: row.cross_street_name?.trim() || row.off_street_name?.trim() || null,
    mannerOfCollision: mannerFor(row),
    lighting: null,
    weather: null,
    surface: null,
    numVehicles: [row.vehicle_type_code1, row.vehicle_type_code2, row.vehicle_type_code_3, row.vehicle_type_code_4, row.vehicle_type_code_5].filter(Boolean).length || null,
    pedestrianInvolved: Number(row.number_of_pedestrians_injured ?? 0) + Number(row.number_of_pedestrians_killed ?? 0) > 0,
    cyclistInvolved: Number(row.number_of_cyclist_injured ?? 0) + Number(row.number_of_cyclist_killed ?? 0) > 0,
  };
}

function boroughToCounty(borough: string): string {
  switch (borough.toUpperCase()) {
    case "MANHATTAN": return "New York";
    case "BROOKLYN": return "Kings";
    case "QUEENS": return "Queens";
    case "BRONX": return "Bronx";
    case "STATEN ISLAND": return "Richmond";
    default: return borough;
  }
}

async function fetchPage(offset: number, sinceIso: string): Promise<SocrataCrash[]> {
  const params = new URLSearchParams({
    $where: `crash_date >= '${sinceIso}'`,
    $order: "crash_date DESC",
    $limit: String(PAGE_SIZE),
    $offset: String(offset),
  });
  const headers: Record<string, string> = {};
  if (process.env.SOCRATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  }
  const r = await fetch(`${BASE_URL}?${params.toString()}`, { headers });
  if (!r.ok) throw new Error(`Socrata ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`);
  return (await r.json()) as SocrataCrash[];
}

async function upsertBatch(rows: InsertCrash[], dry: boolean): Promise<void> {
  if (rows.length === 0) return;
  if (dry) return;
  await db
    .insert(crashesTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [crashesTable.source, crashesTable.sourceRecordId],
      // On re-ingest of an already-stored crash, update the mutable
      // categorical fields. The (source, sourceRecordId) pair is
      // immutable so no rows duplicate.
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

async function main(): Promise<void> {
  const { years, dry } = parseArgs();
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - years);
  const sinceIso = since.toISOString().slice(0, 10);

  console.log(`ingest-crashes-nyc: window = last ${years}y (since ${sinceIso}), dry=${dry}`);

  let offset = 0;
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;
  const startedAt = Date.now();

  while (true) {
    process.stdout.write(`  fetching offset=${offset.toLocaleString()}… `);
    const t0 = Date.now();
    const page = await fetchPage(offset, sinceIso);
    const dt = Date.now() - t0;
    console.log(`${page.length.toLocaleString()} rows in ${dt}ms`);
    if (page.length === 0) break;
    totalFetched += page.length;

    const mapped: InsertCrash[] = [];
    for (const r of page) {
      const m = mapRow(r);
      if (m) mapped.push(m);
      else totalSkipped++;
    }

    for (let i = 0; i < mapped.length; i += BATCH_INSERT_SIZE) {
      await upsertBatch(mapped.slice(i, i + BATCH_INSERT_SIZE), dry);
    }
    totalUpserted += mapped.length;

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `ingest-crashes-nyc: fetched=${totalFetched.toLocaleString()} upserted=${totalUpserted.toLocaleString()} skipped=${totalSkipped.toLocaleString()} elapsed=${elapsedSec}s`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("ingest-crashes-nyc FAILED:", err);
  pool.end().finally(() => process.exit(1));
});
