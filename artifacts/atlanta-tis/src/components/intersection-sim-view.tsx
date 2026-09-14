/**
 * IntersectionSimView — the §04 Simulation figure: a canvas plan view of one
 * junction driven by `lib/intersection-sim.ts` (IntersectionSim), built from
 * the row's own inputs (`simInputsFromRow`) for the No-build and the Build
 * case, run as an 8× time-lapse with a cycle counter and Replay.
 *
 * What is drawn is what the sim holds: the through lanes each approach was
 * sized with, a left bay where the inputs carry one (dashed when its length
 * is assumed), every car by movement (through / left / right; a project trip
 * wears the opener's blue), one signal head per lane in the colour of its
 * phase, and a red glow along each lane as long as its standing queue. North
 * is up, US right-hand approaches, the asphalt-night palette of the home-page
 * opener. Lengths along each approach are to scale (25 ft per queued vehicle
 * is the sim's own spacing); lane widths are exaggerated so cars stay legible.
 *
 * Beside the canvas, per approach: "sim: delay X s · Q95 Y ft" — the sim's
 * control delay and 95th-percentile back-of-queue, measured over the
 * engine's own 15-minute analysis period (ANALYSIS_PERIOD_S: Akçelik d2's
 * T = 0.25 h), after which the run stops and Replay starts a new seed — next
 * to the engine's figures for the same row (the scenario row when the studio
 * has a timing override for this signal, whose timing the sim then runs).
 * Like for like, explicitly:
 *   - delay: the engine column is the row's vcToDelay figure with the row's
 *     calibration multiplier divided back out (the sim is uncalibrated; the
 *     printed, calibrated delay is shown alongside when the two differ), and
 *     a simulated delay above the engine's 300 s cap is shown capped;
 *   - Q95: both columns are the approach TOTAL across lanes × 25 ft — the
 *     engine's queue95Ft basis; the sim also shows its worst single lane on
 *     multi-lane approaches;
 *   - the build Q95 is the row's printed figure; the no-build Q95 is the
 *     engine's method recomputed in the browser (the row prints only build)
 *     and is labelled so;
 *   - the sim discharges at 1800 × the row's weather factor, the engine's own
 *     capacity basis.
 * The two are NOT expected to match: the simulated figure is a stochastic
 * measurement of the queueing process the engine's Webster d1 + Akçelik d2
 * describe analytically; check:intersection-sim documents the ±40 % band
 * under the exact conditions the caption states. The report's number is the
 * engine's.
 *
 * Live values go straight to refs (no re-render per frame); the canvas is
 * decorative and aria-hidden; the loop idles while the canvas is off-screen.
 * With prefers-reduced-motion nothing moves: one static frame with each
 * approach's queue drawn at the ENGINE's Q95 — the approach total spread
 * over its through lanes — and the readout saying so.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, RotateCcw } from "lucide-react";
import {
  IntersectionSim, DIRECTIONS, QUEUE_SPEED, EXIT_FT, YELLOW_S, ALL_RED_S, ANALYSIS_PERIOD_S,
  type Direction, type IntersectionSimInputs, type Movement, type SimCar, type Light, type Scenario, type PhaseState,
} from "@/lib/intersection-sim";
import { CAR_L, CAR_W } from "@/lib/car-following";
import { VEH_LENGTH_FT, SATURATION_FLOW_VPH, SCREENING_MAX_DELAY_SEC } from "@workspace/tis-engine-core";
import type { SimModel } from "@/lib/intersection-study-model";
import { LosBadge } from "@/components/tis-report-bits";

/** simulated seconds per real second */
export const SIM_SPEED = 8;
/** feet of approach the shorter legs show; the scale never drops below MIN_PX_PER_FT */
const VISIBLE_FT = 320;
const MIN_PX_PER_FT = 0.6;
const LANE_EXAGGERATION = 1.6;
/** gap between the kerb and the city blocks, px */
const KERB_PX = 5;
const PALETTE = {
  bg: "#0B1220", block: "#121B2C", blockEdge: "rgba(255,255,255,0.025)", road: "#1B2536", laneLine: "#2B3A52", centre: "#6B5B2A", stop: "rgba(220,227,238,0.75)",
  bayEdge: "#8A9BB5", label: "#8A9BB5", labelDim: "#5B6B85",
  car: { T: "#DCE3EE", L: "#FCD34D", R: "#7DD3FC" } as Record<Movement, string>,
  project: "#60A5FA", projectGlow: "rgba(59,130,246,0.3)", headlight: "#FBBF24",
  light: { G: "#22C55E", Y: "#FBBF24", R: "#EF4444" } as Record<Light, string>,
  headCase: "#0B1220", mast: "#3B4C66",
  queue: "rgba(239,68,68,0.34)",
};
const FONT = '500 10px "JetBrains Mono", Menlo, monospace';
const PHASE_LABEL: Record<PhaseState["key"], string> = { nsL: "NS protected left", ns: "NS through", ewL: "EW protected left", ew: "EW through", slack: "all-red slack" };
const STATE_LABEL: Record<PhaseState["state"], string> = { G: "green", Y: "yellow", AR: "all-red" };

type Refs = Record<string, HTMLElement | null>;

type Frame = {
  d: Direction;
  /** Canvas transform (a b c d) of the local frame: +x direction of travel, +y driver's right, origin at the centre. */
  m: [number, number, number, number];
  stopOff: number;
  /** Distance from the centre to the far edge of the box, where the signal heads hang. */
  farOff: number;
  legEnd: number;
  approachW: number;
  bayW: number;
  throughW: number;
  oppW: number;
  lanes: number;
  bayFt: number | undefined;
  bayAssumed: boolean;
};

type Scene = {
  W: number; H: number; cx: number; cy: number; pxPerFt: number; laneW: number; carL: number; carW: number;
  frames: Record<Direction, Frame>;
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const MATRIX: Record<Direction, [number, number, number, number]> = {
  NB: [0, -1, 1, 0],
  SB: [0, 1, -1, 0],
  EB: [1, 0, 0, 1],
  WB: [-1, 0, 0, -1],
};

function layout(W: number, H: number, inputs: IntersectionSimInputs): Scene {
  const cx = W / 2, cy = H / 2;
  // Lane width first, from a provisional scale, so the box is known before the legs are sized.
  const provisional = Math.max(MIN_PX_PER_FT, (Math.min(cx, cy) - 60) / VISIBLE_FT);
  const laneW = Math.max(9, Math.min(15, 12 * provisional * LANE_EXAGGERATION));
  const widths = (d: Direction) => {
    const a = inputs.approaches[d];
    const bayW = a.leftBayFt !== undefined ? laneW : 0;
    const throughW = Math.max(1, a.throughLanes) * laneW;
    return { approachW: bayW + throughW, bayW, throughW, lanes: Math.max(1, a.throughLanes) };
  };
  const w = { NB: widths("NB"), SB: widths("SB"), EB: widths("EB"), WB: widths("WB") };
  const box = { west: w.SB.approachW, east: w.NB.approachW, north: w.WB.approachW, south: w.EB.approachW };
  const legPx = Math.min(cy - box.south, cy - box.north, cx - box.west, cx - box.east) - 14;
  const pxPerFt = Math.max(MIN_PX_PER_FT, legPx / VISIBLE_FT);
  const mk = (d: Direction, stopOff: number, farOff: number, legEnd: number, oppW: number): Frame => {
    const a = inputs.approaches[d];
    return { d, m: MATRIX[d], stopOff, farOff, legEnd, ...w[d], oppW, bayFt: a.leftBayFt, bayAssumed: !!a.leftBayAssumed };
  };
  return {
    W, H, cx, cy, pxPerFt, laneW,
    carL: Math.max(6, CAR_L * pxPerFt),
    carW: Math.max(4, Math.min(laneW - 4, CAR_W * pxPerFt * LANE_EXAGGERATION)),
    frames: {
      NB: mk("NB", box.south, box.north, cy, w.SB.throughW),
      SB: mk("SB", box.north, box.south, cy, w.NB.throughW),
      EB: mk("EB", box.west, box.east, cx, w.WB.throughW),
      WB: mk("WB", box.east, box.west, cx, w.EB.throughW),
    },
  };
}

/** Lane centre (local +y) of a sim lane index: −1 the bay, 0.. through lanes innermost first. */
function laneV(f: Frame, sc: Scene, lane: number): number {
  return lane < 0 ? f.bayW / 2 : f.bayW + (lane + 0.5) * sc.laneW;
}

/** A car's local position and heading: straight on the approach, an arc past the stop line for turns. */
function carPose(f: Frame, sc: Scene, c: SimCar): { u: number; v: number; th: number } {
  const v0 = laneV(f, sc, c.lane);
  const u0 = -f.stopOff;
  if (c.s <= 0 || c.movement === "T") return { u: u0 + c.s * sc.pxPerFt, v: v0, th: 0 };
  const sPx = c.s * sc.pxPerFt;
  // Left: sweep to the driver's left (−v) about a centre left of the lane; right: to +v about a tight centre.
  const left = c.movement === "L";
  const r = left ? f.stopOff + v0 + sc.laneW * 0.5 : Math.max(sc.laneW * 1.2, f.approachW - v0 + sc.laneW * 0.6);
  const arc = r * Math.PI / 2;
  if (sPx <= arc) {
    const phi = sPx / r;
    const sign = left ? -1 : 1;
    return { u: u0 + r * Math.sin(phi), v: v0 + sign * r * (1 - Math.cos(phi)), th: sign * phi };
  }
  const rest = sPx - arc;
  const sign = left ? -1 : 1;
  return { u: u0 + r, v: v0 + sign * (r + rest), th: sign * Math.PI / 2 };
}

function setLocal(ctx: CanvasRenderingContext2D, sc: Scene, dpr: number, f: Frame): void {
  ctx.setTransform(dpr, 0, 0, dpr, dpr * sc.cx, dpr * sc.cy);
  ctx.transform(f.m[0], f.m[1], f.m[2], f.m[3], 0, 0);
}

type Drawable = { cars: SimCar[]; phase: PhaseState; queueFt: Record<Direction, number[]> };

/** Standing queue per lane, ft — the back of the last stopped car (or the entry buffer's), as the sim counts it. */
function queuesFromCars(inputs: IntersectionSimInputs, cars: SimCar[]): Record<Direction, number[]> {
  const out = {} as Record<Direction, number[]>;
  for (const d of DIRECTIONS) {
    const a = inputs.approaches[d];
    const n = Math.max(1, a.throughLanes) + (a.leftBayFt !== undefined ? 1 : 0);
    out[d] = new Array<number>(n).fill(0);
  }
  for (const c of cars) {
    if (c.s >= 0 || c.v >= QUEUE_SPEED) continue;
    const idx = c.lane + (inputs.approaches[c.approach].leftBayFt !== undefined ? 1 : 0);
    const arr = out[c.approach];
    const back = -c.s + CAR_L / 2;
    if (arr[idx] !== undefined && back > arr[idx]) arr[idx] = back;
  }
  return out;
}

function draw(ctx: CanvasRenderingContext2D, sc: Scene, dpr: number, inputs: IntersectionSimInputs, dr: Drawable): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, sc.W, sc.H);
  const { frames } = sc;

  // City blocks in the four quadrants (the opener's aerial), a kerb's width off the road.
  {
    const nsW = frames.SB.approachW, nsE = frames.NB.approachW, ewN = frames.WB.approachW, ewS = frames.EB.approachW;
    const quads: [number, number, number, number][] = [
      [0, 0, sc.cx - nsW - KERB_PX, sc.cy - ewN - KERB_PX],
      [sc.cx + nsE + KERB_PX, 0, sc.W - (sc.cx + nsE + KERB_PX), sc.cy - ewN - KERB_PX],
      [0, sc.cy + ewS + KERB_PX, sc.cx - nsW - KERB_PX, sc.H - (sc.cy + ewS + KERB_PX)],
      [sc.cx + nsE + KERB_PX, sc.cy + ewS + KERB_PX, sc.W - (sc.cx + nsE + KERB_PX), sc.H - (sc.cy + ewS + KERB_PX)],
    ];
    for (const [x, y, w, h] of quads) {
      if (w <= 0 || h <= 0) continue;
      ctx.fillStyle = PALETTE.block;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = PALETTE.blockEdge;
      ctx.fillRect(x, y, w, 4);
    }
  }

  // Roads, in each approach's local frame.
  for (const d of DIRECTIONS) {
    const f = frames[d];
    setLocal(ctx, sc, dpr, f);
    const x0 = -f.legEnd, x1 = -f.stopOff, len = f.legEnd - f.stopOff;
    ctx.fillStyle = PALETTE.road;
    ctx.fillRect(x0, -f.oppW, len, f.oppW);
    ctx.fillRect(x0, f.bayW, len, f.throughW);
    if (f.bayFt !== undefined) {
      const bayPx = Math.min(len - 10, f.bayFt * sc.pxPerFt);
      const taper = Math.min(sc.laneW * 1.6, Math.max(0, len - bayPx - 4));
      ctx.fillRect(x1 - bayPx, 0, bayPx, f.bayW);
      ctx.beginPath();
      ctx.moveTo(x1 - bayPx, 0); ctx.lineTo(x1 - bayPx, f.bayW); ctx.lineTo(x1 - bayPx - taper, f.bayW); ctx.closePath();
      ctx.fill();
      if (f.bayAssumed) {
        ctx.strokeStyle = PALETTE.bayEdge;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, 0.5); ctx.lineTo(x1 - bayPx, 0.5); ctx.lineTo(x1 - bayPx - taper, f.bayW);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = PALETTE.laneLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1 - bayPx, f.bayW + 0.5); ctx.lineTo(x1, f.bayW + 0.5); ctx.stroke();
    }
    // Centreline and lane lines.
    ctx.strokeStyle = PALETTE.centre;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.stroke();
    ctx.strokeStyle = PALETTE.laneLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    for (let i = 1; i < f.lanes; i++) { const y = f.bayW + i * sc.laneW + 0.5; ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.setLineDash([]);
    // Queue glow per lane.
    const qs = dr.queueFt[d];
    const hasBay = f.bayFt !== undefined;
    ctx.fillStyle = PALETTE.queue;
    for (let i = 0; i < qs.length; i++) {
      const ft = qs[i] ?? 0;
      if (ft <= 0) continue;
      const lane = i - (hasBay ? 1 : 0);
      const y = lane < 0 ? 0 : f.bayW + lane * sc.laneW;
      const px = Math.min(len, ft * sc.pxPerFt);
      ctx.fillRect(x1 - px, y + 1, px, sc.laneW - 2);
    }
    // Stop bar.
    ctx.fillStyle = PALETTE.stop;
    ctx.fillRect(x1 - 1, 0, 2, f.approachW);
  }

  // The box on top of the leg ends.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PALETTE.road;
  ctx.fillRect(sc.cx - frames.SB.approachW, sc.cy - frames.WB.approachW, frames.SB.approachW + frames.NB.approachW, frames.WB.approachW + frames.EB.approachW);

  // Cars.
  for (const d of DIRECTIONS) {
    const f = frames[d];
    setLocal(ctx, sc, dpr, f);
    for (const c of dr.cars) {
      if (c.approach !== d) continue;
      const p = carPose(f, sc, c);
      ctx.save();
      ctx.translate(p.u, p.v);
      ctx.rotate(p.th);
      if (c.project) {
        ctx.fillStyle = PALETTE.projectGlow;
        ctx.fillRect(-sc.carL / 2 - 3, -sc.carW / 2 - 3, sc.carL + 6, sc.carW + 6);
        ctx.fillStyle = PALETTE.project;
      } else {
        ctx.fillStyle = PALETTE.car[c.movement];
      }
      ctx.fillRect(-sc.carL / 2, -sc.carW / 2, sc.carL, sc.carW);
      ctx.fillStyle = PALETTE.headlight;
      ctx.fillRect(sc.carL / 2 - 1.5, -sc.carW / 2 + 0.5, 1.5, 1.5);
      ctx.fillRect(sc.carL / 2 - 1.5, sc.carW / 2 - 2, 1.5, 1.5);
      ctx.restore();
    }
  }

  // Signal heads: a mast arm across the approach's lanes on the FAR side of
  // the box (where a driver at the stop bar looks), one head per lane in the
  // colour of its phase. Drawn after the cars — they hang above the road.
  for (const d of DIRECTIONS) {
    const f = frames[d];
    setLocal(ctx, sc, dpr, f);
    const lights = dr.phase.lights[d];
    const u = f.farOff + 7;
    ctx.fillStyle = PALETTE.mast;
    ctx.fillRect(u - 1, -2, 2, f.approachW + 4);
    const head = (v: number, col: string) => {
      ctx.fillStyle = PALETTE.headCase;
      ctx.beginPath(); ctx.arc(u, v, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(u, v, 2.8, 0, Math.PI * 2); ctx.fill();
    };
    if (f.bayFt !== undefined) head(f.bayW / 2, PALETTE.light[lights.L]);
    for (let i = 0; i < f.lanes; i++) head(f.bayW + (i + 0.5) * sc.laneW, PALETTE.light[lights.T]);
  }

  // Labels, compass, scale — screen space.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = FONT;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = PALETTE.label;
  const lab = (d: Direction, x: number, y: number, align: CanvasTextAlign) => {
    const a = inputs.approaches[d];
    ctx.textAlign = align;
    ctx.fillText(`${d} · ${a.throughLanes} ln${a.leftBayFt !== undefined ? " + bay" : ""} · ${Math.round(a.vph)} vph`, x, y);
  };
  lab("NB", sc.cx + frames.NB.approachW + 8, sc.H - 8, "left");
  lab("SB", sc.cx - frames.SB.approachW - 8, 14, "right");
  lab("EB", 6, sc.cy + frames.EB.approachW + 14, "left");
  lab("WB", sc.W - 6, sc.cy - frames.WB.approachW - 6, "right");
  // Compass.
  ctx.strokeStyle = PALETTE.label;
  ctx.fillStyle = PALETTE.label;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(sc.W - 18, 30); ctx.lineTo(sc.W - 18, 12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sc.W - 18, 8); ctx.lineTo(sc.W - 21.5, 15); ctx.lineTo(sc.W - 14.5, 15); ctx.closePath(); ctx.fill();
  ctx.textAlign = "center";
  ctx.fillText("N", sc.W - 18, 42);
  // Scale bar.
  const bar = 100 * sc.pxPerFt;
  const bx = 8, by = sc.H - 26;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bar, by); ctx.moveTo(bx, by - 3); ctx.lineTo(bx, by + 3); ctx.moveTo(bx + bar, by - 3); ctx.lineTo(bx + bar, by + 3); ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = PALETTE.labelDim;
  ctx.fillText(`100 ft · ${VEH_LENGTH_FT} ft/veh`, bx + bar + 5, by + 3);
}

/**
 * The reduced-motion frame: each approach's queue at the engine's Q95 —
 * the approach TOTAL across lanes (queue95Ft on the whole approach's vph),
 * so the vehicles are dealt over the through lanes round-robin and each lane
 * shows its share — stopped cars at VEH_LENGTH_FT spacing, NS green.
 */
function staticDrawable(inputs: IntersectionSimInputs, engineQ95: Record<Direction, number>): Drawable {
  const cars: SimCar[] = [];
  const queueFt = {} as Record<Direction, number[]>;
  let id = 1;
  for (const d of DIRECTIONS) {
    const a = inputs.approaches[d];
    const hasBay = a.leftBayFt !== undefined;
    const lanes = Math.max(1, a.throughLanes);
    const n = lanes + (hasBay ? 1 : 0);
    queueFt[d] = new Array<number>(n).fill(0);
    const q = Math.max(0, engineQ95[d]);
    const veh = Math.round(q / VEH_LENGTH_FT);
    const perLane = new Array<number>(lanes).fill(0);
    for (let i = 0; i < veh; i++) perLane[i % lanes]! += 1;
    for (let lane = 0; lane < lanes; lane++) {
      for (let i = 0; i < perLane[lane]!; i++) {
        cars.push({ id: id++, approach: d, lane, s: -(i * VEH_LENGTH_FT + CAR_L / 2 + 2), v: 0, movement: lane === 0 && i % 7 === 3 ? "L" : lane === lanes - 1 && i % 5 === 2 ? "R" : "T", project: false });
      }
      queueFt[d][lane + (hasBay ? 1 : 0)] = perLane[lane]! * VEH_LENGTH_FT;
    }
  }
  const lights = {} as PhaseState["lights"];
  for (const d of DIRECTIONS) {
    const g: Light = d === "NB" || d === "SB" ? "G" : "R";
    const prot = d === "NB" || d === "SB" ? inputs.signal.gNsLeft !== undefined : inputs.signal.gEwLeft !== undefined;
    lights[d] = { L: prot ? "R" : g, T: g, R: g };
  }
  return { cars, queueFt, phase: { key: "ns", state: "G", timeInPhase: 0, cycleT: 0, lights } };
}

export type IntersectionSimViewProps = {
  sim: SimModel;
  className?: string;
};

export function IntersectionSimView({ sim, className }: IntersectionSimViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const refs = useRef<Refs>({});
  const bind = (key: string) => (node: HTMLElement | null) => { refs.current[key] = node; };
  const [scenario, setScenario] = useState<Scenario>("build");
  const [run, setRun] = useState(0);
  const [reduced] = useState(prefersReducedMotion);
  const inputs = scenario === "build" ? sim.build : sim.nobuild;
  const engineQ95 = useMemo(() => {
    const out = {} as Record<Direction, number>;
    for (const d of DIRECTIONS) out[d] = scenario === "build" ? sim.engine[d].q95Ft.build : sim.engine[d].q95Ft.noBuild;
    return out;
  }, [sim, scenario]);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const el = refs.current;
    const text = (key: string, value: string) => { const n = el[key]; if (n && n.textContent !== value) n.textContent = value; };

    let dpr = 1, sc = layout(canvas.clientWidth || 640, canvas.clientHeight || 400, inputs);
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth || 640, H = canvas.clientHeight || 400;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      sc = layout(W, H, inputs);
    };
    resize();

    if (reduced) {
      const dr = staticDrawable(inputs, engineQ95);
      draw(ctx, sc, dpr, inputs, dr);
      text("phase", "static frame · queues at the engine's Q95 (approach total over its lanes)");
      text("cycle", "not simulated");
      for (const d of DIRECTIONS) { text(`${d}-delay`, "—"); text(`${d}-q95`, engineQ95[d].toFixed(0)); text(`${d}-q95worst`, "—"); text(`${d}-cap`, ""); }
      const onResize = () => { resize(); draw(ctx, sc, dpr, inputs, dr); };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const s = new IntersectionSim(inputs, 1 + run);
    const paint = () => draw(ctx, sc, dpr, inputs, { cars: s.cars(), phase: s.phase(), queueFt: queuesFromCars(inputs, s.cars()) });
    let done = false;
    const readout = () => {
      const ph = s.phase();
      const p = inputs.signal.phases.find((x) => x.key === ph.key);
      const remain = ph.key === "slack" || !p
        ? inputs.signal.slackSec - ph.timeInPhase
        : ph.state === "G" ? p.greenSec - ph.timeInPhase : ph.state === "Y" ? p.greenSec + YELLOW_S - ph.timeInPhase : p.greenSec + YELLOW_S + ALL_RED_S - ph.timeInPhase;
      text("phase", done ? `${ANALYSIS_PERIOD_S / 60} min analysis period complete · Replay for another seed` : `${PHASE_LABEL[ph.key]} · ${STATE_LABEL[ph.state]} ${Math.max(0, Math.ceil(remain))} s`);
      text("cycle", `cycle ${Math.min(s.cyclesCompleted() + 1, Math.ceil(ANALYSIS_PERIOD_S / inputs.signal.cycleLenSec))} · ${Math.round(Math.min(s.simT, ANALYSIS_PERIOD_S))} of ${ANALYSIS_PERIOD_S} s simulated`);
      const m = s.metrics();
      for (const d of DIRECTIONS) {
        const a = m.approaches[d];
        // The engine caps its reported delay at SCREENING_MAX_DELAY_SEC; a
        // simulated mean above it is shown at the cap, flagged.
        const capped = a.simDelaySec > SCREENING_MAX_DELAY_SEC;
        text(`${d}-delay`, a.throughput > 0 ? Math.min(SCREENING_MAX_DELAY_SEC, a.simDelaySec).toFixed(1) : "—");
        text(`${d}-cap`, a.throughput > 0 && capped ? ` (capped, engine ceiling; measured ${a.simDelaySec.toFixed(0)} s)` : "");
        text(`${d}-q95`, a.cyclesSampled > 0 ? a.q95Ft.toFixed(0) : "—");
        text(`${d}-q95worst`, a.cyclesSampled > 0 ? a.q95WorstLaneFt.toFixed(0) : "—");
      }
    };
    paint();
    readout();
    let raf = 0, last = performance.now(), tick = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      const rect = canvas.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return; // off-screen: idle
      // The engine's figures describe a 15-minute analysis period (Akçelik
      // d2, T = 0.25 h): the sim measures over the same window and stops,
      // so "simulated" and "computed" are the same quantity over the same
      // period rather than a cumulative mean over an unbounded run.
      const left = ANALYSIS_PERIOD_S - s.simT;
      if (left <= 1e-9) {
        if (!done) { done = true; readout(); }
        cancelAnimationFrame(raf); raf = 0;
        return;
      }
      s.step(Math.min(left, dtReal * SIM_SPEED));
      paint();
      if ((tick++ & 7) === 0) readout();
    };
    raf = requestAnimationFrame(frame);
    const onResize = () => { resize(); paint(); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [inputs, engineQ95, run, reduced]);

  const sig = inputs.signal;
  const fmtG = (g: number) => `${g.toFixed(1)} s`;
  const timingLine = `${sig.cycleLenSec} s cycle · NS g ${fmtG(sig.gNs)} · EW g ${fmtG(sig.gEw)}${sig.gNsLeft !== undefined ? ` · NS left g ${fmtG(sig.gNsLeft)}` : ""}${sig.gEwLeft !== undefined ? ` · EW left g ${fmtG(sig.gEwLeft)}` : ""} · ${YELLOW_S} s yellow + ${ALL_RED_S} s all-red per phase`;
  const scenarioLabel = scenario === "build" ? "build" : "no-build";
  const engineDelay = (d: Direction) => (scenario === "build" ? sim.engine[d].delayUncalibrated.build : sim.engine[d].delayUncalibrated.noBuild);
  const printedDelay = (d: Direction) => (scenario === "build" ? sim.engine[d].delay.build : sim.engine[d].delay.noBuild);
  const engineLos = (d: Direction) => (scenario === "build" ? sim.engine[d].los.build : sim.engine[d].los.noBuild);
  const calibrated = sim.calibrationMultiplier !== 1;
  const bandPct = Math.round(sim.agreementBand * 100);
  const headwayS = 3600 / inputs.satFlowVphpl;
  const multiLane = DIRECTIONS.some((d) => inputs.approaches[d].vph > 0 && (inputs.approaches[d].throughLanes > 1 || inputs.approaches[d].leftBayFt !== undefined));

  return (
    <div ref={wrapRef} className={`space-y-3${className ? ` ${className}` : ""}`} data-testid="intersection-sim-view">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
            <Activity className="w-3 h-3" /> Micro-simulation{reduced ? "" : ` · ${SIM_SPEED}× time-lapse`}
          </div>
          <div className="inline-flex rounded-md border overflow-hidden text-xs" role="group" aria-label="Scenario">
            {(["nobuild", "build"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setScenario(k)}
                aria-pressed={scenario === k}
                className={`px-2.5 py-1 ${scenario === k ? "bg-foreground text-background" : "hover:bg-muted"}`}
                data-testid={`button-sim-${k}`}
              >
                {k === "nobuild" ? "No-build" : "Build"}
              </button>
            ))}
          </div>
          {!reduced && (
            <button type="button" onClick={() => setRun((r) => r + 1)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="button-sim-replay">
              <RotateCcw className="w-3 h-3" /> Replay
            </button>
          )}
        </div>
        <div className="font-mono text-xs tabular-nums text-muted-foreground">
          <span ref={bind("phase")}>—</span> · <span ref={bind("cycle")}>cycle 1</span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="rounded-md overflow-hidden bg-[#0B1220]">
          <canvas ref={canvasRef} className="block w-full aspect-[4/3] max-h-[560px]" aria-hidden />
        </div>
        <div className="space-y-2 min-w-0" data-testid="sim-readout">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Per approach · {scenarioLabel}{sim.scenario ? " · scenario" : ""}</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left py-1 pr-2 font-medium">App.</th>
                <th className="text-left py-1 px-2 font-medium">Simulated ({ANALYSIS_PERIOD_S / 60} min)</th>
                <th className="text-left py-1 pl-2 font-medium" data-testid="sim-engine-column">{scenario === "build" ? "Engine (report row)" : "Engine (report delay · Q95 recomputed)"}</th>
              </tr>
            </thead>
            <tbody>
              {DIRECTIONS.filter((d) => inputs.approaches[d].vph > 0).map((d) => (
                <tr key={d} className="border-b last:border-0 align-top" data-testid={`sim-readout-${d}`}>
                  <td className="py-1 pr-2 font-mono font-semibold">{d}</td>
                  <td className="py-1 px-2 font-mono tabular-nums">
                    <div className="whitespace-nowrap">delay <span ref={bind(`${d}-delay`)} className="font-semibold">—</span> s<span ref={bind(`${d}-cap`)} className="text-amber-600 whitespace-normal" /></div>
                    <div className="whitespace-nowrap">Q95 <span ref={bind(`${d}-q95`)} className="font-semibold">—</span> ft <span className="text-muted-foreground">approach total</span></div>
                    {(inputs.approaches[d].throughLanes > 1 || inputs.approaches[d].leftBayFt !== undefined) && (
                      <div className="whitespace-nowrap text-muted-foreground">worst lane <span ref={bind(`${d}-q95worst`)}>—</span> ft</div>
                    )}
                  </td>
                  <td className="py-1 pl-2 font-mono tabular-nums">
                    <div className="whitespace-nowrap">delay <span className="font-semibold" data-testid={`sim-engine-delay-${d}`}>{engineDelay(d).toFixed(1)}</span> s <LosBadge los={engineLos(d)} size="sm" />{calibrated ? <span className="text-muted-foreground"> (printed {printedDelay(d).toFixed(1)} s)</span> : null}</div>
                    <div className="whitespace-nowrap">Q95 <span className="font-semibold">{engineQ95[d].toFixed(0)}</span> ft <span className="text-muted-foreground">{scenario === "build" ? "approach total, printed" : "approach total, recomputed"}</span></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11px] text-muted-foreground leading-snug space-y-1" data-testid="sim-readout-note">
            {reduced
              ? <div>Reduced motion: nothing is simulated; the frame shows each approach's queue at the engine's 95th-percentile length — the approach total, dealt over its through lanes.</div>
              : <div>Simulated ≠ computed. The simulated column is a stochastic measurement (Poisson arrivals, one seed, the engine's {ANALYSIS_PERIOD_S / 60}-minute analysis period) of the queueing process the engine's Webster d1 + Akçelik d2 describe analytically; the two are not expected to match. check:intersection-sim pins them within ±{bandPct} % under exactly these conditions: {sim.agreementConditions}. The report's number is the engine's.</div>}
            <div>
              Q95 in both columns is the approach total across its lanes × {VEH_LENGTH_FT} ft — the engine's queue95Ft basis{multiLane ? "; the sim's \"worst lane\" is the single lane a bay or storage length actually sees" : ""}.
              {scenario === "build"
                ? " The engine's build Q95 is the row's printed figure."
                : " The row prints only the build queue: the no-build Q95 here is the engine's method (queue95Ft on the no-build volume, same capacity) recomputed in the browser."}
              {calibrated ? ` The engine delay shown is the raw vcToDelay figure; the report prints it × the row's calibration multiplier ${sim.calibrationMultiplier.toFixed(2)}, which the sim does not apply.` : ""}
              {sim.weatherFactor !== 1 ? ` Saturation flow in the sim is ${SATURATION_FLOW_VPH} × weather ${sim.weatherFactor.toFixed(2)} = ${inputs.satFlowVphpl.toFixed(0)} vphpl, the capacity factor the row was solved with.` : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground" aria-hidden>
            <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1 bg-[#DCE3EE]" />Through</span>
            <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1 bg-[#FCD34D]" />Left</span>
            <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1 bg-[#7DD3FC]" />Right</span>
            <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1 bg-[#60A5FA]" />Project trip</span>
            <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1 bg-red-500/60" />Standing queue</span>
          </div>
        </div>
      </div>

      <div className="font-mono text-[11px] text-muted-foreground leading-relaxed" data-testid="sim-caption">
        Single-junction micro-simulation (lib/intersection-sim.ts): the opener's car-following moves every vehicle; each lane's stop line admits one vehicle per saturation headway ({headwayS.toFixed(2)} s = 3600 / {inputs.satFlowVphpl.toFixed(0)} vphpl{sim.weatherFactor !== 1 ? ` = ${SATURATION_FLOW_VPH} × weather ${sim.weatherFactor.toFixed(2)}` : ""}) while its phase is green; arrivals are Poisson per movement from a seeded stream (seed {1 + run}); the run measures the engine's {ANALYSIS_PERIOD_S / 60}-minute analysis period (T = 0.25 h in Akçelik d2) and stops, and a simulated delay above the engine's {SCREENING_MAX_DELAY_SEC} s reporting ceiling is shown at the ceiling. Timing: {timingLine}{sig.assumed ? " (screening default — no plan on the row)" : sig.source === "override" ? " (your scenario plan)" : ""}. Lengths along each approach are to scale; lane widths are exaggerated; vehicles leave the drawing {EXIT_FT} ft past the stop line.
        {inputs.notes.length > 0 && (
          <> Disclosed defaults: {inputs.notes.join(" ")}</>
        )}
      </div>
    </div>
  );
}
