import { Router, type IRouter } from "express";
import {
  GenerateTisBody,
  GenerateTisResponse,
  ListTisLandUsesResponse,
} from "@workspace/tis-api-zod";
import { generateTisReport, LAND_USES } from "../lib/tis";
import { regionForCoordinate } from "../lib/regions";
import { renderStudyPdf } from "../lib/pdf-export";
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

  // Coverage guard. Coordinates are now globally valid (the OpenAPI bounds
  // were widened from Atlanta-only to -90/90, -180/180 so any city can be
  // studied), but the engine only has signal/road data for the covered
  // metros — outside them it would silently fall back to Atlanta region
  // parameters and emit a misleading report. Reject out-of-coverage sites
  // with a clear message instead, mirroring the demo route's guard.
  if (!regionForCoordinate(parsed.data.latitude, parsed.data.longitude)) {
    res.status(422).json({
      error:
        `Coordinates (${parsed.data.latitude.toFixed(4)}, ${parsed.data.longitude.toFixed(4)}) ` +
        `fall outside our covered metros. Pick a site inside a covered city — see the Cities page for the full list.`,
    });
    req.log.info(
      { lat: parsed.data.latitude, lon: parsed.data.longitude },
      "tis-generate.out_of_coverage",
    );
    return;
  }

  // Resolve user → firm (auto-creates personal firm on first hit).
  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const quota = canGenerateStudy(firm, { email: user.email });
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

/**
 * Server-rendered PDF for an authenticated study. This is the deliverable
 * the results-page export button should produce: it runs through
 * `renderStudyPdf`, which dispatches to the region-specific renderer
 * (e.g. FDOT MTSIH for Florida, NYSDOT HDM for New York, GA GRTA/ARC,
 * etc.) and applies firm branding — NOT the browser's print of the
 * generic on-screen HTML report. Render-only: the study was already
 * generated + quota-charged via POST /generate, so this neither saves
 * a project nor increments usage.
 */
router.post("/generate/pdf", generateRateLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to download a TIS." });
    return;
  }
  const user = req.user!;

  const parsed = GenerateTisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid TIS request" });
    return;
  }
  if (!regionForCoordinate(parsed.data.latitude, parsed.data.longitude)) {
    res.status(422).json({
      error:
        `Coordinates (${parsed.data.latitude.toFixed(4)}, ${parsed.data.longitude.toFixed(4)}) ` +
        `fall outside our covered metros.`,
    });
    return;
  }

  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  try {
    const report = await generateTisReport(parsed.data);
    const validated = GenerateTisResponse.parse(report);
    const projectName =
      (parsed.data as { projectName?: string }).projectName?.trim()
      || `${validated.tripGeneration.landUseName} @ ${parsed.data.latitude.toFixed(4)}, ${parsed.data.longitude.toFixed(4)}`;
    const pdf = await renderStudyPdf(
      {
        id: `live-${user.id}`,
        studyType: "tis",
        projectName,
        landUseCode: parsed.data.landUseCode,
        siteLat: String(parsed.data.latitude),
        siteLon: String(parsed.data.longitude),
        version: 1,
        createdAt: new Date(),
        requestPayload: parsed.data,
        resultPayload: validated,
      },
      {
        name: firm.name,
        logoUrl: firm.logoUrl,
        brandColor: firm.brandColor,
        addressLine: firm.addressLine,
        phone: firm.phone,
        website: firm.website,
      },
    );
    const safeName = projectName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "study";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.send(pdf);
  } catch (e) {
    req.log.error({ err: e }, "tis-generate-pdf failed");
    const msg = e instanceof Error ? e.message : String(e);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 400).json({ error: msg });
  }
});

export default router;
