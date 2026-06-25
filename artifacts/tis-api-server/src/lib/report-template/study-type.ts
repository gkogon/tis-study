/**
 * Study-type detection.
 *
 * The same site can be the subject of a vehicular traffic study, a pedestrian /
 * Healthy-Streets study, or a parking study — each wants different graphs,
 * different headline decisions and a different code set. This detects the kind
 * from the stored study type plus content signals, and exposes a per-kind config
 * the providers and templates branch on.
 */
import type { StudyKind } from "./regulations";

export type StudyTypeConfig = {
  kind: StudyKind;
  /** Noun for the moving thing — "vehicles" / "pedestrians" / "parked vehicles". */
  unit: string;
  /** Label for the by-hour distribution chart. */
  flowChartTitle: string;
  /** Label for the accumulation chart. */
  accumulationTitle: string;
  /** Whether junction-capacity analysis is relevant to this kind. */
  showCapacity: boolean;
  /** One-line headline framing for the conclusion. */
  headline: string;
};

const CONFIGS: Record<Exclude<StudyKind, "all">, StudyTypeConfig> = {
  vehicular: {
    kind: "vehicular",
    unit: "vehicles",
    flowChartTitle: "Inbound / Outbound Vehicle Trips by Start Time",
    accumulationTitle: "Daily Vehicle-Trip Accumulation",
    showCapacity: true,
    headline: "the residual highway-capacity impact of the development",
  },
  pedestrian: {
    kind: "pedestrian",
    unit: "pedestrians",
    flowChartTitle: "Pedestrian Arrivals / Departures by Time of Day",
    accumulationTitle: "On-Site Pedestrian Accumulation",
    showCapacity: false,
    headline: "the pedestrian movement, comfort and Healthy-Streets performance of the scheme",
  },
  parking: {
    kind: "parking",
    unit: "parked vehicles",
    flowChartTitle: "Parking Arrivals / Departures by Time of Day",
    accumulationTitle: "Parking Accumulation (Occupancy Profile)",
    showCapacity: false,
    headline: "the peak parking demand and accumulation profile of the development",
  },
};

/**
 * Detect the study kind from the stored study type, an explicit request focus,
 * and content signals. `project.studyType === "parking"` ⇒ parking; an explicit
 * `request.focus === "pedestrian"` (or a pedestrian-dominant land use) ⇒
 * pedestrian; otherwise vehicular.
 */
export function detectStudyType(report: any, project: any): StudyTypeConfig {
  const stored = String(project?.studyType ?? report?.request?.studyType ?? "").toLowerCase();
  if (stored === "parking") return CONFIGS.parking;

  const focus = String(report?.request?.focus ?? "").toLowerCase();
  if (focus === "pedestrian" || focus === "walking") return CONFIGS.pedestrian;

  // Pedestrian-led uses (parks, schools at the gate, pedestrianised retail) lean
  // pedestrian when the car mode share is negligible.
  const share = Number(report?.autoModeShareApplied);
  const code = String(report?.tripGeneration?.landUseCode ?? "");
  if (Number.isFinite(share) && share <= 0.1 && /^(41|42|43|44)/.test(code)) return CONFIGS.pedestrian;

  return CONFIGS.vehicular;
}
