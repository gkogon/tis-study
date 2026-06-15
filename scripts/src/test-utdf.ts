/**
 * Smoke test for the UTDF export. Builds the same fake TIS result as
 * test-pdf.ts and writes the UTDF CSV to /tmp.
 *
 * Run: pnpm --filter @workspace/scripts run test-utdf
 */
import { writeFileSync } from "node:fs";
import { generateUtdf } from "../../artifacts/tis-api-server/src/lib/utdf-export";

const fakeResult = {
  request: {
    projectName: "Test Project",
    latitude: 40.7589,
    longitude: -73.9851,
  },
  affectedIntersections: [
    {
      signalId: "S001",
      name: "9 Ave & W 56 St",
      latitude: 40.7657,
      longitude: -73.9890,
      approaches: [
        { direction: "NB", currentVolumeVph: 1200, existingVolumeVph: 1230, futureVolumeVph: 1280, currentVc: 0.78, existingVc: 0.82, futureVc: 0.85 },
        { direction: "SB", currentVolumeVph: 1450, existingVolumeVph: 1490, futureVolumeVph: 1530, currentVc: 0.92, existingVc: 0.96, futureVc: 0.99 },
        { direction: "EB", currentVolumeVph:  800, existingVolumeVph:  820, futureVolumeVph:  850, currentVc: 0.65, existingVc: 0.68, futureVc: 0.71 },
        { direction: "WB", currentVolumeVph:  780, existingVolumeVph:  800, futureVolumeVph:  830, currentVc: 0.63, existingVc: 0.66, futureVc: 0.69 },
      ],
    },
    {
      signalId: "S002",
      name: "Central Park West & W 65 St",
      latitude: 40.7720,
      longitude: -73.9781,
      approaches: [
        { direction: "NB", currentVolumeVph: 950, existingVolumeVph: 970, futureVolumeVph: 1000, currentVc: 0.71, existingVc: 0.74, futureVc: 0.76 },
        { direction: "SB", currentVolumeVph: 880, existingVolumeVph: 900, futureVolumeVph: 920, currentVc: 0.66, existingVc: 0.69, futureVc: 0.71 },
        { direction: "EB", currentVolumeVph: 540, existingVolumeVph: 555, futureVolumeVph: 580, currentVc: 0.43, existingVc: 0.46, futureVc: 0.48 },
      ],
    },
  ],
};

for (const scenario of ["current", "no_build", "build"] as const) {
  const utdf = generateUtdf(fakeResult, { scenario, projectName: "Test Project" });
  const out = `/tmp/tis-test_${scenario}_UTDF.csv`;
  writeFileSync(out, utdf, "utf-8");
  console.log(`✔ wrote ${utdf.length} bytes → ${out}`);
}
