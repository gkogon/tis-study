/**
 * Public /demo endpoint. Lets a non-signed-in prospect run a real
 * TIS against arbitrary coordinates inside any of our 300 indexed
 * metros worldwide and see the full deliverable inline on /demo.
 * Designed as a cold-outreach conversion accelerator — prospects
 * clicking through from a cold email can feel the workflow in
 * ~30 seconds without giving us their email first.
 *
 * Constraints by design:
 *   - No auth required.
 *   - Rate-limited 3/day/IP (demoRateLimiter).
 *   - Coordinates must fall inside the bounding box of one of our
 *     300 active regions (regionForCoordinate). Outside that the
 *     engine has no signal/intersection data to study against.
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
import { demoRateLimiter, geocodeRateLimiter } from "../lib/security";
import { logEvent } from "../lib/events";
import { renderStudyPdf } from "../lib/pdf-export";
import { regionForCoordinate, nearestRegionForCoordinate, type Region } from "../lib/regions";
import { clientIpFromRequest, geolocateIp } from "../lib/ip-geolocate";

const router: IRouter = Router();

const DEMO_RADIUS_MAX_MI = 3;
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
  // Global examples — one per continent. Useful to demonstrate that
  // the same engine runs anywhere in our 300-metro footprint.
  global_paris: {
    label: "Office — 50,000 sqft Paris (Le Marais)",
    blurb: "ITE 710 · 50 ksf · Paris Open Data + synthetic AADT",
    prefill: {
      projectName: "Demo: Paris Office — 50 ksf",
      latitude: 48.8566,
      longitude: 2.3522,
      landUseCode: "710",
      size: 50,
    },
  },
  global_london: {
    label: "Multifamily — 200 units London (Shoreditch)",
    blurb: "ITE 221 · 200 DU · DfT calibrated counts",
    prefill: {
      projectName: "Demo: London Multifamily — 200 DU",
      latitude: 51.5238,
      longitude: -0.0772,
      landUseCode: "221",
      size: 200,
    },
  },
  global_tokyo: {
    label: "Retail — 75,000 sqft Tokyo (Shibuya)",
    blurb: "ITE 820 · 75 ksf · synthetic AADT (OSM road-class baseline)",
    prefill: {
      projectName: "Demo: Tokyo Retail — 75 ksf",
      latitude: 35.6595,
      longitude: 139.7005,
      landUseCode: "820",
      size: 75,
    },
  },
  global_sydney: {
    label: "Hotel — 240 rooms Sydney (CBD)",
    blurb: "ITE 310 · 240 rooms · synthetic AADT",
    prefill: {
      projectName: "Demo: Sydney Hotel — 240 rooms",
      latitude: -33.8688,
      longitude: 151.2093,
      landUseCode: "310",
      size: 240,
    },
  },
} as const;

router.get("/demo/landuses", (_req, res) => {
  // Surface secondaryVariables so the demo form can render the unit picker
  // for codes that accept more than one independent variable (ITE TGM 11th).
  // Each variable carries enough metadata (unit label, short label, confidence
  // tier, engineering note) that the form can show "Did you mean per-employee?"
  // and the PDF can later record exactly which assumption shipped.
  res.json({
    landUses: LAND_USES.map((lu) => ({
      code: lu.code,
      name: lu.name,
      unit: lu.unit,
      unitShort: lu.unitShort,
      secondaryVariables: (lu.secondaryVariables ?? []).map((v) => ({
        unit: v.unit,
        unitShort: v.unitShort,
        confidence: v.confidence,
        note: v.note,
      })),
    })),
  });
});

// Quick-fill demo land uses (ITE codes) for the localized presets.
// Picked to span the four most-pitched site types in cold-outreach
// conversations: residential density, office, retail, hospitality.
const LOCALIZED_LAND_USES: Array<{ code: string; sizeUnitsLabel: string; size: number; verb: string; icon: string }> = [
  { code: "221", sizeUnitsLabel: "DU", size: 200, verb: "Multifamily", icon: "multifamily" },
  { code: "710", sizeUnitsLabel: "ksf", size: 50, verb: "Office", icon: "office" },
  { code: "820", sizeUnitsLabel: "ksf", size: 75, verb: "Retail", icon: "retail" },
  { code: "310", sizeUnitsLabel: "rooms", size: 200, verb: "Hotel", icon: "hotel" },
];

function regionCentroid(region: Region): { lat: number; lon: number } {
  return {
    lat: (region.bounds.latMin + region.bounds.latMax) / 2,
    lon: (region.bounds.lonMin + region.bounds.lonMax) / 2,
  };
}

function buildLocalizedPresets(region: Region): Array<{ id: string; label: string; blurb: string; prefill: { projectName: string; latitude: number; longitude: number; landUseCode: string; size: number } }> {
  const c = regionCentroid(region);
  // Stagger each preset slightly off the centroid so multiple submissions
  // don't all hit the exact same intersection. Δ ~0.005° ≈ 500m at most
  // latitudes — keeps the site inside the metro bbox but produces a
  // realistically distinct study site per land use.
  const offsets = [
    { dLat: 0, dLon: 0 },
    { dLat: 0.003, dLon: 0.004 },
    { dLat: -0.004, dLon: 0.003 },
    { dLat: 0.002, dLon: -0.005 },
  ];
  return LOCALIZED_LAND_USES.map((lu, i) => {
    const o = offsets[i] ?? { dLat: 0, dLon: 0 };
    return {
      id: `local_${region.code}_${lu.icon}`,
      label: `${lu.verb} — ${lu.size.toLocaleString()} ${lu.sizeUnitsLabel} in ${region.displayName}`,
      blurb: `ITE ${lu.code} · ${lu.size} ${lu.sizeUnitsLabel} · resolved from your IP`,
      prefill: {
        projectName: `Demo: ${region.displayName} ${lu.verb} — ${lu.size} ${lu.sizeUnitsLabel}`,
        latitude: Math.round((c.lat + o.dLat) * 10000) / 10000,
        longitude: Math.round((c.lon + o.dLon) * 10000) / 10000,
        landUseCode: lu.code,
        size: lu.size,
      },
    };
  });
}

router.get("/demo/presets", async (req, res) => {
  const staticPresets = (Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((id) => ({
    id,
    label: PRESETS[id].label,
    blurb: PRESETS[id].blurb,
    prefill: PRESETS[id].prefill,
  }));

  // Best-effort IP geolocation. Any failure (timeout, rate limit, private
  // IP, no geo data) → falls through to static presets only.
  const ip = clientIpFromRequest(req.headers as Record<string, string | string[] | undefined>, req.ip);
  const loc = await geolocateIp(ip);
  if (!loc) {
    res.json({ presets: staticPresets, resolvedRegion: null });
    return;
  }
  // Prefer an exact bbox hit (visitor sitting inside a covered metro);
  // fall back to nearest centroid when they're in an uncovered area
  // close to a metro (e.g. visitor in Versailles is closest to Paris).
  const region =
    regionForCoordinate(loc.lat, loc.lon) ?? nearestRegionForCoordinate(loc.lat, loc.lon);
  if (!region) {
    res.json({ presets: staticPresets, resolvedRegion: null });
    return;
  }
  const localized = buildLocalizedPresets(region);

  req.log.info(
    { ip, country: loc.country, city: loc.city, regionCode: region.code },
    "demo.presets.localized",
  );

  res.json({
    presets: [...localized, ...staticPresets],
    resolvedRegion: {
      code: region.code,
      displayName: region.displayName,
      country: loc.country,
      city: loc.city,
    },
  });
});

/**
 * Validate + coerce a demo request body. Returns either a fully-formed
 * TisRequest (with derived projectName/address + the resolved land-use
 * metadata) or a {status,error} tuple ready for the route to send back.
 * Shared between /demo/generate (JSON result) and /demo/pdf (PDF
 * download) so both endpoints enforce identical bounds and don't drift.
 */
type DemoRequestParse =
  | { ok: true; request: TisRequest; landUse: typeof LAND_USES[number]; projectName: string; regionName: string }
  | { ok: false; status: number; error: string };

function parseDemoRequest(body: Record<string, unknown>): DemoRequestParse {
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
  const independentVariableRaw = typeof body.independentVariable === "string"
    ? body.independentVariable.trim()
    : "";

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { ok: false, status: 400, error: `Latitude must be a number between -90 and 90.` };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { ok: false, status: 400, error: `Longitude must be a number between -180 and 180.` };
  }
  const region = regionForCoordinate(latitude, longitude);
  if (!region) {
    return {
      ok: false,
      status: 400,
      error: `Coordinates (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) fall outside our 300 covered metros. Try a different site, or see /cities for the full list.`,
    };
  }
  const landUse = LAND_USES.find((lu) => lu.code === landUseCode);
  if (!landUse) {
    return { ok: false, status: 400, error: `Unknown ITE land-use code: "${landUseCode}".` };
  }
  // Validate the chosen independent variable against the land use. Must
  // match either the primary `unitShort` or one of the secondaryVariables'
  // `unitShort`. Unknown values are rejected so the engine never silently
  // applies the primary when the user thought they picked a secondary.
  let independentVariable: string | undefined;
  if (independentVariableRaw) {
    const validUnits = new Set<string>([
      landUse.unitShort,
      ...(landUse.secondaryVariables ?? []).map((v) => v.unitShort),
    ]);
    if (!validUnits.has(independentVariableRaw)) {
      return {
        ok: false,
        status: 400,
        error: `"${independentVariableRaw}" is not a valid independent variable for ITE ${landUse.code}. Valid: ${[...validUnits].join(", ")}.`,
      };
    }
    // Only thread through when it's a secondary; primary is the default.
    if (independentVariableRaw !== landUse.unitShort) {
      independentVariable = independentVariableRaw;
    }
  }
  // The size-limit error message should reflect the unit the user actually
  // picked, not the primary, so the error reads naturally for a per-employee
  // input. Resolve unitShort from the selected variable for the error copy.
  const sizeUnitShort = independentVariable ?? landUse.unitShort;
  if (!Number.isFinite(size) || size <= 0 || size > SIZE_MAX) {
    return { ok: false, status: 400, error: `Project size must be between 0 and ${SIZE_MAX} ${sizeUnitShort}.` };
  }
  if (openingYear < currentYear - 1 || openingYear > currentYear + 30) {
    return { ok: false, status: 400, error: `Opening year must be between ${currentYear - 1} and ${currentYear + 30}.` };
  }

  const projectName =
    projectNameRaw ||
    `Demo: ${landUse.name} @ ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  const address = addressRaw || `Custom site (${latitude.toFixed(4)}, ${longitude.toFixed(4)}), ${region.displayName}`;

  return {
    ok: true,
    landUse,
    projectName,
    regionName: region.displayName,
    request: {
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
      independentVariable,
    },
  };
}

/**
 * Address → coordinates helper for the demo form. Cold-click visitors
 * from cold outreach think in addresses, not lat/lon, and forcing them
 * to look up coordinates was a major bounce point. This endpoint
 * forwards the address query to OpenStreetMap's Nominatim geocoder
 * (free, no API key, polite-use only) and returns the resolved
 * lat/lon plus the canonical display name so the user can confirm
 * the right place was picked.
 *
 * Caching: in-memory LRU keyed by the normalized query. Nominatim's
 * usage policy asks consumers to cache aggressively and stay under
 * 1 req/sec; the cache plus the per-IP rate limiter together hold
 * us well within that ceiling. If demo traffic ramps significantly
 * we should switch to Mapbox / Google for SLAs.
 *
 * Failure modes:
 *   - empty / too-short / too-long query → 400
 *   - Nominatim down or timeout → 502 with retry-friendly copy
 *   - no results → 404 with "couldn't find that address" copy
 * Out-of-coverage addresses (geocoded fine but outside our 300 metros)
 * are not caught here — the user sees the out-of-bounds error when
 * they click Run study, which is correct because the bounds check
 * lives in /demo/generate.
 */
const geocodeCache = new Map<string, { latitude: number; longitude: number; displayName: string } | "miss">();
const GEOCODE_CACHE_MAX = 1000;
const NOMINATIM_TIMEOUT_MS = 5000;

router.post("/demo/geocode", geocodeRateLimiter, async (req, res): Promise<void> => {
  const raw = String((req.body as { query?: unknown })?.query ?? "").trim();
  if (raw.length < 3 || raw.length > 200) {
    res.status(400).json({ error: "Address must be between 3 and 200 characters." });
    return;
  }
  const key = raw.toLowerCase().replace(/\s+/g, " ");

  const cached = geocodeCache.get(key);
  if (cached === "miss") {
    res.status(404).json({ error: "Couldn't find that address. Try adding a city or country." });
    return;
  }
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", raw);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), NOMINATIM_TIMEOUT_MS);
    const r = await fetch(url.toString(), {
      headers: {
        "User-Agent": "SimpleImpactStudies/1.0 (gkogon@simpleimpactstudies.com)",
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!r.ok) {
      res.status(502).json({ error: "Address lookup is temporarily unavailable. Try again or paste coordinates directly." });
      return;
    }
    const data = (await r.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    if (!Array.isArray(data) || data.length === 0 || !data[0]?.lat || !data[0]?.lon) {
      if (geocodeCache.size < GEOCODE_CACHE_MAX) geocodeCache.set(key, "miss");
      res.status(404).json({ error: "Couldn't find that address. Try adding a city or country." });
      return;
    }
    const result = {
      latitude: Number(data[0].lat),
      longitude: Number(data[0].lon),
      displayName: String(data[0].display_name ?? raw),
    };
    if (!Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) {
      res.status(502).json({ error: "Address lookup returned bad coordinates. Try a more specific address." });
      return;
    }
    if (geocodeCache.size < GEOCODE_CACHE_MAX) geocodeCache.set(key, result);
    res.json(result);
  } catch (err) {
    // AbortError, network error, or upstream JSON parse failure — all
    // map to the same recoverable surface.
    res.status(502).json({ error: "Address lookup is temporarily unavailable. Try again or paste coordinates directly." });
  }
});

router.post("/demo/generate", demoRateLimiter, async (req, res): Promise<void> => {
  const parsed = parseDemoRequest((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(parsed.status).json({ error: parsed.error });
    return;
  }
  const { request, landUse, projectName, regionName } = parsed;
  const { latitude, longitude, landUseCode, size, openingYear, studyRadiusMi } = request;

  try {
    const report = await generateTisReport(request);
    req.log.info(
      { landUseCode, regionName, intersectionCount: report.intersectionsStudied },
      "demo.completed",
    );
    logEvent("demo_run", {
      metadata: {
        mode: "freeform",
        landUseCode,
        regionName,
        lat: latitude.toFixed(4),
        lon: longitude.toFixed(4),
        size,
        intersections: report.intersectionsStudied,
      },
    });
    // Surface the variable the engine actually used so the result-view
    // header doesn't read "240 ksf" for a project the user entered as
    // "240 emp". The engine writes back unitShort + variableConfidence
    // on tripGeneration; pull from there so client + PDF agree.
    const usedUnitShort = report.tripGeneration.unitShort ?? landUse.unitShort;
    res.json({
      projectName,
      regionName,
      latitude,
      longitude,
      landUseCode,
      landUseName: landUse.name,
      landUseUnitShort: usedUnitShort,
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

/**
 * POST /tis-api/demo/pdf
 *
 * Re-runs the same screening (taking the same body shape as
 * /demo/generate) and returns the PDF as a stream-built Buffer.
 * Engineers respond strongly to artifacts they can save; this is what
 * lets a prospect grab the report they just looked at without signing
 * up. Shares the demoRateLimiter so the PDF path can't be used to
 * bypass the 3/day per-IP cap on engine runs.
 *
 * Important: re-runs the engine server-side rather than trusting any
 * client-supplied report payload. A malicious client could otherwise
 * feed bogus numbers into a "screening preview" PDF.
 */
router.post("/demo/pdf", demoRateLimiter, async (req, res): Promise<void> => {
  const parsed = parseDemoRequest((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(parsed.status).json({ error: parsed.error });
    return;
  }
  const { request, landUse, projectName } = parsed;

  try {
    const report = await generateTisReport(request);
    logEvent("demo_pdf_download", {
      metadata: {
        landUseCode: landUse.code,
        lat: request.latitude.toFixed(4),
        lon: request.longitude.toFixed(4),
        size: request.size,
        intersections: report.intersectionsStudied,
      },
    });

    // Render via the existing per-study pipeline by synthesizing a
    // StoredProject-shaped object. No DB write: this is purely an
    // ephemeral render.
    const pdf = await renderStudyPdf(
      {
        id: `demo-${Date.now()}`,
        studyType: "tis",
        projectName,
        landUseCode: landUse.code,
        siteLat: String(request.latitude),
        siteLon: String(request.longitude),
        version: 1,
        createdAt: new Date(),
        requestPayload: request,
        resultPayload: report,
      },
      {
        // No firm branding — make the screening-only nature of the
        // deliverable unmistakable so an engineer doesn't accidentally
        // pass this off as a stamped consultant TIS.
        name: "Simple Impact Studies — Demo Preview",
        logoUrl: null,
      },
    );

    // Make the filename project-derived but filesystem-safe.
    const safeName = projectName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);
  } catch (err) {
    req.log.error({ err, landUseCode: landUse.code }, "demo.pdf.failed");
    const msg = err instanceof Error ? err.message : String(err);
    const isUpstream = /analyzer/i.test(msg);
    res.status(isUpstream ? 503 : 500).json({
      error: isUpstream
        ? "Live data feed is briefly slow. Try again in 30 seconds."
        : "PDF generation failed. Try the demo preview on the page, or sign up to download from your dashboard.",
    });
  }
});

export default router;
