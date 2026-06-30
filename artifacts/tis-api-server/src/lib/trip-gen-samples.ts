/**
 * Trip-generation flywheel — fire-and-forget capture of every study's
 * trip-gen inputs + computed outputs + rate provenance into the
 * `trip_gen_samples` table.
 *
 * Modeled on lib/events.ts logEvent: callers do NOT await this, and it
 * swallows every error — capturing a sample must NEVER affect or slow a
 * user-facing study response. The point is to accumulate an owned dataset
 * (land use → size → location → trips → rate provenance) that the engine's
 * own, ITE-independent rates can be re-derived from once usage builds up.
 * See lib/db schema/trip-gen-samples.ts for the column catalogue.
 */
import { db, tripGenSamplesTable } from "@workspace/db";
import { logger } from "./logger";

export type TripGenSampleInput = {
  landUseCode: string;
  landUseName?: string | null;
  unit?: string | null;
  size?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  regionCode?: string | null;
  dailyTrips?: number | null;
  amTrips?: number | null;
  pmTrips?: number | null;
  rateConfidence?: string | null;
  rateSource?: string | null;
};

/**
 * Record one trip-generation sample. Intentionally returns void and
 * swallows all errors — the analytics/derivation log is never allowed to
 * break a study. Not awaited; the insert runs in the background.
 */
export function logTripGenSample(s: TripGenSampleInput): void {
  void db
    .insert(tripGenSamplesTable)
    .values({
      landUseCode: s.landUseCode,
      landUseName: s.landUseName ?? null,
      unit: s.unit ?? null,
      size: s.size ?? null,
      latitude: s.latitude ?? null,
      longitude: s.longitude ?? null,
      regionCode: s.regionCode ?? null,
      dailyTrips: s.dailyTrips ?? null,
      amTrips: s.amTrips ?? null,
      pmTrips: s.pmTrips ?? null,
      rateConfidence: s.rateConfidence ?? null,
      rateSource: s.rateSource ?? null,
    })
    .catch((err) => {
      logger.warn(
        { err, landUseCode: s.landUseCode },
        "trip_gen_sample.log_failed",
      );
    });
}
