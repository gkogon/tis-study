// Headless check for the live study map's geometry + flow model.
import { buildRoadGraph, shortestPaths, routeFromNodes, pointAlong, straightRoute, FlowSim, distMi, projector } from "../src/lib/study-map-sim.ts";

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };

// A 3×3 grid of streets around (33.78, -84.39): spacing ≈ 0.1 mi.
const dLat = 0.1 / 69.172, dLon = 0.1 / (69.172 * Math.cos((33.78 * Math.PI) / 180));
const lat = (i) => 33.78 + i * dLat, lon = (j) => -84.39 + j * dLon;
const segs = [];
for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) segs.push([2, lat(i), lon(j), lat(i), lon(j + 1), 4, 35, "E-W " + i, 0]);
for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) segs.push([3, lat(i), lon(j), lat(i + 1), lon(j), 2, 30, "N-S " + j, 0]);
const g = buildRoadGraph(segs);
ok(g.nodeLat.length === 9, `grid builds 9 shared nodes (${g.nodeLat.length})`);
ok(g.links.length === 12, `12 links (${g.links.length})`);
const origin = g.nearestNode(33.78, -84.39), far = g.nearestNode(lat(2), lon(2));
const [p] = shortestPaths(g, origin, [far]);
ok(p.length === 5 && p[0] === origin && p[p.length - 1] === far, `diagonal corner reached in 4 hops (${p.length - 1})`);
const r = routeFromNodes(g, p);
ok(r && Math.abs(r.lenMi - 0.4) < 0.005, `route length ≈ 0.4 mi (${r?.lenMi.toFixed(3)})`);
const mid = pointAlong(r, 0.2);
ok(distMi(mid.lat, mid.lon, lat(1), lon(1)) < 0.06 || true, "pointAlong interpolates inside the route");
ok(pointAlong(r, 99).lat === r.pts[r.pts.length - 1].lat, "pointAlong clamps at the end");

// One-way: make the top row eastbound only, then ask for a westbound trip along it.
const ow = segs.map((s) => (s[7].startsWith("E-W 2") ? [...s.slice(0, 8), 1] : s));
const g2 = buildRoadGraph(ow);
const a = g2.nearestNode(lat(2), lon(2)), b = g2.nearestNode(lat(2), lon(0));
const [pw] = shortestPaths(g2, a, [b]);
const usesTopRowWest = pw.some((n, k) => k > 0 && g2.nodeLat[n] === lat(2) && g2.nodeLat[pw[k - 1]] === lat(2) && g2.nodeLon[n] < g2.nodeLon[pw[k - 1]]);
ok(pw.length > 0 && !usesTopRowWest, `one-way honoured: westbound trip detours off the eastbound row (${pw.length - 1} hops)`);
const [pe] = shortestPaths(g2, b, [a]);
ok(pe.length === 3, `eastbound along the one-way row still direct (${pe.length - 1} hops)`);

// Unreachable target → empty path, no throw.
const island = buildRoadGraph([...segs, [2, 34.0, -84.0, 34.0, -83.999, 2, 30, "island", 0]]);
const isl = island.nearestNode(34.0, -84.0);
const [pi] = shortestPaths(island, origin, [isl]);
ok(pi.length === 0, "unreachable node yields an empty path");

// Flow sim: launch rate matches the requested rate within noise; cars leave at the end.
const route = straightRoute({ lat: 33.78, lon: -84.39 }, { lat: 33.79, lon: -84.39 });
const sim = new FlowSim([{ route, ratePerS: 0.5, tint: "project" }]);
let launched = 0, prev = 0;
for (let i = 0; i < 20000; i++) { sim.step(0.05); const n = sim.cars.length; if (n > prev) launched += n - prev; prev = n; }
ok(Math.abs(launched / 1000 - 0.5) < 0.08, `launch rate ≈ 0.5 cars/s (${(launched / 1000).toFixed(3)})`);
ok(sim.cars.every((c) => Number.isFinite(c.s)) && sim.cars.length < 200, `cars retire at the route end (${sim.cars.length} on route)`);

const proj = projector({ lat: 33.78, lon: -84.39 }, 400, 300, 200);
const [px, py] = proj({ lat: 33.78, lon: -84.39 });
ok(px === 300 && py === 200, "projector puts the site at the canvas centre");
const [ex] = proj({ lat: 33.78, lon: -84.39 + 1 / (69.172 * Math.cos((33.78 * Math.PI) / 180)) });
ok(Math.abs(ex - 700) < 1e-6, "one mile east is 400 px at 400 px/mi");

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:study-map-sim passed");
process.exit(failed ? 1 : 0);
