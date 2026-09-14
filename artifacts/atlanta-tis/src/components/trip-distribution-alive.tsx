/**
 * TripDistributionAlive — the report's directional distribution as a live
 * compass rose.
 *
 * Eight wedges, one per octant clockwise from north (NNE first, the order
 * the bars and the PDF use), each drawn to its `byDirection` share on the
 * same scale as the bars (length ∝ share of the largest octant). On mount
 * the wedges grow to their share over ~1.2 s; particles then stream from
 * the hub out along each wedge at a rate proportional to its share. Every
 * destination zone the engine carried is a dot at its own `bearingDeg`,
 * with distance on a log scale from the hub; dots light in descending
 * share order and the ten heaviest wear the rank numeral the zone table
 * below keys on.
 *
 * Hover (or focus) a sector → `onHoverOctant(octant)`; the page hands it to
 * `StudyMapAlive` as `highlightOctant`, which dims every flow and badge
 * outside that bearing sector. Leaving the rose sends null.
 *
 * Nothing is invented: shares, bearings, distances and the method label all
 * come from `report.tripDistribution` (`lib/distribution-rose.ts` lays them
 * out; `scripts/check-distribution-alive.mjs` pins the geometry). Live
 * values are written to SVG attributes from one rAF loop — no per-frame
 * React state. With prefers-reduced-motion the rose renders its final state
 * and no particles run.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { TisReport } from "@workspace/tis-api-client-react";
import {
  roseGeometry, sectorPath, bearingToXY, bearingToOctant, easeOut, type Octant, type RoseGeometry,
} from "../lib/distribution-rose";

export type TripDistributionAliveProps = {
  report: TisReport;
  /** Octant under the pointer (or keyboard focus), null when none. */
  onHoverOctant?: (octant: Octant | null) => void;
};

const R = 110;           // rose radius, viewBox units
const R0 = 9;            // hub radius
const VB = 150;          // half the viewBox — room for the rim labels
const RIM_LABEL_R = R + 21;
const HOVER_R = RIM_LABEL_R + 10; // pointer inside this radius reads an octant
const FILL_MS = 1200;    // wedges reach their share
const ZONE_START_MS = 450;
const ZONE_STEP_MS = 45; // one zone lights every 45 ms, heaviest first
const ZONE_FADE_MS = 260;
const LABEL_COUNT = 10;
const PARTICLE_POOL = 48;
const MAX_EMIT_PER_S = 2.4;   // particles per second on the busiest wedge
const PARTICLE_SPEED = 0.7;   // wedge lengths per second

type Particle = { wedge: number; deg: number; s: number; alive: boolean };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wedgePath(g: RoseGeometry, i: number, p: number): string {
  const w = g.wedges[i]!;
  return sectorPath(w.startDeg, w.endDeg, g.innerRadius, g.innerRadius + w.fill * p * (g.radius - g.innerRadius));
}

export function TripDistributionAlive({ report, onHoverOctant }: TripDistributionAliveProps) {
  const td = report.tripDistribution;
  const reduced = useMemo(prefersReducedMotion, []);
  const geom = useMemo(
    () => roseGeometry(td?.byDirection, td?.zones, { radius: R, innerRadius: R0, labelCount: LABEL_COUNT }),
    [td],
  );
  const [hovered, setHovered] = useState<Octant | null>(null);
  const hoverRef = useRef<Octant | null>(null);
  const cbRef = useRef(onHoverOctant);
  cbRef.current = onHoverOctant;
  const svgRef = useRef<SVGSVGElement>(null);
  const wedgeRefs = useRef<Array<SVGPathElement | null>>([]);
  const zoneRefs = useRef<Array<SVGGElement | null>>([]);
  const particleRefs = useRef<Array<SVGCircleElement | null>>([]);

  function hover(o: Octant | null) {
    if (hoverRef.current === o) return;
    hoverRef.current = o;
    setHovered(o);
    cbRef.current?.(o);
  }
  // A rose that unmounts mid-hover must not leave the map dimmed.
  useEffect(() => () => { if (hoverRef.current !== null) cbRef.current?.(null); }, []);

  /** Octant under the pointer, from its bearing about the hub — null on the hub or outside the rim labels. */
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const x = ((e.clientX - rect.left) / rect.width) * (2 * VB) - VB;
    const y = ((e.clientY - rect.top) / rect.height) * (2 * VB) - VB;
    const r = Math.hypot(x, y);
    if (r < R0 || r > HOVER_R) { hover(null); return; }
    hover(bearingToOctant((Math.atan2(x, -y) * 180) / Math.PI));
  }

  // ---- the loop: wedge fill, zone reveal, particles ----
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const g = geom;
    const setWedges = (p: number) => { for (let i = 0; i < g.wedges.length; i++) wedgeRefs.current[i]?.setAttribute("d", wedgePath(g, i, p)); };
    const setZone = (i: number, o: number) => zoneRefs.current[i]?.setAttribute("opacity", o.toFixed(3));
    if (reduced) {
      setWedges(1);
      for (let i = 0; i < g.zones.length; i++) setZone(i, 1);
      return;
    }
    setWedges(0);
    for (let i = 0; i < g.zones.length; i++) setZone(i, 0);

    const rates = g.wedges.map((w) => w.fill * MAX_EMIT_PER_S);
    const particles: Particle[] = Array.from({ length: PARTICLE_POOL }, () => ({ wedge: 0, deg: 0, s: 0, alive: false }));
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let visible = true;
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }) : null;
    io?.observe(svg);

    const t0 = performance.now();
    let last = t0, raf = 0, fillDone = false, zonesDone = false;
    const zonesEndMs = ZONE_START_MS + g.zones.length * ZONE_STEP_MS + ZONE_FADE_MS;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const el = now - t0;
      const p = fillDone ? 1 : easeOut(el / FILL_MS);
      if (!fillDone) { setWedges(p); if (p >= 1) fillDone = true; }
      if (!zonesDone) {
        for (let i = 0; i < g.zones.length; i++) setZone(i, easeOut((el - (ZONE_START_MS + i * ZONE_STEP_MS)) / ZONE_FADE_MS));
        if (el >= zonesEndMs) zonesDone = true;
      }
      if (!visible) return;
      // Emit: the busiest wedge launches MAX_EMIT_PER_S particles per second,
      // the rest in proportion to their share; a wedge still growing streams
      // only as far as it has grown.
      for (let i = 0; i < g.wedges.length; i++) {
        const w = g.wedges[i]!;
        if (w.fill <= 0 || rnd() >= (rates[i] ?? 0) * dt) continue;
        const free = particles.find((q) => !q.alive);
        if (!free) break;
        free.alive = true; free.wedge = i; free.s = 0;
        free.deg = w.startDeg + 4 + rnd() * (w.endDeg - w.startDeg - 8);
      }
      const hov = hoverRef.current;
      for (let k = 0; k < particles.length; k++) {
        const q = particles[k]!, c = particleRefs.current[k];
        if (!c) continue;
        if (!q.alive) { c.setAttribute("opacity", "0"); continue; }
        q.s += PARTICLE_SPEED * dt;
        if (q.s >= 1) { q.alive = false; c.setAttribute("opacity", "0"); continue; }
        const w = g.wedges[q.wedge]!;
        const len = w.fill * p * (g.radius - g.innerRadius);
        const [x, y] = bearingToXY(q.deg, g.innerRadius + q.s * len);
        c.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
        const fade = Math.min(1, q.s / 0.15, (1 - q.s) / 0.25);
        const dim = hov && hov !== w.octant ? 0.25 : 1;
        c.setAttribute("opacity", (0.9 * fade * dim).toFixed(3));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [geom, reduced]);

  if (!td) return null;

  const initialP = reduced ? 1 : 0;
  const zoneCount = geom.zones.length;
  const labelled = Math.min(LABEL_COUNT, zoneCount);
  const hoveredWedge = hovered ? geom.wedges.find((w) => w.octant === hovered) ?? null : null;
  const hoveredZones = hovered ? geom.zones.filter((z) => z.octant === hovered).length : 0;
  const aria = `Directional distribution: ${geom.wedges.map((w) => `${w.octant} ${w.sharePct.toFixed(1)}%`).join(", ")}. ${zoneCount} destination zones.`;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] items-start" data-testid="dist-rose">
      <svg
        ref={svgRef}
        viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
        className="w-full h-auto max-w-[300px] mx-auto md:mx-0 font-mono select-none"
        role="img"
        aria-label={aria}
        onMouseMove={onMove}
        onMouseLeave={() => hover(null)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hover(null); }}
      >
        {/* rim, spokes, octant labels */}
        <circle r={R} className="fill-none stroke-border" strokeWidth={1} />
        <g className="stroke-border" strokeWidth={0.75}>
          {geom.wedges.map((w) => { const [x, y] = bearingToXY(w.startDeg, R); return <line key={w.octant} x1={0} y1={0} x2={x} y2={y} />; })}
        </g>
        <g className="fill-muted-foreground" fontSize={7.5}>
          {geom.wedges.map((w) => {
            const [x, y] = bearingToXY(w.midDeg, RIM_LABEL_R);
            const dimmed = hovered !== null && hovered !== w.octant;
            return (
              <text key={w.octant} x={x} y={y} textAnchor="middle" opacity={dimmed ? 0.4 : 1} className="transition-opacity duration-150 motion-reduce:transition-none">
                <tspan x={x} dy={-2} className={hovered === w.octant ? "fill-foreground font-semibold" : ""}>{w.octant}</tspan>
                <tspan x={x} dy={9} className="fill-foreground">{w.sharePct.toFixed(1)}%</tspan>
              </text>
            );
          })}
        </g>

        {/* wedges: length ∝ share, same scale as the bars */}
        <g data-testid="dist-rose-wedges">
          {geom.wedges.map((w, i) => {
            const dimmed = hovered !== null && hovered !== w.octant;
            return (
              <path
                key={w.octant}
                ref={(el) => { wedgeRefs.current[i] = el; }}
                d={wedgePath(geom, i, initialP)}
                className={`transition-opacity duration-150 motion-reduce:transition-none ${hovered === w.octant ? "fill-blue-500 dark:fill-blue-400" : "fill-blue-500/60 dark:fill-blue-400/55"}`}
                opacity={dimmed ? 0.3 : 1}
                data-testid={`dist-rose-wedge-${w.octant}`}
              >
                <title>{`${w.octant} · ${w.sharePct.toFixed(1)}% of project trips`}</title>
              </path>
            );
          })}
        </g>

        {/* particles: project trips streaming outward, rate ∝ share */}
        {!reduced && (
          <g aria-hidden className="fill-blue-700 dark:fill-blue-200 pointer-events-none">
            {Array.from({ length: PARTICLE_POOL }, (_, k) => (
              <circle key={k} ref={(el) => { particleRefs.current[k] = el; }} r={1.6} opacity={0} />
            ))}
          </g>
        )}

        {/* destination zones at their bearing, distance log-scaled; top 10 numbered */}
        <g data-testid="dist-rose-zones">
          {geom.zones.map((z, i) => {
            const dimmed = hovered !== null && hovered !== z.octant;
            const lx = z.x + (z.x >= 0 ? 4.5 : -4.5), ly = z.y + (z.y >= 0 ? 7.5 : -3.5);
            return (
              <g key={z.id} ref={(el) => { zoneRefs.current[i] = el; }} opacity={initialP}>
                <g className={`transition-opacity duration-150 motion-reduce:transition-none ${dimmed ? "opacity-30" : ""}`}>
                  <title>{`${z.name} · ${z.distanceMi.toFixed(2)} mi ${z.octant} · ${z.sharePct.toFixed(1)}%`}</title>
                  <circle cx={z.x} cy={z.y} r={z.labelled ? 3 : 1.8} className={z.labelled ? "fill-foreground stroke-background" : "fill-muted-foreground"} strokeWidth={z.labelled ? 1 : 0} />
                  {z.labelled && (
                    <text x={lx} y={ly} fontSize={7} textAnchor={z.x >= 0 ? "start" : "end"} className="fill-foreground font-semibold">{z.rank + 1}</text>
                  )}
                </g>
              </g>
            );
          })}
        </g>

        {/* hub */}
        <circle r={R0} className="fill-background stroke-foreground/60" strokeWidth={1} />
        <circle r={2.2} className="fill-foreground" />

        {/* keyboard sectors: focus drives the same highlight the pointer does; pointer passes through */}
        <g role="list" aria-label="Octants" pointerEvents="none">
          {geom.wedges.map((w) => (
            <path
              key={w.octant}
              d={sectorPath(w.startDeg, w.endDeg, 0, R)}
              fill="none"
              role="listitem"
              tabIndex={0}
              aria-label={`${w.octant}: ${w.sharePct.toFixed(1)} percent of project trips`}
              className="outline-none focus-visible:stroke-blue-500"
              strokeWidth={1.5}
              onFocus={() => hover(w.octant)}
              data-testid={`dist-rose-sector-${w.octant}`}
            />
          ))}
        </g>
      </svg>

      <div className="space-y-2 text-xs min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Method</div>
        <div className="text-sm" data-testid="dist-rose-method">{td.methodLabel}</div>
        <div className="text-muted-foreground">
          Wedge length is the octant's share of project trips, on the bars' scale. Each dot is a destination zone at its bearing from the site; distance from the hub is on a log scale
          {geom.minDistanceMi > 0 && geom.maxDistanceMi > 0 ? <> (<span className="font-mono tabular-nums">{geom.minDistanceMi.toFixed(2)}–{geom.maxDistanceMi.toFixed(2)} mi</span>)</> : null}
          . Numbers key to the top-{labelled} table below.
        </div>
        <div className="min-h-[2.5rem] border-t pt-2 print:hidden" aria-live="polite" data-testid="dist-rose-readout">
          {hoveredWedge ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-base font-semibold">{hoveredWedge.octant}</span>
                <span className="font-mono text-base font-semibold tabular-nums">{hoveredWedge.sharePct.toFixed(1)}%</span>
                <span className="text-muted-foreground">of project trips</span>
              </div>
              <div className="text-muted-foreground font-mono tabular-nums">
                {hoveredWedge.startDeg}°–{hoveredWedge.endDeg}° · {hoveredZones} zone{hoveredZones === 1 ? "" : "s"}
                {onHoverOctant ? " · study map dims the other sectors" : ""}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">
              Hover a sector for its share{onHoverOctant ? " — the study map above highlights the signals in that direction" : ""}.
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1 bg-blue-500/60" />Share by octant</span>
          <span><i className="inline-block w-2 h-2 rounded-full align-middle mr-1 bg-foreground" />Top {labelled} zones</span>
          {zoneCount > labelled && <span><i className="inline-block w-1.5 h-1.5 rounded-full align-middle mr-1 bg-muted-foreground" />Other zones ({zoneCount - labelled})</span>}
          {!reduced && <span><i className="inline-block w-1 h-1 rounded-full align-middle mr-1 bg-blue-700 dark:bg-blue-200" />Trips leaving the site</span>}
        </div>
      </div>
    </div>
  );
}
