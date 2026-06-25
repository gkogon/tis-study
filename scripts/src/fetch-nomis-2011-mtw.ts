/**
 * ONS 2011 Census "Method of Travel to Work" → City-of-London mode-share JSON.
 *
 * This is the public-transport disaggregation source the London Transport
 * Assessment uses for trip generation, per REGIONAL-SPECS/velocity-ta-format.md
 * §4 (client Velocity's own method — their Table 6-6 "Census Mode Share for
 * Travel to Work, City of London as destination"). The TRICS office rates give
 * the all-purpose mode split; the 2011 Census WP703EW (workplace population,
 * City of London MSOA E02000001) disaggregates the public-transport portion
 * into Underground / Train / Bus, and pins the car/van share at ≈6.2%.
 *
 * 2011, not 2021: the 2021 Census was taken mid-COVID lockdown, when
 * travel-to-work patterns were heavily distorted; ONS itself flags the 2021
 * travel-to-work tables as not comparable to prior censuses. 2011 is the
 * planner's convention for a stable pre-COVID baseline.
 *
 * Dataset: NOMIS NM_1318_1 (table WP703EW), the 2001 method-of-travel
 * specification. Single workplace geography (City of London MSOA), all
 * transport_powpew11 categories, OBS_VALUE count measure.
 *
 * Endpoint (pinned):
 *   https://www.nomisweb.co.uk/api/v01/dataset/NM_1318_1.data.json
 *     ?geography=E02000001&transport_powpew11=0...11&measures=20100
 *
 * Writes london-census-mtw-2011.json to the live api-server data dir (the same
 * dir london-aadt.json lives in). Re-runs are idempotent.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-nomis-2011-mtw.ts
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const DATA_DIR = resolve(REPO_ROOT, "artifacts/api-server/src/data");

// NOMIS dataset NM_1318_1 = 2011 Census WP703EW (Method of travel to work,
// 2001 specification, workplace population). geography = City of London MSOA
// E02000001; transport_powpew11 = all 12 categories (0 = All categories …
// 11 = Other); measures = 20100 (the OBS_VALUE count). bulk JSON API.
const DATASET = "NM_1318_1";
const GEOGRAPHY = "E02000001"; // City of London 001 (workplace MSOA)
const API = `https://www.nomisweb.co.uk/api/v01/dataset/${DATASET}.data.json`;

// transport_powpew11 cell codes → our canonical mode keys (2001 spec order).
const CELL: Record<number, string> = {
  0: "all",
  1: "workFromHome",
  2: "underground", // Underground, metro, light rail or tram
  3: "rail", // Train
  4: "bus", // Bus, minibus or coach
  5: "taxi",
  6: "motorcycle", // Motorcycle, scooter or moped
  7: "carDriver", // Driving a car or van
  8: "carPassenger", // Passenger in a car or van
  9: "cycle", // Bicycle
  10: "walk", // On foot
  11: "other",
};

type NomisCell = {
  TRANSPORT_POWPEW11: { value: number };
  OBS_VALUE: number;
};
type NomisResponse = { obs: NomisCell[] };

function r4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

async function main(): Promise<void> {
  const url =
    `${API}?geography=${GEOGRAPHY}` +
    `&transport_powpew11=0...11&measures=20100` +
    `&select=transport_powpew11,obs_value`;
  console.log(`Fetching ${DATASET} (WP703EW) for City of London MSOA ${GEOGRAPHY}…`);
  const res = await fetch(url, {
    headers: { "User-Agent": "tis-study/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`NOMIS ${DATASET}: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as NomisResponse;

  const counts: Record<string, number> = {};
  for (const cell of json.obs ?? []) {
    const key = CELL[cell.TRANSPORT_POWPEW11?.value];
    if (key) counts[key] = cell.OBS_VALUE;
  }

  const total = counts.all ?? 0;
  // Shares are of the TRAVELLING population (total minus work-from-home), so
  // the modal percentages describe how the people who actually travel to work
  // in the City of London get there. PT modes (underground/rail/bus) drive the
  // engine's public-transport adjustment per velocity-ta-format.md §4.
  const travelling = total - (counts.workFromHome ?? 0);
  const share = (k: string) => (travelling > 0 ? r4((counts[k] ?? 0) / travelling) : 0);
  const car = travelling > 0 ? r4(((counts.carDriver ?? 0) + (counts.carPassenger ?? 0)) / travelling) : 0;

  const out = {
    source:
      "ONS 2011 Census WP703EW (NM_1318_1), workplace population, City of London MSOA E02000001",
    datasetId: DATASET,
    table: "WP703EW",
    geography: { msoa: GEOGRAPHY, name: "City of London 001", localAuthority: "E09000001" },
    year: 2011,
    spec: "2001 method-of-travel specification",
    fetchedAt: new Date().toISOString().slice(0, 10),
    total,
    travellingPopulation: travelling,
    counts: {
      workFromHome: counts.workFromHome ?? 0,
      underground: counts.underground ?? 0,
      rail: counts.rail ?? 0,
      bus: counts.bus ?? 0,
      taxi: counts.taxi ?? 0,
      motorcycle: counts.motorcycle ?? 0,
      carDriver: counts.carDriver ?? 0,
      carPassenger: counts.carPassenger ?? 0,
      cycle: counts.cycle ?? 0,
      walk: counts.walk ?? 0,
      other: counts.other ?? 0,
    },
    modeShare: {
      _note:
        "shares of travelling population (total minus work-from-home); PT modes (underground/rail/bus) drive the engine PT adjustment per velocity-ta-format.md §4",
      underground: share("underground"),
      rail: share("rail"),
      bus: share("bus"),
      car,
      taxi: share("taxi"),
      cycle: share("cycle"),
      walk: share("walk"),
      dlr: 0.0, // DLR rolls into "Underground, metro, light rail or tram" under the 2001 spec
    },
  };

  const outPath = resolve(DATA_DIR, "london-census-mtw-2011.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✔ wrote ${outPath}`);
  console.log(
    `  PT total = ${(
      ((out.modeShare.underground + out.modeShare.rail + out.modeShare.bus) * 100)
    ).toFixed(1)}%  car = ${(out.modeShare.car * 100).toFixed(1)}%`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
