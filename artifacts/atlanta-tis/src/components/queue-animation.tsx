/**
 * Queue forming on one lane of the analyzed movement, animated from the
 * report's own numbers.
 *
 * The lane runs left → right into the stop bar. Vehicles arrive with
 * exponential headways at the report's per-lane volume, stop on red and
 * discharge at the report's saturation flow during effective green — the
 * Webster cyclic-queue model the server evaluates
 * (tis-api-server/src/lib/queuing.ts:58-89), running in `lib/queue-sim.ts`
 * as a time-lapse for a few cycles, then holding at the end of a red.
 * Three marks along the lane are the report's average queue, its
 * 95th-percentile queue and — when a storage length was given — the bay,
 * coloured by the storage verdict. Live numbers are written straight to
 * refs; the canvas is decorative and aria-hidden. With
 * prefers-reduced-motion the lane renders once with a queue of the
 * 95th-percentile length and never moves.
 *
 * Two entry points draw the same lane:
 *   `QueueAnimation({ report })`   the queuing study's report, as before —
 *                                  its inputs map 1:1 onto `QueueLaneInputs`.
 *   `QueueLaneAnimation(inputs)`   explicit per-lane inputs, so an
 *                                  intersection study (§02 Queuing) mounts
 *                                  one lane per approach with THAT approach's
 *                                  vph, capacity (s × g/C), cycle, effective
 *                                  green, lanes, storage and verdict.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, RotateCcw } from "lucide-react";
import { QueueSim, VMAX_FTPS } from "../lib/queue-sim";
import type { QueuingReportT } from "./queuing-report";

export type QueueStorageVerdict = QueuingReportT["storage"]["verdict"];

/** Explicit inputs for one drawn lane. Numbers print as given in the caption
 *  and readouts, so callers round to the precision they want shown. */
export type QueueLaneInputs = {
  /** Total demand across the movement's lanes, vph (caption). */
  arrivalVph: number;
  /** λ — arrivals on the drawn lane, vph (arrivalVph ÷ laneCount). */
  arrivalPerLaneVph: number;
  laneCount: number;
  /** s — discharge rate on green, vphpl. */
  satFlowVphpl: number;
  cycleSec: number;
  effectiveGreenSec: number;
  /** Storage per queued vehicle, ft. */
  spacingFt: number;
  /** c = s × g/C per lane, vph, and X = v/c, for the caption. */
  capacityPerLaneVph: number;
  vOverC: number;
  queue: {
    /** Average end-of-red queue; absent ⇒ no "avg" mark and no comparison. */
    averageVehicles?: number;
    averageFt?: number;
    /** What the average is compared against ("report", "engine Q1"). */
    averageSource?: string;
    p95Vehicles: number;
    p95Ft: number;
  };
  storage: { availableFt: number | null; verdict: QueueStorageVerdict };
  /** Header label; default "Queue forming · one lane". */
  title?: string;
  /** Text before the model caption, e.g. the approach identity. */
  captionPrefix?: string;
  /** data-testid of the wrapper; the replay button is `button-<id sans "anim-">-replay`. */
  testId?: string;
  className?: string;
};

/** simulated seconds per real second — a 90 s cycle plays in 15 s */
const SIM_SPEED = 6;
const HOLD_CYCLES = 4;
const H = 108;
/** one queued vehicle at nominal scale: a 14 px car + 4 px gap; shrinks only when a long queue must fit */
const NOMINAL_SLOT_PX = 18;
const MIN_SLOT_PX = 6;
const CAR_L_OF_SLOT = 14 / 18;
/** Tailwind emerald-600 / amber-600 / red-600 — the tones queuing-report.tsx uses for pass / marginal / fail */
const TONE: Record<QueueStorageVerdict, string | null> = {
  pass: "#059669", marginal: "#d97706", fail: "#dc2626", not_measured: null,
};
const SIGNAL = { red: "#dc2626", green: "#059669" };
const FONT = '500 10px "JetBrains Mono", Menlo, monospace';

type Colors = { fg: string; muted: string; mutedFg: string; border: string };
type Scene = { W: number; stopX: number; laneX0: number; pxPerFt: number; carL: number; carH: number };
type Refs = Record<string, HTMLElement | null>;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** theme tokens from index.css are bare HSL triplets on :root / .dark */
function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const hsl = (name: string) => `hsl(${cs.getPropertyValue(name).trim()})`;
  return { fg: hsl("--foreground"), muted: hsl("--muted"), mutedFg: hsl("--muted-foreground"), border: hsl("--border") };
}

function layout(W: number, r: QueueLaneInputs): Scene {
  const stopX = W - 34, laneX0 = 6;
  const spacing = r.spacingFt;
  const laneLen = stopX - laneX0;
  const maxRef = Math.max(r.queue.p95Vehicles, r.queue.averageVehicles ?? 0, (r.storage.availableFt ?? 0) / spacing, 4);
  const slot = Math.min(NOMINAL_SLOT_PX, Math.max(MIN_SLOT_PX, (laneLen * 0.8) / maxRef));
  const carL = slot * CAR_L_OF_SLOT;
  return { W, stopX, laneX0, pxPerFt: slot / spacing, carL, carH: carL / 2 };
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: "left" | "right"): void {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, align === "right" ? x - 4 : x + 4, y);
}

function mark(ctx: CanvasRenderingContext2D, sc: Scene, x: number, laneY: number, laneH: number, color: string, text: string, where: "above" | "below"): void {
  if (x < sc.laneX0) { x = sc.laneX0; text = `← ${text}`; }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x + 0.5, laneY - 8);
  ctx.lineTo(x + 0.5, laneY + laneH + 4);
  ctx.stroke();
  ctx.setLineDash([]);
  label(ctx, text, x, where === "above" ? laneY - 12 : laneY + laneH + 16, color, x > sc.W * 0.6 ? "right" : "left");
}

function car(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 2); else ctx.rect(x, y, w, h);
  ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, sc: Scene, dpr: number, sim: QueueSim, r: QueueLaneInputs, col: Colors): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, sc.W, H);
  const laneY = 30, laneH = 28, cy = laneY + laneH / 2;
  const xOf = (ft: number): number => sc.stopX - ft * sc.pxPerFt;
  ctx.font = FONT;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = col.muted;
  ctx.fillRect(sc.laneX0, laneY, sc.W - sc.laneX0, laneH);
  ctx.strokeStyle = col.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sc.laneX0, laneY + 0.5); ctx.lineTo(sc.W, laneY + 0.5);
  ctx.moveTo(sc.laneX0, laneY + laneH - 0.5); ctx.lineTo(sc.W, laneY + laneH - 0.5);
  ctx.stroke();

  // the bay — storage.availableFt back from the bar, in the verdict's tone
  const avail = r.storage.availableFt, tone = TONE[r.storage.verdict];
  if (avail !== null && tone) {
    const x0 = Math.max(sc.laneX0, xOf(avail));
    ctx.fillStyle = tone;
    ctx.fillRect(x0, laneY + laneH + 24, sc.stopX - x0, 3);
    ctx.fillRect(x0, laneY + laneH + 22, 1, 10);
    label(ctx, `storage ${avail} ft · ${r.storage.verdict === "pass" ? "adequate" : r.storage.verdict === "marginal" ? "marginal" : "short"}`, x0, laneY + laneH + 44, tone, x0 > sc.W * 0.6 ? "right" : "left");
  }

  if (r.queue.averageFt !== undefined) mark(ctx, sc, xOf(r.queue.averageFt), laneY, laneH, col.mutedFg, `avg ${r.queue.averageFt} ft`, "below");
  mark(ctx, sc, xOf(r.queue.p95Ft), laneY, laneH, col.fg, `95th ${r.queue.p95Ft} ft`, "above");

  ctx.fillStyle = col.fg;
  ctx.fillRect(sc.stopX - 1.5, laneY - 3, 3, laneH + 6);

  const hx = sc.stopX + 17, hy = laneY - 12;
  ctx.fillStyle = col.border;
  ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = sim.isGreen() ? SIGNAL.green : SIGNAL.red;
  ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI * 2); ctx.fill();

  for (const v of sim.vehicles) {
    const nose = xOf(v.x), x = nose - sc.carL;
    if (x > sc.W || nose < 0) continue;
    ctx.fillStyle = col.fg;
    ctx.globalAlpha = 0.85;
    car(ctx, x, cy - sc.carH / 2, sc.carL, sc.carH);
    ctx.globalAlpha = 1;
    if (v.state === "queued") {
      ctx.fillStyle = SIGNAL.red;
      ctx.fillRect(x, cy - sc.carH / 2 + 1, 1.5, 1.5);
      ctx.fillRect(x, cy + sc.carH / 2 - 2.5, 1.5, 1.5);
    }
  }
}

/** The queuing study's report on the lane — its inputs map 1:1 onto `QueueLaneInputs`. */
export function QueueAnimation({ report }: { report: QueuingReportT }) {
  const inputs = useMemo<QueueLaneInputs>(() => {
    const lanes = Math.max(1, report.inputs.laneCount);
    return {
      arrivalVph: report.inputs.hourlyVolumeVph,
      arrivalPerLaneVph: report.inputs.hourlyVolumeVph / lanes,
      laneCount: lanes,
      satFlowVphpl: report.inputs.saturationFlowVphpl,
      cycleSec: report.inputs.cycleLengthSec,
      effectiveGreenSec: report.inputs.effectiveGreenSec,
      spacingFt: report.inputs.vehicleSpacingFt,
      capacityPerLaneVph: report.capacity.perLaneVph,
      vOverC: report.capacity.vOverC,
      queue: {
        averageVehicles: report.queue.averageVehicles,
        averageFt: report.queue.averageFt,
        averageSource: "report",
        p95Vehicles: report.queue.p95Vehicles,
        p95Ft: report.queue.p95Ft,
      },
      storage: { availableFt: report.storage.availableFt, verdict: report.storage.verdict },
    };
  }, [report]);
  return <QueueLaneAnimation {...inputs} />;
}

export function QueueLaneAnimation(inputs: QueueLaneInputs) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const refs = useRef<Refs>({});
  const bind = (key: string) => (node: HTMLElement | null) => { refs.current[key] = node; };
  const [run, setRun] = useState(0);
  const [reduced] = useState(prefersReducedMotion);

  const lanes = Math.max(1, inputs.laneCount);
  const lambda = inputs.arrivalPerLaneVph;
  const {
    arrivalVph, satFlowVphpl, cycleSec, effectiveGreenSec, spacingFt, capacityPerLaneVph, vOverC,
    queue, storage, title = "Queue forming · one lane", captionPrefix, testId = "anim-queue", className,
  } = inputs;
  // The scene re-seeds only when a number the sim or the marks read changes —
  // not on every parent render with a fresh props object.
  const sceneKey = JSON.stringify([lambda, satFlowVphpl, cycleSec, effectiveGreenSec, spacingFt, queue, storage]);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const el = refs.current;
    const text = (key: string, value: string) => { const n = el[key]; if (n && n.textContent !== value) n.textContent = value; };

    let dpr = 1, sc = layout(canvas.clientWidth || 640, inputs);
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth || 640;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      sc = layout(W, inputs);
    };
    resize();
    let col = readColors(wrap);

    // vehicles enter two slots beyond the drawn lane; the clock pre-rolls one
    // travel time so the first frame already has traffic on the lane
    const entryFt = (sc.stopX - sc.laneX0) / sc.pxPerFt + 2 * spacingFt;
    const sim = new QueueSim({
      arrivalVph: lambda,
      satFlowVphpl,
      cycleSec,
      greenSec: effectiveGreenSec,
      spacingFt,
      entryFt,
      seed: 7 + run * 101,
      startAt: -(entryFt / VMAX_FTPS + 6),
    });
    const paint = () => draw(ctx, sc, dpr, sim, inputs, col);

    const themeObs = new MutationObserver(() => { col = readColors(wrap); paint(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let holding = false;
    if (reduced) {
      sim.setStaticQueue(Math.round(queue.p95Vehicles));
      paint();
      text("qveh", String(queue.p95Vehicles));
      text("qft", String(queue.p95Ft));
      text("phase", "red · 95th-percentile queue");
      text("cycle", "static");
      text("mean", "—");
      const onResize = () => { resize(); paint(); };
      window.addEventListener("resize", onResize);
      return () => { window.removeEventListener("resize", onResize); themeObs.disconnect(); };
    }

    while (sim.t < 0) sim.step(0.1);
    sim.resetStats(); // the pre-roll is scenery, not a cycle
    paint(); // first frame before any animation frame, so a background tab still shows the lane
    let raf = 0, last = performance.now(), tick = 0;

    const readout = () => {
      text("qveh", String(sim.queue));
      text("qft", String(Math.round(sim.queueFt())));
      text("phase", holding ? "held at end of red" : `${sim.isGreen() ? "green" : "red"} · ${Math.ceil(sim.secondsToChange())} s`);
      text("cycle", `cycle ${Math.min(HOLD_CYCLES, sim.cycles + 1)} of ${HOLD_CYCLES}`);
      const s = sim.redEndSamples();
      const n = s.length + (holding ? 1 : 0);
      if (n > 0) text("mean", ((s.reduce((a, b) => a + b, 0) + (holding ? sim.queue : 0)) / n).toFixed(1));
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      const rect = canvas.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return; // off-screen: wait
      let dt = dtReal * SIM_SPEED;
      while (dt > 0) {
        const h = Math.min(0.1, dt);
        if (!sim.isGreen() && sim.cycles + 1 >= HOLD_CYCLES && sim.secondsToChange() <= h) {
          sim.step(sim.secondsToChange() - 1e-4); // stop just before the light changes: the queue at its longest
          holding = true;
          break;
        }
        sim.step(h);
        dt -= h;
      }
      if ((tick & 63) === 0) col = readColors(wrap);
      paint();
      if ((tick++ & 3) === 0 || holding) readout();
      if (holding) { cancelAnimationFrame(raf); raf = 0; }
    };
    raf = requestAnimationFrame(frame);
    const onResize = () => { resize(); paint(); }; // setting canvas.width clears it
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); themeObs.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, run, reduced]);

  const gC = effectiveGreenSec / cycleSec;
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const caption =
    `${captionPrefix ? `${captionPrefix} · ` : ""}Webster cyclic queue · λ ${fmt(lambda)} vph${lanes > 1 ? `/ln (${fmt(arrivalVph)} vph ÷ ${lanes} ln)` : ""}` +
    ` · s ${fmt(satFlowVphpl)} vphpl × g/C ${effectiveGreenSec}/${cycleSec} s = ${gC.toFixed(2)}` +
    ` → c ${fmt(capacityPerLaneVph)} vph/ln · X ${vOverC.toFixed(2)} · ${spacingFt} ft per queued vehicle`;
  const storageNote = storage.availableFt !== null ? `, storage ${storage.availableFt} ft (${storage.verdict})` : "";
  const averageNote = queue.averageFt !== undefined ? `average ${queue.averageFt} ft, ` : "";
  const replayTestId = `button-${testId.replace(/^anim-/, "")}-replay`;

  return (
    <div
      ref={wrapRef}
      className={`border rounded-lg p-4 space-y-2${className ? ` ${className}` : ""}`}
      data-testid={testId}
      role="img"
      aria-label={`One lane forming a queue at the signal: ${averageNote}95th percentile ${queue.p95Ft} ft${storageNote}.`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
          <Activity className="w-3 h-3" /> {title}{reduced ? "" : ` · ${SIM_SPEED}× time-lapse`}
        </div>
        <div className="font-mono text-xs tabular-nums text-muted-foreground">
          <span ref={bind("phase")}>red</span> · <span ref={bind("cycle")}>cycle 1 of {HOLD_CYCLES}</span>
        </div>
      </div>
      <canvas ref={canvasRef} className="block w-full" style={{ height: H }} aria-hidden />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono text-sm tabular-nums">
          <span ref={bind("qveh")} className="font-semibold">0</span> veh · <span ref={bind("qft")} className="font-semibold">0</span> ft in queue
          <span className="text-muted-foreground"> · end-of-red mean <span ref={bind("mean")}>—</span> veh{queue.averageVehicles !== undefined ? ` (${queue.averageSource ?? "report"} ${queue.averageVehicles})` : ""}</span>
        </div>
        {!reduced && (
          <button
            type="button"
            onClick={() => setRun((r) => r + 1)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            data-testid={replayTestId}
          >
            <RotateCcw className="w-3 h-3" /> Replay
          </button>
        )}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground leading-relaxed">{caption}</div>
    </div>
  );
}
