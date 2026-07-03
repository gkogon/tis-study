/**
 * Activity categories — the four land-use buckets shared by the directional
 * distribution data layers:
 *
 *   shopping  retail / consumer destinations
 *   commerce  offices, business, commercial
 *   working   employment generators (industrial, institutional, jobs)
 *   living    residential
 *
 * Kept neutral (no OSM or Census dependency) so the US Census block-group TAZ
 * layer and the OSM activity-surface generator can both reference one taxonomy
 * without depending on each other.
 */

export type ActivityCategory = "shopping" | "commerce" | "working" | "living";

export const ACTIVITY_CATEGORIES: ReadonlyArray<ActivityCategory> = [
  "shopping", "commerce", "working", "living",
];
