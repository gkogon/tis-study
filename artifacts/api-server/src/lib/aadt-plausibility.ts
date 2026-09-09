/**
 * Functional-class compatibility for the AADT → signal join.
 *
 * The AADT datasets are snapped onto signals by proximity
 * (scripts/src/fetch-aadt-by-signal.ts: nearest counted feature inside a
 * per-source radius, 200 m for FDOT/WSDOT polylines, up to 1000 m for sparse
 * point-station sources). Proximity alone cannot tell whether the counted
 * facility is the one the signal sits on. Wherever a surface arterial runs
 * parallel to a freeway inside that radius — a frontage road, a mall ring
 * road, any arterial in an interchange quadrant — the signal inherits the
 * freeway MAINLINE count.
 *
 * Observed live in tacoma_metro: S Hosmer St and Tacoma Mall Blvd parallel
 * I-5 at 51–158 m. Seven signals on those two streets, all OSM class 2/3
 * (primary/secondary surface streets), were assigned WSDOT AADT 163,000 and
 * 171,000 — I-5 mainline magnitude. regional-intersections.ts turned those
 * into totalVolume 14,670 / 15,390 vph, the engine divided by its 810 vph
 * single-critical-lane screening capacity, and the study printed v/c 8.15–8.55
 * with 4,300–5,400 ft queues across 37 pages of LOS F. Because only two
 * distinct AADT segments were being reused, physically separate intersections
 * also printed byte-identical delay and queue values.
 *
 * The invariant enforced here: an AT-GRADE SIGNALIZED intersection may not be
 * assigned an AADT larger than the road it sits on can physically move through
 * a signal. A record above that ceiling is describing a different facility.
 *
 * Where the ceilings come from — capacity, not taste. For a signalized
 * approach, sustainable throughput is (through lanes per direction) ×
 * (saturation flow ~1,900 vphgpl) × (green ratio), doubled for both
 * directions, converted to daily at the K-factor the datasets carry (~9%
 * of AADT in the design hour):
 *
 *   primary   4 lanes/dir × 1900 × 0.45 g/C × 2 dir ÷ 0.09  ≈  76,000 AADT
 *   secondary 3 lanes/dir × 1900 × 0.45 g/C × 2 dir ÷ 0.09  ≈  57,000 AADT
 *   tertiary  2 lanes/dir × 1900 × 0.45 g/C × 2 dir ÷ 0.09  ≈  38,000 AADT
 *   trunk     4 lanes/dir × 1900 × 0.55 g/C × 2 dir ÷ 0.09  ≈  93,000 AADT
 *
 * Rounded up to the next round number so the ceiling rejects freeway records
 * without clipping the genuinely large arterials that sit just under it (the
 * busiest signalized US arterials run 60–80k AADT; freeway mainlines run
 * 100k–400k, so the gap between the two populations is wide).
 *
 * Class 0 (motorway) signals are ramp terminals, frontage-road junctions and
 * interchange cross-streets — still at-grade, still signalized, so still
 * bounded, but given the trunk allowance because interchange cross-streets are
 * genuinely the largest at-grade facilities in a network.
 *
 * A rejected record is NOT replaced with a guess: the caller falls back to the
 * road-class volume baseline and records honest provenance, so a study never
 * claims a measured count it did not legitimately receive.
 */

/**
 * OSM highway class code → maximum AADT plausibly carried through an at-grade
 * signalized intersection on that class of road.
 *
 * Codes match the `classes` array in the shipped `<slug>-roads.json` files and
 * `roadClassCode` from regional-signal-naming.ts:
 *   0 motorway  1 trunk  2 primary  3 secondary  4 tertiary
 */
export const MAX_SIGNAL_AADT_BY_ROAD_CLASS: Record<number, number> = {
  0: 100_000, // motorway-adjacent: ramp terminal / frontage / interchange cross-street
  1: 100_000, // trunk: at-grade expressway, higher green ratio
  2: 80_000, // primary: major arterial, up to 4 through lanes per direction
  3: 60_000, // secondary: minor arterial, up to 3 through lanes per direction
  4: 40_000, // tertiary: collector, up to 2 through lanes per direction
};

/**
 * Ceiling for a signal whose nearest road class could not be resolved. The
 * road network is missing or the signal sits outside it, so we cannot tell a
 * boulevard from a collector — take the minor-arterial ceiling rather than the
 * most permissive one, matching the conservative posture of DEFAULT_VOLUME.
 */
const UNKNOWN_CLASS_CEILING = 60_000;

/**
 * Ceiling for class codes above the base 0..4 table. Denser road extracts
 * (miami-dade, new-york, chicago ship class 5/6 ways) continue the OSM
 * hierarchy DOWNWARD — residential, unclassified, service. Those are smaller
 * than tertiary, so they inherit the tertiary ceiling rather than falling
 * through to a larger one.
 */
const SMALLEST_CLASS_CEILING = 40_000;

/**
 * Maximum AADT a signal on `classCode` may be assigned. `classCode` is -1 when
 * the roads dataset could not resolve a class for the signal.
 */
export function maxPlausibleSignalAadt(classCode: number): number {
  if (!Number.isFinite(classCode) || classCode < 0) return UNKNOWN_CLASS_CEILING;
  return MAX_SIGNAL_AADT_BY_ROAD_CLASS[classCode] ?? SMALLEST_CLASS_CEILING;
}

/**
 * True when `aadt` is too large to describe the signalized facility at a
 * signal of `classCode` — i.e. the join has picked up a limited-access
 * mainline (or another road entirely) rather than the street the signal is on.
 */
export function isLimitedAccessMismatch(aadt: number, classCode: number): boolean {
  if (!Number.isFinite(aadt) || aadt <= 0) return false;
  return aadt > maxPlausibleSignalAadt(classCode);
}

/**
 * Provenance slug written to IntersectionSummary.volumeSource when a measured
 * record is rejected by the class-compatibility check. Distinct from a plain
 * "road_class_baseline" so coverage tooling can tell "this region has no AADT
 * here" from "this region had AADT here and we refused it as implausible".
 */
export const REJECTED_VOLUME_SOURCE = "road_class_baseline_aadt_class_mismatch";
