/**
 * Public /demo endpoint. Lets a non-signed-in prospect run a real
 * TIS against arbitrary coordinates inside the Atlanta MSA and see
 * the full deliverable inline on /demo. Designed as a cold-outreach
 * conversion accelerator — prospects clicking through from a cold
 * email can feel the workflow in ~30 seconds without giving us their
 * email first.
 *
 * Constraints by design:
 *   - No auth required.
 *   - Rate-limited 3/day/IP (demoRateLimiter).
 *   - Coordinates must fall inside the Atlanta MSA bounding box
 *     (lat 33.4–34.2, lon -84.9 to -83.9). Outside that the engine
 *     has no signal/intersection data to study against.
 *   - Land-use code must be a known ITE 11th Ed. code from LAND_USES.
 *   - Size capped at 10,000 (DU / ksf / rooms / beds, depending on
 *     the land use) to defeat probing for absurd impact reports.
 *   - studyRadiusMi capped at 1.5 mi for demo runs (vs the 6.5 mi
 *     ceiling on authenticated studies) — keeps demo latency tight
 *     and limits scrape-the-metro-via-demo attacks.
 *   - The report is NOT saved to tis_projects. Anonymous demos don't
 *     pollute firm history or bump quota.
 *
 *   GET  /tis-api/demo/landuses   → { landUses: [{code,name,unit,unitShort}] }
 *   GET  /tis-api/demo/presets    → { presets: [{ id, label, blurb, prefill }] }
 *   POST /tis-api/demo/generate   → { projectName, latitude, longitude,
 *                                     landUseCode, size, openingYear?,
 *                                     studyRadiusMi?, address?, projectName? }
 */
import { Router, type IRouter } from "express";
import { generateTisReport, type TisRequest } from "../lib/tis";
import { LAND_USES } from "../lib/land-uses";
import { demoRateLimiter } from "../lib/security";
import { logEvent } from "../lib/events";

const router: IRouter = Router();

// Atlanta MSA bounding box — the analyzer / GDOT data is only useful
// inside this rectangle. Mirrors the openapi study-area bounds.
const ATL_LAT_MIN = 33.4;
const ATL_LAT_MAX = 34.2;
const ATL_LON_MIN = -84.9;
const ATL_LON_MAX = -83.9;

const DEMO_RADIUS_MAX_MI = 1.5;
const SIZE_MAX = 10_000;

// Quick-start examples. Surfaced via /demo/presets so the frontend
// can render click-to-fill buttons. The full request payload is
// exposed (latitude / longitude / landUseCode / size / projectName) —
// the demo is now free-form, so there's no scraper risk to hiding
// these coordinates.
const PRESETS = {
  multifamily: {
    label: "Multifamily — 240-unit mid-rise (Midtown)",
    blurb: "ITE 221 · 240 dwelling units",
    prefill: {
      projectName: "Demo: Midtown Multifamily — 240 DU",
      latitude: 33.7858,
      longitude: -84.3848,
      landUseCode: "221",
      size: 240,
    },
  },
  office: {
    label: "Office — 50,000 sqft Class A (Buckhead)",
    blurb: "ITE 710 · 50,000 sqft GFA",
    prefill: {
      projectName: "Demo: Buckhead Office — 50 ksf",
      latitude: 33.8390,
      longitude: -84.3795,
      landUseCode: "710",
      size: 50,
    },
  },
  retail: {
    label: "Retail — 75,000 sqft shopping center",
    blurb: "ITE 820 · 75,000 sqft GLA · pass-by applied",
    prefill: {
      projectName: "Demo: West Midtown Retail — 75 ksf",
      latitude: 33.7889,
      longitude: -84.4136,
      landUseCode: "820",
      size: 75,
    },
  },
  drivethrough: {
    label: "Drive-Through Restaurant — 4,000 sqft (Cumberland)",
    blurb: "ITE 934 · 4,000 sqft GFA",
    prefill: {
      projectName: "Demo: Drive-Thru Restaurant",
      latitude: 33.8728,
      longitude: -84.4644,
      landUseCode: "934",
      size: 4,
    },
  },
  subdivision: {
    label: "Single-Family Subdivision — 160 lots (Buckhead)",
    blurb: "ITE 210 · 160 dwelling units",
    prefill: {
      projectName: "Demo: Buckhead Subdivision — 160 lots",
      latitude: 33.8095,
      longitude: -84.3712,
      landUseCode: "210",
      size: 160,
    },
  },
  hotel: {
    label: "Hotel — 240-room full-service (Midtown)",
    blurb: "ITE 310 · 240 rooms",
    prefill: {
      projectName: "Demo: Midtown Hotel — 240 rooms",
      latitude: 33.7866,
      longitude: -84.3852,
      landUseCode: "310",
      size: 240,
    },
  },
  medical: {
    label: "Medical Office — 65,000 sqft (Midtown)",
    blurb: "ITE 720 · 65,000 sqft GFA",
    prefill: {
      projectName: "Demo: Midtown Medical Office — 65 ksf",
      latitude: 33.7825,
      longitude: -84.3855,
      landUseCode: "720",
      size: 65,
    },
  },
  supermarket: {
    label: "Supermarket — 65,000 sqft grocery anchor",
    blurb: "ITE 850 · 65,000 sqft GFA",
    prefill: {
      projectName: "Demo: West Midtown Supermarket — 65 ksf",
      latitude: 33.7892,
      longitude: -84.4130,
      landUseCode: "850",
      size: 65,
    },
  },
  restaurant: {
    label: "Sit-Down Restaurant — 11,000 sqft (Buckhead)",
    blurb: "ITE 932 · 11,000 sqft GFA",
    prefill: {
      projectName: "Demo: Buckhead Restaurant — 11 ksf",
      latitude: 33.8422,
      longitude: -84.3698,
      landUseCode: "932",
      size: 11,
    },
  },
} as const;

router.get("/demo/landuses", (_req, res) => {
  res.json({
    landUses: LAND_USES.map((lu) => ({
      code: lu.code,
      name: lu.name,
      unit: lu.unit,
      unitShort: lu.unitShort,
    })),
  });
});

router.get("/demo/presets", (_req, res) => {
  const out = (Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((id) => ({
    id,
    label: PRESETS[id].label,
    blurb: PRESETS[id].blurb,
    prefill: PRESETS[id].prefill,
  }));
  res.json({ presets: out });
});

router.post("/demo/generate", demoRateLimiter, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // ---------- parse + coerce ----------
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const landUseCode = typeof body.landUseCode === "string" ? body.landUseCode.trim() : "";
  const size = Number(body.size);
  const currentYear = new Date().getFullYear();
  const openingYearRaw = body.openingYear === undefined ? currentYear + 1 : Number(body.openingYear);
  const openingYear = Number.isFinite(openingYearRaw) ? Math.trunc(openingYearRaw) : currentYear + 1;
  const studyRadiusRaw = body.studyRadiusMi === undefined ? 0.75 : Number(body.studyRadiusMi);
  const studyRadiusMi = Number.isFinite(studyRadiusRaw)
    ? Math.min(DEMO_RADIUS_MAX_MI, Math.max(0.25, studyRadiusRaw))
    : 0.75;
  const projectNameRaw = typeof body.projectName === "string" ? body.projectName.trim() : "";
  const addressRaw = typeof body.address === "string" ? body.address.trim() : "";

  // ---------- validate ----------
  if (!Number.isFinite(latitude) || latitude < ATL_LAT_MIN || latitude > ATL_LAT_MAX) {
    res.status(400).json({
      error: `Latitude must be between ${ATL_LAT_MIN} and ${ATL_LAT_MAX} (Atlanta MSA).`,
    });
    return;
  }
  if (!Number.isFinite(longitude) || longitude < ATL_LON_MIN || longitude > ATL_LON_MAX) {
    res.status(400).json({
      error: `Longitude must be between ${ATL_LON_MIN} and ${ATL_LON_MAX} (Atlanta MSA).`,
    });
    return;
  }
  const landUse = LAND_USES.find((lu) => lu.code === landUseCode);
  if (!landUse) {
    res.status(400).json({ error: `Unknown ITE land-use code: "${landUseCode}".` });
    return;
  }
  if (!Number.isFinite(size) || size <= 0 || size > SIZE_MAX) {
    res.status(400).json({
      error: `Project size must be between 0 and ${SIZE_MAX} ${landUse.unitShort}.`,
    });
    return;
  }
  if (openingYear < currentYear - 1 || openingYear > currentYear + 30) {
    res.status(400).json({
      error: `Opening year must be between ${currentYear - 1} and ${currentYear + 30}.`,
    });
    return;
  }

  // ---------- build request ----------
  const projectName =
    projectNameRaw ||
    `Demo: ${landUse.name} @ ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  const address = addressRaw || `Custom site (${latitude.toFixed(4)}, ${longitude.toFixed(4)}), Atlanta MSA`;

  const request: TisRequest = {
    projectName,
    address,
    latitude,
    longitude,
    landUseCode,
    size,
    openingYear,
    studyRadiusMi,
    growthRatePct: 1.5,
    weather: "clear",
    runSensitivity: true,
  };

  try {
    const report = await generateTisReport(request);
    req.log.info(
      { landUseCode, intersectionCount: report.intersectionsStudied },
      "demo.completed",
    );
    logEvent("demo_run", {
      metadata: {
        mode: "freeform",
        landUseCode,
        lat: latitude.toFixed(4),
        lon: longitude.toFixed(4),
        size,
        intersections: report.intersectionsStudied,
      },
    });
    res.json({
      projectName,
      latitude,
      longitude,
      landUseCode,
      landUseName: landUse.name,
      landUseUnitShort: landUse.unitShort,
      size,
      openingYear,
      studyRadiusMi,
      report,
    });
  } catch (err) {
    req.log.error({ err, landUseCode }, "demo.failed");
    const msg = err instanceof Error ? err.message : String(err);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 500).json({
      error: isUpstream
        ? "Live data feed is briefly slow. Try again in 30 seconds or sign up to be notified."
        : "Demo generation failed. Check your inputs or sign up to run on a custom site.",
    });
  }
});

export default router;
