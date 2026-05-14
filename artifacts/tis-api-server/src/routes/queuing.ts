/**
 * Queuing Analysis endpoint (HCM Ch. 31).
 *
 *   POST /queuing/generate  body: GenerateQueuingBody → GenerateQueuingResponse
 */
import { Router, type IRouter } from "express";
import {
  GenerateQueuingBody,
  GenerateQueuingResponse,
} from "@workspace/tis-api-zod";
import { runQueuingAnalysis } from "../lib/queuing";
import { generateRateLimiter } from "../lib/security";
import { saveProject } from "../lib/tis-projects";
import {
  getOrCreateFirmForUser,
  canGenerateStudy,
  incrementStudyUsage,
} from "../lib/firms";

const router: IRouter = Router();

router.post(
  "/queuing/generate",
  generateRateLimiter,
  async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Sign in to run a queuing analysis." });
      return;
    }
    const user = req.user!;

    const parsed = GenerateQueuingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid queuing request" });
      req.log.warn({ issues: parsed.error.issues }, "queuing-generate.invalid_body");
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
      const report = runQueuingAnalysis(parsed.data);
      const validated = GenerateQueuingResponse.parse(report);
      // Persist FIRST, then charge quota — see TIS route note.
      const saved = await saveProject({
        userId: user.id,
        firmId: firm.id,
        studyType: "queuing",
        projectName: parsed.data.projectName,
        landUseCode: parsed.data.movement,
        landUseSize: parsed.data.hourlyVolumeVph,
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
      res.json(validated);
    } catch (e) {
      req.log.error({ err: e }, "queuing-generate failed");
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  },
);

export default router;
