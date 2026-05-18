/**
 * Public /demo endpoint. Lets a non-signed-in prospect run a real
 * TIS against a hardcoded preset (no arbitrary inputs accepted) and
 * see the full deliverable inline on /demo. Designed as a cold-
 * outreach conversion accelerator — prospects clicking through from
 * a cold email can feel the workflow in ~30 seconds without giving
 * us their email first.
 *
 * Constraints by design:
 *   - No auth required.
 *   - Rate-limited 3/day/IP (demoRateLimiter).
 *   - Only the curated PRESETS map below is accepted as input.
 *     Arbitrary coordinates / land uses would let scrapers probe
 *     intersections we haven't pre-validated.
 *   - The report is NOT saved to tis_projects. Anonymous demos
 *     don't pollute firm history or bump quota.
 *
 *   POST /tis-api/demo/generate  { presetId: keyof typeof PRESETS }
 */
import { Router, type IRouter } from "express";
import { generateTisReport } from "../lib/tis";
import { demoRateLimiter } from "../lib/security";
import { logEvent } from "../lib/events";

const router: IRouter = Router();

// Curated demo presets — realistic Atlanta projects covering the
// land-use types most representative of inbound prospect interest.
// Each preset must fall inside the Atlanta MSA bounds (lat 33.4-34.2,
// lon -84.9 to -83.9). Sized to produce visibly-impacted reports
// (>0 LOS drops) so the demo conveys value.
const PRESETS = {
  multifamily: {
    label: "Multifamily — 240-unit mid-rise (Midtown)",
    blurb: "ITE 221 · 240 dwelling units · Monte-Carlo sensitivity",
    request: {
      projectName: "Demo: Midtown Multifamily — 240 DU",
      address: "1100 Peachtree St NE, Atlanta GA 30309",
      latitude: 33.7858,
      longitude: -84.3848,
      landUseCode: "221",
      size: 240,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
  office: {
    label: "Office — 50,000 sqft Class A (Buckhead)",
    blurb: "ITE 710 · 50,000 sqft GFA · Monte-Carlo sensitivity",
    request: {
      projectName: "Demo: Buckhead Office — 50 ksf",
      address: "3060 Peachtree Rd NW, Atlanta GA 30305",
      latitude: 33.8390,
      longitude: -84.3795,
      landUseCode: "710",
      size: 50,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
  retail: {
    label: "Retail — 75,000 sqft shopping center",
    blurb: "ITE 820 · 75,000 sqft GLA · pass-by credit applied",
    request: {
      projectName: "Demo: West Midtown Retail — 75 ksf",
      address: "1100 Howell Mill Rd NW, Atlanta GA 30318",
      latitude: 33.7889,
      longitude: -84.4136,
      landUseCode: "820",
      size: 75,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
  drivethrough: {
    label: "Drive-Through Restaurant — 4,000 sqft (Cumberland)",
    blurb: "ITE 934 · 4,000 sqft GFA · high pass-by land use",
    request: {
      projectName: "Demo: Drive-Thru Restaurant",
      address: "2700 Cumberland Pkwy SE, Atlanta GA 30339",
      latitude: 33.8728,
      longitude: -84.4644,
      landUseCode: "934",
      size: 4,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
  subdivision: {
    label: "Single-Family Subdivision — 160 lots (Buckhead)",
    blurb: "ITE 210 · 160 dwelling units · Monte-Carlo sensitivity",
    request: {
      projectName: "Demo: Buckhead Subdivision — 160 lots",
      address: "2500 Piedmont Rd NE, Atlanta GA 30324",
      latitude: 33.8095,
      longitude: -84.3712,
      landUseCode: "210",
      size: 160,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
  hotel: {
    label: "Hotel — 220-room full-service (Downtown)",
    blurb: "ITE 310 · 220 rooms · Monte-Carlo sensitivity",
    request: {
      projectName: "Demo: Downtown Hotel — 220 rooms",
      address: "210 Peachtree St NW, Atlanta GA 30303",
      latitude: 33.7596,
      longitude: -84.3873,
      landUseCode: "310",
      size: 220,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
  medical: {
    label: "Medical Office — 65,000 sqft (Midtown)",
    blurb: "ITE 720 · 65,000 sqft GFA · Monte-Carlo sensitivity",
    request: {
      projectName: "Demo: Midtown Medical Office — 65 ksf",
      address: "550 Peachtree St NE, Atlanta GA 30308",
      latitude: 33.7825,
      longitude: -84.3855,
      landUseCode: "720",
      size: 65,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
  supermarket: {
    label: "Supermarket — 58,000 sqft grocery anchor (West Midtown)",
    blurb: "ITE 850 · 58,000 sqft GFA · high trip generator",
    request: {
      projectName: "Demo: West Midtown Supermarket — 58 ksf",
      address: "1380 Howell Mill Rd NW, Atlanta GA 30318",
      latitude: 33.7948,
      longitude: -84.4108,
      landUseCode: "850",
      size: 58,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
  restaurant: {
    label: "Sit-Down Restaurant — 11,000 sqft (Buckhead)",
    blurb: "ITE 932 · 11,000 sqft GFA · Monte-Carlo sensitivity",
    request: {
      projectName: "Demo: Buckhead Restaurant — 11 ksf",
      address: "3370 Peachtree Rd NE, Atlanta GA 30326",
      latitude: 33.8422,
      longitude: -84.3698,
      landUseCode: "932",
      size: 11,
      openingYear: 2027,
      studyRadiusMi: 0.75,
      growthRatePct: 1.5,
      weather: "clear" as const,
      runSensitivity: true,
    },
  },
} as const;

type PresetId = keyof typeof PRESETS;

function isPresetId(v: unknown): v is PresetId {
  return typeof v === "string" && v in PRESETS;
}

router.get("/demo/presets", (_req, res) => {
  // Surface preset metadata to the frontend without exposing the
  // raw lat/lon — the frontend just needs an id + label to render
  // the picker, and the server fills in the rest on submission.
  const out = (Object.keys(PRESETS) as PresetId[]).map((id) => ({
    id,
    label: PRESETS[id].label,
    blurb: PRESETS[id].blurb,
  }));
  res.json({ presets: out });
});

router.post("/demo/generate", demoRateLimiter, async (req, res): Promise<void> => {
  const body = (req.body as { presetId?: unknown }) ?? {};
  if (!isPresetId(body.presetId)) {
    res.status(400).json({ error: "Unknown preset." });
    return;
  }
  const preset = PRESETS[body.presetId];
  try {
    const report = await generateTisReport(preset.request);
    // Do not save to tis_projects; demo runs don't belong in firm
    // history. Do not call incrementStudyUsage — there's no firm.
    req.log.info(
      { presetId: body.presetId, intersectionCount: report.intersectionsStudied },
      "demo.completed",
    );
    logEvent("demo_run", {
      metadata: { presetId: body.presetId, intersections: report.intersectionsStudied },
    });
    res.json({
      presetId: body.presetId,
      presetLabel: preset.label,
      report,
    });
  } catch (err) {
    req.log.error({ err, presetId: body.presetId }, "demo.failed");
    const msg = err instanceof Error ? err.message : String(err);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 500).json({
      error: isUpstream
        ? "Live data feed is briefly slow. Try again in 30 seconds or sign up to be notified."
        : "Demo generation failed. Try a different preset or sign up.",
    });
  }
});

export default router;
