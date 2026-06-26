/**
 * compare-zone-sources.ts — fidelity + coverage of the OSM-cluster zone layer.
 *
 * For each test city this fetches the OSM activity surface ONCE and derives all
 * three synthetic directional sources from it (so the comparison is apples to
 * apples and costs one Overpass call per city):
 *
 *   osm_cluster   bespoke DBSCAN zones      (osm-cluster-taz.ts)
 *   osm_grid      fixed-grid binning        (activity-zones.ts)
 *   census_bg     national block-group model (national-block-group-taz.ts)
 *
 * It reports, per city:
 *   • the eight-wedge percent split from each source;
 *   • coverage — features retained, zones produced, cluster vs singleton mix;
 *   • agreement of the cluster split vs the Census block-group split (cosine +
 *     total-variation distance), the headline fidelity question: does our
 *     Census-free layer point trips the same way the Census backbone does?
 *
 * Includes an ex-US city (London) to show the cluster layer still works where
 * the US-only block-group layer returns nothing.
 *
 * Run from the repo root (block-group asset path passed explicitly because the
 * bundled script does not sit next to the data dir):
 *   npx esbuild scripts/src/compare-zone-sources.ts --bundle --platform=node \
 *     --format=esm --outfile=/tmp/cmp-zones.mjs \
 *   && NATIONAL_TAZ_PATH=artifacts/tis-api-server/data/national-block-group-taz.json \
 *      node /tmp/cmp-zones.mjs
 */

import {
  type CardinalDirection,
  CARDINALS,
} from "../../artifacts/tis-api-server/src/lib/cardinal-directions";
import {
  generateActivitySurface,
  activityDirectionalPercent,
} from "../../artifacts/tis-api-server/src/lib/activity-zones";
import { clusterTazFromSurface } from "../../artifacts/tis-api-server/src/lib/osm-cluster-taz";
import { nationalDirectionalDistribution } from "../../artifacts/tis-api-server/src/lib/national-block-group-taz";
import { directionalAgreement } from "../../artifacts/tis-api-server/src/lib/directional-distribution";

type City = { name: string; lat: number; lon: number; country: string };

const CITIES: City[] = [
  { name: "Atlanta (Midtown)", lat: 33.7838, lon: -84.3836, country: "US" },
  { name: "Miami (Brickell)", lat: 25.7617, lon: -80.1918, country: "US" },
  { name: "Chicago (Loop)", lat: 41.8819, lon: -87.6278, country: "US" },
  { name: "Los Angeles (DTLA)", lat: 34.0407, lon: -118.2468, country: "US" },
  { name: "London (City)", lat: 51.5155, lon: -0.0922, country: "GB" },
];

const RADIUS_MI = 3;

function fmtPct(p: Record<CardinalDirection, number>): string {
  return CARDINALS.map((d) => `${d} ${p[d].toFixed(1).padStart(5)}`).join("  ");
}

function bar(value: number, max: number, width = 24): string {
  const n = max > 0 ? Math.round((value / max) * width) : 0;
  return "█".repeat(n) + "·".repeat(width - n);
}

async function main() {
  const summary: Array<{
    city: string;
    country: string;
    features: number;
    clusterZones: number;
    clusters: number;
    singletons: number;
    gridZones: number;
    bgZones: number;
    cosClusterVsBg: number | null;
    tvClusterVsBg: number | null;
    cosGridVsBg: number | null;
    cosClusterVsGrid: number;
  }> = [];

  for (const city of CITIES) {
    console.log("\n" + "═".repeat(78));
    console.log(`  ${city.name}  (${city.lat}, ${city.lon})  [${city.country}]  radius ${RADIUS_MI} mi`);
    console.log("═".repeat(78));

    const surface = await generateActivitySurface({ lat: city.lat, lon: city.lon, radiusMi: RADIUS_MI });
    if (!surface) {
      console.log("  ⚠ Overpass returned nothing — skipped.");
      continue;
    }

    const cluster = clusterTazFromSurface(surface);
    const gridPct = activityDirectionalPercent(surface);
    const bg = nationalDirectionalDistribution(city.lat, city.lon, RADIUS_MI);

    // ── Coverage ──
    console.log(`\n  COVERAGE`);
    console.log(`    OSM features classified : ${surface.features.length}`);
    console.log(`    osm_cluster zones       : ${cluster.coverage.zoneCount}  ` +
      `(${cluster.coverage.clusterCount} clusters + ${cluster.coverage.singletonCount} singletons; ` +
      `${(cluster.coverage.clusteredAttractionShare * 100).toFixed(0)}% of pull is clustered)`);
    console.log(`    osm_grid cells          : ${surface.zones.length}`);
    console.log(`    census block groups     : ${bg ? bg.blockGroupCount : "—  (no US block-group coverage)"}`);

    // ── Directional splits ──
    console.log(`\n  DIRECTIONAL SPLIT (% of trip pull by wedge)`);
    console.log(`    cluster : ${fmtPct(cluster.percent)}`);
    console.log(`    grid    : ${fmtPct(gridPct)}`);
    console.log(`    census  : ${bg ? fmtPct(bg.percent) : "—"}`);

    // ── Top bespoke zones (the selling point: named, organic zones) ──
    console.log(`\n  TOP OSM-CLUSTER ZONES`);
    for (const z of cluster.zones.slice(0, 6)) {
      console.log(
        `    ${z.totalAttraction.toFixed(0).padStart(6)}  ${z.dominant.padEnd(8)} ` +
        `${z.cardinal} ${z.distanceMi.toFixed(1)}mi  ${z.featureCount.toString().padStart(3)} feat  ` +
        `${z.isCluster ? "clus" : "sing"}  ${z.name}`,
      );
    }

    // ── Fidelity ──
    const cVsG = directionalAgreement(cluster.percent, gridPct);
    const cVsB = bg ? directionalAgreement(cluster.percent, bg.percent) : null;
    const gVsB = bg ? directionalAgreement(gridPct, bg.percent) : null;
    console.log(`\n  FIDELITY (agreement of the 8-wedge shapes)`);
    console.log(`    cluster vs census : ${cVsB ? `cos ${cVsB.cosine}  TV ${cVsB.totalVariation}  L1 ${cVsB.l1}pp  ${bar(cVsB.cosine, 1)}` : "— (no census)"}`);
    console.log(`    grid    vs census : ${gVsB ? `cos ${gVsB.cosine}  TV ${gVsB.totalVariation}  L1 ${gVsB.l1}pp  ${bar(gVsB.cosine, 1)}` : "— (no census)"}`);
    console.log(`    cluster vs grid   : cos ${cVsG.cosine}  TV ${cVsG.totalVariation}  L1 ${cVsG.l1}pp  ${bar(cVsG.cosine, 1)}`);

    summary.push({
      city: city.name,
      country: city.country,
      features: surface.features.length,
      clusterZones: cluster.coverage.zoneCount,
      clusters: cluster.coverage.clusterCount,
      singletons: cluster.coverage.singletonCount,
      gridZones: surface.zones.length,
      bgZones: bg ? bg.blockGroupCount : 0,
      cosClusterVsBg: cVsB ? cVsB.cosine : null,
      tvClusterVsBg: cVsB ? cVsB.totalVariation : null,
      cosGridVsBg: gVsB ? gVsB.cosine : null,
      cosClusterVsGrid: cVsG.cosine,
    });

    // Be polite to the public Overpass mirrors between cities.
    await new Promise((r) => setTimeout(r, 1500));
  }

  // ── Summary table ──
  console.log("\n\n" + "█".repeat(78));
  console.log("  SUMMARY — cluster-vs-census directional fidelity & coverage");
  console.log("█".repeat(78));
  console.log(
    "  " +
    "city".padEnd(20) + "feat".padStart(6) + "clusZ".padStart(7) +
    "gridZ".padStart(7) + "bgZ".padStart(6) +
    "cos↔bg".padStart(9) + "TV↔bg".padStart(8) + "cos↔grid".padStart(10),
  );
  console.log("  " + "─".repeat(72));
  const withBg = summary.filter((s) => s.cosClusterVsBg != null);
  for (const s of summary) {
    console.log(
      "  " +
      s.city.padEnd(20) +
      s.features.toString().padStart(6) +
      s.clusterZones.toString().padStart(7) +
      s.gridZones.toString().padStart(7) +
      (s.bgZones || "—").toString().padStart(6) +
      (s.cosClusterVsBg != null ? s.cosClusterVsBg.toFixed(3) : "—").padStart(9) +
      (s.tvClusterVsBg != null ? s.tvClusterVsBg.toFixed(3) : "—").padStart(8) +
      s.cosClusterVsGrid.toFixed(3).padStart(10),
    );
  }
  if (withBg.length > 0) {
    const avgCos = withBg.reduce((a, s) => a + (s.cosClusterVsBg ?? 0), 0) / withBg.length;
    const avgTv = withBg.reduce((a, s) => a + (s.tvClusterVsBg ?? 0), 0) / withBg.length;
    const avgGridCos = withBg.reduce((a, s) => a + (s.cosGridVsBg ?? 0), 0) / withBg.length;
    console.log("  " + "─".repeat(72));
    console.log(
      `  US-city mean (n=${withBg.length}):  ` +
      `cluster↔census cos ${avgCos.toFixed(3)} / TV ${avgTv.toFixed(3)}   ` +
      `grid↔census cos ${avgGridCos.toFixed(3)}`,
    );
    const verdict = avgCos >= avgGridCos + 0.02
      ? "beats"
      : avgCos >= avgGridCos - 0.02
        ? "matches (within Overpass run-to-run noise)"
        : "trails";
    console.log(
      `  → cluster ${verdict} the grid layer's agreement with the Census backbone — ` +
      `with no Census dependency, and as named, mappable bespoke zones.`,
    );
  }
  console.log(
    `\n  Note: every osm_* source is SYNTHETIC/MODELED, not an adopted MPO TAZ layer.`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
