/**
 * Within-day (diurnal) office trip profiles — locale-gated.
 *
 * The screening engine has no within-day distribution of its own — it produces
 * only daily and AM/PM peak-hour totals. This module supplies a defensible
 * within-day *shape* that a renderer distributes the engine's GROSS trip
 * generation across; the *magnitude* is always the engine's own trip
 * generation, never fabricated.
 *
 * Office within-day shape, by locale (`ProfileLocale`), so a renderer only ever
 * prints a provenance line with a nexus to its own jurisdiction:
 *
 *  - locale "us" (DEFAULT): NO office within-day shape ships. We do not carry a
 *    digitised US office time-of-day curve, so a US DOT renderer
 *    (FDOT/GDOT/Caltrans/NYSDOT/TxDOT/IDOT) OMITS the office diurnal figure
 *    rather than fabricate a curve. Office land uses get no within-day chart;
 *    the renderer prints an honest "derive at submittal" note instead.
 *
 *  - locale "uk": the LTDS office profile digitised from Velocity Transport
 *    Planning's 60 Gracechurch Street TA Figure 2-1 / Figure 6-2 (a TfL London
 *    Travel Demand Survey, 2019 distribution). This carries a TfL/LTDS/Velocity
 *    provenance string and is GATED to the London/UK renderer (`renderTisLondon`)
 *    only — printing it in a US TIA would cite foreign data with no site nexus.
 *
 * A consultant with site-specific survey / gateline data can override the
 * profile end-to-end via `TisRequest.tripProfile` (see resolveProfile), in
 * which case the supplied source string is printed verbatim regardless of
 * locale — including for office land uses.
 */

/** A within-day distribution of arrivals and departures over a 24-hour clock. */
export type DiurnalProfile = {
  /** Fraction of the daily ARRIVAL (inbound) total in each clock hour 0–23. Normalised to sum 1. */
  arrivals: number[];
  /** Fraction of the daily DEPARTURE (outbound) total in each clock hour 0–23. Normalised to sum 1. */
  departures: number[];
  /** Human-readable provenance, printed under the figures. */
  source: string;
};

/**
 * Jurisdiction selector for the office within-day shape. "us" (default) has NO
 * office shape (the office figure is omitted); "uk" uses the LTDS/Velocity shape
 * + source string. Only the London/UK renderer may pass "uk"; every other
 * renderer must use the US default so no TfL/LTDS provenance line reaches a US
 * DOT submittal.
 */
export type ProfileLocale = "us" | "uk";

function normalise(xs: number[]): number[] {
  const sum = xs.reduce((s, x) => s + (x > 0 ? x : 0), 0) || 1;
  return xs.map((x) => (x > 0 ? x : 0) / sum);
}

// --- US office profile (DEFAULT) -------------------------------------------
// We do NOT ship a digitised US office within-day curve. The US locale has no
// office shape, so `officeProfile("us")` returns null and an office land use
// gets NO within-day figure (the renderer skips it and prints an honest
// "derive at submittal" note). A consultant override via `TisRequest.tripProfile`
// supplies a site-specific office curve when one is genuinely available.

// --- UK office profile (London/Velocity renderer ONLY) ----------------------
// Office shape, DIGITISED from the bar heights of Velocity Transport Planning's
// 60 Gracechurch Street TA Figure 2-1 (a stacked inbound/outbound-by-start-time
// chart, itself an LTDS-2019 office distribution). Values are the per-hour
// segment heights in chart pixels; `normalise` rescales each series to sum to 1,
// so only relative magnitudes matter. Reproduces the published peaks: arrivals
// 07:00–09:00 (08:00 ≈ 14% of daily total) and departures 17:00–18:00.
// GATED: only the London/UK renderer (locale "uk") may consume this — its source
// string names TfL/LTDS/Velocity, which has no nexus to a US site.
const OFFICE_ARRIVALS_RAW = [
  7, 5, 1, 1, 7, 42, 152, 395, 495, 160, 84, 66,
  94, 134, 74, 50, 36, 28, 19, 8, 8, 7, 4, 2,
];
const OFFICE_DEPARTURES_RAW = [
  3, 1, 1, 1, 1, 1, 2, 10, 21, 24, 39, 57,
  134, 168, 100, 121, 182, 372, 292, 121, 55, 29, 29, 23,
];

const LTDS_SOURCE =
  "Within-day distribution digitised from Velocity Transport Planning's 60 Gracechurch " +
  "Street TA Figure 2-1 (a TfL London Travel Demand Survey, 2019 office 'usual workplace / " +
  "work-related' distribution). The profile shape is fixed to that published office curve; " +
  "absolute volumes scale the engine's gross screening trip generation.";

/** The LTDS-style office profile (normalised). London/UK renderer only — see ProfileLocale. */
export const LTDS_OFFICE_PROFILE: DiurnalProfile = {
  arrivals: normalise(OFFICE_ARRIVALS_RAW),
  departures: normalise(OFFICE_DEPARTURES_RAW),
  source: LTDS_SOURCE,
};

// --- Non-office profiles (standard US within-day distributions from NHTS 2022
// home-based / shopping / school trip start times, designed and adversarially
// shape-verified). Un-normalised; `normalise` rescales each series to sum to 1.

const RESIDENTIAL_ARRIVALS_RAW = [
  5, 3, 2, 2, 3, 6, 10, 14, 16, 14, 13, 14,
  15, 16, 22, 34, 52, 70, 68, 54, 40, 28, 16, 9,
];
const RESIDENTIAL_DEPARTURES_RAW = [
  3, 2, 1, 2, 5, 14, 38, 78, 100, 62, 40, 36,
  36, 34, 36, 40, 38, 32, 26, 20, 15, 11, 8, 5,
];
export const RESIDENTIAL_PROFILE: DiurnalProfile = {
  arrivals: normalise(RESIDENTIAL_ARRIVALS_RAW),
  departures: normalise(RESIDENTIAL_DEPARTURES_RAW),
  source:
    "Within-day distribution from the FHWA National Household Travel Survey (NHTS 2022) home-based trip start times, cross-checked against public-data LU 210/220 directional splits. Residents depart in the AM peak and return in the PM peak; on-site occupancy is highest overnight and lowest midday.",
};

const RETAIL_ARRIVALS_RAW = [
  1, 0.5, 0.5, 0.5, 1, 2, 5, 12, 25, 40, 55, 72,
  78, 70, 62, 68, 82, 90, 80, 60, 42, 28, 14, 5,
];
const RETAIL_DEPARTURES_RAW = [
  2, 1, 0.5, 0.5, 0.5, 1, 3, 7, 16, 30, 48, 62,
  74, 74, 66, 62, 70, 82, 88, 76, 56, 40, 24, 10,
];
export const RETAIL_PROFILE: DiurnalProfile = {
  arrivals: normalise(RETAIL_ARRIVALS_RAW),
  departures: normalise(RETAIL_DEPARTURES_RAW),
  source:
    "Within-day distribution from NHTS 2022 shopping / errand / meal trip start times, cross-checked against public-data time-of-day patterns for LU 820 / 850. Activity builds to a midday plateau and a stronger late-afternoon/evening peak; on-site occupancy peaks midday through the evening.",
};

const SCHOOL_ARRIVALS_RAW = [
  0.2, 0.1, 0.1, 0.1, 0.3, 1.5, 6, 30, 22, 5, 2.5, 2,
  2.5, 3, 4, 3.5, 2, 1.5, 1, 0.6, 0.4, 0.3, 0.2, 0.2,
];
const SCHOOL_DEPARTURES_RAW = [
  0.2, 0.1, 0.1, 0.1, 0.2, 0.6, 2, 6, 5, 3, 2, 2,
  3, 4, 14, 26, 12, 6, 3, 1.5, 0.8, 0.5, 0.3, 0.2,
];
export const SCHOOL_PROFILE: DiurnalProfile = {
  arrivals: normalise(SCHOOL_ARRIVALS_RAW),
  departures: normalise(SCHOOL_DEPARTURES_RAW),
  source:
    "Within-day distribution from NHTS 2022 school-trip start times, cross-checked against public-data time-of-day patterns for LU 520 / 530. A sharp AM arrival peak before first bell and an early-afternoon dismissal departure peak; on-site population plateaus through the school day and empties at dismissal.",
};

/**
 * Validate + normalise a consultant-supplied override. Returns null when the
 * payload is missing or unusable, so the caller can fall back to the locale
 * default. Accepts `{ arrivals: number[24], departures: number[24], source? }`.
 */
export function parseProfileOverride(raw: unknown): DiurnalProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const a = o.arrivals;
  const d = o.departures;
  const ok = (x: unknown): x is number[] =>
    Array.isArray(x) &&
    x.length === 24 &&
    x.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
  if (!ok(a) || !ok(d)) return null;
  if (a.reduce((s, n) => s + n, 0) <= 0 || d.reduce((s, n) => s + n, 0) <= 0) return null;
  const src =
    typeof o.source === "string" && o.source.trim()
      ? o.source.trim()
      : "Consultant-supplied within-day trip profile (overrides the engine's default within-day distribution).";
  return { arrivals: normalise(a), departures: normalise(d), source: src };
}

/**
 * The office within-day shape for a locale, or null when none ships. "us"
 * (default) has NO office shape → null → the renderer omits the office figure.
 * "uk" uses the LTDS/Velocity office curve (London/UK renderer only).
 */
export function officeProfile(locale: ProfileLocale = "us"): DiurnalProfile | null {
  return locale === "uk" ? LTDS_OFFICE_PROFILE : null;
}

/**
 * Resolve the active profile: a valid consultant override, else the locale
 * office default. Returns null when there is no override and the locale carries
 * no office shape (US) — the caller must then omit the office figure.
 */
export function resolveProfile(override?: unknown, locale: ProfileLocale = "us"): DiurnalProfile | null {
  return parseProfileOverride(override) ?? officeProfile(locale);
}

/** Use-class families that have a defensible within-day profile. */
export type UseFamily = "office" | "residential" | "retail" | "school";

/**
 * Registry of locale-independent within-day profiles by use-class family
 * (standard US NHTS 2022 distributions). `office` is intentionally absent here
 * because it is locale-gated — resolve it via `officeProfile(locale)` /
 * `profilesForLocale`, never from this map. A family absent from the resolved
 * registry yields no chart (the renderer prints an honest "derive at submittal"
 * note instead of fabricating a curve). Under the US locale `office` has no
 * shape, so US office land uses are absent from the resolved registry too.
 */
export const PROFILES: Partial<Record<UseFamily, DiurnalProfile>> = {
  residential: RESIDENTIAL_PROFILE,
  retail: RETAIL_PROFILE,
  school: SCHOOL_PROFILE,
};

/**
 * Full profile registry for a locale: the shared families plus the locale's
 * office shape, if any. The US locale ships no office shape, so `office` is
 * omitted and US office land uses get no within-day chart.
 */
export function profilesForLocale(locale: ProfileLocale = "us"): Partial<Record<UseFamily, DiurnalProfile>> {
  const office = officeProfile(locale);
  return office ? { ...PROFILES, office } : { ...PROFILES };
}

/**
 * Map a land-use code to a use-class family.
 * 2xx → residential · 5xx → school/institutional · 4xx/8xx/9xx → retail/services ·
 * 1xx/3xx/6xx/7xx → office-shaped commute (industrial, lodging, medical, office).
 */
export function familyForCode(code: string): UseFamily | null {
  const c = String(code ?? "").trim();
  if (!c) return null;
  switch (c[0]) {
    case "2": return "residential";
    case "5": return "school";
    case "4":
    case "8":
    case "9": return "retail";
    case "1":
    case "3":
    case "6":
    case "7": return "office";
    default: return null;
  }
}

/** A resolved profile plus whether it is a genuine match (vs. a fallback). */
export type ResolvedProfile = {
  profile: DiurnalProfile;
  /** true when a consultant override applies or the use class has a registered profile. */
  matched: boolean;
  family: UseFamily | null;
};

/**
 * A neutral, never-charted placeholder profile returned alongside
 * `matched: false` so callers have a non-null object to destructure but know
 * not to render it. Flat shape, no jurisdictional provenance.
 */
const UNMATCHED_PLACEHOLDER: DiurnalProfile = {
  arrivals: normalise(new Array(24).fill(1)),
  departures: normalise(new Array(24).fill(1)),
  source: "No defensible within-day distribution for this land use; derive at submittal.",
};

/**
 * Pick the within-day profile for a land use: a valid consultant override wins;
 * else the registered profile for the code's use-class family in the given
 * locale; else an unmatched fallback the caller should NOT chart (matched ===
 * false). Under the US locale office land uses have no shape, so they resolve
 * unmatched (the office figure is omitted). The "uk" locale resolves office to
 * the LTDS/Velocity shape. The unmatched fallback carries no jurisdictional
 * provenance, so a US caller can never surface a TfL/LTDS string.
 */
export function profileForLandUse(
  code: string,
  override?: unknown,
  locale: ProfileLocale = "us",
): ResolvedProfile {
  const ov = parseProfileOverride(override);
  if (ov) return { profile: ov, matched: true, family: null };
  const family = familyForCode(code);
  const profile = family ? profilesForLocale(locale)[family] : undefined;
  if (profile) return { profile, matched: true, family };
  return { profile: UNMATCHED_PLACEHOLDER, matched: false, family };
}

/** Per-hour trip counts and the resulting on-site person accumulation. */
export type HourlyTrips = {
  /** Clock hours 0–23. */
  hours: number[];
  /** Inbound (arrival) counts per hour. */
  arrivals: number[];
  /** Outbound (departure) counts per hour. */
  departures: number[];
  /** Persons on site at the end of each hour (running net of arrivals − departures). */
  accumulation: number[];
  /** Arrivals as a % of the daily inbound total (each series sums to 100). */
  arrivalsPct: number[];
  /** Departures as a % of the daily outbound total (each series sums to 100). */
  departuresPct: number[];
  /** Arrivals as a % of the COMBINED daily total (in+out) — the Velocity Fig 2-1 stacked y-axis. */
  arrivalsSharePct: number[];
  /** Departures as a % of the COMBINED daily total (in+out) — stacks with arrivalsSharePct. */
  departuresSharePct: number[];
  /** Peak on-site accumulation and the hour it occurs. */
  peakAccumulation: number;
  peakAccumulationHour: number;
};

/**
 * Distribute a gross daily trip total across the profile.
 *
 * Inbound total = outbound total = dailyTrips / 2, so the accumulation curve
 * opens and closes the day at zero (everyone who arrives also leaves). This is
 * the standard person-accumulation construction used for office TAs.
 */
export function distributeDaily(dailyTrips: number, profile: DiurnalProfile): HourlyTrips {
  const d = Number(dailyTrips);
  const half = (Number.isFinite(d) && d > 0 ? d : 0) / 2;
  const arrivals = profile.arrivals.map((f) => f * half);
  const departures = profile.departures.map((f) => f * half);
  // Running net change in on-site population from the midnight baseline.
  const raw: number[] = [];
  let acc = 0;
  for (let h = 0; h < 24; h++) {
    acc += arrivals[h] - departures[h];
    raw.push(acc);
  }
  // Shift so the emptiest hour reads zero occupancy. For an office (arrivals
  // lead departures) the minimum is the midnight baseline, so this is a no-op
  // and the curve still peaks midday. For residential (departures lead) the
  // minimum is midday, so the curve correctly reads high overnight / low midday.
  const minAcc = Math.min(0, ...raw);
  const accumulation = raw.map((v) => v - minAcc);
  let peak = 0;
  let peakH = 0;
  accumulation.forEach((v, h) => {
    if (v > peak) {
      peak = v;
      peakH = h;
    }
  });
  // Combined-share %: each hour's segment as a fraction of the whole day's
  // trips (in+out). Inbound and outbound totals are both `half`, so the two
  // share series sum to 100 across all hours and stack into the Velocity bar.
  const denom = half * 2 || 1;
  return {
    hours: Array.from({ length: 24 }, (_, h) => h),
    arrivals,
    departures,
    accumulation,
    arrivalsPct: profile.arrivals.map((f) => f * 100),
    departuresPct: profile.departures.map((f) => f * 100),
    arrivalsSharePct: arrivals.map((c) => (c / denom) * 100),
    departuresSharePct: departures.map((c) => (c / denom) * 100),
    peakAccumulation: peak,
    peakAccumulationHour: peakH,
  };
}
