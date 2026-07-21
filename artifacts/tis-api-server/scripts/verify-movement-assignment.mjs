// Regression check for movement-assignment.ts — the geometric turning-movement
// breakdown of project trips (Peralta feedback #4: "show what movements are
// being affected, such as NB Through or NB Left").
//
// Geometry convention under test (right-hand traffic, compass travel dirs):
// approach named by travel direction (NB = entering traveling north);
// exit − entry of 0° = Through, +90° = Right, +270° = Left, U folded into L.
//
// Fixture: intersection due NORTH of the site (bearing int→site = 180°), so
//   outbound trips enter traveling north (NB, from the site leg);
//   inbound trips exit traveling south (toward the site).
//
// Run: node ./scripts/verify-movement-assignment.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { assignMovements } = await import(path.resolve(here, "../src/lib/movement-assignment.ts"));
const { GenerateTisResponse } = await import(
  path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts")
);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const octants = (over) => ({ NNE: 0, ENE: 0, ESE: 0, SSE: 0, SSW: 0, WSW: 0, WNW: 0, NNW: 0, ...over });
const find = (mv, approach, movement) => mv.find((m) => m.approach === approach && m.movement === movement);
const fmt = (mv) => mv.map((m) => `${m.approach}-${m.movement}:${m.trips}`).join(" ");

const B = 180; // intersection due north of site

// 1. Zones straight ahead (NNE): outbound NB-Through, inbound SB-Through.
{
  const mv = assignMovements(B, octants({ NNE: 100 }), 20, 0.35);
  ok(find(mv, "NB", "T")?.trips === 13 && find(mv, "SB", "T")?.trips === 7 && mv.length === 2,
    `zones ahead → NB-T 13 (out) + SB-T 7 (in): ${fmt(mv)}`);
}

// 2. Zones to the EAST (ENE): outbound NB-Right, inbound WB-Left.
{
  const mv = assignMovements(B, octants({ ENE: 100 }), 20, 0.35);
  ok(find(mv, "NB", "R")?.trips === 13 && find(mv, "WB", "L")?.trips === 7 && mv.length === 2,
    `zones east → NB-Right (out) + WB-Left (in): ${fmt(mv)}`);
}

// 3. Zones to the WEST (WNW): outbound NB-Left, inbound EB-Right.
{
  const mv = assignMovements(B, octants({ WNW: 100 }), 20, 0.35);
  ok(find(mv, "NB", "L")?.trips === 13 && find(mv, "EB", "R")?.trips === 7 && mv.length === 2,
    `zones west → NB-Left (out) + EB-Right (in): ${fmt(mv)}`);
}

// 4. All zones BEHIND the intersection (site side): falls back to through
//    along the site axis — the distance-decay load passes straight through.
{
  const mv = assignMovements(B, octants({ SSW: 60, SSE: 40 }), 10, 0.5);
  ok(find(mv, "NB", "T")?.trips === 5 && find(mv, "SB", "T")?.trips === 5 && mv.length === 2,
    `zones behind → through fallback: ${fmt(mv)}`);
}

// 5. Mixed realistic distribution: trips cross-foot exactly with round(added).
{
  const shares = octants({ NNE: 22, ENE: 18, ESE: 9, SSE: 6, SSW: 5, WSW: 11, WNW: 17, NNW: 12 });
  const mv = assignMovements(B, shares, 37.4, 0.42);
  const sum = mv.reduce((s, m) => s + m.trips, 0);
  ok(sum === 37, `mixed distribution cross-foots: Σ=${sum} === round(37.4): ${fmt(mv)}`);
  ok(mv.every((m) => Number.isInteger(m.trips) && m.trips > 0), "all loads are positive integers");
}

// 6. Rotated geometry: intersection due EAST of site (bearing int→site = 270).
//    Outbound enter traveling east (EB); zones beyond are eastern; zones to the
//    NNE turn left from EB. Inbound from NNE enter SB, exit west leg = SB-Right.
{
  const mv = assignMovements(270, octants({ NNE: 100 }), 20, 0.5);
  ok(find(mv, "EB", "L")?.trips === 10 && find(mv, "SB", "R")?.trips === 10,
    `rotated (site west) zones NNE → EB-Left + SB-Right: ${fmt(mv)}`);
}

// 7. Negligible load → no movements.
{
  ok(assignMovements(B, octants({ NNE: 100 }), 0.4, 0.5).length === 0, "sub-vehicle load → []");
}

// 8. Schema retention: movements survive the response boundary.
{
  const itemSchema = GenerateTisResponse.shape.affectedIntersections.element;
  const parsed = itemSchema.parse({
    signalId: "s1", name: "X", zone: "z", latitude: 25.8, longitude: -80.2, distanceMi: 0.2,
    existingVc: 0.5, addedTripsPmPeak: 20, futureVc: 0.52,
    existingDelaySec: 20, futureDelaySec: 21, existingLos: "C", futureLos: "C",
    losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 100,
    movements: [{ approach: "NB", movement: "T", trips: 13 }, { approach: "WB", movement: "L", trips: 7 }],
  });
  ok(Array.isArray(parsed.movements) && parsed.movements[0].trips === 13,
    "movements survive GenerateTisResponse validation (not stripped)");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
