/**
 * Parking Demand Study engine — TEMPORARILY DISABLED.
 *
 * The previous parking-demand rate table reproduced a proprietary parking
 * generation manual and has been removed. The parking feature is being
 * migrated to a PUBLIC zoning-code basis (per-jurisdiction off-street
 * parking minimums published in municipal zoning ordinances). Until that
 * public-data table lands, the parking engine returns a clear "migrating /
 * temporarily unavailable" signal instead of computing a demand figure.
 *
 * `generateParkingReport` throws a typed `ParkingFeatureUnavailableError`
 * so the route handler can answer with an HTTP 503 + explanatory message
 * rather than a 500 / opaque crash. The empty `PARKING_LAND_USES` registry
 * keeps the `GET /parking/land-uses` listing responsive (empty list) while
 * the feature is disabled.
 */
import {
  type GenerateParkingBodyT,
  type GenerateParkingResponseT,
} from "@workspace/tis-api-zod";

/**
 * Public, user-facing message describing the migration state. Surfaced by
 * the route handler in the 503 body and reused anywhere the feature needs
 * to explain itself.
 */
export const PARKING_MIGRATION_MESSAGE =
  "Parking demand is being migrated to a public zoning-code basis and is temporarily unavailable. Trip-generation studies are unaffected.";

/**
 * Empty parking land-use registry. The proprietary parking-generation
 * table was removed; the public zoning-code replacement is not yet wired.
 * Kept as an exported empty array so the listing route stays responsive
 * (returns `[]`) and downstream callers don't crash on a missing import.
 */
export const PARKING_LAND_USES: never[] = [];

/**
 * Thrown by `generateParkingReport` while the parking feature is disabled.
 * The route handler catches this specifically and returns HTTP 503 with
 * `PARKING_MIGRATION_MESSAGE` rather than treating it as a server error.
 */
export class ParkingFeatureUnavailableError extends Error {
  constructor(message: string = PARKING_MIGRATION_MESSAGE) {
    super(message);
    this.name = "ParkingFeatureUnavailableError";
  }
}

// Retained for back-compat with any external catch sites; subclassing keeps
// `instanceof ParkingEngineError` true for the unavailable error.
export class ParkingEngineError extends Error {}

/**
 * Parking demand generation is disabled during the public-data migration.
 * Always throws `ParkingFeatureUnavailableError`; never computes a figure
 * from a proprietary rate. The route layer converts this to an HTTP 503.
 */
export function generateParkingReport(
  _body: GenerateParkingBodyT,
): GenerateParkingResponseT {
  throw new ParkingFeatureUnavailableError();
}
