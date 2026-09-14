/**
 * Geometry behind `TripDistributionAlive` — the compass rose that draws the
 * report's directional trip distribution.
 *
 * Pure TypeScript, no DOM: `scripts/check-distribution-alive.mjs` exercises
 * it under plain node against a real report fixture. Nothing here invents a
 * number — every wedge is one of the eight `byDirection` shares the engine
 * computed, every dot is one of its `zones`, placed by the zone's own
 * `bearingDeg` and `distanceMi`.
 *
 * Conventions match the engine (`tis-api-server/src/lib/cardinal-directions.ts`):
 * bearings are degrees clockwise from north, and octant k is the 45° sector
 * [45k, 45k+45) in the order NNE, ENE, ESE, SSE, SSW, WSW, WNW, NNW — the
 * same order `trip-distribution-card.tsx` lists the bars in.
 */

/** The eight octants clockwise from due north. NNE is the sector 0°–45°. */
export const OCTANTS = ["NNE", "ENE", "ESE", "SSE", "SSW", "WSW", "WNW", "NNW"] as const;
export type Octant = (typeof OCTANTS)[number];

export const OCTANT_SPAN_DEG = 45;

/** A zone as the report carries it (`tripDistribution.zones[]`). */
export type RoseZoneInput = {
  id: string;
  name?: string;
  distanceMi: number;
  bearingDeg: number;
  cardinal?: string;
  sharePct: number;
};

export type RoseOpts = {
  /** Outer radius of the rose, px. */
  radius?: number;
  /** Radius of the hub the wedges grow from, px. */
  innerRadius?: number;
  /** How many zones get a label — the heaviest first. */
  labelCount?: number;
  /**
   * Distance the outermost ring stands for. Defaults to the farthest zone;
   * pass the study radius to pin the ring to it when every zone is inside.
   */
  maxDistanceMi?: number;
};

export type RoseWedge = {
  octant: Octant;
  index: number;
  /** Sector start / end, degrees clockwise from north. */
  startDeg: number;
  endDeg: number;
  /** Bisector, for labels and particle emission. */
  midDeg: number;
  /** The report's share for this octant, per cent of all project trips. */
  sharePct: number;
  /** sharePct / the largest octant's share, 0..1 — the same scale the bars use. */
  fill: number;
  /** Outer radius the wedge reaches at full fill, px. */
  outerR: number;
};

export type RoseZonePoint = {
  id: string;
  name: string;
  sharePct: number;
  distanceMi: number;
  bearingDeg: number;
  /** Octant the zone's bearing falls in (engine convention). */
  octant: Octant;
  /** 0-based rank by share, heaviest first. */
  rank: number;
  /** Log-scaled radius from the hub, px. */
  r: number;
  /** SVG offset from the rose centre (y down). */
  x: number;
  y: number;
  labelled: boolean;
};

export type RoseGeometry = {
  radius: number;
  innerRadius: number;
  wedges: RoseWedge[];
  /** Zones in descending share order (rank order). */
  zones: RoseZonePoint[];
  /** Ids of the labelled zones, heaviest first. */
  labels: string[];
  maxSharePct: number;
  /** Σ byDirection, as carried — the check asserts ≈ 100. */
  totalSharePct: number;
  minDistanceMi: number;
  maxDistanceMi: number;
};

/** Innermost fraction of the radius a zone dot can sit at (the nearest zone). */
const ZONE_R_MIN_FRAC = 0.2;
/** Outermost fraction (the farthest zone) — inside the ring, so labels fit. */
const ZONE_R_MAX_FRAC = 0.94;

/** Normalise any bearing to [0, 360). */
export function normDeg(deg: number): number {
  const b = deg % 360;
  return b < 0 ? b + 360 : b;
}

/**
 * Initial great-circle bearing, degrees clockwise from north — byte-for-byte
 * the engine's `bearingDeg` (cardinal-directions.ts), so the map's sector
 * dim agrees with the octant the engine filed a row's zone under.
 */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad, p2 = lat2 * toRad;
  const dl = (lon2 - lon1) * toRad;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const t = Math.atan2(y, x) / toRad;
  return (t + 360) % 360;
}

/** Octant for a bearing: [0,45) → NNE, [45,90) → ENE, … (engine convention). */
export function bearingToOctant(deg: number): Octant {
  const b = normDeg(deg);
  return OCTANTS[Math.floor(b / OCTANT_SPAN_DEG) % 8]!;
}

export function isOctant(s: string | null | undefined): s is Octant {
  return typeof s === "string" && (OCTANTS as readonly string[]).includes(s);
}

/** Unit vector for a bearing in SVG space (x right, y down). */
export function bearingToXY(deg: number, r: number): [number, number] {
  const a = (normDeg(deg) * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

/**
 * SVG path for the sector between two bearings at radius `r1..r2` around
 * (0,0). Angles clockwise from north; `sweep` ≤ 180° here (octants are 45°).
 */
export function sectorPath(startDeg: number, endDeg: number, r1: number, r2: number): string {
  const [ax, ay] = bearingToXY(startDeg, r2), [bx, by] = bearingToXY(endDeg, r2);
  const [cx, cy] = bearingToXY(endDeg, r1), [dx, dy] = bearingToXY(startDeg, r1);
  const large = normDeg(endDeg - startDeg) > 180 ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  if (r1 <= 0) {
    return `M0 0 L${f(ax)} ${f(ay)} A${f(r2)} ${f(r2)} 0 ${large} 1 ${f(bx)} ${f(by)} Z`;
  }
  return `M${f(ax)} ${f(ay)} A${f(r2)} ${f(r2)} 0 ${large} 1 ${f(bx)} ${f(by)} L${f(cx)} ${f(cy)} A${f(r1)} ${f(r1)} 0 ${large} 0 ${f(dx)} ${f(dy)} Z`;
}

/** Log-scaled radius fraction (0..1 of the usable band) for a distance. */
function logFrac(d: number, dMin: number, dMax: number): number {
  if (!(dMax > dMin) || !(dMin > 0)) return 0.5;
  const dd = Math.min(dMax, Math.max(dMin, d));
  return (Math.log(dd) - Math.log(dMin)) / (Math.log(dMax) - Math.log(dMin));
}

/**
 * Lay the rose out. `byDirection` is `tripDistribution.byDirection` (octant →
 * share %); `zones` is `tripDistribution.zones`. Missing octants read 0.
 */
export function roseGeometry(
  byDirection: Record<string, number> | null | undefined,
  zones: RoseZoneInput[] | null | undefined,
  opts: RoseOpts = {},
): RoseGeometry {
  const radius = opts.radius ?? 120;
  const innerRadius = Math.max(0, Math.min(radius, opts.innerRadius ?? 10));
  const labelCount = Math.max(0, opts.labelCount ?? 10);

  const shares = OCTANTS.map((o) => {
    const v = Number(byDirection?.[o]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const maxSharePct = Math.max(0, ...shares);
  const totalSharePct = shares.reduce((a, b) => a + b, 0);

  const wedges: RoseWedge[] = OCTANTS.map((octant, index) => {
    const sharePct = shares[index] ?? 0;
    const fill = maxSharePct > 0 ? sharePct / maxSharePct : 0;
    const startDeg = index * OCTANT_SPAN_DEG;
    return {
      octant, index, startDeg, endDeg: startDeg + OCTANT_SPAN_DEG, midDeg: startDeg + OCTANT_SPAN_DEG / 2,
      sharePct, fill, outerR: innerRadius + fill * (radius - innerRadius),
    };
  });

  const clean = (zones ?? []).filter((z) => z && typeof z.id === "string" && Number.isFinite(z.bearingDeg) && Number.isFinite(z.distanceMi));
  // Descending share; ties keep report order (stable sort).
  const ordered = clean.map((z, i) => ({ z, i })).sort((a, b) => (b.z.sharePct - a.z.sharePct) || (a.i - b.i)).map((p) => p.z);
  const positive = ordered.map((z) => z.distanceMi).filter((d) => d > 0);
  const minDistanceMi = positive.length ? Math.min(...positive) : 0;
  let maxDistanceMi = positive.length ? Math.max(...positive) : 0;
  if (opts.maxDistanceMi !== undefined && Number.isFinite(opts.maxDistanceMi) && opts.maxDistanceMi > maxDistanceMi) maxDistanceMi = opts.maxDistanceMi;

  const band = radius * (ZONE_R_MAX_FRAC - ZONE_R_MIN_FRAC);
  const zonePts: RoseZonePoint[] = ordered.map((z, rank) => {
    const d = z.distanceMi > 0 ? z.distanceMi : minDistanceMi;
    const r = radius * ZONE_R_MIN_FRAC + band * logFrac(d, minDistanceMi, maxDistanceMi);
    const [x, y] = bearingToXY(z.bearingDeg, r);
    return {
      id: z.id, name: z.name || z.id, sharePct: Number.isFinite(z.sharePct) ? z.sharePct : 0,
      distanceMi: z.distanceMi, bearingDeg: normDeg(z.bearingDeg), octant: bearingToOctant(z.bearingDeg),
      rank, r, x, y, labelled: rank < labelCount,
    };
  });

  return {
    radius, innerRadius, wedges, zones: zonePts,
    labels: zonePts.filter((z) => z.labelled).map((z) => z.id),
    maxSharePct, totalSharePct, minDistanceMi, maxDistanceMi,
  };
}

/** easeOutCubic — the wedge fill curve; also used for the zone reveal. */
export function easeOut(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}
