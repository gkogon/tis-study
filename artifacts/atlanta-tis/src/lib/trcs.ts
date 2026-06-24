// TRCS demo — client-side mirror of the server UK capacity engine
// (tis-api-server/src/lib/uk-capacity.ts). Kept self-contained so the
// /trcs-demo pitch page computes DoS / PRC / MMQ live with zero backend
// dependency (nothing to fail in the room). The formulas are copied
// faithfully from the server module; if that engine changes, mirror the
// change here. See uk-capacity.ts for the full methodology references
// (DMRB CD 116 / CD 123, Kimber LR942, Kimber & Hollis LR909, RR67).

export type UkControlType = "signal" | "roundabout" | "priority";

export type UkCapacityResult = {
  controlType: UkControlType;
  method: string;
  demandPcu: number;
  capacityPcu: number;
  rfc: number;
  dosPct: number;
  prcPct: number | null;
  mmqPcu: number;
  withinCapacity: boolean;
  usesDefaultGeometry: boolean;
  note: string;
};

const UK_SAT_FLOW_PCU = 1900;
const UK_GREEN_RATIO = 0.45;
const UK_SIGNAL_CAPACITY_PCU = UK_SAT_FLOW_PCU * UK_GREEN_RATIO; // 855 PCU/h
const PRACTICAL_DOS = 0.9;
const PRACTICAL_RFC = 0.85;
export const DEFAULT_HGV_PCU_UPLIFT = 1.03;

export function vehToPcu(veh: number, uplift = DEFAULT_HGV_PCU_UPLIFT): number {
  return Math.max(0, veh) * uplift;
}

// Mean overflow queue, PCU — Kimber & Hollis (LR909) / Akçelik family,
// the same form the engine's HCM incremental-delay term uses (k = 0.5).
function overflowQueuePcu(rfc: number, capacityPcu: number, periodHr: number): number {
  if (capacityPcu <= 0 || rfc <= 0) return 0;
  const k = 0.5;
  const CT = capacityPcu * periodHr;
  const x = rfc;
  return (CT / 4) * ((x - 1) + Math.sqrt(Math.pow(x - 1, 2) + (8 * k * x) / CT));
}

// ---- Signalised (TRL RR67 / OSCADY–LinSig). DoS = engine v/c. ----
export function signalCapacity(
  dosFromEngine: number,
  opts: { capacityPcu?: number; periodHr?: number } = {},
): UkCapacityResult {
  const capacityPcu = opts.capacityPcu ?? UK_SIGNAL_CAPACITY_PCU;
  const periodHr = opts.periodHr ?? 1;
  const dos = Math.max(0, dosFromEngine);
  const demandPcu = dos * capacityPcu;

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
    ? `DoS ${dosPct.toFixed(1)}% ≤ 90% practical limit; within practical capacity.`
    : `DoS ${dosPct.toFixed(1)}% > 90% practical limit; over practical capacity — mitigation indicated.`;

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

// ---- Roundabout (Kimber LR942 / ARCADY), DMRB CD 116 default geometry ----
export type RoundaboutGeometry = {
  entryWidthM: number;
  approachHalfWidthM: number;
  flareLengthM: number;
  inscribedDiaM: number;
  entryAngleDeg: number;
  entryRadiusM: number;
};

export const DEFAULT_ROUNDABOUT_GEOMETRY: RoundaboutGeometry = {
  entryWidthM: 7.0,
  approachHalfWidthM: 3.65,
  flareLengthM: 10,
  inscribedDiaM: 30,
  entryAngleDeg: 30,
  entryRadiusM: 20,
};

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

export function roundaboutCapacity(
  entryDemandPcu: number,
  circulatingPcu: number,
  opts: { geom?: RoundaboutGeometry; periodHr?: number } = {},
): UkCapacityResult {
  const periodHr = opts.periodHr ?? 1;
  const capacityPcu = roundaboutEntryCapacityPcu(circulatingPcu, opts.geom);
  const rfcRaw = capacityPcu > 0 ? entryDemandPcu / capacityPcu : (entryDemandPcu > 0 ? Infinity : 0);
  const rfc = Number.isFinite(rfcRaw) ? rfcRaw : 99;
  const mmqPcu = overflowQueuePcu(Math.min(rfc, 3), capacityPcu, periodHr);
  const withinCapacity = rfc <= PRACTICAL_RFC;
  const note = withinCapacity
    ? `RFC ${rfc.toFixed(2)} ≤ ${PRACTICAL_RFC} (default geometry); within capacity — re-run in ARCADY with measured geometry.`
    : `RFC ${rfc.toFixed(2)} > ${PRACTICAL_RFC} (default geometry); over capacity — re-run in ARCADY with measured geometry.`;
  return {
    controlType: "roundabout",
    method: "Roundabout (Kimber LR942 / ARCADY), DMRB CD 116 default geometry",
    demandPcu: entryDemandPcu,
    capacityPcu,
    rfc,
    dosPct: rfc * 100,
    prcPct: rfc > 0 ? (PRACTICAL_DOS / rfc - 1) * 100 : null,
    mmqPcu,
    withinCapacity,
    usesDefaultGeometry: true,
    note,
  };
}

// ---- Priority (PICADY gap-acceptance), default critical-gap/follow-up ----
export type GapAcceptanceParams = { criticalGapS: number; followUpS: number };
export const DEFAULT_GAP_PARAMS: GapAcceptanceParams = { criticalGapS: 5.0, followUpS: 3.0 };

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

export function priorityCapacity(
  minorDemandPcu: number,
  conflictingPcu: number,
  opts: { params?: GapAcceptanceParams; periodHr?: number } = {},
): UkCapacityResult {
  const periodHr = opts.periodHr ?? 1;
  const capacityPcu = gapAcceptanceCapacityPcu(conflictingPcu, opts.params);
  const rfcRaw = capacityPcu > 0 ? minorDemandPcu / capacityPcu : (minorDemandPcu > 0 ? Infinity : 0);
  const rfc = Number.isFinite(rfcRaw) ? rfcRaw : 99;
  const mmqPcu = overflowQueuePcu(Math.min(rfc, 3), capacityPcu, periodHr);
  const withinCapacity = rfc <= PRACTICAL_RFC;
  const note = withinCapacity
    ? `RFC ${rfc.toFixed(2)} ≤ ${PRACTICAL_RFC} (gap-acceptance, default params); within capacity — re-run in PICADY with measured geometry.`
    : `RFC ${rfc.toFixed(2)} > ${PRACTICAL_RFC} (gap-acceptance, default params); over capacity — re-run in PICADY with measured geometry.`;
  return {
    controlType: "priority",
    method: "Priority (PICADY gap-acceptance), default critical-gap/follow-up",
    demandPcu: minorDemandPcu,
    capacityPcu,
    rfc,
    dosPct: rfc * 100,
    prcPct: rfc > 0 ? (PRACTICAL_DOS / rfc - 1) * 100 : null,
    mmqPcu,
    withinCapacity,
    usesDefaultGeometry: true,
    note,
  };
}

// ---- Sample London junctions for the demo (calibrated to the three
// published London TAs referenced in the engine; v/c values illustrative). ----
export type SampleJunction = {
  id: string;
  name: string;
  control: UkControlType;
  noBuildVc: number;
  buildVc: number;
};

export const SAMPLE_JUNCTIONS: SampleJunction[] = [
  { id: "camden", name: "Camden Rd / Parkhurst Rd", control: "signal", noBuildVc: 0.78, buildVc: 0.83 },
  { id: "holloway", name: "Holloway Rd / Hillmarton Rd", control: "signal", noBuildVc: 0.90, buildVc: 0.97 },
  { id: "tee", name: "Hillmarton Rd / site access (priority T)", control: "priority", noBuildVc: 0.22, buildVc: 0.34 },
  { id: "arterial", name: "Seven Sisters Rd / Parkhurst Rd", control: "signal", noBuildVc: 0.95, buildVc: 1.06 },
];

export function fmt(n: number, d = 1): string {
  return Number(n).toFixed(d);
}

export function prcStr(prc: number | null, d = 0): string {
  if (prc === null) return "—";
  return (prc >= 0 ? "+" : "") + prc.toFixed(d) + "%";
}
