/**
 * StudyMapAlive — the study map that runs while a TIS generates, then carries
 * the report's trip assignment.
 *
 * Pending: resolves the site's region, pulls the analyzer's real road network
 * and the signals inside the study radius (`/api/roads`, `/api/intersections`
 * with the radius filter), draws the network in from the site outward, and
 * runs background pulses along shortest paths to every signal — the engine's
 * own scope, on screen, while it works. The stage list on the left is honest:
 * the first two stages are real fetches; the rest are paced.
 *
 * Report: every studied intersection resolves to its LOS badge (Build by
 * default, No-Build on the toggle — never labelled "existing", per the API
 * spec), and project trips run from the site along client-side shortest
 * paths to each intersection at a rate proportional to its
 * `addedTripsPmPeak`. Hover a signal for the numbers. No road file for the
 * region → straight-line routes and a note.
 *
 * Scenario: when `scenarioReport` is passed (the browser re-solve of the same
 * study), badges, flows, stats and the hover card read from it while the
 * base report stays the yardstick — flow rates are normalised to the BASE
 * study's busiest signal so a uniform trip change is visible, a dashed ring
 * marks every signal whose LOS moved against the base, and the sim is kept
 * (rates updated in place) so the cars never restart on an edit. Clicking a
 * signal selects it (`onSelectSignal`); the selection wears a solid ring.
 *
 * Canvas is aria-hidden; everything the reader needs is in the DOM beside it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { TisReport, TisAffectedIntersection } from "@workspace/tis-api-client-react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  buildRoadGraph, shortestPaths, routeFromNodes, straightRoute, pointAlong, projector, distMi,
  FlowSim, LOS_MAP_COLORS, type RoadGraph, type RoadSegment, type Route, type Flow, type LatLon,
} from "../lib/study-map-sim";

type Signal = { id: string; name: string; latitude: number; longitude: number };
type NetStatus = "idle" | "loading" | "ready" | "none" | "error";
type Scenario = "build" | "nobuild";

export type StudyMapAliveProps = {
  site: { latitude: number; longitude: number };
  radiusMi: number;
  phase: "pending" | "report";
  report?: TisReport | null;
  projectName?: string | null;
  /** The browser re-solve of `report` for the scenario being edited. Absent
   *  or null ⇒ the map shows the base report alone. */
  scenarioReport?: TisReport | null;
  /** Studied signal to ring as selected (the studio's Signal tab). */
  selectedSignalId?: string | null;
  /** Fired on a canvas click: the studied signal under the pointer, or null
   *  when the click landed on empty map. */
  onSelectSignal?: (signalId: string | null) => void;
};

const SIM_SPEED = 20;            // simulated seconds per real second
const MAX_PENDING_TARGETS = 40;  // background pulses fan out to at most this many signals
const REVEAL_S = 1.4;            // network draws in over this many real seconds
const ROUTING_STAGE_S = 2.5;     // paced stage after the two real fetches
const HIT_RADIUS_PX = 14;        // hover / click hit-test radius around a signal
const FLOW_RATE_PER_MAX = 0.05;  // cars per simulated second at the base study's busiest signal

const CLASS_STYLE: Array<{ w: number; c: string }> = [
  { w: 5, c: "#3A4A66" }, { w: 4, c: "#33425C" }, { w: 3.2, c: "#2D3B54" }, { w: 2.4, c: "#27344B" }, { w: 1.5, c: "#212D42" },
];

function useReducedMotion(): boolean {
  return useMemo(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
}

/** Flow rate for a row against the base study's busiest signal. */
function flowRate(addedTripsPmPeak: number, baseMaxTrips: number): number {
  return (FLOW_RATE_PER_MAX * addedTripsPmPeak) / baseMaxTrips;
}

/** Settle a still frame for reduced-motion readers. */
function settle(sim: FlowSim): void {
  sim.cars = [];
  for (let i = 0; i < 400; i++) sim.step(0.5);
}

export function StudyMapAlive({ site, radiusMi, phase, report, projectName, scenarioReport, selectedSignalId, onSelectSignal }: StudyMapAliveProps) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [net, setNet] = useState<{ status: NetStatus; segments: number; signals: number; regionName: string | null }>({ status: "idle", segments: 0, signals: 0, regionName: null });
  const [scenario, setScenario] = useState<Scenario>("build");
  // Hover keeps the signal only; the row is resolved at render time so the
  // card follows a slider edit while the pointer rests on a signal.
  const [hover, setHover] = useState<{ x: number; y: number; sig: Signal } | null>(null);
  const [, tick] = useState(0);

  // Everything the animation loop needs lives in one ref so the loop never closes over stale props.
  const world = useRef<{
    graph: RoadGraph | null; segments: RoadSegment[]; signals: Signal[]; siteNode: number;
    loadedAt: number | null; sigLoadedAt: number | null; sim: FlowSim | null; simKey: string;
    reportRows: Map<string, TisAffectedIntersection>; baseRows: Map<string, TisAffectedIntersection>;
    phase: "pending" | "report"; scenario: Scenario; selected: string | null;
    static: HTMLCanvasElement | null; staticKey: string; hoverSig: Signal | null;
  }>({ graph: null, segments: [], signals: [], siteNode: -1, loadedAt: null, sigLoadedAt: null, sim: null, simKey: "", reportRows: new Map(), baseRows: new Map(), phase, scenario, selected: null, static: null, staticKey: "", hoverSig: null });
  world.current.phase = phase;
  world.current.scenario = scenario;
  world.current.selected = selectedSignalId ?? null;

  const siteKey = `${site.latitude.toFixed(4)},${site.longitude.toFixed(4)},${radiusMi}`;

  // ---- data: region → roads + signals ----
  useEffect(() => {
    const ctrl = new AbortController();
    const w = world.current;
    w.graph = null; w.segments = []; w.signals = []; w.siteNode = -1; w.loadedAt = null; w.sigLoadedAt = null; w.sim = null; w.simKey = ""; w.static = null; w.staticKey = "";
    setNet({ status: "loading", segments: 0, signals: 0, regionName: null });
    const rad = Math.min(8, radiusMi * 1.2 + 0.15);
    (async () => {
      try {
        const rr = await fetch(`/tis-api/region-for?lat=${site.latitude}&lon=${site.longitude}`, { signal: ctrl.signal });
        const region = rr.ok ? (await rr.json()) as { regionCode: string | null; displayName: string | null } : { regionCode: null, displayName: null };
        if (!region.regionCode) { setNet({ status: "none", segments: 0, signals: 0, regionName: null }); w.loadedAt = performance.now(); w.sigLoadedAt = performance.now(); return; }
        const q = `regionCode=${encodeURIComponent(region.regionCode)}&lat=${site.latitude}&lon=${site.longitude}&radiusMi=${rad}`;
        const roadsP = fetch(`/api/roads?${q}`, { signal: ctrl.signal }).then(async (r) => (r.ok ? (await r.json()) as { available: boolean; segments: RoadSegment[] } : { available: false, segments: [] }));
        const sigsP = fetch(`/api/intersections?${q}`, { signal: ctrl.signal }).then(async (r) => (r.ok ? (await r.json()) as Signal[] : []));
        const roads = await roadsP;
        if (ctrl.signal.aborted) return;
        w.segments = roads.available ? roads.segments : [];
        w.graph = w.segments.length ? buildRoadGraph(w.segments) : null;
        w.siteNode = w.graph ? w.graph.nearestNode(site.latitude, site.longitude) : -1;
        w.loadedAt = performance.now();
        setNet((n) => ({ ...n, status: w.graph ? "ready" : "none", segments: w.segments.length, regionName: region.displayName }));
        const sigs = await sigsP;
        if (ctrl.signal.aborted) return;
        // Filter client-side too (an older analyzer without the radius param returns the whole metro).
        w.signals = (Array.isArray(sigs) ? sigs : []).filter((s) => distMi(site.latitude, site.longitude, s.latitude, s.longitude) <= rad);
        w.sigLoadedAt = performance.now();
        setNet((n) => ({ ...n, signals: w.signals.length }));
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        w.loadedAt = performance.now(); w.sigLoadedAt = performance.now();
        setNet({ status: "error", segments: 0, signals: 0, regionName: null });
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  // ---- report rows keyed by signal id (scenario on top of the base) ----
  useEffect(() => {
    const w = world.current;
    const base = new Map<string, TisAffectedIntersection>();
    const shown = new Map<string, TisAffectedIntersection>();
    if (phase === "report" && report) {
      for (const r of report.affectedIntersections) base.set(r.signalId, r);
      for (const r of (scenarioReport ?? report).affectedIntersections) shown.set(r.signalId, r);
    }
    const sameIds = w.sim !== null && w.reportRows.size === shown.size && [...shown.keys()].every((id) => w.reportRows.has(id));
    w.reportRows = shown;
    w.baseRows = base;
    if (sameIds && w.sim) {
      // Same study, new numbers: update the rates in place and keep the cars.
      let baseMax = 1;
      for (const r of base.values()) baseMax = Math.max(baseMax, r.addedTripsPmPeak);
      let changed = false;
      for (const f of w.sim.flows) {
        if (!f.signalId) continue;
        const row = shown.get(f.signalId);
        const rate = row ? flowRate(row.addedTripsPmPeak, baseMax) : 0;
        if (rate !== f.ratePerS) { f.ratePerS = rate; changed = true; }
      }
      if (changed && reduced) settle(w.sim);
    } else {
      w.sim = null; w.simKey = "";
    }
  }, [phase, report, scenarioReport, reduced]);

  // stage list re-render while pending (the loop itself never touches React state)
  useEffect(() => {
    if (phase !== "pending") return;
    const t = setInterval(() => tick((n) => n + 1), 400);
    return () => clearInterval(t);
  }, [phase]);

  // ---- the loop ----
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const w = world.current;
    let raf = 0, last = performance.now(), vw = 0, vh = 0, dpr = 1;
    const resize = () => { dpr = Math.min(2, window.devicePixelRatio || 1); vw = canvas.clientWidth; vh = canvas.clientHeight; canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr); w.static = null; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    let visible = true;
    const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }); io.observe(canvas);

    const center: LatLon = { lat: site.latitude, lon: site.longitude };

    function ensureSim(pxPerMi: number): void {
      // Deliberately blind to trip values: rates are updated in place by the
      // rows effect, so an edit never rebuilds the sim and resets the cars.
      const key = `${w.phase}:${w.graph ? w.graph.links.length : 0}:${w.signals.length}:${w.reportRows.size}:${pxPerMi.toFixed(1)}`;
      if (w.sim && w.simKey === key) return;
      const flows: Flow[] = [];
      const routeTo = (p: LatLon): Route | null => {
        if (w.graph && w.siteNode >= 0) {
          const n = w.graph.nearestNode(p.lat, p.lon);
          const [path] = shortestPaths(w.graph, w.siteNode, [n]);
          const r = path ? routeFromNodes(w.graph, path) : null;
          if (r) return r;
        }
        return straightRoute(center, p);
      };
      if (w.phase === "report" && w.reportRows.size) {
        // Normalised to the BASE study's busiest signal so a scenario that
        // scales every row is visible on the map.
        const yard = w.baseRows.size ? w.baseRows : w.reportRows;
        let maxTrips = 1;
        for (const r of yard.values()) maxTrips = Math.max(maxTrips, r.addedTripsPmPeak);
        for (const r of w.reportRows.values()) {
          const route = routeTo({ lat: r.latitude, lon: r.longitude });
          if (route) flows.push({ route, ratePerS: flowRate(r.addedTripsPmPeak, maxTrips), tint: "project", signalId: r.signalId });
        }
      } else if (w.phase === "pending" && w.signals.length) {
        const targets = [...w.signals].sort((a, b) => distMi(center.lat, center.lon, a.latitude, a.longitude) - distMi(center.lat, center.lon, b.latitude, b.longitude)).slice(0, MAX_PENDING_TARGETS);
        const per = Math.min(0.012, 0.12 / Math.max(1, targets.length));
        for (const s of targets) { const route = routeTo({ lat: s.latitude, lon: s.longitude }); if (route) flows.push({ route, ratePerS: per, tint: "background" }); }
      }
      w.sim = new FlowSim(flows); w.simKey = key;
      if (reduced && w.phase === "report") settle(w.sim); // settle to a still frame
    }

    function drawStatic(pxPerMi: number, revealMi: number, complete: boolean): HTMLCanvasElement {
      const key = `${vw}x${vh}:${pxPerMi.toFixed(2)}:${complete ? "full" : revealMi.toFixed(3)}`;
      if (w.static && w.staticKey === key) return w.static;
      const off = w.static ?? document.createElement("canvas");
      off.width = Math.round(vw * dpr); off.height = Math.round(vh * dpr);
      const c = off.getContext("2d"); if (!c) return off;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = "#0B1220"; c.fillRect(0, 0, vw, vh);
      const proj = projector(center, pxPerMi, vw / 2, vh / 2);
      c.lineCap = "round";
      for (let cls = 4; cls >= 0; cls--) {
        const st = CLASS_STYLE[cls] ?? CLASS_STYLE[4]!;
        c.strokeStyle = st.c; c.lineWidth = Math.max(1, st.w * Math.min(1.4, pxPerMi / 600));
        c.beginPath();
        for (const s of w.segments) {
          if (Math.min(4, Math.max(0, s[0] | 0)) !== cls) continue;
          if (!complete && distMi(center.lat, center.lon, (s[1] + s[3]) / 2, (s[2] + s[4]) / 2) > revealMi) continue;
          const [ax, ay] = proj({ lat: s[1], lon: s[2] }), [bx, by] = proj({ lat: s[3], lon: s[4] });
          c.moveTo(ax, ay); c.lineTo(bx, by);
        }
        c.stroke();
      }
      w.static = off; w.staticKey = key;
      return off;
    }

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!visible || vw === 0) return;
      const pxPerMi = Math.min(vw, vh) / (2 * radiusMi * 1.25);
      const proj = projector(center, pxPerMi, vw / 2, vh / 2);
      const t = performance.now();
      const revealFrac = w.loadedAt === null ? 0 : reduced ? 1 : Math.min(1, (t - w.loadedAt) / 1000 / REVEAL_S);
      const maxMi = radiusMi * 1.2 + 0.15;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(drawStatic(pxPerMi, revealFrac * maxMi, revealFrac >= 1), 0, 0, vw, vh);
      if (w.loadedAt === null) { // still resolving: ground + site only
        ctx.fillStyle = "#0B1220"; ctx.fillRect(0, 0, vw, vh);
      }
      // study radius
      const [sx, sy] = proj(center);
      ctx.strokeStyle = "rgba(59,130,246,0.55)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(sx, sy, radiusMi * pxPerMi, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      // site → network stub
      if (w.graph && w.siteNode >= 0) {
        const [nx, ny] = proj({ lat: w.graph.nodeLat[w.siteNode] ?? center.lat, lon: w.graph.nodeLon[w.siteNode] ?? center.lon });
        ctx.strokeStyle = "rgba(251,191,36,0.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(nx, ny); ctx.stroke();
      }
      // flows
      const routingStarted = w.loadedAt !== null && w.sigLoadedAt !== null;
      if (routingStarted) {
        ensureSim(pxPerMi);
        const sim = w.sim;
        if (sim) {
          if (!reduced) { const s = dt * SIM_SPEED; sim.step(s * 0.5); sim.step(s * 0.5); }
          for (const car of sim.cars) {
            const f = sim.flows[car.flow]; if (!f) continue;
            const p = pointAlong(f.route, car.s), q = pointAlong(f.route, Math.min(f.route.lenMi, car.s + 0.004));
            const [x, y] = proj(p), [x2, y2] = proj(q);
            const ang = Math.atan2(y2 - y, x2 - x);
            ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
            if (f.tint === "project") { ctx.fillStyle = "rgba(59,130,246,0.35)"; ctx.fillRect(-7, -5, 14, 10); ctx.fillStyle = "#60A5FA"; }
            else ctx.fillStyle = "rgba(220,227,238,0.55)";
            ctx.fillRect(-4, -2, 8, 4);
            ctx.restore();
          }
        }
      }
      // signals
      const pulse = 0.5 + 0.5 * Math.sin(t / 420);
      for (const s of w.signals) {
        const [x, y] = proj({ lat: s.latitude, lon: s.longitude });
        const row = w.reportRows.get(s.id);
        if (w.phase === "report" && w.reportRows.size) {
          if (!row) { ctx.fillStyle = "rgba(148,163,184,0.35)"; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
        } else {
          const appear = w.sigLoadedAt === null ? 0 : Math.min(1, (t - w.sigLoadedAt) / 600);
          ctx.globalAlpha = appear;
          ctx.fillStyle = routingStarted ? `rgba(148,163,184,${(0.55 + 0.35 * pulse).toFixed(2)})` : "rgba(148,163,184,0.7)";
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      if (w.phase === "report") {
        for (const r of w.reportRows.values()) {
          const [x, y] = proj({ lat: r.latitude, lon: r.longitude });
          const los = w.scenario === "build" ? r.futureLos : r.existingLos;
          const bw = 22, bh = 22;
          ctx.fillStyle = LOS_MAP_COLORS[los] ?? "#94A3B8";
          ctx.beginPath(); ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 4); ctx.fill();
          if (r.losChanged && w.scenario === "build") { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke(); }
          // Scenario moved this signal's LOS against the base study: dashed ring.
          const base = w.baseRows.get(r.signalId);
          if (base && base !== r) {
            const baseLos = w.scenario === "build" ? base.futureLos : base.existingLos;
            if (baseLos !== los) {
              ctx.strokeStyle = "#60A5FA"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
              ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
            }
          }
          if (w.selected === r.signalId) {
            ctx.strokeStyle = "#60A5FA"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.fillStyle = "#0B1220"; ctx.font = '700 13px "JetBrains Mono", Menlo, monospace'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(los, x, y + 0.5);
        }
      }
      // site pin
      ctx.fillStyle = "#FBBF24";
      ctx.beginPath(); ctx.arc(sx, sy - 14, 8, Math.PI * 0.75, Math.PI * 2.25); ctx.lineTo(sx, sy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#0B1220"; ctx.beginPath(); ctx.arc(sx, sy - 14, 3, 0, Math.PI * 2); ctx.fill();
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, reduced]);

  // ---- pointer: hit-test, hover, click ----
  function hitTest(e: React.MouseEvent<HTMLCanvasElement>): { sig: Signal | null; mx: number; my: number } {
    const canvas = canvasRef.current; if (!canvas) return { sig: null, mx: 0, my: 0 };
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = world.current;
    const pxPerMi = Math.min(rect.width, rect.height) / (2 * radiusMi * 1.25);
    const proj = projector({ lat: site.latitude, lon: site.longitude }, pxPerMi, rect.width / 2, rect.height / 2);
    let best: Signal | null = null, bestD = HIT_RADIUS_PX;
    const candidates: Signal[] = w.phase === "report" && w.reportRows.size
      ? [...w.reportRows.values()].map((r) => ({ id: r.signalId, name: r.name, latitude: r.latitude, longitude: r.longitude }))
      : w.signals;
    for (const s of candidates) { const [x, y] = proj({ lat: s.latitude, lon: s.longitude }); const d = Math.hypot(x - mx, y - my); if (d < bestD) { bestD = d; best = s; } }
    return { sig: best, mx, my };
  }
  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const { sig, mx, my } = hitTest(e);
    if (!sig) { if (hover) setHover(null); return; }
    setHover({ x: mx, y: my, sig });
  }
  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onSelectSignal || phase !== "report") return;
    const { sig } = hitTest(e);
    onSelectSignal(sig && world.current.reportRows.has(sig.id) ? sig.id : null);
  }

  // ---- stage list ----
  const w = world.current;
  const now = performance.now();
  const fetched = w.loadedAt !== null && w.sigLoadedAt !== null;
  const routingDone = fetched && (now - Math.max(w.loadedAt ?? 0, w.sigLoadedAt ?? 0)) / 1000 > ROUTING_STAGE_S;
  const stages: Array<{ label: string; state: "done" | "active" | "todo" }> = phase === "report"
    ? []
    : [
        { label: net.status === "none" ? "No road file for this location — routing straight-line" : net.status === "error" ? "Road network unavailable — continuing without it" : `Loading the road network${w.loadedAt !== null ? ` · ${net.segments.toLocaleString()} segments` : ""}`, state: w.loadedAt !== null ? "done" : "active" },
        { label: `Finding signals in the study radius${w.sigLoadedAt !== null ? ` · ${net.signals}` : ""}`, state: w.sigLoadedAt !== null ? "done" : w.loadedAt !== null ? "active" : "todo" },
        { label: "Routing project trips onto the network", state: routingDone ? "done" : fetched ? "active" : "todo" },
        { label: "Solving capacity and LOS at every signal", state: routingDone ? "active" : "todo" },
        { label: "Drafting findings and methodology", state: "todo" },
      ];
  const shownReport = scenarioReport ?? report;
  const isScenario = !!scenarioReport && scenarioReport !== report;
  const rows = shownReport?.affectedIntersections ?? [];
  const baseRowsArr = report?.affectedIntersections ?? [];
  const stat = (rs: TisAffectedIntersection[]) => ({
    drops: rs.filter((r) => r.losChanged).length,
    ef: rs.filter((r) => r.futureLos === "E" || r.futureLos === "F").length,
    worst: rs.reduce((m, r) => Math.max(m, r.futureDelaySec - r.existingDelaySec), 0),
  });
  const cur = stat(rows), baseStat = stat(baseRowsArr);
  const hoverRow = hover ? rows.find((r) => r.signalId === hover.sig.id) ?? null : null;
  const hoverBase = hover && isScenario ? baseRowsArr.find((r) => r.signalId === hover.sig.id) ?? null : null;

  return (
    <div ref={wrapRef} className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]" data-testid="study-map-alive">
      <div className="flex flex-col gap-3 min-w-0">
        {phase === "pending" ? (
          <>
            <div>
              <div className="text-sm font-semibold">Generating{projectName ? ` — ${projectName}` : "…"}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{net.regionName ? `${net.regionName} · ` : ""}{radiusMi} mi study radius. Usually 20–60 seconds; the first study in a metro is the slow one.</div>
            </div>
            <ol className="space-y-1.5" data-testid="study-stages">
              {stages.map((s) => (
                <li key={s.label} className={`flex items-start gap-2 text-sm ${s.state === "todo" ? "text-muted-foreground/60" : s.state === "active" ? "font-medium" : ""}`}>
                  <span className="mt-0.5 shrink-0 w-4 h-4 inline-flex items-center justify-center">
                    {s.state === "done" ? <CheckCircle2 className="w-4 h-4 text-blue-700" /> : s.state === "active" ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none text-blue-700" /> : <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />}
                  </span>
                  <span>{s.label}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <div>
              <div className="text-sm font-semibold">{isScenario ? "Project trips on the network — scenario" : "Project trips on the network"}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Each studied signal shows its LOS; trips leave the site along their shortest routes at a rate proportional to the PM-peak trips it receives. Hover a signal for the numbers{onSelectSignal ? ", click one to edit its timing" : ""}.
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t pt-3">
              <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Studied</div><div className="font-mono text-xl font-semibold tabular-nums">{rows.length}</div></div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">LOS drops</div>
                <div className={`font-mono text-xl font-semibold tabular-nums ${cur.drops ? "text-amber-600" : ""}`} data-testid="stat-map-los-drops">{cur.drops}</div>
                {isScenario && cur.drops !== baseStat.drops && <div className="font-mono text-[10px] text-muted-foreground tabular-nums">base {baseStat.drops}</div>}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Worst Δ</div>
                <div className={`font-mono text-xl font-semibold tabular-nums ${cur.worst >= 5 ? "text-amber-600" : ""}`} data-testid="stat-map-worst-delta">+{cur.worst.toFixed(1)}s</div>
                {isScenario && cur.worst.toFixed(1) !== baseStat.worst.toFixed(1) && <div className="font-mono text-[10px] text-muted-foreground tabular-nums">base +{baseStat.worst.toFixed(1)}s</div>}
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs border-t pt-3">
              <span className="text-muted-foreground mr-1">Scenario:</span>
              {(["nobuild", "build"] as const).map((sc) => (
                <button key={sc} type="button" onClick={() => setScenario(sc)} className={`rounded border px-2 py-0.5 ${scenario === sc ? "bg-foreground text-background" : "hover:bg-muted"}`} data-testid={`button-map-scenario-${sc}`}>
                  {sc === "build" ? "Build" : "No-Build"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1 bg-blue-500" />Project trips</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1 border border-white bg-amber-500" />LOS changed</span>
              {isScenario && <span><i className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1 border border-dashed border-blue-400" />Moved vs base</span>}
              {onSelectSignal && <span><i className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1 border-2 border-blue-400" />Selected</span>}
              <span><i className="inline-block w-2 h-2 rounded-full align-middle mr-1 bg-slate-400/60" />Signal not studied</span>
            </div>
            {net.status === "none" && <div className="text-xs text-muted-foreground">No road file for this region — routes are drawn straight-line.</div>}
          </>
        )}
      </div>
      <div className="relative rounded-lg overflow-hidden border bg-[#0B1220] h-[320px] md:h-[440px]">
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 block w-full h-full ${hover && onSelectSignal ? "cursor-pointer" : ""}`}
          aria-hidden
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={onClick}
        />
        {hover && (
          <div className="absolute z-10 pointer-events-none rounded border border-white/15 bg-[#0F1729]/95 text-slate-50 px-2.5 py-2 text-xs shadow-lg max-w-[240px]" style={{ left: Math.min(hover.x + 12, 9999), top: hover.y + 12 }} data-testid="tooltip-map-signal">
            <div className="font-medium">{hover.sig.name}</div>
            {hoverRow ? (
              <div className="font-mono text-[11px] text-slate-300 mt-0.5">
                LOS {hoverRow.existingLos} → {hoverRow.futureLos} · {hoverRow.existingDelaySec.toFixed(1)}s → {hoverRow.futureDelaySec.toFixed(1)}s<br />
                +{hoverRow.addedTripsPmPeak} PM peak trips · {hoverRow.distanceMi.toFixed(2)} mi
                {hoverBase && (hoverBase.futureLos !== hoverRow.futureLos || hoverBase.futureDelaySec !== hoverRow.futureDelaySec || hoverBase.addedTripsPmPeak !== hoverRow.addedTripsPmPeak) && (
                  <><br /><span className="text-slate-400">base: LOS {hoverBase.futureLos} · {hoverBase.futureDelaySec.toFixed(1)}s · +{hoverBase.addedTripsPmPeak}</span></>
                )}
              </div>
            ) : (
              <div className="font-mono text-[11px] text-slate-400 mt-0.5">{phase === "pending" ? "in the study radius" : "not studied"}</div>
            )}
          </div>
        )}
        <div className="absolute left-2 bottom-1.5 font-mono text-[10px] text-slate-400/80 pointer-events-none">Road network © OpenStreetMap contributors · not to scale for design</div>
      </div>
    </div>
  );
}
