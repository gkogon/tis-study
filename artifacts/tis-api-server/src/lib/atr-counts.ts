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
  // FHWA TMAS — the national continuous-count feed. One adapter, 49 reporting
  // states. Used wherever there is no fresher state-specific feed: NY keeps
  // nyc_dot_atr (through 2026-02) and FL keeps fdot_tda (rolling 365 days),
  // because TMAS's latest published year is 2023.
  //
  // NEW JERSEY: reachable, but only through the archive. NJ stopped reporting to
  // TMAS after 2020 (2023/2022/2021 all return zero rows), so the ingest pulls
  // its 2019 data — the last clean pre-COVID year — for the Trenton stations.
  // That is why the TMAS lookback window is 10 years and why the block states
  // its vintage in prose. NJ's own feed is AADT-only and stale since 2024-03,
  // and njtms.org 403s all programmatic access.
  GA: "fhwa_tmas",
  TX: "fhwa_tmas",
  CA: "fhwa_tmas",
  PA: "fhwa_tmas",
  MD: "fhwa_tmas",
  NC: "fhwa_tmas",
  SC: "fhwa_tmas",
  NJ: "fhwa_tmas",
};

/**
 * IANA zone used to bucket an ATR bin into a LOCAL hour.
 *
 * The peak-hour SQL used to hardcode America/New_York, which was correct while
 * the only feeds were NYC DOT and FDOT. A national feed breaks that: a 08:00
 * California peak read in Eastern lands at 11:00 and misses the 7-9 AM window
 * entirely, so the "AM peak" column would print a mid-morning volume.
 *
 * Keyed by region first for the two states that straddle a boundary (El Paso is
 * Mountain in an otherwise Central state; the Florida panhandle is Central in an
 * otherwise Eastern one), then by state. Default stays Eastern so NY and FL
 * results are unchanged.
 */
const ATR_TZ_BY_REGION: Record<string, string> = {
  el_paso_metro: "America/Denver",
  pensacola_metro: "America/Chicago",
};
const ATR_TZ_BY_STATE: Record<string, string> = {
  CA: "America/Los_Angeles",
  TX: "America/Chicago",
};
export const ATR_DEFAULT_TZ = "America/New_York";

export function atrTimeZoneForRegion(
  region: { code?: string | null; stateCode?: string | null } | null | undefined,
): string {
  if (!region) return ATR_DEFAULT_TZ;
  const byRegion = region.code ? ATR_TZ_BY_REGION[region.code] : undefined;
  if (byRegion) return byRegion;
  return (region.stateCode ? ATR_TZ_BY_STATE[region.stateCode] : undefined) ?? ATR_DEFAULT_TZ;
}

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

/**
 * Search radius by source. Count programs differ in KIND, not just coverage.
 *
 * NYC DOT and FDOT run dense local/short-count programs — a station within a
 * mile is plausibly on a study approach. FHWA TMAS is the national CONTINUOUS
 * COUNT STATION network: permanent highway stations, roughly one per major
 * corridor. Measured nearest-station distance from real metro sites: Charlotte
 * 0.79 mi, Charleston 2.23, Atlanta 3.27, Baltimore 4.71, LA 5.66, Dallas 10.98,
 * Philadelphia 12.00. At 1.0 mi TMAS would essentially never return a row.
 *
 * 3.0 mi is the compromise: far enough to find the corridor station, near enough
 * that it is still the same traffic shed. It is NOT widened further, because a
 * count twelve miles away on a different facility tells a reviewer nothing about
 * the study intersection, and printing it under a "measured" heading would be a
 * worse failure than printing nothing.
 */
const ATR_RADIUS_MI_BY_SOURCE: Record<string, number> = {
  fhwa_tmas: 3.0,
};
export const ATR_DEFAULT_RADIUS_MI = 1.0;
export function atrRadiusForSource(source: string | null | undefined): number {
  return (source ? ATR_RADIUS_MI_BY_SOURCE[source] : undefined) ?? ATR_DEFAULT_RADIUS_MI;
}

/**
 * Lookback window by source.
 *
 * ⚠️ A THREE-YEAR DEFAULT IS A TIME BOMB FOR HISTORICAL SOURCES. The TMAS bins
 * are from October 2023; as of this writing they are 2.9 years old and inside
 * the window by weeks. Left at 3 years, every TMAS count would silently vanish
 * from every report — no error, no empty section, just a block that stops
 * appearing — and New Jersey's only usable data (2019, the last year it reported)
 * could never appear at all.
 *
 * TMAS is a historical archive by nature, so it gets a decade. The vintage is not
 * hidden: the block prints each station's actual count date, and old data is
 * labelled as such in the prose.
 */
const ATR_WINDOW_YEARS_BY_SOURCE: Record<string, number> = {
  fhwa_tmas: 10,
};
export const ATR_DEFAULT_WINDOW_YEARS = 3;
export function atrWindowYearsForSource(source: string | null | undefined): number {
  return (source ? ATR_WINDOW_YEARS_BY_SOURCE[source] : undefined) ?? ATR_DEFAULT_WINDOW_YEARS;
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
  /** IANA zone for local-hour bucketing; see atrTimeZoneForRegion. */
  timeZone?: string;
}): Promise<AtrSummary> {
  // No default source. It used to default to "nyc_dot_atr", which silently made
  // every caller a NYC caller — the reason ingesting another metro would have
  // changed nothing. Callers resolve the source from the region instead
  // (atrSourceForRegion) and skip the query when there isn't one.
  const { lat, lon, radiusMi, windowYears, source } = args;
  const tz = args.timeZone ?? ATR_DEFAULT_TZ;
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
      // Both of these are bucketed in the STUDY's local zone, not UTC. In UTC a
      // three-day midweek count spills into a fourth calendar day the moment it
      // includes an evening hour (23:00 EDT on Oct 5 is 03:00 UTC on Oct 6), so
      // `sampleDays` over-reported 4 for a 3-day count and `latestCountDate`
      // printed a day the count never covered. Both are printed to a reviewing
      // engineer as evidence of how much observation backs the number, so an
      // inflated count is exactly the wrong error to make.
      latest: sql<string>`to_char(max(${atrCountsTable.occurredAt}) AT TIME ZONE ${tz}, 'YYYY-MM-DD')`,
      sampleDays: sql<number>`count(distinct date_trunc('day', ${atrCountsTable.occurredAt} AT TIME ZONE ${tz}))`,
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
          extract(hour FROM occurred_at AT TIME ZONE ${tz}) AS local_hour,
          extract(dow FROM occurred_at AT TIME ZONE ${tz}) AS local_dow,
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
          SELECT date_trunc('day', occurred_at AT TIME ZONE ${tz}) AS day, sum(vol) AS daily_vol
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
      // Already a local-zone 'YYYY-MM-DD' string from SQL; re-parsing it through
      // Date would push it back into UTC and undo the fix above.
      latestCountDate: String(r.latest ?? "").slice(0, 10),
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
