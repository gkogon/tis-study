/**
 * Road-Diet Feasibility endpoint.
 *
 *   POST /road-diet/generate  body: GenerateRoadDietBody → GenerateRoadDietResponse
 */
import { Router, type IRouter } from "express";
import {
  GenerateRoadDietBody,
  GenerateRoadDietResponse,
} from "@workspace/tis-api-zod";
import { runRoadDietAnalysis } from "../lib/road-diet";
import { generateRateLimiter } from "../lib/security";
import { saveProject } from "../lib/tis-projects";
import {
  getOrCreateFirmForUser,
  canGenerateStudy,
  incrementStudyUsage,
} from "../lib/firms";
import { logEvent } from "../lib/events";

const router: IRouter = Router();

router.post(
  "/road-diet/generate",
  generateRateLimiter,
  async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Sign in to run a road-diet analysis." });
      return;
    }
    const user = req.user!;

    const parsed = GenerateRoadDietBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid road-diet request" });
      req.log.warn({ issues: parsed.error.issues }, "road-diet-generate.invalid_body");
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
      const report = runRoadDietAnalysis(parsed.data);
      const validated = GenerateRoadDietResponse.parse(report);
      // Persist FIRST, then charge quota — see TIS route note.
      const saved = await saveProject({
        userId: user.id,
        firmId: firm.id,
        studyType: "road_diet",
        projectName: parsed.data.projectName,
        landUseCode: parsed.data.proposedConfig,
        landUseSize: parsed.data.adt,
        siteLat: parsed.data.latitude ?? null,
        siteLon: parsed.data.longitude ?? null,
        request: parsed.data,
        result: validated,
      });
      if (!saved) {
        res.status(500).json({
          error: "Generated the study but couldn't save it to your history. Please retry — this attempt didn't count toward your quota.",
        });
        return;
      }
      await incrementStudyUsage(firm.id);
      logEvent("study_generated", {
        firmId: firm.id,
        userId: user.id,
        metadata: { studyType: "road_diet" },
      });
      res.json(validated);
    } catch (e) {
      req.log.error({ err: e }, "road-diet-generate failed");
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  },
);

export default router;
