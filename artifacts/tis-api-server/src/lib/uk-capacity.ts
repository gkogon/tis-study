// UK junction-capacity engine — the DMRB / TRL replacement for the
// US Highway Capacity Manual (HCM) calculation that drives the rest of
// the engine (tis.ts: vcToDelay / queue95Ft, Webster signal delay).
//
// WHY THIS EXISTS
// ---------------
// The London Transport Assessment renderer (renderTisLondon in
// pdf-export.ts) historically reported the engine's HCM 6 Ch.19 output
// (LOS letters A–F, control delay in seconds, 95th-percentile queue in
// feet) and disclosed in §1.2 that those are NOT the metrics a UK
// reviewer accepts. UK practice reports junction performance against the
// Design Manual for Roads and Bridges (DMRB) and the TRL junction
// models — ARCADY (roundabouts), PICADY (priority junctions) and
// OSCADY / LinSig (signals) — in terms of:
//
//   • RFC  — Ratio of Flow to Capacity (priority / roundabout arms)
//   • DoS  — Degree of Saturation, % (signalised junctions)
//   • PRC  — Practical Reserve Capacity, % (signals; PRC = (0.9/DoS − 1)·100)
//   • MMQ  — Mean Maximum Queue, in PCU (passenger car units)
//
// This module produces those four metrics so the GB branch can report a
// UK-shaped capacity result instead of cross-referencing HCM and asking
// the reviewer to re-run everything.
//
// FIDELITY — read before trusting a number
// -----------------------------------------
// The screening engine carries per-approach VEHICLE flows, a control
// model that treats every junction as signalised (Webster delay, 90 s
// cycle, g/C = 0.45, 1,800 vph saturation flow → v/c per approach), and
// NO measured junction geometry (entry width, flare, visibility, lane
// detail). That bounds what each model can honestly claim:
//
//   • SIGNALS (default) — HIGH fidelity. The engine already computes a
//     Webster degree of saturation (its v/c). DoS, PRC and the queue
//     are derived directly from that calibrated value; only the units
//     change (PCU instead of vehicles, RR67 saturation flow). This is a
//     faithful UK signalised result, not an approximation.
//
//   • ROUNDABOUTS (Kimber / ARCADY) and PRIORITY (PICADY gap-acceptance)
//     — SCREENING grade. The Kimber entry-capacity regression and the
//     gap-acceptance capacity are the genuine TRL methods, but they are
//     evaluated against DMRB CD 116 illustrative DEFAULT geometry and a
//     conflicting-flow estimate derived from approach totals (the engine
//     has no turning-movement matrix). `usesDefaultGeometry` is true and
//     the note says so. A submitted TA must re-run these arms in ARCADY /
//     PICADY (Junctions 11) with measured geometry and visibility.
//
// Because the engine does not yet carry a control-type field per
// junction, the per-intersection mapper defaults every study junction to
// the signalised model — which is exactly the engine's own internal
// assumption, so the result is consistent end to end. The ARCADY and
// PICADY functions are exported and exercised so the engine is complete
// and routes correctly the moment control-type data becomes available.
//
// References:
//   • Highways England, DMRB CD 116 (Geometric design of roundabouts)
//     and CD 123 (Geometric design of at-grade priority and signal-
//     controlled junctions).
//   • R.M. Kimber, "The traffic capacity of roundabouts", TRRL
//     Laboratory Report LR942 (1980) — the ARCADY entry-capacity
//     regression reproduced in `roundaboutEntryCapacityPcu`.
//   • R.M. Kimber & R.D. Hollis, "Traffic queues and delays at road
//     junctions", TRRL LR909 (1979) — time-dependent queueing, the
//     basis of the ARCADY / PICADY queue.
//   • F.V. Webster & B.M. Cobbe, "Traffic Signals", Road Research
//     Technical Paper 56 (1966) and TRL RR67 saturation-flow base.
//   • Gap-acceptance (Tanner / Siegloch) capacity for priority streams,
//     the theory underlying PICADY.

export type UkControlType = "signal" | "roundabout" | "priority";

export type UkCapacityResult = {
  controlType: UkControlType;
  /** Human-facing method label for the report (e.g. for a table footnote). */
  method: string;
  /** Subject arm / junction demand, PCU per hour. */
  demandPcu: number;
  /** Subject arm / junction capacity, PCU per hour. */
  capacityPcu: number;
  /** Ratio of Flow to Capacity (demand / capacity). Headline for priority + roundabout. */
  rfc: number;
  /** Degree of Saturation, percent. Headline for signals (== rfc·100). */
  dosPct: number;
  /**
   * Practical Reserve Capacity, percent: PRC = (0.9/DoS − 1)·100.
   * The spare capacity before DoS reaches the 90% practical limit.
   * Positive ⇒ within practical capacity. Null when there is no demand
   * on the arm (DoS = 0 ⇒ PRC undefined / unbounded).
   */
  prcPct: number | null;
  /** Mean Maximum Queue, PCU. */
  mmqPcu: number;
  /**
   * True ⇒ within UK practical capacity. Signals: DoS ≤ 90% (PRC ≥ 0).
   * Priority / roundabout: RFC ≤ 0.85 (the conventional TA threshold).
   */
  withinCapacity: boolean;
  /** True when the result relies on DMRB default geometry (roundabout / priority). */
  usesDefaultGeometry: boolean;
  /** One-line reviewer note: practical-capacity verdict + any caveat. */
  note: string;
};

// ---------- UK signal base parameters (TRL RR67 / Webster) ----------

/**
 * Base saturation flow per lane, PCU/h. TRL RR67 (and DMRB) take a
 * straight-through lane base of ~1,900 PCU/h, slightly above the engine's
 * US 1,800 vph. Used to express signal capacity and queue in PCU; the
 * Degree of Saturation itself is taken from the engine's calibrated v/c
 * (see `signalCapacity`) so the UK and HCM views stay internally
 * consistent.
 */
const UK_SAT_FLOW_PCU = 1900;

/** Effective green ratio g/C, matched to the engine's signal model. */
const UK_GREEN_RATIO = 0.45;

/** Per-approach signalised capacity, PCU/h (one critical lane). */
const UK_SIGNAL_CAPACITY_PCU = UK_SAT_FLOW_PCU * UK_GREEN_RATIO; // 855 PCU/h

/** UK practical Degree of Saturation limit (the basis of PRC). */
const PRACTICAL_DOS = 0.9;

/** Conventional RFC ceiling for priority / roundabout arms in TA practice. */
const PRACTICAL_RFC = 0.85;

/**
 * Default vehicle→PCU uplift for a car-dominated urban approach with no
 * supplied HGV fraction (≈3% HGV at 2.0 PCU each ⇒ ×1.03). Kept explicit
 * so a future HGV-aware input can replace it.
 */
export const DEFAULT_HGV_PCU_UPLIFT = 1.03;

/** Convert a vehicle/hour flow to PCU/hour using the default uplift. */
export function vehToPcu(veh: number, uplift: number = DEFAULT_HGV_PCU_UPLIFT): number {
  return Math.max(0, veh) * uplift;
}

// ---------- Shared queueing (Kimber & Hollis time-dependent) ----------

/**
 * Mean overflow (random + oversaturation) queue, in PCU, over an analysis
 * period `periodHr` for a service with capacity `capacityPcu` at ratio
 * `rfc`. This is the time-dependent queue family of Kimber & Hollis
 * (LR909) / Akçelik — the same form the engine's HCM incremental-delay
 * term uses (tis.ts vcToDelay d2, k = 0.5), so signal and unsignalised
 * queues stay on one consistent footing. Finite at and above RFC = 1
 * because the period is finite.
 */
function overflowQueuePcu(rfc: number, capacityPcu: number, periodHr: number): number {
  if (capacityPcu <= 0 || rfc <= 0) return 0;
  const k = 0.5;
  const CT = capacityPcu * periodHr; // PCU served in the period
  const x = rfc;
  return (CT / 4) * ((x - 1) + Math.sqrt(Math.pow(x - 1, 2) + (8 * k * x) / CT));
}

// ---------- Signalised junctions (OSCADY / LinSig / TRL) ----------

/**
 * Signalised-arm UK result. `dosFromEngine` is the engine's Webster v/c
 * for the scenario — taken as the authoritative Degree of Saturation so
 * the UK and HCM views of the same junction never disagree. Capacity and
 * demand are expressed in PCU using the RR67 base saturation flow; the
 * uniform + overflow queue gives the Mean Maximum Queue in PCU.
 */
export function signalCapacity(
  dosFromEngine: number,
  opts: { capacityPcu?: number; periodHr?: number } = {},
): UkCapacityResult {
  const capacityPcu = opts.capacityPcu ?? UK_SIGNAL_CAPACITY_PCU;
  const periodHr = opts.periodHr ?? 1;
  const dos = Math.max(0, dosFromEngine);
  const demandPcu = dos * capacityPcu;

  // Uniform back-of-queue (PCU per cycle), Webster Q1 form: vehicles
  // arriving on red that clear on the following green.
  //   Q1 = q·C·(1 − λ) / (1 − x·λ)   with q in PCU/s and C the cycle (s).
  const lambda = UK_GREEN_RATIO;
  const xForUniform = Math.min(1, dos);
  const arrPerSec = demandPcu / 3600;
  const CYCLE_S = 90;
  const q1 = (arrPerSec * CYCLE_S * (1 - lambda)) / Math.max(0.05, 1 - xForUniform * lambda);

  const mmqPcu = q1 + overflowQueuePcu(dos, capacityPcu, periodHr);

  const prcPct = dos > 0 ? (PRACTICAL_DOS / dos - 1) * 100 : null;
  const withinCapacity = dos <= PRACTICAL_DOS;
  const dosPct = dos * 100;

  const note = withinCapacity
    ? `DoS ${dosPct.toFixed(1)}% ≤ 90% practical limit (PRC ${prcPct === null ? "—" : "+" + prcPct.toFixed(0)}%); within practical capacity.`
    : `DoS ${dosPct.toFixed(1)}% > 90% practical limit (PRC ${prcPct === null ? "—" : prcPct.toFixed(0)}%); over practical capacity — mitigation indicated.`;

  return {
    controlType: "signal",
    method: "Signalised (TRL RR67 / OSCADY–LinSig); DoS from Webster v/c",
    demandPcu,
    capacityPcu,
    rfc: dos,
    dosPct,
    prcPct,
    mmqPcu,
    withinCapacity,
    usesDefaultGeometry: false,
    note,
  };
}

// ---------- Roundabouts (Kimber / ARCADY, LR942) ----------

/** DMRB CD 116 illustrative default geometry for a UK urban roundabout entry. */
export type RoundaboutGeometry = {
  entryWidthM: number;       // e   — entry width
  approachHalfWidthM: number;// v   — approach half-width
  flareLengthM: number;      // l'  — effective flare length
  inscribedDiaM: number;     // D   — inscribed circle diameter
  entryAngleDeg: number;     // φ   — entry angle
  entryRadiusM: number;      // r   — entry radius
};

export const DEFAULT_ROUNDABOUT_GEOMETRY: RoundaboutGeometry = {
  entryWidthM: 7.0,
  approachHalfWidthM: 3.65,
  flareLengthM: 10,
  inscribedDiaM: 30,
  entryAngleDeg: 30,
  entryRadiusM: 20,
};

/**
 * Kimber (LR942) entry capacity, PCU/h, as a function of the circulating
 * (conflicting) flow `qcPcu` and entry geometry:
 *
 *   Qe = k·(F − fc·qc),   Qe ≥ 0
 *   F   = 303·x2
 *   fc  = 0.210·tD·(1 + 0.2·x2)
 *   tD  = 1 + 0.5 / (1 + exp((D − 60)/10))
 *   x2  = v + (e − v)/(1 + 2S),   S = 1.6·(e − v)/l'
 *   k   = 1 − 0.00347·(φ − 30) − 0.978·(1/r − 0.05)
 */
export function roundaboutEntryCapacityPcu(
  qcPcu: number,
  geom: RoundaboutGeometry = DEFAULT_ROUNDABOUT_GEOMETRY,
): number {
  const { entryWidthM: e, approachHalfWidthM: v, flareLengthM: l, inscribedDiaM: D, entryAngleDeg: phi, entryRadiusM: r } = geom;
  const S = (1.6 * (e - v)) / Math.max(0.1, l);
  const x2 = v + (e - v) / (1 + 2 * S);
  const tD = 1 + 0.5 / (1 + Math.exp((D - 60) / 10));
  const F = 303 * x2;
  const fc = 0.210 * tD * (1 + 0.2 * x2);
  const k = 1 - 0.00347 * (phi - 30) - 0.978 * (1 / r - 0.05);
  return Math.max(0, k * (F - fc * Math.max(0, qcPcu)));
}

/**
 * Roundabout-arm UK result (Kimber / ARCADY). `entryDemandPcu` is the
 * subject arm's entering demand; `circulatingPcu` is the conflicting
 * circulating flow passing the arm. Both PCU/h. Uses default geometry —
 * a submitted TA must supply measured geometry.
 */
export function roundaboutCapacity(
  entryDemandPcu: number,
  circulatingPcu: number,
  opts: { geom?: RoundaboutGeometry; periodHr?: number } = {},
): UkCapacityResult {
  const periodHr = opts.periodHr ?? 1;
  const capacityPcu = roundaboutEntryCapacityPcu(circulatingPcu, opts.geom);
  const rfc = capacityPcu > 0 ? entryDemandPcu / capacityPcu : (entryDemandPcu > 0 ? Infinity : 0);
  const rfcFinite = Number.isFinite(rfc) ? rfc : 99;
  const mmqPcu = overflowQueuePcu(Math.min(rfcFinite, 3), capacityPcu, periodHr);
  const withinCapacity = rfcFinite <= PRACTICAL_RFC;
  const note = withinCapacity
    ? `RFC ${rfcFinite.toFixed(2)} ≤ ${PRACTICAL_RFC} (default geometry); within capacity — re-run in ARCADY with measured geometry.`
    : `RFC ${rfcFinite.toFixed(2)} > ${PRACTICAL_RFC} (default geometry); over capacity — re-run in ARCADY with measured geometry.`;
  return {
    controlType: "roundabout",
    method: "Roundabout (Kimber LR942 / ARCADY), DMRB CD 116 default geometry",
    demandPcu: entryDemandPcu,
    capacityPcu,
    rfc: rfcFinite,
    dosPct: rfcFinite * 100,
    prcPct: rfcFinite > 0 ? (PRACTICAL_DOS / rfcFinite - 1) * 100 : null,
    mmqPcu,
    withinCapacity,
    usesDefaultGeometry: true,
    note,
  };
}

// ---------- Priority junctions (PICADY / gap-acceptance) ----------

/** Default gap-acceptance parameters for a minor-road stream (DMRB-consistent). */
export type GapAcceptanceParams = {
  criticalGapS: number; // t_c — critical gap
  followUpS: number;    // t_f — follow-up (move-up) headway
};

export const DEFAULT_GAP_PARAMS: GapAcceptanceParams = {
  criticalGapS: 5.0,
  followUpS: 3.0,
};

/**
 * Gap-acceptance capacity of a minor stream, PCU/h, against a conflicting
 * major flow `qcPcu` (PCU/h) — the Siegloch / Tanner form underlying
 * PICADY:
 *
 *   c = qc · e^(−qc·tc/3600) / (1 − e^(−qc·tf/3600))
 *
 * As qc → 0 the capacity tends to 3600/tf (saturation move-up rate).
 */
export function gapAcceptanceCapacityPcu(
  qcPcu: number,
  params: GapAcceptanceParams = DEFAULT_GAP_PARAMS,
): number {
  const qc = Math.max(0, qcPcu);
  const tc = params.criticalGapS;
  const tf = params.followUpS;
  if (qc === 0) return 3600 / tf;
  const num = qc * Math.exp((-qc * tc) / 3600);
  const den = 1 - Math.exp((-qc * tf) / 3600);
  return den > 0 ? num / den : 3600 / tf;
}

/**
 * Priority-junction minor-arm UK result (PICADY gap-acceptance).
 * `minorDemandPcu` is the give-way stream demand; `conflictingPcu` the
 * major flow it yields to. Default critical-gap / follow-up parameters —
 * a submitted TA must re-run in PICADY with measured geometry/visibility.
 */
export function priorityCapacity(
  minorDemandPcu: number,
  conflictingPcu: number,
  opts: { params?: GapAcceptanceParams; periodHr?: number } = {},
): UkCapacityResult {
  const periodHr = opts.periodHr ?? 1;
  const capacityPcu = gapAcceptanceCapacityPcu(conflictingPcu, opts.params);
  const rfc = capacityPcu > 0 ? minorDemandPcu / capacityPcu : (minorDemandPcu > 0 ? Infinity : 0);
  const rfcFinite = Number.isFinite(rfc) ? rfc : 99;
  const mmqPcu = overflowQueuePcu(Math.min(rfcFinite, 3), capacityPcu, periodHr);
  const withinCapacity = rfcFinite <= PRACTICAL_RFC;
  const note = withinCapacity
    ? `RFC ${rfcFinite.toFixed(2)} ≤ ${PRACTICAL_RFC} (gap-acceptance, default params); within capacity — re-run in PICADY with measured geometry.`
    : `RFC ${rfcFinite.toFixed(2)} > ${PRACTICAL_RFC} (gap-acceptance, default params); over capacity — re-run in PICADY with measured geometry.`;
  return {
    controlType: "priority",
    method: "Priority (PICADY gap-acceptance), default critical-gap/follow-up",
    demandPcu: minorDemandPcu,
    capacityPcu,
    rfc: rfcFinite,
    dosPct: rfcFinite * 100,
    prcPct: rfcFinite > 0 ? (PRACTICAL_DOS / rfcFinite - 1) * 100 : null,
    mmqPcu,
    withinCapacity,
    usesDefaultGeometry: true,
    note,
  };
}

// ---------- Dispatcher + per-intersection mapper ----------

export type UkCapacityInput = {
  controlType: UkControlType;
  /** Engine Webster v/c for the scenario (signals; authoritative DoS). */
  signalDoS?: number;
  /** Subject-arm demand, vehicles/h (converted to PCU internally). */
  armDemandVeh?: number;
  /** Conflicting flow, vehicles/h — circulating (roundabout) or major (priority). */
  conflictingVeh?: number;
  periodHr?: number;
};

/** Route an input to the correct TRL model. Signals are the default. */
export function computeUkCapacity(input: UkCapacityInput): UkCapacityResult {
  const periodHr = input.periodHr ?? 1;
  if (input.controlType === "roundabout") {
    return roundaboutCapacity(
      vehToPcu(input.armDemandVeh ?? 0),
      vehToPcu(input.conflictingVeh ?? 0),
      { periodHr },
    );
  }
  if (input.controlType === "priority") {
    return priorityCapacity(
      vehToPcu(input.armDemandVeh ?? 0),
      vehToPcu(input.conflictingVeh ?? 0),
      { periodHr },
    );
  }
  return signalCapacity(input.signalDoS ?? 0, { periodHr });
}

/** Which scenario column of an AffectedIntersection to report. */
export type UkScenario = "current" | "noBuild" | "build" | "designNoBuild" | "designBuild";

/**
 * Map a report `AffectedIntersection` (the engine's per-junction output)
 * to a UK capacity result for one scenario. The engine carries no
 * control-type field and models every junction as signalised, so this
 * defaults to the signalised model and takes the scenario v/c as the
 * authoritative Degree of Saturation. `controlType` may be overridden by
 * the caller when analyzer data supplies it, routing to ARCADY / PICADY.
 */
export function ukCapacityForIntersection(
  it: {
    currentVc?: number;
    existingVc?: number;
    futureVc?: number;
    designNoBuildVc?: number;
    designBuildVc?: number;
  },
  scenario: UkScenario,
  opts: { controlType?: UkControlType; periodHr?: number } = {},
): UkCapacityResult {
  const vcByScenario: Record<UkScenario, number> = {
    current: Number(it.currentVc ?? 0),
    noBuild: Number(it.existingVc ?? 0),
    build: Number(it.futureVc ?? 0),
    designNoBuild: Number(it.designNoBuildVc ?? 0),
    designBuild: Number(it.designBuildVc ?? 0),
  };
  const dos = vcByScenario[scenario];
  // Only the signalised path can be driven purely from v/c. ARCADY /
  // PICADY need flows + conflicting flows, which arrive via computeUkCapacity
  // once analyzer control-type + turning data exists; until then every
  // junction reports as signalised (the engine's own assumption).
  return signalCapacity(dos, { periodHr: opts.periodHr });
}
