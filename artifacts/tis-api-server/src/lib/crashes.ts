/**
 * Crash-data query API for the TIS engine.
 *
 * Reads from the `crashes` table populated by per-jurisdiction ingest
 * scripts (scripts/src/ingest-crashes-*.ts). Powers the crash-analysis
 * section every state TIS shell needs — §4 in NYSDOT, §5 in FDOT and
 * MTSIH, equivalents in GDOT / Caltrans / etc.
 *
 * The two query shapes:
 *
 *   1. crashesNearPoint() — spatial radius search. Used when we have
 *      precise study-intersection coords AND the underlying data
 *      source publishes precise crash coords (NYC OpenData, FARS,
 *      and a handful of state extracts).
 *
 *   2. crashesByApproximateMatch() — municipality + street-name
 *      search. Used as a fallback when the source dropped coords
 *      (NYS public ALIS extract, GA GEARS public release). Less
 *      precise but still defensible for §4 aggregate counts.
 *
 * The renderer chooses between them based on which dataset covers
 * the study area; see `crashSummaryForStudyArea()` for the routing
 * logic.
 */
import { and, between, gte, ilike, or, sql } from "drizzle-orm";
import { db, crashesTable } from "@workspace/db";

const EARTH_RADIUS_MI = 3958.8;

/**
 * Result shape used in renderer payloads. Aggregate counts + a
 * sample of recent severe crashes for the §4 detail table. The
 * renderer never enumerates all rows — at a busy intersection a
 * 3-year window can be hundreds of crashes; engineers want the
 * aggregate and the top-N severe.
 */
export type CrashSummary = {
  windowYears: number;
  // Spatial radius used for the search (mi). Absent / null when the
  // result came from an approximate-match path that has no radius.
  radiusMi?: number;
  totalCrashes: number;
  bySeverity: { K: number; A: number; B: number; C: number; O: number; UNKNOWN: number };
  pedestrianInvolved: number;
  cyclistInvolved: number;
  // Recent severe (K/A) crashes for the per-incident detail table.
  // Capped at 25 — a real submittal would itemize all of them; the
  // screening output gets the worst-N.
  recentSevere: Array<{
    occurredAt: string;
    severity: string;
    onStreet: string | null;
    crossStreet: string | null;
    mannerOfCollision: string | null;
    pedestrianInvolved: boolean;
    cyclistInvolved: boolean;
  }>;
  // Provenance — engineers verifying numbers want to know whether
  // they came from NYC's precise dataset or a no-coord state extract.
  source: string;
  locationPrecision: "precise" | "approximate";
};

/**
 * Bounding-box prefilter for a circular-radius query. Postgres can
 * answer `lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?` via the btree
 * index on (latitude, longitude); the precise Haversine filter then
 * runs only against the prefiltered subset. Avoids requiring PostGIS
 * on Railway-managed Postgres.
 */
function boundingBox(lat: number, lon: number, radiusMi: number): {
  latMin: number; latMax: number; lonMin: number; lonMax: number;
} {
  const dLat = radiusMi / 69;
  const dLon = radiusMi / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.001));
  return {
    latMin: lat - dLat,
    latMax: lat + dLat,
    lonMin: lon - dLon,
    lonMax: lon + dLon,
  };
}

/**
 * Spatial query: crashes within radiusMi of (lat, lon) in the trailing
 * windowYears. Only returns rows where latitude/longitude are not null
 * (locationPrecision IN ('precise', 'segment')).
 *
 * Uses Haversine inside Postgres so the row never leaves the DB before
 * being filtered. The bounding-box prefilter cuts the work by ~99% on
 * a city-wide dataset before the trig function runs.
 */
export async function crashesNearPoint(args: {
  lat: number;
  lon: number;
  radiusMi: number;
  windowYears: number;
  source?: string;
}): Promise<CrashSummary> {
  const { lat, lon, radiusMi, windowYears, source } = args;
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - windowYears);
  const bbox = boundingBox(lat, lon, radiusMi);

  // Haversine in SQL — the only practical way to push this filter
  // down without PostGIS. The constant is in miles (3958.8); switch
  // to 6371 if a future caller wants km.
  const haversine = sql<number>`
    ${EARTH_RADIUS_MI} * acos(
      cos(radians(${lat})) *
      cos(radians(${crashesTable.latitude})) *
      cos(radians(${crashesTable.longitude}) - radians(${lon})) +
      sin(radians(${lat})) *
      sin(radians(${crashesTable.latitude}))
    )
  `;

  const conditions = [
    between(crashesTable.latitude, bbox.latMin, bbox.latMax),
    between(crashesTable.longitude, bbox.lonMin, bbox.lonMax),
    gte(crashesTable.occurredAt, since),
    sql`${haversine} <= ${radiusMi}`,
  ];
  if (source) conditions.push(sql`${crashesTable.source} = ${source}`);

  const rows = await db
    .select({
      severity: crashesTable.severity,
      occurredAt: crashesTable.occurredAt,
      onStreet: crashesTable.onStreet,
      crossStreet: crashesTable.crossStreet,
      mannerOfCollision: crashesTable.mannerOfCollision,
      pedestrianInvolved: crashesTable.pedestrianInvolved,
      cyclistInvolved: crashesTable.cyclistInvolved,
      source: crashesTable.source,
    })
    .from(crashesTable)
    .where(and(...conditions))
    .limit(50_000);

  return aggregate(rows, { windowYears, radiusMi, locationPrecision: "precise" });
}

/**
 * Approximate match: crashes that occurred on a road matching `onStreet`
 * within the named municipality. Used for jurisdictions whose public
 * extract drops coords (NYS public ALIS, etc.).
 *
 * The street name match is a case-insensitive substring — sources
 * encode road names inconsistently ("Main St" vs "MAIN STREET" vs
 * "Main"). The renderer prose discloses the approximate-match
 * methodology so a reviewing PE knows the precision.
 */
export async function crashesByApproximateMatch(args: {
  municipality: string;
  onStreetSubstring: string;
  windowYears: number;
  source?: string;
}): Promise<CrashSummary> {
  const { municipality, onStreetSubstring, windowYears, source } = args;
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - windowYears);

  const conditions = [
    ilike(crashesTable.municipality, municipality),
    or(
      ilike(crashesTable.onStreet, `%${onStreetSubstring}%`),
      ilike(crashesTable.crossStreet, `%${onStreetSubstring}%`),
    )!,
    gte(crashesTable.occurredAt, since),
  ];
  if (source) conditions.push(sql`${crashesTable.source} = ${source}`);

  const rows = await db
    .select({
      severity: crashesTable.severity,
      occurredAt: crashesTable.occurredAt,
      onStreet: crashesTable.onStreet,
      crossStreet: crashesTable.crossStreet,
      mannerOfCollision: crashesTable.mannerOfCollision,
      pedestrianInvolved: crashesTable.pedestrianInvolved,
      cyclistInvolved: crashesTable.cyclistInvolved,
      source: crashesTable.source,
    })
    .from(crashesTable)
    .where(and(...conditions))
    .limit(50_000);

  return aggregate(rows, { windowYears, locationPrecision: "approximate" });
}



function aggregate(
  rows: Array<{
    severity: string;
    occurredAt: Date;
    onStreet: string | null;
    crossStreet: string | null;
    mannerOfCollision: string | null;
    pedestrianInvolved: boolean;
    cyclistInvolved: boolean;
    source: string;
  }>,
  meta: { windowYears: number; radiusMi?: number; locationPrecision: "precise" | "approximate" },
): CrashSummary {
  const bySeverity = { K: 0, A: 0, B: 0, C: 0, O: 0, UNKNOWN: 0 };
  let pedestrianInvolved = 0;
  let cyclistInvolved = 0;
  let source = "";
  for (const r of rows) {
    bySeverity[r.severity as keyof typeof bySeverity] =
      (bySeverity[r.severity as keyof typeof bySeverity] ?? 0) + 1;
    if (r.pedestrianInvolved) pedestrianInvolved++;
    if (r.cyclistInvolved) cyclistInvolved++;
    if (!source) source = r.source;
  }
  const recentSevere = rows
    .filter((r) => r.severity === "K" || r.severity === "A")
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 25)
    .map((r) => ({
      occurredAt: r.occurredAt.toISOString().slice(0, 10),
      severity: r.severity,
      onStreet: r.onStreet,
      crossStreet: r.crossStreet,
      mannerOfCollision: r.mannerOfCollision,
      pedestrianInvolved: r.pedestrianInvolved,
      cyclistInvolved: r.cyclistInvolved,
    }));
  return {
    windowYears: meta.windowYears,
    radiusMi: meta.radiusMi,
    totalCrashes: rows.length,
    bySeverity,
    pedestrianInvolved,
    cyclistInvolved,
    recentSevere,
    source: source || "unknown",
    locationPrecision: meta.locationPrecision,
  };
}
