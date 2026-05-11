/**
 * Sight Distance Analysis endpoint (AASHTO Green Book 7th Ed.).
 *
 *   POST /sight-distance/generate  body: GenerateSightDistanceBody →
 *                                  GenerateSightDistanceResponse
 *
 * Shares quota + firm scoping with the other engines.
 */
import { Router, type IRouter } from "express";
import {
  GenerateSightDistanceBody,
  GenerateSightDistanceResponse,
} from "@workspace/tis-api-zod";
import { runSightDistanceAnalysis } from "../lib/sight-distance";
import { generateRateLimiter } from "../lib/security";
import { saveProject } from "../lib/tis-projects";
import {
  getOrCreateFirmForUser,
  canGenerateStudy,
  incrementStudyUsage,
} from "../lib/firms";

const router: IRouter = Router();

router.post(
  "/sight-distance/generate",
  generateRateLimiter,
  async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Sign in to run a sight-distance analysis." });
      return;
    }
    const user = req.user!;

    const parsed = GenerateSightDistanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid sight-distance request" });
      req.log.warn(
        { issues: parsed.error.issues },
        "sight-distance-generate.invalid_body",
      );
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
      const report = runSightDistanceAnalysis(parsed.data);
      const validated = GenerateSightDistanceResponse.parse(report);

      saveProject({
        userId: user.id,
        firmId: firm.id,
        studyType: "sight_distance",
        projectName: parsed.data.projectName,
        // Re-use landUseCode for the maneuver type so listing pages can
        // surface a compact label.
        landUseCode: parsed.data.maneuver,
        landUseSize: parsed.data.majorStreet.designSpeedMph,
        siteLat: parsed.data.latitude ?? null,
        siteLon: parsed.data.longitude ?? null,
        request: parsed.data,
        result: validated,
      }).catch(() => {});
      incrementStudyUsage(firm.id).catch(() => {});
      res.json(validated);
    } catch (e) {
      req.log.error({ err: e }, "sight-distance-generate failed");
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  },
);

export default router;
