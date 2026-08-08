/**
 * Render a county sample PDF from a saved demo/authed JSON response.
 * Usage: DATABASE_URL=... npx tsx src/render-county-sample.ts <in.json> <out.pdf> [firmName]
 * The JSON is the /tis-api/demo/generate (or authed generate) response:
 * top-level request fields + `report`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

const [inPath, outPath, firmName] = process.argv.slice(2);
if (!inPath || !outPath) { console.error("usage: render-county-sample.ts <in.json> <out.pdf> [firmName]"); process.exit(1); }
const d = JSON.parse(readFileSync(inPath, "utf8"));
const report = d.report ?? d;
const request = report.request ?? {
  projectName: d.projectName, latitude: d.latitude, longitude: d.longitude,
  landUseCode: d.landUseCode, size: d.size, openingYear: d.openingYear,
  studyRadiusMi: d.studyRadiusMi,
};
const project = {
  id: `county-sample-${Date.now()}`,
  studyType: "tis",
  projectName: String(d.projectName ?? request.projectName ?? "County Sample Study"),
  landUseCode: String(d.landUseCode ?? request.landUseCode ?? ""),
  siteLat: String(d.latitude ?? request.latitude ?? ""),
  siteLon: String(d.longitude ?? request.longitude ?? ""),
  version: 1,
  createdAt: new Date(),
  requestPayload: request,
  resultPayload: { ...report, request },
};
const firm = { name: firmName ?? "Simple Impact Studies — sample draft", logoUrl: null };
const buf = await renderStudyPdf(project as any, firm as any);
writeFileSync(outPath, buf);
console.log(`✔ wrote ${buf.length} bytes → ${outPath}`);
