/**
 * Regenerate the hosted county sample PDFs at greater depth.
 *
 * Two levers, applied to every county's saved master request:
 *   1. tripProfile — a retail (LU 820) 24-hour arrival/departure profile
 *      derived from NHTS 2017 shopping-trip start-time distributions.
 *      Supplying it unlocks the inbound/outbound-by-hour and on-site
 *      accumulation figures for non-office use classes (the documented
 *      unlock in the TisRequest spec).
 *   2. studyRadiusMi — bumped per county so thin sites analyze a fuller
 *      intersection set (target ≥8 studied where the network allows;
 *      one automatic +0.25 mi retry, capped at 1.25 mi).
 *
 * Reads master configs from --masters-dir, writes deepened master
 * JSON+PDF pairs to --out-masters and hosted-named PDFs to --out-samples.
 *
 * Run:  pnpm --filter @workspace/scripts exec tsx src/deepen-county-samples.ts \
 *         --masters-dir ~/tis-study/private/county-samples-tampa \
 *         --out-masters ~/tis-study/private/county-samples-tampa/deepened \
 *         --out-samples ../artifacts/atlanta-tis/public/samples
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { generateTisReport } from "../../artifacts/tis-api-server/src/lib/tis";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";
import { regionForCoordinate } from "../../artifacts/tis-api-server/src/lib/regions";

// NHTS 2017-derived relative shopping-trip profile (clock hours 0-23).
// Renderer normalizes each array; only relative magnitudes matter.
const RETAIL_ARRIVALS = [0, 0, 0, 0, 0, 0, 0, 1, 3, 6, 8, 9, 10, 9, 8, 8, 9, 10, 9, 6, 4, 2, 1, 0];
const RETAIL_DEPARTURES = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 5, 7, 9, 10, 8, 8, 8, 9, 10, 8, 6, 4, 2, 1];
const PROFILE_SOURCE = "Consultant profile derived from NHTS 2017 shopping-trip start-time distributions";

type County = { key: string; src: string; out: string; radius: number };
const COUNTIES: County[] = [
  { key: "bexar",        src: "master-bexar.json",         out: "bexar-county.pdf",        radius: 1.0 },
  { key: "broward",      src: "master-broward.json",       out: "broward-county.pdf",      radius: 0.75 },
  { key: "charleston",   src: "master-charleston.json",    out: "charleston-county.pdf",   radius: 0.75 },
  { key: "dallas",       src: "master-dallas.json",        out: "dallas-county.pdf",       radius: 0.75 },
  { key: "duval",        src: "master-duval2.json",        out: "duval-county.pdf",        radius: 0.75 },
  { key: "greenville",   src: "master-greenville-sc.json", out: "greenville-county.pdf",   radius: 0.75 },
  { key: "harris",       src: "master-harris.json",        out: "harris-county.pdf",       radius: 1.0 },
  { key: "hillsborough", src: "weoliver.json",             out: "hillsborough-county.pdf", radius: 0.75 },
  { key: "leon",         src: "master-leon.json",          out: "leon-county.pdf",         radius: 0.75 },
  { key: "manatee",      src: "master-manatee.json",       out: "manatee-county.pdf",      radius: 1.0 },
  { key: "mecklenburg",  src: "master-mecklenburg.json",   out: "mecklenburg-county.pdf",  radius: 0.75 },
  { key: "miami-dade",   src: "master-miamidade.json",     out: "miami-dade-county.pdf",   radius: 0.5 },
  { key: "orange",       src: "bpa.json",                  out: "orange-county.pdf",       radius: 0.75 },
  { key: "palm-beach",   src: "master-palmbeach.json",     out: "palm-beach-county.pdf",   radius: 0.75 },
  { key: "pasco",        src: "fl-design.json",            out: "pasco-county.pdf",        radius: 0.75 },
  { key: "pinellas",     src: "american-quality.json",     out: "pinellas-county.pdf",     radius: 0.75 },
  { key: "richland",     src: "master-richland.json",      out: "richland-county.pdf",     radius: 1.0 },
  { key: "tarrant",      src: "master-tarrant.json",       out: "tarrant-county.pdf",      radius: 0.75 },
  { key: "travis",       src: "master-travis.json",        out: "travis-county.pdf",       radius: 0.75 },
  { key: "wake",         src: "master-wake.json",          out: "wake-county.pdf",         radius: 1.0 },
  // GA (3) — added with the Georgia county-sample wave. All three sit in the
  // Atlanta MSA; Walton only began resolving there once atlanta_metro grew to
  // cover all 29 counties, which is why its saved master still says statewide.
  { key: "bartow",       src: "master-bartow.json",        out: "bartow-county.pdf",       radius: 1.25 },
  { key: "douglas",      src: "master-douglas.json",       out: "douglas-county.pdf",      radius: 1.25 },
  { key: "walton",       src: "master-walton.json",        out: "walton-county.pdf",       radius: 1.25 },
];

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) { console.error(`missing ${name}`); process.exit(1); }
  return process.argv[i + 1];
}
const mastersDir = arg("--masters-dir");
const outMasters = arg("--out-masters");
const outSamples = arg("--out-samples");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? new Set(process.argv[onlyIdx + 1].split(",")) : null;
mkdirSync(outMasters, { recursive: true });
mkdirSync(outSamples, { recursive: true });

function pdfPages(buf: Buffer): number {
  const counts = [...buf.toString("latin1").matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}

for (const c of COUNTIES) {
  if (only && !only.has(c.key)) continue;
  const saved = JSON.parse(readFileSync(join(mastersDir, c.src), "utf8"));
  const savedReport = saved.report ?? saved;
  const baseReq = savedReport.request ?? {};
  const origStudied = savedReport.intersectionsStudied ?? "?";

  // Resolve the region from the coordinate rather than trusting the saved
  // master. A master captured before a region's bounds changed carries the OLD
  // name in two places -- `regionName` and the derived "Custom site (lat, lon),
  // <region>" address -- and `address` rides along inside the request, so a
  // plain re-run reprints the stale name no matter how the engine now resolves
  // the site. That is what left the Walton sample reading "Georgia
  // (statewide)" after the county moved into the Atlanta MSA.
  const region = regionForCoordinate(saved.latitude, saved.longitude);
  const regionName = region?.displayName ?? saved.regionName;
  const address = typeof baseReq.address === "string" && /^Custom site \(/.test(baseReq.address)
    ? `Custom site (${saved.latitude}, ${saved.longitude}), ${regionName}`
    : baseReq.address;
  if (regionName !== saved.regionName) {
    console.log(`${c.key.padEnd(13)} region ${JSON.stringify(saved.regionName)} -> ${JSON.stringify(regionName)}`);
  }

  let radius = c.radius;
  let report: any;
  for (;;) {
    const req: any = {
      ...baseReq,
      address,
      studyRadiusMi: radius,
      tripProfile: { arrivals: RETAIL_ARRIVALS, departures: RETAIL_DEPARTURES, source: PROFILE_SOURCE },
    };
    report = await generateTisReport(req);
    report.request = req;
    if ((report.intersectionsStudied ?? 0) >= 8 || radius >= 1.25) break;
    radius = Math.min(1.25, radius + 0.25);
  }

  const master = {
    projectName: saved.projectName, latitude: saved.latitude, longitude: saved.longitude,
    landUseCode: saved.landUseCode, landUseName: saved.landUseName, landUseUnitShort: saved.landUseUnitShort,
    size: saved.size, openingYear: saved.openingYear, studyRadiusMi: radius,
    regionName, report,
  };
  writeFileSync(join(outMasters, `master-${c.key}.json`), JSON.stringify(master, null, 1));

  const project = {
    id: `county-sample-${c.key}`, studyType: "tis",
    projectName: String(saved.projectName ?? "County Sample Study"),
    landUseCode: String(saved.landUseCode ?? ""),
    siteLat: String(saved.latitude ?? ""), siteLon: String(saved.longitude ?? ""),
    version: 1, createdAt: new Date(),
    requestPayload: report.request, resultPayload: report,
  };
  const firm = { name: "Simple Impact Studies — sample draft", logoUrl: null };
  const buf = await renderStudyPdf(project as any, firm as any);
  writeFileSync(join(outMasters, `master-${c.key}.pdf`), buf);
  writeFileSync(join(outSamples, c.out), buf);
  console.log(
    `${c.key.padEnd(13)} studied ${String(origStudied).padStart(2)} → ${String(report.intersectionsStudied).padStart(2)}` +
    `  radius ${baseReq.studyRadiusMi} → ${radius}  pages → ${pdfPages(buf)}  ${(buf.length / 1024) | 0}KB`,
  );
}
console.log("done");
