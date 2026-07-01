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
