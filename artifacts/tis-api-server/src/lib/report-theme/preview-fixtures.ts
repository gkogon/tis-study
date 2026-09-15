/**
 * Committed sample studies the preview endpoint renders through a firm's
 * theme, one per regional renderer family (copied from the sample masters by
 * scripts/build-preview-fixtures.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, tisProjectsTable } from "@workspace/db";
import { regionForCoordinate } from "../regions";
import { stateForCoordinate } from "../state-boundaries";

export type FixtureFamily = "fl" | "ga" | "tx" | "ny" | "nc" | "sc";
export type PreviewFixture = {
  family: FixtureFamily;
  key: string;
  projectName: string;
  latitude: number;
  longitude: number;
  landUseCode: string;
  report: { request?: unknown } & Record<string, unknown>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = (() => {
  for (const c of [
    path.resolve(__dirname, "../../../data/preview-fixtures"),
    path.resolve(__dirname, "../../data/preview-fixtures"),
    path.resolve(__dirname, "../data/preview-fixtures"),
  ]) {
    if (existsSync(path.join(c, "fl.json"))) return c;
  }
  return path.resolve(__dirname, "../../../data/preview-fixtures");
})();

const BY_STATE: Record<string, FixtureFamily> = { FL: "fl", GA: "ga", TX: "tx", NY: "ny", NC: "nc", SC: "sc" };

export function regionFamilyForCoordinate(lat: number, lon: number): FixtureFamily {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "fl";
  const region = regionForCoordinate(lat, lon);
  const state = stateForCoordinate(lat, lon) ?? region?.stateCode ?? null;
  return (state && BY_STATE[state]) || "fl";
}

const cache = new Map<FixtureFamily, PreviewFixture>();
export function loadPreviewFixture(family: FixtureFamily): PreviewFixture {
  const hit = cache.get(family);
  if (hit) return hit;
  const fx = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${family}.json`), "utf8")) as PreviewFixture;
  cache.set(family, fx);
  return fx;
}

/**
 * StoredProject-shaped record; fixed createdAt so a preview is reproducible.
 * Clones `fx.report` — `renderStudyPdf` mutates `resultPayload` in place
 * (crash-summary / GDOT-snapshot / FARS-K enrichment, speed-enrichment of
 * `affectedIntersections`, …), and `fx` is the process-wide cached fixture
 * (see `loadPreviewFixture`), so handing it out by reference would let the
 * first preview permanently corrupt it and race concurrent previews.
 */
export function projectFromFixture(fx: PreviewFixture) {
  const report = structuredClone(fx.report);
  return {
    id: `preview-${fx.key}`,
    studyType: "tis",
    projectName: fx.projectName,
    landUseCode: fx.landUseCode,
    siteLat: String(fx.latitude),
    siteLon: String(fx.longitude),
    version: 1,
    createdAt: new Date("2026-01-15T12:00:00Z"),
    requestPayload: report.request,
    resultPayload: report,
  };
}

/** Family of the firm's most recent TIS project with a coordinate, else Florida. */
export async function latestProjectFamily(firmId: string): Promise<FixtureFamily> {
  try {
    const rows = await db
      .select({ siteLat: tisProjectsTable.siteLat, siteLon: tisProjectsTable.siteLon })
      .from(tisProjectsTable)
      .where(and(eq(tisProjectsTable.firmId, firmId), isNotNull(tisProjectsTable.siteLat)))
      .orderBy(desc(tisProjectsTable.createdAt))
      .limit(1);
    const r = rows[0];
    return r ? regionFamilyForCoordinate(Number(r.siteLat), Number(r.siteLon)) : "fl";
  } catch {
    return "fl";
  }
}
