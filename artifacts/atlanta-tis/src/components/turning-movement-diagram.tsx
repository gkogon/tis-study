/**
 * TurningMovementDiagram — one signal's project trips by turning movement,
 * drawn as an SVG junction: twelve arrows (L / T / R from NB, SB, EB, WB),
 * one per movement of the row's `movements` table, in the frame
 * `intersection-plan.tsx` uses (north up, 640 × 400, an approach on the
 * right-hand side of its leg, the same lane width).
 *
 *   stroke width   ∝ the movement's integer trips (the largest cell is the
 *                  widest); a movement with no trips is a faint hairline so
 *                  the twelve-cell structure stays visible
 *   tint           amber = trips travelling AWAY from the site (outbound),
 *                  blue = trips travelling TOWARD it (inbound) — the map's
 *                  project-trip blue. A movement carrying both draws the
 *                  inbound share as a blue core over an amber stroke.
 *   label          the integer trips beside the arrow's exit; hover an arrow
 *                  for the exact load and its inbound / outbound parts
 *   particles      stream along each arrow, entry → exit (the direction the
 *                  vehicle actually moves through the junction, whichever
 *                  way the trip is bound), at a rate ∝ trips; each particle
 *                  is blue or amber in the movement's inbound proportion.
 *                  rAF, refs, no per-frame React state; reduced motion →
 *                  static, no particles
 *   site marker    a small pointer at the frame edge in the junction → site
 *                  bearing (the engine's own bearingDeg), so the leg that
 *                  faces the site is visible
 *
 * Tabs (AM / PM, the report's period reports) and the base / scenario
 * toggle are rendered here but owned by the caller, so the section's other
 * readouts follow the same choice. Every number drawn comes from
 * `DistributionPeriodModel` (lib/intersection-study-model.ts
 * distributionForRow) — the row's own table and the engine's own split.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DistributionPeriodModel, DistributionCell } from "@/lib/intersection-study-model";
import { type IntersectionPlan as Plan, type Direction, type Movement, DIRECTIONS } from "@/lib/intersection-geometry";

const W = 640;
const H = 400;
const CX = W / 2;
const CY = H / 2;
const LW = 13;              // lane width, viewBox units (the plan's)
const EDGE = 14;            // legs stop this close to the frame
const MIN_HALF_W = 3 * 11;  // a half-road is at least wide enough for three arrows 11 apart
const MAX_STROKE = 10;
const MIN_STROKE = 1.6;
const PARTICLE_POOL = 44;
const MAX_EMIT_PER_S = 1.8; // particles per second on the busiest movement
const PARTICLE_SPEED = 0.32; // arrow lengths per second

export const INBOUND_COLOR = "#3B82F6";   // blue-500 — the map's project-trip blue
export const OUTBOUND_COLOR = "#F59E0B";  // amber-500

type Vec = [number, number];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
/** Right of a travel direction in screen space (y down): rotate 90° clockwise. */
const rightOf = (f: Vec): Vec => [-f[1], f[0]];

/** Unit travel vector per direction, SVG space (north up). */
const FORWARD: Record<Direction, Vec> = { NB: [0, -1], SB: [0, 1], EB: [1, 0], WB: [-1, 0] };
const DIR_OF = (f: Vec): Direction => (f[0] === 0 ? (f[1] < 0 ? "NB" : "SB") : f[0] > 0 ? "EB" : "WB");
/** Exit travel vector for a movement (right-hand traffic). */
function exitVector(d: Direction, m: Movement): Vec {
  const f = FORWARD[d], r = rightOf(f);
  return m === "T" ? f : m === "R" ? r : mul(r, -1);
}

type Frame = {
  /** Half-width of each direction's approach lanes (right of its centreline). */
  approachW: Record<Direction, number>;
  /** Width of each direction's departure lanes (through lanes only). */
  departW: Record<Direction, number>;
  bayW: Record<Direction, number>;
  /** Distance from the centre to the junction box edge on the side an approach comes from. */
  stopOff: Record<Direction, number>;
  /** Distance from the centre to the frame edge along each travel direction. */
  legEnd: Record<Direction, number>;
};

function frameFromPlan(plan: Plan): Frame {
  const byDir = new Map(plan.approaches.map((a) => [a.direction, a]));
  const approachW = {} as Record<Direction, number>, departW = {} as Record<Direction, number>, bayW = {} as Record<Direction, number>;
  for (const d of DIRECTIONS) {
    const a = byDir.get(d);
    const bay = a?.leftBay.present ? LW : 0;
    const through = Math.max(1, a?.throughLanes ?? 1) * LW;
    bayW[d] = bay;
    approachW[d] = Math.max(MIN_HALF_W, bay + through);
    departW[d] = Math.max(MIN_HALF_W, through);
  }
  // The cross road's half-width on the side an approach enters from is the
  // approach lanes of the direction whose right-hand side faces that way.
  const stopOff = {} as Record<Direction, number>;
  for (const d of DIRECTIONS) {
    const back = mul(FORWARD[d], -1);
    const side = DIRECTIONS.find((e) => { const r = rightOf(FORWARD[e]); return r[0] === back[0] && r[1] === back[1]; })!;
    stopOff[d] = approachW[side];
  }
  const legEnd: Record<Direction, number> = { NB: CY - EDGE, SB: H - CY - EDGE, EB: W - CX - EDGE, WB: CX - EDGE };
  return { approachW, departW, bayW, stopOff, legEnd };
}

/** Offset of a movement's lane from the centreline, on the approach and on the departure. */
function laneOffsets(fr: Frame, d: Direction, m: Movement): { a: number; b: number } {
  const exitDir = DIR_OF(exitVector(d, m));
  const aw = fr.approachW[d], dw = fr.departW[exitDir];
  const pos = m === "L" ? 1 / 6 : m === "T" ? 1 / 2 : 5 / 6;
  return { a: aw * pos, b: dw * pos };
}

/** The arrow's path: outer end of the approach → stop line → (curve) → box edge on the exit leg → outer end of the exit leg. */
function arrowPath(fr: Frame, d: Direction, m: Movement): { d: string; end: Vec; exitF: Vec; exitR: Vec; label: Vec; b: number } {
  const C: Vec = [CX, CY];
  const f = FORWARD[d], r = rightOf(f);
  const f2 = exitVector(d, m), r2 = rightOf(f2);
  const exitDir = DIR_OF(f2);
  const { a, b } = laneOffsets(fr, d, m);
  // The departure begins at the box edge on the exit side: the cross road's
  // half-width there is the approach lanes of the direction whose right faces +f2.
  const exitSide = DIRECTIONS.find((e) => { const rr = rightOf(FORWARD[e]); return rr[0] === f2[0] && rr[1] === f2[1]; })!;
  const exitOff = fr.approachW[exitSide];
  const p0 = add(add(C, mul(f, -fr.legEnd[d])), mul(r, a));
  const p1 = add(add(C, mul(f, -fr.stopOff[d])), mul(r, a));
  const p2 = add(add(C, mul(f2, exitOff)), mul(r2, b));
  const p3 = add(add(C, mul(f2, fr.legEnd[exitDir] - 6)), mul(r2, b));
  const fmt = (p: Vec) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  let mid: string;
  if (m === "T") {
    // Straight through, easing across a bay's width if the departure is narrower.
    const c1 = add(add(C, mul(f, -fr.stopOff[d] * 0.4)), mul(r, a));
    const c2 = add(add(C, mul(f2, exitOff * 0.4)), mul(r2, b));
    mid = `C ${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`;
  } else {
    // The corner where the entry lane line meets the exit lane line.
    const pc = add(add(C, mul(r, a)), mul(r2, b));
    mid = `Q ${fmt(pc)} ${fmt(p2)}`;
  }
  const label = add(add(C, mul(f2, exitOff + 0.58 * (fr.legEnd[exitDir] - exitOff))), mul(r2, b));
  return { d: `M ${fmt(p0)} L ${fmt(p1)} ${mid} L ${fmt(p3)}`, end: p3, exitF: f2, exitR: r2, label, b };
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const MOVEMENT_WORD: Record<Movement, string> = { L: "left", T: "through", R: "right" };

export type TurningMovementDiagramProps = {
  model: DistributionPeriodModel;
  plan: Plan;
  /** Junction → site bearing, degrees clockwise from north (the engine's own), for the site pointer. */
  siteBearingDeg: number;
  siteDistanceMi: number;
  tabs: Array<{ key: string; label: string }>;
  activeTab: string;
  onTab: (key: string) => void;
  /** Present when a scenario model exists for this signal. */
  view?: "base" | "scenario";
  onView?: (v: "base" | "scenario") => void;
  className?: string;
};

type Particle = { cell: number; s: number; inbound: boolean; alive: boolean };

export function TurningMovementDiagram({ model, plan, siteBearingDeg, siteDistanceMi, tabs, activeTab, onTab, view, onView, className }: TurningMovementDiagramProps) {
  const reduced = useMemo(prefersReducedMotion, []);
  const fr = useMemo(() => frameFromPlan(plan), [plan]);
  const [hover, setHover] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const pathRefs = useRef<Array<SVGPathElement | null>>([]);
  const particleRefs = useRef<Array<SVGCircleElement | null>>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  const arrows = useMemo(() => model.cells.map((c) => ({ cell: c, geo: arrowPath(fr, c.approach, c.movement) })), [model, fr]);
  const max = Math.max(1, model.maxCellTrips);
  const widthOf = (c: DistributionCell) => (c.trips > 0 ? MIN_STROKE + (MAX_STROKE - MIN_STROKE) * (c.trips / max) : 1);
  const inFrac = (c: DistributionCell) => (c.exact > 0 ? Math.min(1, Math.max(0, c.inbound / c.exact)) : 0);
  const hasSplit = model.cellDirectionBasis !== "none";

  // ---- particles ----
  useEffect(() => {
    const svg = svgRef.current; if (!svg || reduced) return;
    const lengths = pathRefs.current.map((p) => (p ? p.getTotalLength() : 0));
    const rates = model.cells.map((c) => (c.trips > 0 ? MAX_EMIT_PER_S * (c.trips / max) : 0));
    const fracs = model.cells.map(inFrac);
    const particles: Particle[] = Array.from({ length: PARTICLE_POOL }, () => ({ cell: 0, s: 0, inbound: false, alive: false }));
    let seed = 11;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let visible = true;
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }) : null;
    io?.observe(svg);
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!visible) return;
      for (let i = 0; i < rates.length; i++) {
        const rate = rates[i] ?? 0;
        if (rate <= 0 || rnd() >= rate * dt) continue;
        const free = particles.find((q) => !q.alive);
        if (!free) break;
        free.alive = true; free.cell = i; free.s = 0; free.inbound = rnd() < (fracs[i] ?? 0);
      }
      const hov = hoverRef.current;
      for (let k = 0; k < particles.length; k++) {
        const q = particles[k]!, el = particleRefs.current[k];
        if (!el) continue;
        if (!q.alive) { el.setAttribute("opacity", "0"); continue; }
        q.s += PARTICLE_SPEED * dt;
        const path = pathRefs.current[q.cell], len = lengths[q.cell] ?? 0;
        if (q.s >= 1 || !path || len <= 0) { q.alive = false; el.setAttribute("opacity", "0"); continue; }
        const pt = path.getPointAtLength(q.s * len);
        el.setAttribute("cx", pt.x.toFixed(2)); el.setAttribute("cy", pt.y.toFixed(2));
        el.setAttribute("fill", q.inbound ? INBOUND_COLOR : OUTBOUND_COLOR);
        const fade = Math.min(1, q.s / 0.08, (1 - q.s) / 0.12);
        const dim = hov !== null && hov !== q.cell ? 0.2 : 1;
        el.setAttribute("opacity", (0.95 * fade * dim).toFixed(3));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [model, fr, reduced, max]);

  function setHov(i: number | null) { hoverRef.current = i; setHover(i); }

  const hovered = hover !== null ? model.cells[hover] ?? null : null;
  const byDir = new Map(plan.approaches.map((a) => [a.direction, a]));
  const siteAngle = ((siteBearingDeg % 360) + 360) % 360;
  const siteVec: Vec = [Math.sin((siteAngle * Math.PI) / 180), -Math.cos((siteAngle * Math.PI) / 180)];
  // Where the site pointer meets the frame: walk the bearing to the edge.
  const edgeT = Math.min(Math.abs((siteVec[0] !== 0 ? (siteVec[0] > 0 ? W - CX - 26 : CX - 26) / siteVec[0] : Infinity)), Math.abs((siteVec[1] !== 0 ? (siteVec[1] > 0 ? H - CY - 26 : CY - 26) / siteVec[1] : Infinity)));
  const sitePt = add([CX, CY], mul(siteVec, edgeT));
  const aria = `Turning movements at ${plan.name}, ${model.periodLabel}: ${model.cells.filter((c) => c.trips > 0).map((c) => `${c.approach} ${MOVEMENT_WORD[c.movement]} ${c.trips}`).join(", ") || "no project trips"}. ${model.total.trips} project trips in all${hasSplit ? `, ${model.total.inbound.toFixed(1)} toward the site and ${model.total.outbound.toFixed(1)} away` : ""}.`;

  return (
    <div className={className} data-testid="turning-movement-diagram">
      <div className="flex flex-wrap items-center gap-2 mb-2 print:hidden">
        <div className="flex items-center gap-1 text-xs" role="tablist" aria-label="Analysis period">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => onTab(t.key)}
              className={`rounded border px-2 py-0.5 ${activeTab === t.key ? "bg-foreground text-background" : "hover:bg-muted"}`}
              data-testid={`tmd-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {view && onView && (
          <div className="flex items-center gap-1 text-xs ml-auto" role="tablist" aria-label="Base or scenario">
            {(["base", "scenario"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onView(v)} className={`rounded border px-2 py-0.5 ${view === v ? "bg-foreground text-background" : "hover:bg-muted"}`} data-testid={`tmd-view-${v}`}>
                {v === "base" ? "Base" : "Scenario"}
              </button>
            ))}
          </div>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxHeight: 420, height: "auto", display: "block" }}
        role="img"
        aria-label={aria}
        className="font-mono text-[10px] select-none"
        onMouseLeave={() => setHov(null)}
        data-period={model.period}
      >
        {/* Road slabs: each approach's lanes (right of the centreline) and the opposite direction's departure lanes. */}
        {DIRECTIONS.map((d) => {
          const f = FORWARD[d], r = rightOf(f);
          const legLen = fr.legEnd[d] - fr.stopOff[d];
          const p = add(add([CX, CY], mul(f, -fr.legEnd[d])), mul(r, 0));
          const opp = DIR_OF(mul(f, -1));
          const w1 = fr.approachW[d], w2 = fr.departW[opp];
          // Rectangle from the outer end to the stop line spanning [-w2, w1] across.
          const c0 = add(p, mul(r, -w2)), c1 = add(p, mul(r, w1)), c2 = add(add(p, mul(f, legLen)), mul(r, w1)), c3 = add(add(p, mul(f, legLen)), mul(r, -w2));
          const cl0 = p, cl1 = add(p, mul(f, legLen));
          return (
            <g key={d}>
              <polygon points={[c0, c1, c2, c3].map((q) => `${q[0]},${q[1]}`).join(" ")} className="fill-neutral-300 dark:fill-neutral-700" />
              <line x1={cl0[0]} y1={cl0[1]} x2={cl1[0]} y2={cl1[1]} strokeWidth="1" className="stroke-amber-500/70" />
            </g>
          );
        })}
        {/* The junction box. */}
        <rect x={CX - fr.approachW.SB} y={CY - fr.approachW.WB} width={fr.approachW.SB + fr.approachW.NB} height={fr.approachW.WB + fr.approachW.EB} className="fill-neutral-300 dark:fill-neutral-700" />

        {/* Arrows: amber stroke, blue core in the inbound proportion, one head. */}
        <g strokeLinecap="round" strokeLinejoin="round" fill="none">
          {arrows.map(({ cell, geo }, i) => {
            const w = widthOf(cell);
            const fi = hasSplit ? inFrac(cell) : 0;
            const dimmed = hover !== null && hover !== i;
            const zero = cell.trips <= 0;
            const headLen = zero ? 5 : 2.2 * w + 4, headHalf = zero ? 2.5 : 1.1 * w + 2;
            const tip = geo.end, base = add(tip, mul(geo.exitF, -headLen));
            const hl = add(base, mul(geo.exitR, headHalf)), hr = add(base, mul(geo.exitR, -headHalf));
            const headColor = !hasSplit ? "currentColor" : fi >= 0.5 ? INBOUND_COLOR : OUTBOUND_COLOR;
            const title = `${cell.approach} ${MOVEMENT_WORD[cell.movement]}: ${cell.trips} trips (exact ${cell.exact.toFixed(2)})${hasSplit ? ` — ${cell.inbound.toFixed(2)} toward the site, ${cell.outbound.toFixed(2)} away` : ""}`;
            return (
              <g key={`${cell.approach}${cell.movement}`} opacity={dimmed ? 0.3 : 1} className="transition-opacity duration-150 motion-reduce:transition-none" data-testid={`tmd-arrow-${cell.approach}${cell.movement}`} data-trips={cell.trips}>
                <title>{title}</title>
                {zero ? (
                  <path ref={(el) => { pathRefs.current[i] = el; }} d={geo.d} stroke="currentColor" strokeWidth={1} strokeDasharray="3 4" opacity={0.28} />
                ) : (
                  <>
                    <path ref={(el) => { pathRefs.current[i] = el; }} d={geo.d} stroke={hasSplit ? OUTBOUND_COLOR : "currentColor"} strokeWidth={w} opacity={hasSplit ? 0.9 : 0.75} />
                    {hasSplit && fi > 0 && <path d={geo.d} stroke={INBOUND_COLOR} strokeWidth={Math.max(0.8, w * fi)} opacity={0.95} />}
                  </>
                )}
                <polygon points={`${tip[0]},${tip[1]} ${hl[0]},${hl[1]} ${hr[0]},${hr[1]}`} fill={headColor} stroke="none" opacity={zero ? 0.28 : 1} />
                {/* Wide invisible hit area. */}
                <path d={geo.d} stroke="transparent" strokeWidth={Math.max(12, w + 8)} onMouseEnter={() => setHov(i)} onFocus={() => setHov(i)} onBlur={() => setHov(null)} tabIndex={0} aria-label={title} className="outline-none" style={{ pointerEvents: "stroke" }} />
              </g>
            );
          })}
        </g>

        {/* Particles. */}
        {!reduced && (
          <g aria-hidden pointerEvents="none">
            {Array.from({ length: PARTICLE_POOL }, (_, k) => (
              <circle key={k} ref={(el) => { particleRefs.current[k] = el; }} r={2.4} opacity={0} className="stroke-background" strokeWidth={0.8} />
            ))}
          </g>
        )}

        {/* Labels: the integer trips beside each arrow's exit. */}
        <g className="fill-foreground font-semibold" pointerEvents="none">
          {arrows.map(({ cell, geo }) => {
            if (cell.trips <= 0) return null;
            const w = widthOf(cell);
            const p = add(geo.label, mul(geo.exitR, w / 2 + 9));
            const text = String(cell.trips);
            const tw = text.length * 6.5 + 6;
            return (
              <g key={`${cell.approach}${cell.movement}-l`} transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`} data-testid={`tmd-label-${cell.approach}${cell.movement}`}>
                <rect x={-tw / 2} y={-7} width={tw} height={14} rx={3} className="fill-background/90" />
                <text textAnchor="middle" y={3.5}>{text}</text>
              </g>
            );
          })}
        </g>

        {/* Approach captions at each leg's outer end. */}
        {DIRECTIONS.map((d) => {
          const a = byDir.get(d);
          const t = model.approaches[d];
          const f = FORWARD[d], r = rightOf(f);
          const anchorPt = add(add([CX, CY], mul(f, -(fr.legEnd[d] + 3))), mul(r, fr.approachW[d] / 2));
          const text = `${d}${a ? ` · ${a.throughLanes} ln` : ""} · +${t.trips}`;
          const props = d === "NB" ? { x: anchorPt[0], y: anchorPt[1] + 10, anchor: "middle" as const }
            : d === "SB" ? { x: anchorPt[0], y: anchorPt[1] - 4, anchor: "middle" as const }
            : d === "EB" ? { x: anchorPt[0] - 2, y: anchorPt[1] + 12, anchor: "end" as const }
            : { x: anchorPt[0] + 2, y: anchorPt[1] - 8, anchor: "start" as const };
          return <text key={d} x={props.x} y={props.y} textAnchor={props.anchor} className="fill-muted-foreground">{text}</text>;
        })}

        {/* Site pointer: the junction → site bearing. */}
        <g transform={`translate(${sitePt[0].toFixed(1)} ${sitePt[1].toFixed(1)}) rotate(${siteAngle.toFixed(1)})`} className="fill-amber-500 stroke-amber-500" data-testid="tmd-site-pointer">
          <line x1={0} y1={12} x2={0} y2={-6} strokeWidth="1.4" />
          <polygon points="0,-12 -4,-4 4,-4" stroke="none" />
        </g>
        <text x={sitePt[0] + (siteVec[0] >= 0 ? -6 : 6)} y={sitePt[1] + (siteVec[1] >= 0 ? -10 : 18)} textAnchor={siteVec[0] >= 0 ? "end" : "start"} className="fill-amber-600 dark:fill-amber-400">site {siteDistanceMi.toFixed(2)} mi</text>

        {/* Compass. */}
        <g className="fill-muted-foreground stroke-muted-foreground" transform={`translate(${W - 22} 22)`}>
          <line x1="0" y1="10" x2="0" y2="-8" strokeWidth="1.2" />
          <polygon points="0,-12 -3.5,-5 3.5,-5" stroke="none" />
          <text x="0" y="22" textAnchor="middle" stroke="none" className="fill-muted-foreground">N</text>
        </g>
        <text x={W - EDGE} y={H - 6} textAnchor="end" className="fill-muted-foreground">{model.periodLabel}{view === "scenario" ? " · scenario" : ""} · {model.total.trips} trips</text>
      </svg>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground leading-snug">
        <span><i className="inline-block w-3 h-1.5 rounded-sm align-middle mr-1" style={{ background: OUTBOUND_COLOR }} />away from the site (outbound)</span>
        <span><i className="inline-block w-3 h-1.5 rounded-sm align-middle mr-1" style={{ background: INBOUND_COLOR }} />toward the site (inbound)</span>
        <span>width ∝ trips · dotted = none on this movement</span>
      </div>
      <div className="min-h-[2.25rem] mt-1 text-xs font-mono tabular-nums" aria-live="polite" data-testid="tmd-readout">
        {hovered ? (
          <>
            <span className="font-semibold">{hovered.approach} {MOVEMENT_WORD[hovered.movement]}</span>
            {" · "}{hovered.trips} trips <span className="text-muted-foreground">(exact {hovered.exact.toFixed(3)})</span>
            {hasSplit && <> · <span style={{ color: INBOUND_COLOR }}>{hovered.inbound.toFixed(2)} in</span> / <span style={{ color: OUTBOUND_COLOR }}>{hovered.outbound.toFixed(2)} out</span></>}
          </>
        ) : (
          <span className="text-muted-foreground font-sans">Hover an arrow for its exact load. "NB left" is a vehicle travelling north (in from the south leg) turning left; U-turns are folded into left.</span>
        )}
      </div>
    </div>
  );
}
