/**
 * Smoke test — auto-resolve London PTAL from lat/lon.
 *
 * Calls the TfL PTAL FeatureServer for two well-known London points and
 * confirms the lookup returns the expected band. No engine, no PDF —
 * just the lookup. Run-on-CI safe: 3.5s timeout per call, errors → null.
 *
 *   Holloway   (51.5550, -0.1144) → PTAL 6a (AI ~33)
 *   Westminster(51.5074, -0.1278) → PTAL 6b (AI ~85)
 *   Manchester (53.5, -2.2)       → null (outside Greater London)
 */
import { lookupLondonPtal } from "../../artifacts/tis-api-server/src/lib/tfl-ptal";

const cases = [
  { name: "Holloway",   lat: 51.5550, lon: -0.1144, expectBand: "6a" as const },
  { name: "Westminster",lat: 51.5074, lon: -0.1278, expectBand: "6b" as const },
  { name: "Manchester (outside)", lat: 53.5, lon: -2.2, expectBand: null },
];

let fail = false;
for (const c of cases) {
  const result = await lookupLondonPtal(c.lat, c.lon);
  const got = result?.band ?? null;
  const ok = got === c.expectBand;
  const aiStr = result?.ai != null ? ` (AI ${result.ai.toFixed(2)})` : "";
  console.log(`${ok ? "✔" : "✘"} ${c.name.padEnd(28)} expected=${String(c.expectBand).padEnd(4)} got=${String(got).padEnd(4)}${aiStr}`);
  if (!ok) fail = true;
}
process.exit(fail ? 1 : 0);
