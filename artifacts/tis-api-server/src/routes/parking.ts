/**
 * Parking Demand Study endpoints.
 *
 *   GET  /parking/land-uses        registry of ITE PG land uses + Atlanta code minimums
 *   POST /parking/generate         body: GenerateParkingBody → GenerateParkingResponse
 *
 * Shares quota + firm scoping with the TIS engine — every successful
 * generate counts against `firms.studies_used_this_period`.
 */
import { Router, type IRouter } from "express";
import {
  GenerateParkingBody,
  GenerateParkingResponse,
  ListParkingLandUsesResponse,
} from "@workspace/tis-api-zod";
import { generateParkingReport, PARKING_LAND_USES } from "../lib/parking";
import { generateRateLimiter } from "../lib/security";
import { saveProject } from "../lib/tis-projects";
import {
  getOrCreateFirmForUser,
  canGenerateStudy,
  incrementStudyUsage,
} from "../lib/firms";

const router: IRouter = Router();

router.get("/parking/land-uses", (_req, res): void => {
  res.json(ListParkingLandUsesResponse.parse(PARKING_LAND_USES));
});

router.post("/parking/generate", generateRateLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to generate a parking study." });
    return;
  }
  const user = req.user!;

  const parsed = GenerateParkingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid parking request" });
    req.log.warn({ issues: parsed.error.issues }, "parking-generate.invalid_body");
    return;
  }

  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const quota = canGenerateStudy(firm);
  if (!quota.ok) {
    res.status(402).json({
      error:
        "Your firm has used all studies in this billing period. Upgrade or add overage credits in Settings → Billing.",
      reason: quota.reason,
      limit: quota.limit,
      planTier: firm.planTier,
    });
    return;
  }

  try {
    const report = generateParkingReport(parsed.data);
    const validated = GenerateParkingResponse.parse(report);
    const projectName =
      parsed.data.projectName?.trim()
      || `${validated.landUse.name} — ${parsed.data.size} ${validated.landUse.unit}`;

    saveProject({
      userId: user.id,
      firmId: firm.id,
      studyType: "parking",
      projectName,
      landUseCode: parsed.data.landUseCode,
      landUseSize: parsed.data.size,
      siteLat: parsed.data.latitude ?? null,
      siteLon: parsed.data.longitude ?? null,
      request: parsed.data,
      result: validated,
    }).catch(() => {});
    incrementStudyUsage(firm.id).catch(() => {});
    res.json(validated);
  } catch (e) {
    req.log.error({ err: e }, "parking-generate failed");
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

export default router;
