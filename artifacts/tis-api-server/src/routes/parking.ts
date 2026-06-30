/**
 * Parking Demand Study endpoints — TEMPORARILY DISABLED.
 *
 *   GET  /parking/land-uses        returns an empty registry while the
 *                                  feature migrates to a public zoning-code
 *                                  basis (the proprietary parking-generation
 *                                  rate table was removed).
 *   POST /parking/generate         returns HTTP 503 + migration message; it
 *                                  does NOT consume a study-quota slot and
 *                                  does NOT crash.
 *
 * When a public zoning-code parking table is wired into `../lib/parking`,
 * restore the full generate flow (quota reservation + saveProject) below.
 */
import { Router, type IRouter } from "express";
import { ListParkingLandUsesResponse } from "@workspace/tis-api-zod";
import { PARKING_LAND_USES, PARKING_MIGRATION_MESSAGE } from "../lib/parking";
import { generateRateLimiter } from "../lib/security";

const router: IRouter = Router();

router.get("/parking/land-uses", (_req, res): void => {
  // Registry is intentionally empty during the public-data migration.
  res.json(ListParkingLandUsesResponse.parse(PARKING_LAND_USES));
});

router.post("/parking/generate", generateRateLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to generate a parking study." });
    return;
  }
  // Parking demand is disabled while it migrates to a public zoning-code
  // basis. Answer with a clear 503 (Service Unavailable) and DO NOT reserve
  // a quota slot, save a project, or throw — the feature is gated cleanly.
  res.status(503).json({
    error: PARKING_MIGRATION_MESSAGE,
    status: "feature_migrating",
  });
});

export default router;
