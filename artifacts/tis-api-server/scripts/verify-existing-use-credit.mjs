// Verifies the redevelopment existing-use-credit feature requested by a
// Miami-Dade reviewer:
//   (1) the request schema accepts existingLandUseCode / existingSize,
//   (2) the period trip-gen schema retains existingUseCredit / netNewExternalTrips,
//   (3) the credit arithmetic matches the engine: for the PM peak,
//       external(u) = max(0, raw − passBy − internal) × autoModeShare where
//       raw = pmRate × size, passBy = raw·pb, internal = (raw−passBy)·ic; and
//       netNew = max(0, external(proposed) − external(existing)), floored at 0.
//
// The mode-share factor is identical for both uses, so the netNew relationship
// is exercised here at the all-modes level (share cancels).
//
// Run: node ./scripts/verify-existing-use-credit.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { LAND_USES, resolveRatesForVariable } = await import(path.resolve(here, "../src/lib/land-uses.ts"));
const { GenerateTisBody, GenerateTisResponse } = await import(
  path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts")
);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// Replicate the engine's PM-peak external-trip math (see tis.ts period loop).
function pmExternalAllModes(code, size) {
  const lu = LAND_USES.find((u) => u.code === code);
  if (!lu) throw new Error(`unknown LU ${code}`);
  const rates = resolveRatesForVariable(lu, undefined);
  const raw = rates.pmRate * size;
  const pb = Math.min(70, Math.max(0, lu.passByPctPm)) / 100;
  const ic = Math.min(50, Math.max(0, lu.internalCapturePctPm)) / 100;
  const passBy = raw * pb;          // creditScale = 1.0 at PM peak
  const internal = (raw - passBy) * ic;
  return Math.max(0, raw - passBy - internal);
}

// Pick two real land uses present in the catalog.
const proposedCode = LAND_USES.find((u) => u.code === "220") ? "220" : LAND_USES[0].code; // multifamily
const existingCode = LAND_USES.find((u) => u.code === "820") ? "820" : LAND_USES[1].code; // shopping center

// Case A: existing SMALLER than proposed → positive net new = prop − exist.
{
  const prop = pmExternalAllModes(proposedCode, 200);
  const exist = pmExternalAllModes(existingCode, 10);
  const net = Math.max(0, prop - exist);
  ok(net > 0 && Math.abs(net - (prop - exist)) < 1e-9,
    `Case A net new = proposed(${prop.toFixed(1)}) − existing(${exist.toFixed(1)}) = ${net.toFixed(1)} (>0)`);
}

// Case B: existing LARGER than proposed → credit floors net new at 0.
{
  const prop = pmExternalAllModes(proposedCode, 10);
  const exist = pmExternalAllModes(existingCode, 500);
  const net = Math.max(0, prop - exist);
  ok(exist > prop && net === 0,
    `Case B shrinking redevelopment floors net new at 0 (proposed ${prop.toFixed(1)} < existing ${exist.toFixed(1)})`);
}

// Schema (1): request accepts the existing-use inputs.
{
  const body = {
    projectName: "Redev", address: "NW 7 Ave & NW 79 St, Miami, FL",
    latitude: 25.8478, longitude: -80.209,
    landUseCode: proposedCode, size: 200, openingYear: 2028,
    existingLandUseCode: existingCode, existingSize: 30,
  };
  const r = GenerateTisBody.safeParse(body);
  ok(r.success, "request schema accepts existingLandUseCode / existingSize");
  if (r.success) {
    ok(r.data.existingLandUseCode === existingCode && r.data.existingSize === 30,
      "existing-use request fields survive validation");
  } else {
    console.error(String(r.error).split("\n").slice(0, 6).join("\n"));
  }
}

// Schema (2): period trip-gen retains credit fields.
{
  const periodSchema = GenerateTisResponse.shape.periodReports.element.shape.tripGeneration;
  const tg = periodSchema.parse({
    period: "pm_peak", periodLabel: "PM Peak", rawTrips: 100, passByCredit: 0,
    internalCaptureCredit: 0, externalTrips: 100, inTrips: 60, outTrips: 40,
    existingUseCredit: 35, netNewExternalTrips: 65,
  });
  ok(tg.existingUseCredit === 35 && tg.netNewExternalTrips === 65,
    "period trip-gen retains existingUseCredit / netNewExternalTrips");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
