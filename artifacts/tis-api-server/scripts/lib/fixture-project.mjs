import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_FAMILIES = ["fl", "ga", "tx", "ny", "nc", "sc"];
export function loadFixture(family) {
  return JSON.parse(readFileSync(path.resolve(here, "../../data/preview-fixtures", `${family}.json`), "utf8"));
}
/** StoredProject-shaped record with a FIXED createdAt so renders are reproducible. */
export function projectFromFixture(fx) {
  return {
    id: `preview-${fx.key}`, studyType: "tis", projectName: fx.projectName, landUseCode: fx.landUseCode,
    siteLat: String(fx.latitude), siteLon: String(fx.longitude), version: 1,
    createdAt: new Date("2026-01-15T12:00:00Z"), requestPayload: fx.report.request, resultPayload: fx.report,
  };
}
