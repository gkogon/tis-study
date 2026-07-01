import { Router, type IRouter } from "express";
import {
  GenerateTisBody,
  GenerateTisResponse,
  ListTisLandUsesResponse,
} from "@workspace/tis-api-zod";
import { generateTisReport, LAND_USES } from "../lib/tis";
import { validateDriveways } from "../lib/driveways";
import { regionForCoordinate, REGIONS } from "../lib/regions";
import { renderStudyPdf } from "../lib/pdf-export";
import { generateRateLimiter, tricsRateLimiter } from "../lib/security";
import { saveProject } from "../lib/tis-projects";
import {
  getOrCreateFirmForUser,
  reserveStudySlot,
  releaseStudySlot,
} from "../lib/firms";
import { logEvent } from "../lib/events";

const router: IRouter = Router();

/**
 * Covered cities/regions for the "Run a study → choose a city" picker.
 * Returns each active region with its centroid so the form can drop a
 * site at the city center and run with city-appropriate quick-start
 * presets — the same one-click flow the public demo offers per metro.
 */
router.get("/regions", (_req, res): void => {
  const regions = Object.values(REGIONS)
    .filter((r) => r.active !== false)
    .map((r) => ({
      code: r.code,
      displayName: r.displayName,
      stateCode: r.stateCode ?? null,
      country: r.country ?? "US",
      lat: Math.round(((r.bounds.latMin + r.bounds.latMax) / 2) * 1e4) / 1e4,
      lon: Math.round(((r.bounds.lonMin + r.bounds.lonMax) / 2) * 1e4) / 1e4,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  res.json({ regions });
});

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

  // Driveway validation is a pure client-input check (no I/O) — run it before
  // reserving a quota slot so a malformed driveway request never burns a paid
  // study credit.
  const drivewayErr = validateDriveways((parsed.data as any).driveways);
  if (drivewayErr) {
    res.status(422).json({ error: drivewayErr });
    return;
  }

  // Resolve user → firm (auto-creates personal firm on first hit).
  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const quota = await reserveStudySlot(firm, { email: user.email });
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
    // Bad-geocode guard: no signalized intersection within the study radius
    // (coordinate resolved to water / outside our signal coverage). Refund the
    // reserved slot — a study that couldn't be analyzed must not count toward
    // quota — and return a clear message instead of saving an empty report.
    if (report.coverageWarning) {
      await releaseStudySlot(firm, { email: user.email });
      res.status(422).json({
        error: report.coverageWarning.message,
        code: report.coverageWarning.code,
      });
      req.log.info(
        { lat: parsed.data.latitude, lon: parsed.data.longitude },
        "tis-generate.no_signals_in_radius",
      );
      return;
    }
    const validated = GenerateTisResponse.parse(report);
    const projectName =
      (parsed.data as { projectName?: string }).projectName?.trim()
      || `${validated.tripGeneration.landUseName} @ ${parsed.data.latitude.toFixed(4)}, ${parsed.data.longitude.toFixed(4)}`;
    // The quota slot was already reserved above (atomic, race-safe). Persist
    // the study; if the save fails we refund the slot below, honoring the
    // pricing-page promise that "if a generation errors out, it doesn't
    // count" — without ever letting two concurrent runs share the last slot.
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
      await releaseStudySlot(firm, { email: user.email });
      res.status(500).json({
        error: "Generated the study but couldn't save it to your history. Please retry — this attempt didn't count toward your quota.",
      });
      return;
    }
    logEvent("study_generated", {
      firmId: firm.id,
      userId: user.id,
      metadata: { studyType: "tis", landUseCode: parsed.data.landUseCode },
    });
    res.json(validated);
  } catch (e) {
    await releaseStudySlot(firm, { email: user.email });
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
    // Don't render an empty PDF for a bad geocode — surface the reason instead.
    if (report.coverageWarning) {
      res.status(422).json({
        error: report.coverageWarning.message,
        code: report.coverageWarning.code,
      });
      return;
    }
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
        firmId: firm.id,
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

// ---------------------------------------------------------------------------
// TRICS — public-by-URL, London-only TA generator (`/trics` page).
//
// Open to anyone who navigates to /trics. It is NOT linked from the site
// nav, so it is reachable only by typing the URL — "unlisted public", not
// access-controlled. Unlike the authenticated /generate (charges quota +
// saves a project), these endpoints save nothing and charge no quota; but
// because they are public AND run the full engine + a multi-page PDF
// render, they carry a dedicated `tricsRateLimiter` (3 requests/day per
// IP, admins/dev-auth exempt) so a prospect can try a couple of London
// sites but a competitor cannot farm the deliverable or grind our compute.
// Coordinates are hard-restricted to the Greater London metro, and
// anonymous renders get a neutral "Demo Preview" stamp (see /trics/pdf).
router.post("/trics/generate", tricsRateLimiter, async (req, res): Promise<void> => {
  const parsed = GenerateTisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid TIS request" });
    return;
  }
  const region = regionForCoordinate(parsed.data.latitude, parsed.data.longitude);
  if (!region || region.code !== "london_metro") {
    res.status(422).json({
      error: "The TRICS generator is London-only. Pick a site within Greater London.",
    });
    return;
  }
  try {
    const report = await generateTisReport(parsed.data);
    if (report.coverageWarning) {
      res.status(422).json({
        error: report.coverageWarning.message,
        code: report.coverageWarning.code,
      });
      return;
    }
    const validated = GenerateTisResponse.parse(report);
    res.json(validated);
  } catch (e) {
    req.log.error({ err: e }, "trics-generate failed");
    const msg = e instanceof Error ? e.message : String(e);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 400).json({ error: msg });
  }
});

router.post("/trics/pdf", tricsRateLimiter, async (req, res): Promise<void> => {
  const parsed = GenerateTisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid TIS request" });
    return;
  }
  const region = regionForCoordinate(parsed.data.latitude, parsed.data.longitude);
  if (!region || region.code !== "london_metro") {
    res.status(422).json({
      error: "The TRICS generator is London-only. Pick a site within Greater London.",
    });
    return;
  }
  // Signed-in users get their firm branding; anonymous public users get the
  // neutral demo-preview stamp (mirrors /demo/pdf) so an unbranded screening
  // render is never mistaken for a stamped consultant TA.
  let firmBranding: Parameters<typeof renderStudyPdf>[1];
  if (req.isAuthenticated() && req.user) {
    const { firm } = await getOrCreateFirmForUser(req.user.id, {
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
    });
    firmBranding = {
      name: firm.name,
      logoUrl: firm.logoUrl,
      brandColor: firm.brandColor,
      addressLine: firm.addressLine,
      phone: firm.phone,
      website: firm.website,
    };
  } else {
    firmBranding = { name: "Simple Impact Studies — Demo Preview", logoUrl: null };
  }
  try {
    const report = await generateTisReport(parsed.data);
    if (report.coverageWarning) {
      res.status(422).json({
        error: report.coverageWarning.message,
        code: report.coverageWarning.code,
      });
      return;
    }
    const validated = GenerateTisResponse.parse(report);
    const projectName =
      (parsed.data as { projectName?: string }).projectName?.trim()
      || `London TA @ ${parsed.data.latitude.toFixed(4)}, ${parsed.data.longitude.toFixed(4)}`;
    const pdf = await renderStudyPdf(
      {
        id: `trics-${Date.now()}`,
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
      firmBranding,
    );
    const safeName = projectName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "london-ta";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.send(pdf);
  } catch (e) {
    req.log.error({ err: e }, "trics-pdf failed");
    const msg = e instanceof Error ? e.message : String(e);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 400).json({ error: msg });
  }
});

export default router;
