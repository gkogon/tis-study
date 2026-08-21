import { Router, type IRouter, type Request, type Response } from "express";
import {
  GenerateTisBody,
  GenerateTisResponse,
  ListTisLandUsesResponse,
  ParseUtdfFileBody,
  ParseUtdfFileResponse,
} from "@workspace/tis-api-zod";
import { generateTisReport, LAND_USES } from "../lib/tis";
import { parseUtdf } from "../lib/utdf-import";
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
  // `confidence` + `source` ride along so the land-use picker can show where a
  // rate came from. They used to be projected away here, which meant the one
  // screen where an engineer chooses a rate was also the one screen that hid
  // its provenance.
  const out = LAND_USES.map(({
    code, name, unit, unitShort, dailyRate, amRate, pmRate,
    amDirectionalIn, satMultiplier, passByPctPm, internalCapturePctPm,
    confidence, source,
  }) => ({
    code, name, unit, unitShort, dailyRate, amRate, pmRate,
    amDirectionalIn, satMultiplier, passByPctPm, internalCapturePctPm,
    confidence, source,
  }));
  res.json(ListTisLandUsesResponse.parse(out));
});

// Parse a Synchro UTDF file into structured intersections. The client reads
// the file with FileReader and posts its text (files are small — a corridor
// model is tens of KB; the schema caps at 2 MB), so no multipart machinery.
// The parsed node coordinates slot directly into additionalStudyPoints on a
// TIS request — the engineer's existing Synchro network defines the study
// scope via the force-include machinery that already ships.
router.post("/utdf/parse", (req, res): void => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to import a UTDF file." });
    return;
  }
  const body = ParseUtdfFileBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Provide the UTDF file text as { content }." });
    return;
  }
  const doc = parseUtdf(body.data.content);
  const withVolumes = new Set(doc.volumes.map((v) => v.intId));
  res.json(ParseUtdfFileResponse.parse({
    nodes: doc.nodes.map((n) => ({
      intId: n.intId,
      name: n.name,
      ...(n.latitude !== undefined ? { latitude: n.latitude } : {}),
      ...(n.longitude !== undefined ? { longitude: n.longitude } : {}),
      hasVolumes: withVolumes.has(n.intId),
    })),
    volumeIntersections: doc.volumes.length,
    laneIntersections: doc.lanes.length,
    timingIntersections: doc.timings.length,
    utdfIntersections: buildUtdfIntersectionRecords(doc),
    warnings: doc.warnings,
  }));
});

/**
 * Ready-to-attach measured records for the generate request: one per node
 * carrying BOTH lat/lon and a positive [Volumes] record. Coordinates are
 * rounded to 4 decimals here (server-side) so they line up exactly with the
 * client's additionalStudyPoints merge — one rounding rule, one place.
 * Values that would violate the UtdfIntersectionData schema bounds (a PHF
 * outside [0.25, 1], a cycle outside [30, 300]) are OMITTED rather than
 * clamped: a nonsense value from a malformed file should disappear, not be
 * silently rewritten into a plausible-looking measurement.
 */
function buildUtdfIntersectionRecords(doc: ReturnType<typeof parseUtdf>) {
  const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
  return doc.nodes.flatMap((n) => {
    if (n.latitude === undefined || n.longitude === undefined) return [];
    const vol = doc.volumes.find((v) => v.intId === n.intId);
    if (!vol) return [];
    const volumes: Record<string, number> = {};
    let total = 0;
    for (const [mv, v] of Object.entries(vol.movements)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        volumes[mv] = v;
        total += v;
      }
    }
    if (total <= 0) return [];
    // Representative (volume-weighted) PHF / heavy-vehicle % across the
    // movements that carry both a volume and a factor.
    const weighted = (rec?: Partial<Record<string, number>>): number | undefined => {
      if (!rec) return undefined;
      let num = 0, den = 0;
      for (const [mv, val] of Object.entries(rec)) {
        const w = volumes[mv];
        if (typeof val === "number" && Number.isFinite(val) && typeof w === "number" && w > 0) {
          num += val * w;
          den += w;
        }
      }
      return den > 0 ? num / den : undefined;
    };
    const phfRaw = weighted(vol.phf);
    const phf = phfRaw !== undefined && phfRaw >= 0.25 && phfRaw <= 1
      ? Math.round(phfRaw * 100) / 100 : undefined;
    const hvRaw = weighted(vol.heavyVehiclesPct);
    const hvPct = hvRaw !== undefined && hvRaw >= 0 && hvRaw <= 100
      ? Math.round(hvRaw * 10) / 10 : undefined;
    const laneRec = doc.lanes.find((l) => l.intId === n.intId);
    const storageFt: Record<string, number> = {};
    if (laneRec) {
      for (const [mv, info] of Object.entries(laneRec.movements)) {
        const s = info?.storageFt;
        if (typeof s === "number" && Number.isFinite(s) && s > 0) storageFt[mv] = s;
      }
    }
    const cyc = doc.timings.find((t) => t.intId === n.intId)?.cycleLengthS;
    const cycleLenSec = typeof cyc === "number" && cyc >= 30 && cyc <= 300 ? cyc : undefined;
    return [{
      intId: n.intId,
      ...(n.name ? { name: n.name } : {}),
      latitude: round4(n.latitude),
      longitude: round4(n.longitude),
      volumes,
      ...(phf !== undefined ? { phf } : {}),
      ...(hvPct !== undefined ? { hvPct } : {}),
      ...(Object.keys(storageFt).length > 0 ? { storageFt } : {}),
      ...(cycleLenSec !== undefined ? { cycleLenSec } : {}),
    }];
  });
}

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
      await releaseStudySlot(firm, { email: user.email, source: quota.source });
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
      await releaseStudySlot(firm, { email: user.email, source: quota.source });
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
    await releaseStudySlot(firm, { email: user.email, source: quota.source });
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
    // Demand map for coverage expansion: every rejected coordinate is a
    // prospect telling us where to wire next. Mirrors tis-generate above.
    req.log.info(
      { lat: parsed.data.latitude, lon: parsed.data.longitude },
      "tis-project.out_of_coverage",
    );
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
// London TA — public-by-URL, London-only TA generator (`/london-ta` page).
//
// Canonical paths are /london-ta/generate + /london-ta/pdf; the original
// /trics/* paths are kept as legacy aliases (same handlers registered on
// both) because sent cold emails link them. "TRICS" is TRICS Consortium
// Ltd's trademarked trip database — it must not be used as product
// identity, only nominatively ("a submitted TA would use licensed TRICS
// rates — we do not redistribute TRICS data").
//
// Open to anyone who navigates to the page. It is NOT linked from the site
// nav, so it is reachable only by typing the URL — "unlisted public", not
// access-controlled. Unlike the authenticated /generate (charges quota +
// saves a project), these endpoints save nothing and charge no quota; but
// because they are public AND run the full engine + a multi-page PDF
// render, they carry a dedicated `tricsRateLimiter` (3 requests/day per
// IP, admins/dev-auth exempt) so a prospect can try a couple of London
// sites but a competitor cannot farm the deliverable or grind our compute.
// Coordinates are hard-restricted to the Greater London metro, and
// anonymous renders get a neutral "Demo Preview" stamp (see the pdf
// handler below).
const londonTaGenerateHandler = async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateTisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid TIS request" });
    return;
  }
  const region = regionForCoordinate(parsed.data.latitude, parsed.data.longitude);
  if (!region || region.code !== "london_metro") {
    res.status(422).json({
      error: "The London TA generator is London-only. Pick a site within Greater London.",
    });
    return;
  }
  const drivewayErr = validateDriveways((parsed.data as any).driveways);
  if (drivewayErr) {
    res.status(422).json({ error: drivewayErr });
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
    req.log.error({ err: e }, "london-ta-generate failed");
    const msg = e instanceof Error ? e.message : String(e);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 400).json({ error: msg });
  }
};

const londonTaPdfHandler = async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateTisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid TIS request" });
    return;
  }
  const region = regionForCoordinate(parsed.data.latitude, parsed.data.longitude);
  if (!region || region.code !== "london_metro") {
    res.status(422).json({
      error: "The London TA generator is London-only. Pick a site within Greater London.",
    });
    return;
  }
  const drivewayErr = validateDriveways((parsed.data as any).driveways);
  if (drivewayErr) {
    res.status(422).json({ error: drivewayErr });
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
        id: `london-ta-${Date.now()}`,
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
    req.log.error({ err: e }, "london-ta-pdf failed");
    const msg = e instanceof Error ? e.message : String(e);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 400).json({ error: msg });
  }
};

// Canonical routes + legacy /trics/* aliases (old outbound links must keep
// working). Same handlers, same rate limiter — the limiter keys on IP, so
// hitting the alias and the canonical path draws from the same 3/day budget.
router.post("/london-ta/generate", tricsRateLimiter, londonTaGenerateHandler);
router.post("/trics/generate", tricsRateLimiter, londonTaGenerateHandler);
router.post("/london-ta/pdf", tricsRateLimiter, londonTaPdfHandler);
router.post("/trics/pdf", tricsRateLimiter, londonTaPdfHandler);

export default router;
