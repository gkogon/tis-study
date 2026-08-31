/**
 * Automated Traffic Recorder (ATR) query API. Reads measured 15-min
 * volume bins from the `atr_counts` table (populated by
 * scripts/src/ingest-atr-nyc.ts and future per-state equivalents) and
 * returns peak-hour volumes that a state TIS renderer can paint into
 * the §3 Existing Conditions table.
 *
 * The product still falls back to inferred `AADT × K × D` estimation
 * when no ATR coverage exists within the requested radius — NYC DOT
 * counts a rotating sample, not the full grid, so any given site may
 * or may not have a recent count nearby. The renderer prose
 * discloses which path was taken.
 *
 * What this is NOT: turning movement counts. ATR is directional
 * segment volume, not per-approach × L/T/R. Publicly available TMCs
 * don't exist at scale. The engineer verifying the TIS in Synchro /
 * HCS supplies the turn splits from a separate count study (or
 * accepts the engine's distribution model).
 */
import { and, between, gte, sql } from "drizzle-orm";
import { db, atrCountsTable } from "@workspace/db";

const EARTH_RADIUS_MI = 3958.8;

/**
 * Peak-hour volume summary for a single (segment, direction) pair
 * within radius of a study site.
 */
export type AtrSegmentSummary = {
  segmentId: string;
  street: string | null;
  fromStreet: string | null;
  toStreet: string | null;
  direction: string;
  latitude: number;
  longitude: number;
  distanceMi: number;
  // Most recent count window covered by this segment.
  latestCountDate: string;
  sampleDays: number;
  // Peak-hour volumes (vph), averaged across all weekday samples in
  // the requested window. AM = max of 7-9 AM hours; PM = max of
  // 4-6 PM hours.
  amPeakHourVph: number | null;
  pmPeakHourVph: number | null;
  // Average of DAILY TOTALS across sampled days — vehicles per DAY, not
  // per hour. Directly comparable to AADT, which is the point of showing
  // it. ⚠️ Named `...Veh` deliberately: this was `avgDailyVph` rendered
  // under a "Daily (vph)" column, which printed ~50,000 vph for the West
  // Side Highway on production. The bug was invisible until 2026-08-31
  // because `atr_counts` had never been populated.
  avgDailyVeh: number | null;
};

/**
 * Which ingested ATR dataset backs a given study region.
 *
 * Adding a metro is one row here plus its ingest adapter — see
 * scripts/src/lib/atr-socrata.ts. Keyed by region code first so a city feed is
 * not applied to the whole state, then by state for feeds that genuinely are
 * statewide.
 *
 * NOTE on NY: the only feed today is NYC DOT's, and it is mapped at STATE level
 * deliberately, because that reproduces the previous behaviour exactly — every
 * NY-state study queried nyc_dot_atr and failed open when no segment was within
 * the radius. Upstate sites therefore find nothing, as before.
 */
const ATR_SOURCE_BY_REGION: Record<string, string> = {};
const ATR_SOURCE_BY_STATE: Record<string, string> = {
  NY: "nyc_dot_atr",
  // FDOT Traffic TMSCOUNT (TDA) — hourly directional counts, all 63 counties,
  // so this genuinely is statewide rather than one city's feed.
  //
  // ⚠️ NOTE: the Florida renderer does NOT render this summary, on purpose. FL
  // already prints measured FDOT counts in its own §4.3, from a LIVE TMSCOUNT
  // query at render time (enrichTmsCountIntersections). Rendering this too
  // would report the same agency's data twice under different aggregations
  // (two-way / fixed 08:00 + 17:00 hour vs directional / windowed peak over a
  // multi-year sample). Kept mapped because the ingested form is the better
  // methodology and is the intended replacement for §4.3 — but that is a
  // deliberate swap, not something to switch on by accident.
  FL: "fdot_tda",
};

export function atrSourceForRegion(
  region: { code?: string | null; stateCode?: string | null; country?: string | null } | null | undefined,
): string | null {
  if (!region) return null;
  if ((region.country ?? "US") !== "US") return null;
  const byRegion = region.code ? ATR_SOURCE_BY_REGION[region.code] : undefined;
  if (byRegion) return byRegion;
  const byState = region.stateCode ? ATR_SOURCE_BY_STATE[region.stateCode] : undefined;
  return byState ?? null;
}

export type AtrSummary = {
  windowYears: number;
  radiusMi: number;
  segments: AtrSegmentSummary[];
  // Provenance: which dataset(s) backed this summary. NYC studies
  // will be `nyc_dot_atr`; future state ingests get their own tag.
  source: string;
  totalSegmentsFound: number;
};

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
 * Find the nearest ATR segments within `radiusMi` of (lat, lon) that
 * have at least one count bin in the trailing `windowYears`. For
 * each, return AM/PM peak-hour volume and daily average computed
 * from the available bins.
 *
 * Caps the result set at `maxSegments` (default 8) — far more than
 * a typical TIS study area would have ATR coverage for, but lets a
 * larger query for diagnostic / coverage-map purposes scale.
 */
export async function atrSegmentsNearPoint(args: {
  lat: number;
  lon: number;
  radiusMi: number;
  windowYears: number;
  source?: string;
  maxSegments?: number;
}): Promise<AtrSummary> {
  // No default source. It used to default to "nyc_dot_atr", which silently made
  // every caller a NYC caller — the reason ingesting another metro would have
  // changed nothing. Callers resolve the source from the region instead
  // (atrSourceForRegion) and skip the query when there isn't one.
  const { lat, lon, radiusMi, windowYears, source } = args;
  if (!source) return { windowYears, radiusMi, segments: [], source: "", totalSegmentsFound: 0 };
  const maxSegments = args.maxSegments ?? 8;

  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - windowYears);
  const bbox = boundingBox(lat, lon, radiusMi);

  // Haversine — same pattern as crashes.ts so the DB doesn't need
  // PostGIS.
  const haversine = sql<number>`
    ${EARTH_RADIUS_MI} * acos(
      cos(radians(${lat})) *
      cos(radians(${atrCountsTable.latitude})) *
      cos(radians(${atrCountsTable.longitude}) - radians(${lon})) +
      sin(radians(${lat})) *
      sin(radians(${atrCountsTable.latitude}))
    )
  `;

  // Two queries:
  //   1. Discover which (segment_id, direction) pairs have any
  //      bins within radius and the trailing window.
  //   2. For each discovered pair, aggregate AM peak / PM peak /
  //      daily average from the per-15-min bins.
  // Could fold into one query with grouping but the resulting plan
  // gets ugly without PostGIS; two queries is clearer and the bin
  // table is indexed on (source_segment_id, direction).

  const segmentsRaw = await db
    .select({
      segmentId: atrCountsTable.sourceSegmentId,
      direction: atrCountsTable.direction,
      street: atrCountsTable.street,
      fromStreet: atrCountsTable.fromStreet,
      toStreet: atrCountsTable.toStreet,
      latitude: atrCountsTable.latitude,
      longitude: atrCountsTable.longitude,
      distance: haversine,
      latest: sql<Date>`max(${atrCountsTable.occurredAt})`,
      sampleDays: sql<number>`count(distinct date_trunc('day', ${atrCountsTable.occurredAt}))`,
    })
    .from(atrCountsTable)
    .where(
      and(
        sql`${atrCountsTable.source} = ${source}`,
        between(atrCountsTable.latitude, bbox.latMin, bbox.latMax),
        between(atrCountsTable.longitude, bbox.lonMin, bbox.lonMax),
        gte(atrCountsTable.occurredAt, since),
        sql`${haversine} <= ${radiusMi}`,
      ),
    )
    .groupBy(
      atrCountsTable.sourceSegmentId,
      atrCountsTable.direction,
      atrCountsTable.street,
      atrCountsTable.fromStreet,
      atrCountsTable.toStreet,
      atrCountsTable.latitude,
      atrCountsTable.longitude,
    )
    .orderBy(sql`${haversine} ASC`)
    .limit(maxSegments * 4); // 4× headroom for the per-segment volume aggregation

  if (segmentsRaw.length === 0) {
    return {
      windowYears,
      radiusMi,
      segments: [],
      source,
      totalSegmentsFound: 0,
    };
  }

  // For each unique (segment, direction), compute peak-hour volumes.
  // ATR bins are 15-min; we sum 4 consecutive bins to get an
  // hourly volume, take the max across the AM (7-9) and PM (4-6)
  // 2-hour windows for the canonical peak-hour estimate.
  const segments: AtrSegmentSummary[] = [];
  for (const r of segmentsRaw.slice(0, maxSegments)) {
    const peakRow = await db.execute<{
      am_peak: number | null;
      pm_peak: number | null;
      avg_daily: number | null;
    }>(sql`
      WITH hourly AS (
        SELECT
          date_trunc('hour', occurred_at) AS hour_start,
          extract(hour FROM occurred_at AT TIME ZONE 'America/New_York') AS local_hour,
          extract(dow FROM occurred_at AT TIME ZONE 'America/New_York') AS local_dow,
          sum(vol) AS hourly_vol
        FROM atr_counts
        WHERE source = ${source}
          AND source_segment_id = ${r.segmentId}
          AND direction = ${r.direction}
          AND occurred_at >= ${since}
        GROUP BY 1, 2, 3
      ),
      weekday_hourly AS (
        SELECT local_hour, hourly_vol FROM hourly WHERE local_dow BETWEEN 1 AND 5
      ),
      am_window AS (
        SELECT max(hourly_vol)::numeric AS peak FROM weekday_hourly WHERE local_hour BETWEEN 7 AND 9
      ),
      pm_window AS (
        SELECT max(hourly_vol)::numeric AS peak FROM weekday_hourly WHERE local_hour BETWEEN 16 AND 18
      ),
      daily AS (
        SELECT avg(daily_vol)::numeric AS avg_daily FROM (
          SELECT date_trunc('day', occurred_at AT TIME ZONE 'America/New_York') AS day, sum(vol) AS daily_vol
          FROM atr_counts
          WHERE source = ${source}
            AND source_segment_id = ${r.segmentId}
            AND direction = ${r.direction}
            AND occurred_at >= ${since}
          GROUP BY 1
        ) t
      )
      SELECT
        (SELECT peak FROM am_window) AS am_peak,
        (SELECT peak FROM pm_window) AS pm_peak,
        (SELECT avg_daily FROM daily) AS avg_daily
    `);

    const row = peakRow.rows[0] ?? { am_peak: null, pm_peak: null, avg_daily: null };

    segments.push({
      segmentId: r.segmentId,
      street: r.street,
      fromStreet: r.fromStreet,
      toStreet: r.toStreet,
      direction: r.direction ?? "—",
      latitude: r.latitude ?? 0,
      longitude: r.longitude ?? 0,
      distanceMi: Number(r.distance),
      // drizzle returns max(occurred_at) as the raw Postgres string for
      // some configurations; coerce defensively rather than asserting
      // it's a Date.
      latestCountDate: new Date(r.latest as unknown as string | Date).toISOString().slice(0, 10),
      sampleDays: Number(r.sampleDays ?? 0),
      amPeakHourVph: row.am_peak !== null ? Math.round(Number(row.am_peak)) : null,
      pmPeakHourVph: row.pm_peak !== null ? Math.round(Number(row.pm_peak)) : null,
      avgDailyVeh: row.avg_daily !== null ? Math.round(Number(row.avg_daily)) : null,
    });
  }

  return {
    windowYears,
    radiusMi,
    segments,
    source,
    totalSegmentsFound: segmentsRaw.length,
  };
}
