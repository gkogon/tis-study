/**
 * Signal Warrant Analysis endpoint (MUTCD Ch. 4C).
 *
 *   POST /warrants/generate  body: GenerateWarrantsBody → GenerateWarrantsResponse
 *
 * Shares quota + firm scoping with the TIS and Parking engines —
 * every successful generate counts against `firms.studies_used_this_period`.
 */
import { Router, type IRouter } from "express";
import {
  GenerateWarrantsBody,
  GenerateWarrantsResponse,
} from "@workspace/tis-api-zod";
import { runWarrantsAnalysis } from "../lib/warrants";
import { generateRateLimiter } from "../lib/security";
import { saveProject } from "../lib/tis-projects";
import {
  getOrCreateFirmForUser,
  canGenerateStudy,
  incrementStudyUsage,
} from "../lib/firms";

const router: IRouter = Router();

router.post(
  "/warrants/generate",
  generateRateLimiter,
  async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Sign in to run a warrant analysis." });
      return;
    }
    const user = req.user!;

    const parsed = GenerateWarrantsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid warrants request" });
      req.log.warn({ issues: parsed.error.issues }, "warrants-generate.invalid_body");
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
      const report = runWarrantsAnalysis(parsed.data);
      const validated = GenerateWarrantsResponse.parse(report);

      // Persist FIRST, then charge quota — see TIS route note.
      const saved = await saveProject({
        userId: user.id,
        firmId: firm.id,
        studyType: "warrants",
        projectName: parsed.data.projectName,
        // No ITE land-use code on a warrant study; reuse the column as
        // the lane-config key for compactness.
        landUseCode: `${parsed.data.majorStreet.lanesEachDirection}x${parsed.data.minorStreet.lanesEachDirection}`,
        landUseSize: 0,
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
      req.log.error({ err: e }, "warrants-generate failed");
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  },
);

export default router;
