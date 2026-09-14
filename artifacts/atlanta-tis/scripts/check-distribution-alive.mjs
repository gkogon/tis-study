// Headless check for the live trip-distribution rose's geometry.
// Runs `roseGeometry` on a REAL engine report (fixtures/scenario-base.json)
// and pins the conventions the map's sector dim relies on to the engine's
// own bearings.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  roseGeometry, bearingDeg, bearingToOctant, sectorPath, bearingToXY, normDeg, easeOut, OCTANTS,
} from "../src/lib/distribution-rose.ts";

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(readFileSync(join(here, "fixtures", "scenario-base.json"), "utf8"));
const td = report.tripDistribution;
ok(td && td.byDirection && Array.isArray(td.zones) && td.zones.length > 0, `fixture carries a tripDistribution (${td?.zones?.length ?? 0} zones, ${td?.methodLabel ?? "?"})`);

const R = 120, R0 = 10;
const g = roseGeometry(td.byDirection, td.zones, { radius: R, innerRadius: R0, labelCount: 10 });

// ---- shares ----
const carried = OCTANTS.reduce((s, o) => s + (Number(td.byDirection[o]) || 0), 0);
ok(near(carried, 100, 1e-6), `fixture byDirection sums to 100 (${carried.toFixed(6)})`);
ok(near(g.totalSharePct, carried, 1e-9), `geometry totalSharePct equals the carried sum (${g.totalSharePct.toFixed(6)})`);
ok(g.wedges.every((w, i) => w.sharePct === (Number(td.byDirection[w.octant]) || 0) && w.octant === OCTANTS[i]), "every wedge carries its octant's share verbatim, in card order NNE…NNW");
const maxW = g.wedges.reduce((m, w) => (w.sharePct > m.sharePct ? w : m), g.wedges[0]);
ok(maxW.fill === 1 && maxW.outerR === R, `largest octant (${maxW.octant} ${maxW.sharePct.toFixed(1)}%) fills to the full radius`);
ok(g.wedges.every((w) => near(w.fill, w.sharePct / g.maxSharePct, 1e-12)), "fill fraction is share / largest share (the bars' scale)");
ok(g.wedges.every((w) => w.outerR >= R0 && w.outerR <= R && near(w.outerR, R0 + w.fill * (R - R0), 1e-9)), "wedge outer radius is linear in fill between hub and ring");

// ---- wedge angles tile 360°, clockwise from north, NNE first ----
ok(g.wedges[0].startDeg === 0 && g.wedges[0].octant === "NNE", "first wedge (NNE) starts at due north (0°)");
let tiled = true, total = 0;
for (let i = 0; i < g.wedges.length; i++) {
  const w = g.wedges[i], nxt = g.wedges[(i + 1) % g.wedges.length];
  total += w.endDeg - w.startDeg;
  if (!near(normDeg(w.endDeg), normDeg(nxt.startDeg), 1e-9)) tiled = false;
  if (!near(w.endDeg - w.startDeg, 45, 1e-9)) tiled = false;
  if (!near(w.midDeg, w.startDeg + 22.5, 1e-9)) tiled = false;
}
ok(tiled && near(total, 360, 1e-9), `8 × 45° wedges tile 360° with no gap or overlap (Σ ${total}°)`);

// ---- octant assignment agrees with the engine's cardinal per zone ----
const mism = td.zones.filter((z) => bearingToOctant(z.bearingDeg) !== z.cardinal);
ok(mism.length === 0, `bearingToOctant matches the engine's cardinal on all ${td.zones.length} zones${mism.length ? ` (${mism.length} mismatched: ${mism.slice(0, 3).map((z) => `${z.id} ${z.bearingDeg.toFixed(1)}°→${bearingToOctant(z.bearingDeg)} vs ${z.cardinal}`).join(", ")})` : ""}`);
ok(g.zones.every((z) => { const src = td.zones.find((s) => s.id === z.id); return src && z.octant === src.cardinal; }), "every zone point carries the engine's own octant");
ok(bearingToOctant(0) === "NNE" && bearingToOctant(44.999) === "NNE" && bearingToOctant(45) === "ENE" && bearingToOctant(359.9) === "NNW" && bearingToOctant(-1) === "NNW" && bearingToOctant(720) === "NNE", "octant boundaries at 0/45/90… and negative / >360 bearings wrap");

// ---- the map's bearing helper reproduces the engine's zone bearings ----
// Zone ids are analyzer signal ids, so a zone's bearingDeg is the engine's
// site→signal bearing for the same row on the map.
const site = { lat: report.request.latitude, lon: report.request.longitude };
const rows = new Map(report.affectedIntersections.map((r) => [r.signalId, r]));
let paired = 0, worst = 0;
for (const z of td.zones) {
  const row = rows.get(z.id);
  if (!row) continue;
  paired++;
  const b = bearingDeg(site.lat, site.lon, row.latitude, row.longitude);
  const diff = Math.abs(((b - z.bearingDeg + 540) % 360) - 180);
  worst = Math.max(worst, diff);
}
ok(paired >= 10, `${paired} zones pair with a studied row by id`);
ok(worst < 0.5, `site→row bearing reproduces the engine's zone bearing on every paired row (worst Δ ${worst.toFixed(3)}°)`);
ok(near(bearingDeg(0, 0, 1, 0), 0, 1e-9) && near(bearingDeg(0, 0, 0, 1), 90, 1e-9) && near(bearingDeg(0, 0, -1, 0), 180, 1e-9) && near(bearingDeg(0, 0, 0, -1), 270, 1e-9), "bearingDeg: north 0°, east 90°, south 180°, west 270°");

// ---- zone radii monotone in distance, inside the ring ----
const byDist = [...g.zones].sort((a, b) => a.distanceMi - b.distanceMi);
let mono = true;
for (let i = 1; i < byDist.length; i++) {
  const a = byDist[i - 1], b = byDist[i];
  if (b.distanceMi > a.distanceMi && !(b.r > a.r)) mono = false;
  if (b.distanceMi === a.distanceMi && !near(b.r, a.r, 1e-9)) mono = false;
}
ok(mono, "zone radius is strictly monotone in distance (equal distance ⇒ equal radius)");
ok(g.zones.every((z) => z.r > 0 && z.r < R), `every zone sits strictly inside the ring (r ∈ (0, ${R}))`);
ok(near(byDist[0].r, R * 0.2, 1e-9) && near(byDist[byDist.length - 1].r, R * 0.94, 1e-9), `nearest zone at 0.20 R, farthest at 0.94 R (${byDist[0].r.toFixed(1)}, ${byDist[byDist.length - 1].r.toFixed(1)})`);
// Log scale: the geometric midpoint of min/max lands at the middle of the band.
const dmid = Math.sqrt(g.minDistanceMi * g.maxDistanceMi);
const gm = roseGeometry(td.byDirection, [...td.zones, { id: "probe", name: "probe", distanceMi: dmid, bearingDeg: 10, sharePct: 0 }], { radius: R, innerRadius: R0 });
const probe = gm.zones.find((z) => z.id === "probe");
ok(probe && near(probe.r, R * (0.2 + 0.94) / 2, 1e-6), `radius is log-scaled: geometric mid-distance sits mid-band (${probe?.r.toFixed(2)})`);
// Placement follows the bearing: the SVG point lies on the zone's bearing.
ok(g.zones.every((z) => near(normDeg((Math.atan2(z.x, -z.y) * 180) / Math.PI), z.bearingDeg, 1e-6) && near(Math.hypot(z.x, z.y), z.r, 1e-9)), "zone (x, y) lies on its bearing at its radius (0° up, clockwise)");
const [ex, ey] = bearingToXY(90, 10);
ok(near(ex, 10, 1e-9) && near(ey, 0, 1e-9), "bearingToXY: 90° is +x (east), y down");

// ---- labels = top 10 by share ----
const top10 = [...td.zones].sort((a, b) => b.sharePct - a.sharePct).slice(0, 10).map((z) => z.id);
ok(g.labels.length === 10 && g.labels.every((id, i) => id === top10[i]), `labels are the top 10 zones by share, heaviest first (${g.labels.slice(0, 3).join(", ")}…)`);
ok(g.zones.every((z, i) => z.rank === i) && g.zones.every((z, i) => i === 0 || z.sharePct <= g.zones[i - 1].sharePct), "zones are ranked in descending share order");
ok(g.zones.filter((z) => z.labelled).length === 10 && g.zones.every((z) => z.labelled === (z.rank < 10)), "exactly the ranked top 10 are flagged labelled");
ok(g.zones.length === td.zones.length, `all ${td.zones.length} zones are placed`);

// ---- sector path + easing ----
const p = sectorPath(0, 45, 0, 100);
ok(p.startsWith("M0 0 L0.00 -100.00 A100.00 100.00 0 0 1 70.71 -70.71 Z"), `sectorPath from the hub: ${p}`);
const p2 = sectorPath(0, 45, 10, 100);
ok(/^M0\.00 -100\.00 A100\.00 100\.00 0 0 1 70\.71 -70\.71 L7\.07 -7\.07 A10\.00 10\.00 0 0 0 0\.00 -10\.00 Z$/.test(p2), `sectorPath annulus: ${p2}`);
ok(easeOut(0) === 0 && easeOut(1) === 1 && easeOut(2) === 1 && easeOut(-1) === 0 && easeOut(0.5) > 0.5, "easeOut is clamped and front-loaded");

// ---- degenerate inputs never produce NaN ----
const empty = roseGeometry(undefined, undefined, { radius: R });
ok(empty.wedges.length === 8 && empty.wedges.every((w) => w.sharePct === 0 && w.fill === 0 && w.outerR === empty.innerRadius) && empty.zones.length === 0 && empty.labels.length === 0, "no distribution ⇒ eight empty wedges, no zones, no NaN");
const one = roseGeometry({ NNE: 100 }, [{ id: "a", name: "A", distanceMi: 0.3, bearingDeg: 20, sharePct: 100 }], { radius: R });
ok(one.wedges[0].fill === 1 && one.wedges.slice(1).every((w) => w.fill === 0) && one.zones.length === 1 && Number.isFinite(one.zones[0].r) && one.zones[0].r > 0, "single zone / single octant places finitely");
const same = roseGeometry({ NNE: 50, SSW: 50 }, [{ id: "a", distanceMi: 0.3, bearingDeg: 20, sharePct: 50 }, { id: "b", distanceMi: 0.3, bearingDeg: 200, sharePct: 50 }], { radius: R });
ok(same.zones.length === 2 && near(same.zones[0].r, same.zones[1].r, 1e-9) && Number.isFinite(same.zones[0].r), "equal distances share one radius (no divide-by-zero on the log scale)");
const junk = roseGeometry({ NNE: Number.NaN, ENE: -5, ESE: "7" }, [{ id: "z", distanceMi: Number.NaN, bearingDeg: 0, sharePct: 1 }], { radius: R });
ok(junk.wedges[0].sharePct === 0 && junk.wedges[1].sharePct === 0 && junk.wedges[2].sharePct === 7 && junk.zones.length === 0, "NaN / negative shares read 0, numeric strings coerce, non-finite zones are dropped");
const pinned = roseGeometry(td.byDirection, td.zones, { radius: R, maxDistanceMi: report.studyRadiusMi });
ok(pinned.maxDistanceMi === report.studyRadiusMi && pinned.zones.every((z) => z.r < R * 0.94 + 1e-9), `maxDistanceMi pins the ring to the study radius (${report.studyRadiusMi} mi); every zone stays inside`);

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:distribution-alive passed");
process.exit(failed ? 1 : 0);
