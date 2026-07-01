/**
 * Driveway access model for the TIS site-access feature. A driveway is a point
 * on the site's fronting street with a set of allowed turning movements
 * (relative to that street). Presets expand to an explicit movements set; the
 * routing layer enforces those movements and reroutes forbidden ones.
 */
export type AccessType = "full" | "riro" | "three_quarter" | "entrance_only" | "exit_only" | "custom";

export type Movements = { inLeft: boolean; inRight: boolean; outLeft: boolean; outRight: boolean };

export type Driveway = {
  id: string;
  latitude: number;
  longitude: number;
  label?: string;
  accessType: AccessType;
  movements: Movements;
};

const NONE: Movements = { inLeft: false, inRight: false, outLeft: false, outRight: false };

/** Preset → allowed movements. "custom" yields none (caller supplies movements). */
export function expandAccessType(t: AccessType): Movements {
  switch (t) {
    case "full": return { inLeft: true, inRight: true, outLeft: true, outRight: true };
    case "riro": return { inLeft: false, inRight: true, outLeft: false, outRight: true };
    case "three_quarter": return { inLeft: true, inRight: true, outLeft: false, outRight: true };
    case "entrance_only": return { inLeft: true, inRight: true, outLeft: false, outRight: false };
    case "exit_only": return { inLeft: false, inRight: false, outLeft: true, outRight: true };
    case "custom": return { ...NONE };
  }
}

/** Resolve the effective movements: preset expands; custom uses supplied movements. */
export function resolveMovements(d: { accessType: AccessType; movements?: Partial<Movements> }): Movements {
  if (d.accessType !== "custom") return expandAccessType(d.accessType);
  return {
    inLeft: !!d.movements?.inLeft,
    inRight: !!d.movements?.inRight,
    outLeft: !!d.movements?.outLeft,
    outRight: !!d.movements?.outRight,
  };
}

export type SiteSide = 1 | -1;

function vec(bearingDeg: number): { x: number; y: number } {
  const r = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(r), y: Math.cos(r) }; // (east, north)
}
function cross(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.y - a.y * b.x; // >0 ⇒ a→b is a LEFT (CCW) turn in this east-north frame
}
function dot(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.x + a.y * b.y;
}

/** Which side of the street the site sits on (+1 left, −1 right of the street bearing). */
export function sideOfStreet(streetBearingDeg: number, drivewayToSiteBearingDeg: number): SiteSide {
  return cross(vec(streetBearingDeg), vec(drivewayToSiteBearingDeg)) >= 0 ? 1 : -1;
}

/**
 * The turning movement a trip to/from `odBearingDeg` (compass bearing of the
 * origin/destination from the site) makes at this driveway.
 *
 * The site sits perpendicular to the street on `siteSide` (+1 left / −1 right of
 * the street bearing), so driveway→site ≈ streetBearing − 90 (left) or +90 (right).
 * - Inbound: the car travels along the street toward the site (i.e. AWAY from the
 *   origin), then turns toward the site. Left/right = sign of cross(travel, driveway→site).
 * - Outbound: the car exits the driveway toward the street (site→driveway heading),
 *   then turns onto the along-street direction heading toward the destination.
 */
export function classifyMovement(
  streetBearingDeg: number,
  siteSide: SiteSide,
  odBearingDeg: number,
  inbound: boolean,
): keyof Movements {
  const drivewayToSite = streetBearingDeg + (siteSide === 1 ? -90 : 90);
  const siteToDriveway = drivewayToSite + 180;
  const fwd = vec(streetBearingDeg);
  const back = vec(streetBearingDeg + 180);
  if (inbound) {
    // Travel toward the site = the along-street direction pointing AWAY from the origin.
    const towardSite = vec(odBearingDeg + 180);
    const travel = dot(fwd, towardSite) >= dot(back, towardSite) ? fwd : back;
    return cross(travel, vec(drivewayToSite)) > 0 ? "inLeft" : "inRight";
  }
  // Outbound: exit heading = site→driveway; travel = along-street dir toward the destination.
  const od = vec(odBearingDeg);
  const travel = dot(fwd, od) >= dot(back, od) ? fwd : back;
  return cross(vec(siteToDriveway), travel) > 0 ? "outLeft" : "outRight";
}
