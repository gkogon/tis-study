/**
 * Verify candidate county-sample sites for the tri-state/4-city wave:
 * region resolution (regionForCoordinate) + raw signal count within the
 * 0.5 mi study radius, against the LOCAL analyzer (localhost:8080).
 * Mirrors the 2026-07-21 verification procedure documented in
 * private/county-sample-sites.tsv.
 *
 * Each candidate carries the region it SHOULD resolve to, so this script
 * also regression-tests regionForCoordinate precedence (e.g. Stamford must
 * resolve to bridgeport_metro, not new_york_metro, after the smallest-bbox
 * rule landed with the 2026-07-30 northeast coverage fix).
 *
 * Run: ANALYZER_API_URL=http://localhost:8080 npx tsx src/verify-northeast-sites.ts
 */
import { regionForCoordinate } from "../../artifacts/tis-api-server/src/lib/regions";

const ANALYZER = process.env["ANALYZER_API_URL"] ?? "http://localhost:8080";

type Cand = { key: string; county: string; lat: number; lon: number; expect: string; note: string };
const CANDIDATES: Cand[] = [
  // ── North/Central NJ (NYC MSA) ──────────────────────────────────────
  { key: "nj-union", county: "Union", lat: 40.695, lon: -74.271, expect: "new_york_metro", note: "Rt 22 Union Twp corridor" },
  { key: "nj-essex", county: "Essex", lat: 40.7937, lon: -74.2603, expect: "new_york_metro", note: "West Orange Essex Green (Prospect Ave)" },
  { key: "nj-essex-newark", county: "Essex", lat: 40.7357, lon: -74.1724, expect: "new_york_metro", note: "Newark Broad & Market" },
  { key: "nj-hudson", county: "Hudson", lat: 40.7272, lon: -74.0355, expect: "new_york_metro", note: "Jersey City Newport" },
  { key: "nj-bergen", county: "Bergen", lat: 40.9177, lon: -74.0774, expect: "new_york_metro", note: "Paramus Garden State Plaza Rt 4/17" },
  { key: "nj-middlesex", county: "Middlesex", lat: 40.547, lon: -74.3355, expect: "new_york_metro", note: "Edison Menlo Park Mall" },
  { key: "nj-monmouth", county: "Monmouth", lat: 40.2596, lon: -74.2938, expect: "new_york_metro", note: "Freehold Rt 9 retail corridor" },
  // ── South Jersey (Philadelphia MSA) ─────────────────────────────────
  { key: "nj-camden", county: "Camden", lat: 39.9368, lon: -75.027, expect: "philadelphia_metro", note: "Cherry Hill Mall Rt 38" },
  { key: "nj-burlington", county: "Burlington", lat: 39.949, lon: -74.956, expect: "philadelphia_metro", note: "Moorestown Mall Rt 38" },
  { key: "nj-gloucester", county: "Gloucester", lat: 39.83, lon: -75.091, expect: "philadelphia_metro", note: "Deptford Mall Rt 42" },
  // ── CT (Stamford dead-zone regression probes) ───────────────────────
  { key: "ct-fairfield-trumbull", county: "Fairfield", lat: 41.227, lon: -73.221, expect: "bridgeport_metro", note: "Trumbull Westfield mall" },
  { key: "ct-fairfield-stamford", county: "Fairfield", lat: 41.075, lon: -73.545, expect: "bridgeport_metro", note: "Stamford High Ridge Rd" },
  { key: "ct-fairfield-norwalk", county: "Fairfield", lat: 41.1129, lon: -73.4213, expect: "bridgeport_metro", note: "Norwalk Rt 1 corridor" },
  { key: "ct-newhaven", county: "New Haven", lat: 41.362, lon: -72.872, expect: "new_haven_metro", note: "North Haven Universal Dr" },
  { key: "ct-newhaven-alt", county: "New Haven", lat: 41.3082, lon: -72.925, expect: "new_haven_metro", note: "New Haven downtown" },
  { key: "ct-hartford-manchester", county: "Hartford", lat: 41.805, lon: -72.552, expect: "hartford_metro", note: "Manchester Buckland Hills" },
  { key: "ct-hartford-southington", county: "Hartford", lat: 41.622, lon: -72.873, expect: "hartford_metro", note: "Southington Queen St Rt 10" },
  // ── NoVA (DC MSA) ───────────────────────────────────────────────────
  { key: "va-fairfax-tysons", county: "Fairfax", lat: 38.9187, lon: -77.2311, expect: "washington_dc_metro", note: "Tysons Corner Center" },
  { key: "va-fairfax-city", county: "Fairfax", lat: 38.8462, lon: -77.3064, expect: "washington_dc_metro", note: "Fairfax Blvd Rt 50" },
  { key: "va-alexandria", county: "Alexandria", lat: 38.8048, lon: -77.0469, expect: "washington_dc_metro", note: "Alexandria King St" },
  { key: "va-loudoun-ashburn", county: "Loudoun", lat: 39.0682, lon: -77.46, expect: "washington_dc_metro", note: "One Loudoun Rt 7 corridor" },
  { key: "va-pw-woodbridge", county: "Prince William", lat: 38.6582, lon: -77.2497, expect: "washington_dc_metro", note: "Woodbridge Rt 1 corridor" },
  // ── Suburban MD (DC MSA) ────────────────────────────────────────────
  { key: "md-montgomery-bethesda", county: "Montgomery", lat: 38.9847, lon: -77.0947, expect: "washington_dc_metro", note: "Bethesda Wisconsin Ave" },
  { key: "md-montgomery-silverspring", county: "Montgomery", lat: 38.9907, lon: -77.0261, expect: "washington_dc_metro", note: "Silver Spring Georgia Ave" },
  { key: "md-montgomery-rockville", county: "Montgomery", lat: 39.084, lon: -77.1528, expect: "washington_dc_metro", note: "Rockville Pike Rt 355" },
  { key: "md-pg-largo", county: "Prince George's", lat: 38.8907, lon: -76.8331, expect: "washington_dc_metro", note: "Largo Town Center" },
];

const R_EARTH_MI = 3958.8;
function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_MI * Math.asin(Math.sqrt(s));
}

const inventoryCache = new Map<string, Array<{ lat: number; lon: number }>>();
async function inventory(regionCode: string): Promise<Array<{ lat: number; lon: number }>> {
  const hit = inventoryCache.get(regionCode);
  if (hit) return hit;
  const url =
    regionCode === "atlanta_metro"
      ? `${ANALYZER}/api/atlanta/intersections`
      : `${ANALYZER}/api/intersections?regionCode=${encodeURIComponent(regionCode)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${regionCode}: analyzer ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, unknown>>;
  const pts = raw
    .map((r) => ({
      lat: Number(r["lat"] ?? r["latitude"]),
      lon: Number(r["lon"] ?? r["lng"] ?? r["longitude"]),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  inventoryCache.set(regionCode, pts);
  return pts;
}

let failures = 0;
for (const c of CANDIDATES) {
  const region = regionForCoordinate(c.lat, c.lon);
  if (!region) {
    failures++;
    console.log(`✗ ${c.key.padEnd(28)} NO REGION (expected ${c.expect}) — ${c.note}`);
    continue;
  }
  const regionOk = region.code === c.expect;
  if (!regionOk) failures++;
  try {
    const pts = await inventory(region.code);
    const within = pts.filter((p) => haversineMi(c.lat, c.lon, p.lat, p.lon) <= 0.5).length;
    // ≥6 = comfortable; 3-5 = marginal but a viable small study (warn only);
    // <3 = the "no coverage" demo experience this fix exists to prevent.
    const countOk = within >= 3;
    if (!countOk) failures++;
    const mark = regionOk && within >= 6 ? "✓" : countOk && regionOk ? "△" : "✗";
    console.log(
      `${mark} ${c.key.padEnd(28)} region=${region.code.padEnd(22)}${regionOk ? "" : ` (EXPECTED ${c.expect})`} signals@0.5mi=${String(within).padStart(3)}  ${c.note}`,
    );
  } catch (err) {
    failures++;
    console.log(`✗ ${c.key.padEnd(28)} region=${region.code} ERR ${(err as Error).message}`);
  }
}
console.log(failures === 0 ? "\nALL PROBES PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
