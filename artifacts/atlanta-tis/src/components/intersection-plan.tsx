/**
 * IntersectionPlan — an SVG plan view of one studied signal, drawn from the
 * report row alone (src/lib/intersection-geometry.ts).
 *
 * North is up. Each approach is drawn on the right-hand side of its leg with
 * the through lanes the engine sized it with, a left bay where a lane record
 * or a protected phase implies one (dashed when its length is assumed), and
 * the 95th-percentile back-of-queue laid along the approach TO SCALE — one
 * scale for all four legs, 25 ft per queued vehicle as the engine computes
 * it. Storage is hatched where the report carries a length; the part of a
 * queue past its storage is red. Labels carry no-build → build vph, the
 * build LOS, and the queue against the bay.
 *
 * Nothing here is animated and nothing is estimated: a default one-lane
 * approach is drawn as one lane and says "default"; an approach with no bay
 * record and a permissive left gets no bay.
 */
import { useId } from "react";
import { LOS_COLORS } from "@/components/tis-report-bits";
import {
  type IntersectionPlan as Plan, type ApproachPlan, type Direction,
  ASSUMED_BAY_FT, QUEUE_FT_PER_VEH, DIRECTIONS,
} from "@/lib/intersection-geometry";

const W = 640;
const H = 400;
const CX = W / 2;
const CY = H / 2;
const LW = 13;          // lane width, viewBox units
const EDGE = 6;         // legs run to this close to the frame
const SCALE_FILL = 0.88; // longest drawn length as a fraction of the shortest leg

type Frame = {
  d: Direction;
  matrix: string;
  /** Distance from the centre to this approach's stop line. */
  stopOff: number;
  /** Distance from the centre to the outer end of the leg. */
  legEnd: number;
  /** Width of this approach's lanes (bay + through). */
  approachW: number;
  bayW: number;
  /** Width of the opposite direction's departure lanes on this leg. */
  oppW: number;
};

/** Local frame per direction: +x is the direction of travel, +y the driver's
 *  right; origin at the intersection centre. */
const MATRIX: Record<Direction, string> = {
  NB: `matrix(0 -1 1 0 ${CX} ${CY})`,
  SB: `matrix(0 1 -1 0 ${CX} ${CY})`,
  EB: `matrix(1 0 0 1 ${CX} ${CY})`,
  WB: `matrix(-1 0 0 -1 ${CX} ${CY})`,
};

function widths(a: ApproachPlan | undefined): { approachW: number; bayW: number; throughW: number } {
  if (!a) return { approachW: LW, bayW: 0, throughW: LW };
  const bayW = a.leftBay.present ? LW : 0;
  const throughW = Math.max(1, a.throughLanes) * LW;
  return { approachW: bayW + throughW, bayW, throughW };
}

function short(s: string): string {
  return s === "import" ? "import" : s === "osm" ? "OSM" : "default";
}

export function IntersectionPlan({ plan, className }: { plan: Plan; className?: string }) {
  const uid = useId();
  const hatchId = `hatch-${uid}`;
  const byDir = new Map(plan.approaches.map((a) => [a.direction, a]));
  const w = {
    NB: widths(byDir.get("NB")), SB: widths(byDir.get("SB")), EB: widths(byDir.get("EB")), WB: widths(byDir.get("WB")),
  };
  // The intersection box: NS road spans SB's lanes (west) to NB's (east); EW
  // road spans WB's lanes (north) to EB's (south).
  const box = { west: w.SB.approachW, east: w.NB.approachW, north: w.WB.approachW, south: w.EB.approachW };
  const frames: Record<Direction, Frame> = {
    NB: { d: "NB", matrix: MATRIX.NB, stopOff: box.south, legEnd: H - CY - EDGE, ...w.NB, oppW: w.SB.throughW },
    SB: { d: "SB", matrix: MATRIX.SB, stopOff: box.north, legEnd: CY - EDGE, ...w.SB, oppW: w.NB.throughW },
    EB: { d: "EB", matrix: MATRIX.EB, stopOff: box.west, legEnd: CX - EDGE, ...w.EB, oppW: w.WB.throughW },
    WB: { d: "WB", matrix: MATRIX.WB, stopOff: box.east, legEnd: W - CX - EDGE, ...w.WB, oppW: w.EB.throughW },
  };
  const shortestLeg = Math.min(...DIRECTIONS.map((d) => frames[d].legEnd - frames[d].stopOff));
  const scaleFt = Math.max(plan.scaleFt, 150);
  const pxPerFt = (shortestLeg * SCALE_FILL) / scaleFt;
  const px = (ft: number) => Math.max(0, ft) * pxPerFt;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxHeight: 420, height: "auto", display: "block" }}
        role="img"
        aria-label={`Plan view of ${plan.name}: ${plan.approaches.map((a) => `${a.direction} ${a.throughLanes} through lane${a.throughLanes === 1 ? "" : "s"} (${a.lanesSource}), ${a.vph.noBuild.toFixed(0)} to ${a.vph.build.toFixed(0)} vph, LOS ${a.los.build}, 95th-percentile queue ${a.queue95Ft.toFixed(0)} ft${a.storageFt !== undefined ? ` against ${a.storageFt} ft of storage` : ""}`).join("; ")}.`}
        className="font-mono text-[10px]"
        data-testid="intersection-plan"
      >
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" strokeWidth="1.5" className="stroke-foreground/45" />
          </pattern>
        </defs>

        {/* Legs, in each approach's local frame. */}
        {DIRECTIONS.map((d) => {
          const f = frames[d];
          const a = byDir.get(d);
          return <Leg key={d} f={f} a={a} px={px} hatchId={hatchId} />;
        })}

        {/* Intersection box, on top of the leg ends. */}
        <rect
          x={CX - box.west} y={CY - box.north} width={box.west + box.east} height={box.north + box.south}
          className="fill-neutral-300 dark:fill-neutral-700"
        />

        {/* Labels in the outer frame. */}
        {DIRECTIONS.map((d) => {
          const a = byDir.get(d);
          if (!a) return null;
          return <Label key={d} f={frames[d]} a={a} />;
        })}

        {/* Compass and scale. */}
        <g className="fill-muted-foreground stroke-muted-foreground" transform={`translate(${W - 22} 22)`}>
          <line x1="0" y1="10" x2="0" y2="-8" strokeWidth="1.2" />
          <polygon points="0,-12 -3.5,-5 3.5,-5" stroke="none" />
          <text x="0" y="22" textAnchor="middle" stroke="none" className="fill-muted-foreground">N</text>
        </g>
        <g transform={`translate(${EDGE + 4} ${H - 10})`} className="stroke-muted-foreground">
          <line x1="0" y1="0" x2={px(100)} y2="0" strokeWidth="1.2" />
          <line x1="0" y1="-3" x2="0" y2="3" strokeWidth="1.2" />
          <line x1={px(100)} y1="-3" x2={px(100)} y2="3" strokeWidth="1.2" />
          <text x={px(100) + 5} y="3" stroke="none" className="fill-muted-foreground">100 ft · {QUEUE_FT_PER_VEH} ft/veh</text>
        </g>
        {plan.scenario && (
          <text x={W - EDGE - 2} y={H - 7} textAnchor="end" className="fill-muted-foreground">scenario</text>
        )}
      </svg>
      <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
        Drawn from the report: through lanes as the engine sized each approach (source in the label), 95th-percentile
        back-of-queue to one scale at {QUEUE_FT_PER_VEH} ft per vehicle, a left bay only where a lane record or a protected phase
        implies one (dashed: length assumed at {ASSUMED_BAY_FT} ft, used in no number). Hatching is imported storage; a queue past
        its storage turns red.
      </div>
    </div>
  );
}

function Leg({ f, a, px, hatchId }: { f: Frame; a: ApproachPlan | undefined; px: (ft: number) => number; hatchId: string }) {
  const x0 = -f.legEnd;   // outer end
  const x1 = -f.stopOff;  // stop line
  const len = f.legEnd - f.stopOff;
  const bay = a?.leftBay;
  const bayLenPx = bay?.present ? Math.min(len - 8, px(bay.storageFt ?? ASSUMED_BAY_FT)) : 0;
  const taper = bay?.present ? Math.min(18, Math.max(0, len - bayLenPx - 4)) : 0;
  const throughY0 = f.bayW;
  const throughY1 = f.approachW;
  const throughLanes = Math.max(1, a?.throughLanes ?? 1);

  // Queue on the through lanes: the approach's own Q95. With a row-level bay
  // the renderer compares that queue against the bay, so the excess is red.
  const queuePx = a ? Math.min(len, px(a.queue95Ft)) : 0;
  const rowStorage = a && a.storageFt !== undefined && a.storageBasis === "row";
  const storagePx = a && a.storageFt !== undefined ? Math.min(len, px(a.storageFt)) : 0;
  const leftGroup = a?.laneGroups?.find((g) => g.movement === "L");
  const leftQueuePx = leftGroup ? Math.min(len, px(leftGroup.queue95thFt)) : 0;

  return (
    <g transform={f.matrix}>
      {/* Opposite direction's departure lanes (left of the centreline). */}
      <rect x={x0} y={-f.oppW} width={len} height={f.oppW} className="fill-neutral-300 dark:fill-neutral-700" />
      {/* This approach's through lanes. */}
      <rect x={x0} y={throughY0} width={len} height={throughY1 - throughY0} className="fill-neutral-300 dark:fill-neutral-700" />
      {/* Left bay with its taper. */}
      {bay?.present && (
        <g>
          <rect x={x1 - bayLenPx} y={0} width={bayLenPx} height={f.bayW} className="fill-neutral-300 dark:fill-neutral-700" />
          <polygon points={`${x1 - bayLenPx},0 ${x1 - bayLenPx},${f.bayW} ${x1 - bayLenPx - taper},${f.bayW}`} className="fill-neutral-300 dark:fill-neutral-700" />
          {bay.assumed && (
            <polyline
              points={`${x1},0 ${x1 - bayLenPx},0 ${x1 - bayLenPx - taper},${f.bayW}`}
              fill="none" strokeWidth="1" strokeDasharray="3 3" className="stroke-foreground/60"
            />
          )}
          {/* Bay lane line. */}
          <line x1={x1 - bayLenPx} y1={f.bayW} x2={x1} y2={f.bayW} strokeWidth="1" className="stroke-background" />
        </g>
      )}
      {/* Centreline. */}
      <line x1={x0} y1={0} x2={x1} y2={0} strokeWidth="1.2" className="stroke-amber-500" />
      {/* Through lane lines. */}
      {Array.from({ length: throughLanes - 1 }, (_, i) => (
        <line key={i} x1={x0} y1={throughY0 + (i + 1) * LW} x2={x1} y2={throughY0 + (i + 1) * LW} strokeWidth="1" strokeDasharray="6 5" className="stroke-background" />
      ))}
      {/* Storage: hatched over the bay when a length is known. */}
      {a && a.storageFt !== undefined && storagePx > 0 && (
        <rect x={x1 - storagePx} y={bay?.present ? 0 : throughY0} width={storagePx} height={bay?.present ? f.bayW : throughY1 - throughY0} fill={`url(#${hatchId})`}>
          <title>{`${a.direction} storage ${a.storageFt} ft (${a.storageBasis === "lane-group" ? "imported left-turn bay" : "imported governing bay, row level"})`}</title>
        </rect>
      )}
      {/* Approach queue on the through lanes. */}
      {a && queuePx > 0 && (
        <g>
          <rect x={x1 - Math.min(queuePx, rowStorage ? storagePx : queuePx)} y={throughY0 + 2} width={Math.min(queuePx, rowStorage ? storagePx : queuePx)} height={throughY1 - throughY0 - 4} className="fill-sky-500/60">
            <title>{`${a.direction} 95th-percentile queue ${a.queue95Ft.toFixed(0)} ft (${a.queue95Veh.toFixed(1)} veh)`}</title>
          </rect>
          {rowStorage && queuePx > storagePx && (
            <rect x={x1 - queuePx} y={throughY0 + 2} width={queuePx - storagePx} height={throughY1 - throughY0 - 4} className="fill-red-500/75">
              <title>{`${a.direction} queue exceeds the ${a.storageFt} ft bay by ${(a.queue95Ft - (a.storageFt ?? 0)).toFixed(0)} ft`}</title>
            </rect>
          )}
        </g>
      )}
      {/* Left-turn group queue in the bay, red past its own storage. */}
      {a && leftGroup && bay?.present && leftQueuePx > 0 && (
        <g>
          <rect x={x1 - Math.min(leftQueuePx, leftGroup.storageFt !== undefined ? px(leftGroup.storageFt) : leftQueuePx)} y={2} width={Math.min(leftQueuePx, leftGroup.storageFt !== undefined ? px(leftGroup.storageFt) : leftQueuePx)} height={f.bayW - 4} className="fill-sky-500/60">
            <title>{`${a.direction}L 95th-percentile queue ${leftGroup.queue95thFt.toFixed(0)} ft`}</title>
          </rect>
          {leftGroup.storageFt !== undefined && leftQueuePx > px(leftGroup.storageFt) && (
            <rect x={x1 - leftQueuePx} y={2} width={leftQueuePx - px(leftGroup.storageFt)} height={f.bayW - 4} className="fill-red-500/75">
              <title>{`${a.direction}L queue exceeds the ${leftGroup.storageFt} ft bay`}</title>
            </rect>
          )}
        </g>
      )}
      {/* Stop line. */}
      <line x1={x1} y1={0} x2={x1} y2={f.approachW} strokeWidth="2" className="stroke-foreground/80" />
    </g>
  );
}

function Label({ f, a }: { f: Frame; a: ApproachPlan }) {
  // Anchor beside the approach's own lanes, near the outer end of the leg.
  let x = 0, y = 0, anchor: "start" | "end" = "start";
  switch (f.d) {
    case "NB": x = CX + f.approachW + 8; y = H - EDGE - 30; anchor = "start"; break;
    case "SB": x = CX - f.approachW - 8; y = EDGE + 12; anchor = "end"; break;
    case "EB": x = EDGE + 4; y = CY + f.approachW + 14; anchor = "start"; break;
    case "WB": x = W - EDGE - 4; y = CY - f.approachW - 32; anchor = "end"; break;
  }
  const c = LOS_COLORS[a.los.build] ?? LOS_COLORS.A!;
  const lanes = `${a.throughLanes} lane${a.throughLanes === 1 ? "" : "s"}`;
  const bayNote = a.leftBay.present ? (a.leftBay.assumed ? " · bay assumed" : ` · bay ${a.leftBay.storageFt} ft`) : "";
  const queueNote = a.storageFt !== undefined
    ? `Q95 ${a.queue95Ft.toFixed(0)} / ${a.storageFt} ft${a.storageDeficient ? " over" : ""}`
    : `Q95 ${a.queue95Ft.toFixed(0)} ft`;
  const badgeX = anchor === "start" ? x : x - 14;
  const textAfterBadgeX = anchor === "start" ? x + 18 : x - 18;
  return (
    <g data-testid={`plan-label-${a.direction}`}>
      <text x={x} y={y} textAnchor={anchor} className="fill-foreground font-semibold">
        {a.direction} · {lanes} · {short(a.lanesSource)}{bayNote}
      </text>
      <text x={x} y={y + 13} textAnchor={anchor} className="fill-foreground">
        {a.vph.noBuild.toFixed(0)} → {a.vph.build.toFixed(0)} vph{a.addedTrips > 0 ? ` (+${a.addedTrips})` : ""}
      </text>
      <rect x={badgeX} y={y + 18} width="14" height="14" rx="2" fill={c.map} fillOpacity="0.28" stroke={c.map} strokeWidth="1" />
      <text x={badgeX + 7} y={y + 28.5} textAnchor="middle" className="fill-foreground font-bold">{a.los.build}</text>
      <text x={textAfterBadgeX} y={y + 28.5} textAnchor={anchor} className={a.storageDeficient ? "fill-red-600 dark:fill-red-400 font-semibold" : "fill-foreground"}>
        {queueNote}
      </text>
      <title>{`${a.direction}: delay ${a.delay.noBuild.toFixed(1)} → ${a.delay.build.toFixed(1)} s, v/c ${a.vc.noBuild.toFixed(2)} → ${a.vc.build.toFixed(2)}, LOS ${a.los.noBuild} → ${a.los.build}`}</title>
    </g>
  );
}
