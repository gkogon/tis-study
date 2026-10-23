/**
 * Miami-Dade concurrency traffic stations — adopted "trip bank" for roadway
 * concurrency determination. FLORIDA (Miami-Dade) specific.
 *
 * Source: Miami-Dade County DTPW Concurrency Management System, January 2025
 * station tables — the FDOT State Highway System table and the Miami-Dade
 * County roadway table. Each station is a monitored roadway link with its
 * adopted peak-hour maximum-service volume (at the adopted LOS), the existing
 * peak-hour peak-direction volume (PHP), reserved/committed "date-of-service"
 * (DOS) trips, and the resulting AVAILABLE TRIPS — the capacity a new
 * development may reserve before the link fails concurrency.
 *
 * Concurrency check (Admin. Order 4-85 / CDMP): a project's net new peak-hour
 * peak-direction trips on a link are compared to that link's AVAILABLE TRIPS.
 *   available = maxLosVolume − php − dosTrips   (negative ⇒ already deficient)
 * A link where the project adds ≥ 5% (or ≥ 10%) of the max-service volume is
 * flagged "significant" (the 5%/10% columns in the source tables).
 *
 * TRANSCRIPTION NOTE: this is a curated subset of the published tables —
 * the principal corridors a Miami-Dade site is most likely to abut (US-1/SR 5,
 * SR 826 Palmetto, SR 836 Dolphin, SR 94 Kendall, SR 976 Bird, SR 968 Flagler,
 * SR 860 Miami Gardens, SR 9/27 Ave, I-95, SR 112, the Turnpike/HEFT, Lejeune,
 * Sunset, Biscayne/Brickell). The published Jan-2025 station tables remain the
 * authoritative source for a submittal; additional links can be appended here.
 */

export type ConcurrencyAgency = "fdot" | "county";
export type RoadClass = "arterial" | "freeway" | "collector";

/** LOS-standard code legend (from the source-table footnote). */
export const CONCURRENCY_LOS_LEGEND: Record<string, string> = {
  EE: "120% of LOS E, Extraordinary Transit between Infill Area and Urban Development Boundary",
  HE: "LOS E with 20-minute headway between Infill Area and Urban Development Boundary",
  "E+50": "150% of LOS E, Extraordinary Transit in Infill Area",
  "E+20": "120% of LOS E, 20-minute transit headway in Infill Area",
  SUMA: "State Urban Minor Arterial between Infill Area and Urban Development Boundary",
};

export type ConcurrencyStation = {
  id: number;
  agency: ConcurrencyAgency;
  roadway: string;
  location: string;
  roadClass: RoadClass;
  lanes: number;
  /** Peak-hour maximum service volume at the adopted LOS standard. */
  maxLosVolume: number;
  /** Existing peak-hour peak-direction volume. */
  php: number;
  /** Reserved / committed date-of-service trips. */
  dosTrips: number;
  /** Trips available to reserve = maxLosVolume − php − dosTrips. */
  availableTrips: number;
  existingLos: string;
  adoptedLos: string;
  concurrencyLos: string;
};

// Compact tuple rows → objects below. Tuple order:
// [id, agency, roadway, location, roadClass, lanes, maxLos, php, dos, available, existLOS, adoptLOS, concLOS]
type Row = [number, ConcurrencyAgency, string, string, RoadClass, number, number, number, number, number, string, string, string];

const ROWS: ReadonlyArray<Row> = [
  // ── FDOT State Highway System ──────────────────────────────────────────────
  // US-1 / SR 5 (South Dixie Highway)
  [8, "fdot", "SR 5 / US-1", "100' S Silver Palm Dr / SW 232 St", "arterial", 4, 4296, 2533, 812, 951, "C", "EE", "C"],
  [9, "fdot", "SR 5 / US-1", "200' N Miami-Dade / Monroe Co Line", "arterial", 2, 1510, 1767, 0, -257, "F", "C", "E+10"],
  [33, "fdot", "S Dixie Hwy (US-1 / SR 5)", "N/O SW 152 St / Coral Reef to SW 136 St", "arterial", 6, 6468, 4817, 0, 1651, "C", "EE", "C"],
  [110, "fdot", "SR 5 / US-1", "100' S SR 826 / Palmetto Expwy", "arterial", 6, 6468, 5580, 60, 828, "F", "EE", "E+4"],
  [521, "fdot", "SR 5 / US-1", "200' S Grand Ave (Coral Gables)", "arterial", 3, 6468, 4469, 0, 1999, "C", "E+20", "C"],
  [543, "fdot", "SR 5 / US-1", "2500' S Palm Dr / Florida City", "arterial", 4, 4296, 2173, 11, 2112, "C", "EE", "C"],
  [5049, "fdot", "SR 5 / US-1", "50' S of NE 9 St", "arterial", 6, 8085, 2541, 0, 5544, "C", "E+50", "C"],
  // SR 826 Palmetto Expressway (limited access)
  [405, "fdot", "SR 826 / Palmetto Expwy", "1100' E NW 57 Ave / SR 823", "freeway", 8, 13390, 9925, 0, 3465, "C", "D", "C"],
  [554, "fdot", "SR 826 / Palmetto Expwy", "1100' W NW 57 Ave / SR 823", "freeway", 6, 10060, 9829, 0, 231, "D", "D", "D"],
  [565, "fdot", "SR 826 / Palmetto Expwy", "500' N SW 56 St", "freeway", 8, 13620, 10669, 0, 2951, "C", "D", "C"],
  [569, "fdot", "SR 826 / Palmetto Expwy", "1000' N Flagler St", "freeway", 10, 18930, 10987, 0, 7943, "C", "E", "C"],
  [571, "fdot", "SR 826 / Palmetto Expwy", "1000' N SW 36 St", "freeway", 10, 16840, 15199, 0, 1641, "D", "D", "D"],
  [576, "fdot", "SR 826 / Palmetto Expwy", "1000' N NW 138 St", "freeway", 6, 10060, 11876, 0, -1816, "F", "D", "E+6"],
  // SR 836 Dolphin Expressway (limited access)
  [2188, "fdot", "SR 836 / Dolphin Expwy", "200' E SR 826 / Palmetto Expwy", "freeway", 8, 13390, 10432, 2, 2956, "C", "D", "C"],
  [2207, "fdot", "SR 836 / Dolphin Expwy", "1500' E Lejeune Rd", "freeway", 8, 10060, 10089, 205, -234, "F", "D", "E"],
  [2242, "fdot", "SR 836 / Dolphin Expwy", "300' W NW 107 Ave", "freeway", 6, 10060, 8889, 266, 905, "D", "D", "D"],
  [2244, "fdot", "SR 836 / Dolphin Expwy", "1600' E NW 87 Ave", "freeway", 6, 10060, 5867, 0, 4193, "C", "B", "C"],
  // SR 94 Kendall Drive
  [10, "fdot", "SR 94 / Kendall Dr", "380' E SR 997 / Krome Ave", "arterial", 4, 3580, 1808, 30, 1742, "C", "D", "C"],
  [60, "fdot", "SR 94 / Kendall Dr", "500' E SW 134 Ct", "arterial", 8, 8652, 4802, 0, 3850, "C", "EE", "C"],
  [64, "fdot", "SR 94 / Kendall Dr / SW 88 St", "200' E SW 103 Ave", "arterial", 6, 6468, 3584, 117, 2767, "C", "EE", "C"],
  [683, "fdot", "SR 94 / Kendall Dr", "200' W Dadeland Blvd", "arterial", 8, 8085, 3152, 62, 4871, "C", "E+50", "C"],
  // SR 976 Bird Road
  [72, "fdot", "SR 976 / Bird Rd", "600' E Fla Tpk / SR 821", "arterial", 6, 5390, 3374, 19, 1997, "C", "HE", "C"],
  [80, "fdot", "SR 976 / Bird Rd", "400' W SW 57 Ave", "arterial", 6, 6468, 3379, 85, 3004, "C", "E+20", "C"],
  [1048, "fdot", "SR 976 / Bird Rd", "200' W SW 42 Ave", "arterial", 4, 4068, 2740, 0, 1328, "A", "E+20", "A"],
  // SR 968 Flagler Street
  [94, "fdot", "SR 968 / Flagler St", "60' E of NW 46 Ave", "arterial", 4, 5370, 2440, 0, 2930, "C", "E+50", "C"],
  [1140, "fdot", "SR 968 / Flagler St", "400' W SW/NW 72 Ave", "arterial", 6, 8085, 3616, 4, 4465, "C", "E+50", "C"],
  [1142, "fdot", "SR 968 / Flagler St", "200' E NW 87 Ave", "arterial", 6, 6468, 4082, 86, 2300, "C", "EE", "C"],
  // SR 860 Miami Gardens Drive
  [2516, "fdot", "SR 860 / Miami Gardens Dr", "200' W SR 823 / Red Rd", "arterial", 4, 4296, 2635, 11, 1650, "C", "EE", "C"],
  [2518, "fdot", "SR 860 / Miami Gardens Dr", "800' W of NW 87 Ave", "arterial", 4, 3580, 3789, 1436, -1645, "F", "E", "E+45"],
  // SR 9 / 27 Ave & I-95
  [23, "fdot", "SR 9 / NW 27 Ave", "100' N NW 103 St", "arterial", 8, 8085, 2785, 227, 5073, "C", "E+50", "C"],
  [431, "fdot", "SR 9 / SW-NW 27 Ave", "100' S NW 103 St", "arterial", 4, 4380, 2157, 253, 1970, "C", "E+50", "D"],
  [2036, "fdot", "SR 9 / I-95", "500' N Bridge 870432-SB", "freeway", 10, 28395, 11811, 0, 16584, "C", "E+50", "C"],
  [2085, "fdot", "SR 9 / I-95", "200' N NW 103 St / SR 932", "freeway", 10, 28395, 12540, 0, 15855, "C", "E+50", "C"],
  [2505, "fdot", "I-95 / SR 9A", "200' S NW 6 St", "freeway", 8, 13390, 11676, 0, 1714, "D", "D", "D"],
  // SR 112 Airport Expressway
  [2060, "fdot", "Airport Expwy (SR 112)", "W/O NW 27 Ave to Lejeune Rd", "freeway", 6, 16650, 6759, 0, 9891, "C", "E+50", "C"],
  [2065, "fdot", "SR 112 / Airport Expwy", "200' W NW 32 Ave Bridge", "freeway", 6, 16650, 8199, 2, 8449, "C", "E+50", "C"],
  // Florida Turnpike / HEFT (SR 821)
  [2246, "fdot", "Fla Tpk (HEFT / SR 821)", "S/O SW 88 St / Kendall Dr to SR 874", "freeway", 6, 10060, 2842, 0, 7218, "C", "B", "C"],
  [2266, "fdot", "Fla Tpk (HEFT / SR 821)", "S/O Don Shula Expwy / SR 874 to SW 152 St", "freeway", 8, 16840, 7700, 0, 9140, "C", "B", "C"],
  // SR 953 Lejeune Road
  [24, "fdot", "SR 953 / Lejeune Rd", "200' S Coral Way / SR 972", "arterial", 4, 4296, 2362, 0, 1934, "C", "E+20", "C"],
  [1181, "fdot", "SR 953 / Lejeune Rd", "1100' N of NW 119 St", "arterial", 6, 8085, 1704, 35, 6346, "C", "E+50", "C"],
  // SR 90 / SW 8 St (Tamiami Trail)
  [5, "fdot", "SR 90 / US-41 / SW 8 St", "200' E SW 74 Ave", "arterial", 6, 5370, 3235, 24, 2111, "C", "E+50", "C"],
  [88, "fdot", "SR 90 / US-41 / SW 8 St", "200' E SW 137 Ave", "arterial", 6, 6468, 3111, 104, 3253, "C", "EE", "C"],
  [589, "fdot", "SR 90 / US-41 / SW 8 St", "200' W SW 87 Ave", "arterial", 8, 8652, 3605, 31, 5016, "C", "EE", "C"],
  // Brickell / Biscayne
  [5042, "fdot", "Brickell Ave", "200' S SE 8 St / SR 99 / Tamiami Trl", "arterial", 4, 4560, 592, 0, 3968, "C", "E+50", "C"],
  [2556, "fdot", "SR 5 / Biscayne Blvd", "200' N of NE 16 St", "arterial", 6, 4560, 3637, 46, 877, "F", "E+50", "E+21"],
  [70, "fdot", "SW 72 St / Sunset Dr", "US-1 to SW 67th Ave", "arterial", 4, 2920, 1869, 0, 1051, "D", "E", "D"],

  // ── Miami-Dade County roadway table ────────────────────────────────────────
  [9106, "county", "SW 40 St / Bird Rd (SR 976)", "W/O HEFT/SR 821 to SW 127 Ave", "arterial", 4, 3222, 4072, 5, -855, "F", "HE", "E+26"],
  [9150, "county", "Flagler St", "E/O NW 8 Ave", "arterial", 4, 3717, 1135, 31, 2551, "C", "D", "C"],
  [9640, "county", "Rickenbacker Cswy", "W/O Virginia Key", "arterial", 4, 5821, 3135, 30, 2656, "C", "E+20", "C"],
  [9962, "county", "SW 8 St / Tamiami Trail", "W/O SW 99 Ave", "arterial", 8, 8652, 1802, 16, 6834, "C", "EE", "C"],
  [9966, "county", "US-1 / South Dixie Hwy", "S/O Kendall Dr / SW 88 St to SW 104 St", "arterial", 8, 8085, 3207, 66, 4812, "C", "EE", "C"],
  [9968, "county", "US-1 / South Dixie Hwy", "SW 134 St to SW 152 St", "arterial", 6, 6468, 4102, 0, 2366, "C", "EE", "C"],
  [9300, "county", "NE 82 St / SR 934 (1-way WB)", "W/O Biscayne Blvd to I-95", "arterial", 2, 1152, 929, 0, 223, "C", "E+20", "C"],
  [9720, "county", "SW 104 St", "W/O SW 127 Ave to SW 137 Ave", "arterial", 6, 5821, 3151, 56, 2614, "C", "EE", "C"],
  [9802, "county", "SW 137 Ave", "S/O SW 26 St to SW 42 St", "arterial", 6, 5390, 2689, 17, 2684, "C", "D", "C"],
  [9580, "county", "Old Cutler Rd", "S/O SW 136 St to SW 152 St", "arterial", 2, 1440, 1404, 0, 36, "D", "D", "D"],
  [9250, "county", "NW 183 St / Miami Gardens Dr", "W/O NW 37 Ave from NW 27 Ave to NW 47 Ave", "arterial", 6, 6468, 2044, 0, 4424, "C", "EE", "C"],
  [9836, "county", "SW 147 Ave", "S/O SW 184 St to SW 200 St", "arterial", 2, 1359, 1225, 42, 92, "C", "C", "C"],
];

export const CONCURRENCY_STATIONS: ReadonlyArray<ConcurrencyStation> = ROWS.map((r) => ({
  id: r[0], agency: r[1], roadway: r[2], location: r[3], roadClass: r[4], lanes: r[5],
  maxLosVolume: r[6], php: r[7], dosTrips: r[8], availableTrips: r[9],
  existingLos: r[10], adoptedLos: r[11], concurrencyLos: r[12],
}));

export const CONCURRENCY_SOURCE =
  "Miami-Dade County DTPW Concurrency Management System station tables (FDOT State Highway System + Miami-Dade County roadways), January 2025. Concurrency administered under Administrative Order 4-85 / CDMP Transportation Element.";

// ─── Lookups ─────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Stations whose roadway name contains the query (token/substring match). */
export function findStationsByRoadway(query: string): ConcurrencyStation[] {
  const q = norm(query);
  if (!q) return [];
  return CONCURRENCY_STATIONS.filter((s) => norm(s.roadway).includes(q) || q.includes(norm(s.roadway).split(" ")[0] ?? ""));
}

export function concurrencyStationById(id: number): ConcurrencyStation | undefined {
  return CONCURRENCY_STATIONS.find((s) => s.id === id);
}

/** Match a set of study-area roadway/intersection names against the station
 *  list, returning the unique stations whose roadway appears in any name. */
export function stationsForStudyArea(names: ReadonlyArray<string>): ConcurrencyStation[] {
  const seen = new Set<number>();
  const out: ConcurrencyStation[] = [];
  for (const name of names) {
    const n = norm(name);
    if (!n) continue;
    for (const s of CONCURRENCY_STATIONS) {
      if (seen.has(s.id)) continue;
      // match on the leading roadway token (e.g. "kendall", "flagler", "us 1", "sr 826")
      const tokens = norm(s.roadway).split(" ").filter((t) => t.length >= 3 && !/^(st|rd|ave|dr|blvd|the|of|sr|us|expwy|hwy)$/.test(t));
      if (tokens.some((t) => n.includes(t))) { seen.add(s.id); out.push(s); }
    }
  }
  return out;
}

export type ConcurrencyAssessment = {
  station: ConcurrencyStation;
  /** Project net new peak-hour peak-direction trips evaluated on this link. */
  projectTrips: number;
  remainingAfterProject: number;
  /** Share of the link's max-service volume the project consumes. */
  pctOfCapacity: number;
  significant: boolean;       // ≥ 5% of capacity, per the concurrency-table flags
  adequate: boolean;          // available capacity covers the project trips
  note: string;
};

/** Apply the concurrency check for a project's peak-direction trips on a link. */
export function assessConcurrency(
  station: ConcurrencyStation,
  projectPeakDirTrips: number,
): ConcurrencyAssessment {
  const projectTrips = Math.max(0, Math.round(projectPeakDirTrips));
  const remainingAfterProject = station.availableTrips - projectTrips;
  const pctOfCapacity = station.maxLosVolume > 0 ? (projectTrips / station.maxLosVolume) * 100 : 0;
  const significant = pctOfCapacity >= 5;
  const adequate = remainingAfterProject >= 0 && station.availableTrips >= 0;
  const note = station.availableTrips < 0
    ? "Link is already concurrency-deficient (negative available trips); a mitigation or proportionate-share contribution is required."
    : adequate
    ? `Available trips (${station.availableTrips}) cover the project's ${projectTrips} peak-direction trips; ${remainingAfterProject} remain.`
    : `Project's ${projectTrips} peak-direction trips exceed the ${station.availableTrips} available; the link fails concurrency and mitigation is required.`;
  return { station, projectTrips, remainingAfterProject, pctOfCapacity: Math.round(pctOfCapacity * 10) / 10, significant, adequate, note };
}
