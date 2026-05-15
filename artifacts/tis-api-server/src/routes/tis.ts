import { Router, type IRouter } from "express";
import {
  GenerateTisBody,
  GenerateTisResponse,
  ListTisLandUsesResponse,
} from "@workspace/tis-api-zod";
import { generateTisReport, LAND_USES } from "../lib/tis";
import { generateRateLimiter } from "../lib/security";
import { saveProject } from "../lib/tis-projects";
import {
  getOrCreateFirmForUser,
  canGenerateStudy,
  incrementStudyUsage,
} from "../lib/firms";
import { logEvent } from "../lib/events";

const router: IRouter = Router();

router.get("/land-uses", (_req, res): void => {
  const out = LAND_USES.map(({
    code, name, unit, unitShort, dailyRate, amRate, pmRate,
    amDirectionalIn, satMultiplier, passByPctPm, internalCapturePctPm,
  }) => ({
    code, name, unit, unitShort, dailyRate, amRate, pmRate,
    amDirectionalIn, satMultiplier, passByPctPm, internalCapturePctPm,
  }));
  res.json(ListTisLandUsesResponse.parse(out));
});

router.post("/generate", generateRateLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to generate a TIS." });
    return;
  }
  const user = req.user!;

  const parsed = GenerateTisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid TIS request" });
    req.log.warn({ issues: parsed.error.issues }, "tis-generate.invalid_body");
    return;
  }

  // Resolve user → firm (auto-creates personal firm on first hit).
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
    req.log.info(
      { firmId: firm.id, limit: quota.limit, planTier: firm.planTier },
      "tis-generate.quota_exceeded",
    );
    logEvent("quota_hit", {
      firmId: firm.id,
      userId: user.id,
      metadata: { studyType: "tis", limit: quota.limit, planTier: firm.planTier },
    });
    return;
  }

  try {
    const report = await generateTisReport(parsed.data);
    const validated = GenerateTisResponse.parse(report);
    const projectName =
      (parsed.data as { projectName?: string }).projectName?.trim()
      || `${validated.tripGeneration.landUseName} @ ${parsed.data.latitude.toFixed(4)}, ${parsed.data.longitude.toFixed(4)}`;
    // Persist FIRST, then charge quota. Honors the pricing-page promise
    // that "if a generation errors out, it doesn't count" — a silent
    // save failure used to bump quota without leaving a row in
    // /projects, so users retried and burned through their trial early.
    const saved = await saveProject({
      userId: user.id,
      firmId: firm.id,
      studyType: "tis",
      projectName,
      landUseCode: parsed.data.landUseCode,
      landUseSize: parsed.data.size,
      siteLat: parsed.data.latitude,
      siteLon: parsed.data.longitude,
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
      metadata: { studyType: "tis", landUseCode: parsed.data.landUseCode },
    });
    res.json(validated);
  } catch (e) {
    req.log.error({ err: e }, "tis-generate failed");
    const msg = e instanceof Error ? e.message : String(e);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 400).json({ error: msg });
  }
});

export default router;
