/**
 * UTDF (Universal Traffic Data Format) export. Produces a Synchro-
 * importable CSV scaffold from the engine output so a Florida / NY /
 * California / etc. PE can:
 *
 *   1. Download the UTDF for a screening run.
 *   2. Open it in Synchro Studio (File → Combine → Read UTDF or
 *      Transfer → Read UTDF).
 *   3. Overlay measured turning-movement counts at the affected
 *      intersections — the engine decomposes the PROJECT-ADDED trips
 *      into L/T/R (see movement-assignment.ts), but no measured
 *      EXISTING turning split exists at scale, so total movement
 *      volumes still need field counts.
 *   4. Tweak signal phasing, splits, offsets per their field
 *      verification.
 *   5. Re-run capacity in Synchro and produce a verifiable submittal.
 *
 * This is the third pillar of the "true TIS" upgrade: the first two
 * (crash module + ATR) make the SCREENING report more credible; UTDF
 * gives the PE a real artifact they can import into the tool
 * reviewers trust.
 *
 * --- The disclosure ----------------------------------------------------
 *
 * The engine DOES model the project-added trips per L/T/R at each
 * study intersection (movement-assignment.ts — geometric assignment,
 * cross-footed with each junction's added-trip total). What it has no
 * measured source for is the EXISTING turning split. Because the UTDF
 * carries TOTAL approach volumes (existing + project), this export
 * distributes each approach's volume across left / through / right
 * using fixed 10% / 80% / 10% defaults — the industry-typical
 * rule-of-thumb when no field data is available — rather than the
 * project-only movement assignment. The header comment in the
 * generated file declares this explicitly so a reviewing PE never
 * mistakes the scaffold for measured TMC data.
 *
 * Similarly: lane configuration defaults to 1L + 2T + 1R per approach
 * (4 lanes) when the engine output does not include explicit lane
 * counts. Signal timing defaults to a NEMA 8-phase dual-ring with
 * cycle = 90s, splits proportional to approach v/c at saturation. PE
 * supplies field-verified geometry + signal logs to override.
 *
 * --- UTDF format reference --------------------------------------------
 *
 * UTDF is documented in the Synchro 11 User Guide (Trafficware /
 * Cubic Transportation Systems). Format is comma-delimited with
 * bracketed section headers ([Network], [Nodes], [Lanes], [Volumes],
 * [Timings], [Phasing]). Pre-2006 each section was a separate file;
 * since 2006 Synchro reads them all as one combined CSV. We emit the
 * combined form.
 *
 * Synchro accepts partial UTDF — missing sections / fields fall back
 * to Synchro defaults at import time, which is what we rely on for
 * the fields we don't have measured data for.
 */

const UTDF_VERSION = "1.0";
const DEFAULT_CYCLE_LENGTH_S = 90;
const DEFAULT_YELLOW_S = 4.0;
const DEFAULT_ALL_RED_S = 2.0;
const DEFAULT_MIN_GREEN_S = 8;
const DEFAULT_MAX_GREEN_S = 30;
const DEFAULT_LANE_WIDTH_FT = 12;

// 10/80/10 L/T/R default split — industry-typical when no field
// counts are available. The renderer prose declares this in the
// downloaded file's header.
/** Mean Earth radius in feet (6,371,000 m / 0.3048). */
const EARTH_RADIUS_FT = 20_902_231;

/**
 * Local equirectangular projection to FEET east/north of an origin, matching
 * the `Metric,0` (feet) flag written into [Network].
 *
 * Longitude degrees are scaled by cos(latitude) because meridians converge —
 * omitting that is what stretched the exported network along X. Equirectangular
 * is accurate to well under a foot over a TIS study radius; anything larger
 * would want a real state-plane projection.
 */
export function projectFeet(
  lat: number,
  lon: number,
  originLat: number,
  originLon: number,
): { x: number; y: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { x: 0, y: 0 };
  const toRad = Math.PI / 180;
  const x = EARTH_RADIUS_FT * (lon - originLon) * toRad * Math.cos(originLat * toRad);
  const y = EARTH_RADIUS_FT * (lat - originLat) * toRad;
  return { x: Math.round(x), y: Math.round(y) };
}

const DEFAULT_LEFT_FRAC = 0.1;
const DEFAULT_THROUGH_FRAC = 0.8;
const DEFAULT_RIGHT_FRAC = 0.1;

const DEFAULT_LEFT_LANES = 1;
const DEFAULT_THROUGH_LANES = 2;
const DEFAULT_RIGHT_LANES = 1;

// NEMA 8-phase dual-ring standard assignment:
//   Phase 1 = SBL    Phase 2 = NBT/NBR    Phase 3 = WBL    Phase 4 = EBT/EBR
//   Phase 5 = NBL    Phase 6 = SBT/SBR    Phase 7 = EBL    Phase 8 = WBT/WBR
const NEMA_PHASE: Record<string, number> = {
  SBL: 1, NBT: 2, NBR: 2, WBL: 3, EBT: 4, EBR: 4,
  NBL: 5, SBT: 6, SBR: 6, EBL: 7, WBT: 8, WBR: 8,
};

type EngineApproach = {
  direction: string;
  currentVolumeVph?: number;
  existingVolumeVph?: number;
  futureVolumeVph?: number;
  existingVc?: number;
  futureVc?: number;
};

type EngineIntersection = {
  signalId?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  approaches?: EngineApproach[];
};

type EngineResult = {
  affectedIntersections?: EngineIntersection[];
  request?: { projectName?: string; latitude?: number; longitude?: number };
};

export type UtdfOptions = {
  /**
   * Which scenario's volumes to emit:
   *   - `current` = current-year baseline, no growth, no project
   *   - `no_build` = opening-year grown without project
   *   - `build` = opening-year grown plus project trips (default)
   */
  scenario?: "current" | "no_build" | "build";
  projectName?: string;
};

export function generateUtdf(result: EngineResult, opts: UtdfOptions = {}): string {
  const scenario = opts.scenario ?? "build";
  const intersections = Array.isArray(result.affectedIntersections)
    ? result.affectedIntersections
    : [];

  const lines: string[] = [];

  // --- Header comment block. UTDF allows free-text lines before the
  // first [Section]; Synchro skips them at import. We use this to
  // document the scaffolding decisions so the importing PE sees them
  // immediately.
  const projectName = opts.projectName ?? result.request?.projectName ?? "Untitled Project";
  lines.push(`# Synchro UTDF Scaffold — Simple Impact Studies`);
  lines.push(`# Project: ${projectName}`);
  lines.push(`# Scenario: ${scenario}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Engine version: utdf-export ${UTDF_VERSION}`);
  lines.push(`#`);
  lines.push(`# IMPORTANT — DEFAULT ASSUMPTIONS BELOW. OVERRIDE BEFORE SUBMITTAL.`);
  lines.push(`#`);
  // How many intersections actually carry a measured turn split, so the
  // disclosure below describes THIS file rather than the worst case.
  const measuredMovementNodes = intersections.filter((it) =>
    (Array.isArray(it.approaches) ? it.approaches : []).some(
      (a) => Array.isArray((a as { laneGroups?: unknown[] }).laneGroups)
        && ((a as { laneGroups?: unknown[] }).laneGroups as unknown[]).length > 0,
    ),
  ).length;
  // Intersections carrying at least one measured per-movement lane count.
  const measuredLaneNodes = intersections.filter((it) =>
    (Array.isArray(it.approaches) ? it.approaches : []).some((a) =>
      ((a as { laneGroups?: Array<{ lanes?: number }> }).laneGroups ?? []).some(
        (g) => Number.isInteger(g.lanes as number) && (g.lanes as number) > 0,
      ),
    ),
  ).length;
  if (measuredMovementNodes > 0) {
    lines.push(`# 1. Turning movement counts: MEASURED at ${measuredMovementNodes} of ${intersections.length}`);
    lines.push(`#    intersection(s), from the Synchro record imported with this study;`);
    lines.push(`#    those movements carry the real turn split, rescaled to the`);
    lines.push(`#    scenario's approach volume. Rows marked "default-" in [Lanes] are`);
    lines.push(`#    the remaining intersections, where approach volumes are still`);
    lines.push(`#    distributed by 10% LEFT / 80% THROUGH / 10% RIGHT and the PE must`);
    lines.push(`#    overlay field counts.`);
  } else {
    lines.push(`# 1. Turning movement counts: NOT measured. Approach volumes are`);
    lines.push(`#    distributed by 10% LEFT / 80% THROUGH / 10% RIGHT. Public TMC`);
    lines.push(`#    data does not exist at scale; PE must overlay field counts.`);
  }
  if (measuredLaneNodes > 0) {
    lines.push(`# 2. Lane configuration: MEASURED at ${measuredLaneNodes} of ${intersections.length}`);
    lines.push(`#    intersection(s) — per-movement lane counts carried straight from`);
    lines.push(`#    the imported Synchro [Lanes] record. Those rows are marked`);
    lines.push(`#    "measured-lanes" in [Lanes]. Every other row defaults to`);
    lines.push(`#    1 LEFT + 2 THROUGH + 1 RIGHT and is marked "default-"; PE`);
    lines.push(`#    substitutes field-verified geometry there.`);
  } else {
    lines.push(`# 2. Lane configuration: NOT measured — defaults to 1 LEFT + 2 THROUGH`);
    lines.push(`#    + 1 RIGHT per approach (4 lanes total). PE substitutes field-`);
    lines.push(`#    verified geometry from as-built plans or driveway survey.`);
  }
  lines.push(`# 3. Signal timing: NEMA 8-phase dual-ring, cycle ${DEFAULT_CYCLE_LENGTH_S}s, yellow`);
  lines.push(`#    ${DEFAULT_YELLOW_S}s, all-red ${DEFAULT_ALL_RED_S}s. Splits proportional to approach v/c.`);
  lines.push(`#    PE substitutes signal-controller logs from agency permit file.`);
  lines.push(`# 4. Coordination offset: 0s (uncoordinated). PE sets per system`);
  lines.push(`#    timing plan if the intersection is part of a coordinated arterial.`);
  lines.push(`#`);
  lines.push(`# All sections below are auto-generated from the screening engine output.`);
  lines.push(`# Synchro will accept this as the starting point for full HCS / Synchro 11+`);
  lines.push(`# capacity analysis; calibrate against measured data before formal submittal.`);
  lines.push(``);

  // --- [Network] section ---
  lines.push(`[Network]`);
  lines.push(`RECORDNAME,DATA`);
  lines.push(`Metric,0`);
  lines.push(`UTDFVersion,${UTDF_VERSION}`);
  lines.push(`NumNodes,${intersections.length}`);
  // Link count = 4 directions × N intersections (one upstream link per approach)
  lines.push(`NumLinks,${intersections.length * 4}`);
  lines.push(`CreatedBy,SimpleImpactStudies`);
  lines.push(``);

  // --- [Nodes] section ---
  // Projection origin: the first node with real coordinates. Every node's X/Y
  // is then feet east/north of it, which keeps the numbers small and makes the
  // relative layout — the part Synchro's capacity math actually uses — correct.
  const origin = intersections.find(
    (it) => Number.isFinite(it.latitude) && Number.isFinite(it.longitude),
  );
  const originLat = origin ? (origin.latitude as number) : 0;
  const originLon = origin ? (origin.longitude as number) : 0;
  lines.push(`[Nodes]`);
  lines.push(`INTID,Name,X,Y,Z,TYPE,LATITUDE,LONGITUDE,Notes`);
  intersections.forEach((it, i) => {
    const intid = i + 1;
    const name = csvEscape(it.name ?? it.signalId ?? `Node ${intid}`);
    const lat = Number.isFinite(it.latitude) ? it.latitude : "";
    const lon = Number.isFinite(it.longitude) ? it.longitude : "";
    // X/Y are written in the unit the [Network] Metric flag declares, which is
    // 0 = FEET. The old code wrote degrees × 100000 on the assumption Synchro
    // re-projects on import; it does not, and the units are not feet, so the
    // network came in both ~3.6x too small (100,000 units/degree vs ~364,000
    // ft/degree) AND stretched along X, because scaling latitude and longitude
    // by the same constant ignores the cos(latitude) convergence of meridians
    // — an 11% aspect error at Miami's latitude, worse further north.
    //
    // Local equirectangular projection about the first node instead: exact
    // enough over a TIS study radius (a few miles) and in real feet, so link
    // lengths and the intersection layout are geometrically true.
    const { x, y } = projectFeet(it.latitude as number, it.longitude as number, originLat, originLon);
    lines.push(
      `${intid},${name},${x},${y},0,Signalized,${lat},${lon},engine-generated`,
    );
  });
  lines.push(``);

  // --- [Lanes] section ---
  // One row per (intersection, movement). Movements use Synchro's
  // standard naming: NBL, NBT, NBR, SBL, SBT, SBR, EBL, EBT, EBR,
  // WBL, WBT, WBR.
  lines.push(`[Lanes]`);
  lines.push(`INTID,NAME,Lanes,Width,Shared,Storage,TaperLength,Notes`);
  intersections.forEach((it, i) => {
    const intid = i + 1;
    const approaches = Array.isArray(it.approaches) ? it.approaches : [];
    const dirsWithData = new Set(approaches.map((a) => normDirection(a.direction)));
    // For each of the four cardinal approaches that have engine data,
    // emit three movements (L/T/R) at the default lane counts.
    // Turn-bay storage per movement, when an imported record carried it. The
    // old code wrote a hardcoded 0 for every movement, which reads in Synchro
    // as "no bay" and silently discards a measured length we already had.
    const storageByMovement: Record<string, number> = {};
    // Measured lane COUNT per movement, from the imported [Lanes] section.
    // The engine has carried this on LaneGroupImpact.lanes since #166 and the
    // PDF lane-group table already prints it; this export was still writing
    // the 1L/2T/1R default over the top of it, which is the one thing Peralta
    // actually asked for — lane geometry a reviewer can open in Synchro.
    const lanesByMovement: Record<string, number> = {};
    for (const a of approaches) {
      const dir = normDirection(a.direction);
      const groups = (a as {
        laneGroups?: Array<{ movement: string; storageFt?: number; lanes?: number }>;
      }).laneGroups;
      for (const g of groups ?? []) {
        if (Number.isFinite(g.storageFt as number) && (g.storageFt as number) > 0) {
          storageByMovement[`${dir}${g.movement}`] = g.storageFt as number;
        }
        if (Number.isInteger(g.lanes as number) && (g.lanes as number) > 0) {
          lanesByMovement[`${dir}${g.movement}`] = g.lanes as number;
        }
      }
    }
    const laneRow = (dir: string, mv: "L" | "T" | "R", defaultLanes: number, fallbackNote: string) => {
      const st = storageByMovement[`${dir}${mv}`];
      const hasSt = Number.isFinite(st) && st > 0;
      const measuredLanes = lanesByMovement[`${dir}${mv}`];
      const hasLanes = Number.isInteger(measuredLanes) && measuredLanes > 0;
      const lanes = hasLanes ? measuredLanes : defaultLanes;
      // Note column is the provenance disclosure a reviewing PE reads first:
      // say exactly which of the two fields on this row is real.
      const note = hasLanes && hasSt ? "measured-lanes+storage"
        : hasLanes ? "measured-lanes"
        : hasSt ? `measured-storage,${fallbackNote}`
        : fallbackNote;
      return `${intid},${dir}${mv},${lanes},${DEFAULT_LANE_WIDTH_FT},0,${hasSt ? Math.round(st) : 0},0,${note}`;
    };
    for (const dir of ["NB", "SB", "EB", "WB"]) {
      if (!dirsWithData.has(dir)) continue;
      lines.push(laneRow(dir, "L", DEFAULT_LEFT_LANES, "default-1L"));
      lines.push(laneRow(dir, "T", DEFAULT_THROUGH_LANES, "default-2T"));
      lines.push(laneRow(dir, "R", DEFAULT_RIGHT_LANES, "default-1R"));
    }
  });
  lines.push(``);

  // --- [Volumes] section ---
  lines.push(`[Volumes]`);
  lines.push(`INTID,NBL,NBT,NBR,SBL,SBT,SBR,EBL,EBT,EBR,WBL,WBT,WBR`);
  intersections.forEach((it, i) => {
    const intid = i + 1;
    const approaches = Array.isArray(it.approaches) ? it.approaches : [];
    const v: Record<string, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
    // Measured L/T/R by direction, when the engine resolved a real turn split
    // for this approach from an imported Synchro record. Absent otherwise, and
    // absent entirely on payloads generated before lane groups shipped — hence
    // the optional read and the 10/80/10 fallback below.
    const measured: Record<string, Record<string, number> | undefined> = {};
    for (const a of approaches) {
      const dir = normDirection(a.direction);
      v[dir] = scenarioVol(a, scenario);
      const groups = (a as { laneGroups?: Array<{ movement: string; futureVolumeVph: number }> }).laneGroups;
      if (Array.isArray(groups) && groups.length > 0) {
        const byMv: Record<string, number> = {};
        for (const g of groups) {
          if (Number.isFinite(g.futureVolumeVph)) byMv[g.movement] = g.futureVolumeVph;
        }
        if (Object.keys(byMv).length > 0) measured[dir] = byMv;
      }
    }
    const row = ["NB", "SB", "EB", "WB"].flatMap((dir) => {
      const vol = v[dir] ?? 0;
      const m = measured[dir];
      if (m) {
        // Real split. Rescale to the scenario volume so the exported movements
        // still sum to the approach total this scenario reports.
        const sum = (m.L ?? 0) + (m.T ?? 0) + (m.R ?? 0);
        if (sum > 0) {
          return [
            Math.round(vol * ((m.L ?? 0) / sum)),
            Math.round(vol * ((m.T ?? 0) / sum)),
            Math.round(vol * ((m.R ?? 0) / sum)),
          ];
        }
      }
      // No measured split: the documented 10/80/10 rule-of-thumb scaffold.
      return [
        Math.round(vol * DEFAULT_LEFT_FRAC),
        Math.round(vol * DEFAULT_THROUGH_FRAC),
        Math.round(vol * DEFAULT_RIGHT_FRAC),
      ];
    });
    lines.push(`${intid},${row.join(",")}`);
  });
  lines.push(``);

  // --- [Timings] section ---
  // 8-phase NEMA. Splits proportional to approach v/c × cycle. The
  // engine doesn't give per-phase v/c — we approximate from per-
  // approach v/c (max of currentVc/existingVc/futureVc by scenario).
  lines.push(`[Timings]`);
  lines.push(
    `INTID,Phase,Brp,MinInitial,MaxInitial,VehExt,MinGap,Yellow,AllRed,Recall,DualEntry,CycleLength,Coordinated,Offset`,
  );
  intersections.forEach((it, i) => {
    const intid = i + 1;
    const approaches = Array.isArray(it.approaches) ? it.approaches : [];
    const vcByDir: Record<string, number> = { NB: 0.5, SB: 0.5, EB: 0.5, WB: 0.5 };
    for (const a of approaches) {
      const dir = normDirection(a.direction);
      const vc = scenarioVc(a, scenario);
      if (Number.isFinite(vc)) vcByDir[dir] = vc;
    }
    // Phase split proportional to v/c per direction. NEMA pairs:
    //   N/S share Phase 2/6; E/W share Phase 4/8.
    const totalVc = (vcByDir.NB + vcByDir.SB + vcByDir.EB + vcByDir.WB) || 1;
    const nsFrac = (vcByDir.NB + vcByDir.SB) / 2 / totalVc;
    const ewFrac = (vcByDir.EB + vcByDir.WB) / 2 / totalVc;
    const nsSplit = Math.max(DEFAULT_MIN_GREEN_S, Math.round(DEFAULT_CYCLE_LENGTH_S * nsFrac));
    const ewSplit = Math.max(DEFAULT_MIN_GREEN_S, Math.round(DEFAULT_CYCLE_LENGTH_S * ewFrac));

    for (let phase = 1; phase <= 8; phase++) {
      const isNs = phase === 2 || phase === 6;
      const isEw = phase === 4 || phase === 8;
      const isLeft = phase === 1 || phase === 3 || phase === 5 || phase === 7;
      const splitS = isLeft
        ? DEFAULT_MIN_GREEN_S
        : isNs
          ? nsSplit
          : isEw
            ? ewSplit
            : DEFAULT_MIN_GREEN_S;
      lines.push(
        [
          intid,
          phase,
          0, // Brp
          DEFAULT_MIN_GREEN_S, // MinInitial
          splitS, // MaxInitial (split)
          3.0, // VehExt
          3.0, // MinGap
          DEFAULT_YELLOW_S,
          DEFAULT_ALL_RED_S,
          "None", // Recall
          "No", // DualEntry
          DEFAULT_CYCLE_LENGTH_S,
          "No", // Coordinated
          0, // Offset
        ].join(","),
      );
    }
  });
  lines.push(``);

  // --- [Phasing] section ---
  // Maps each movement to its NEMA phase number. Synchro uses this
  // to assemble the ring/barrier structure on import.
  lines.push(`[Phasing]`);
  const movements = Object.keys(NEMA_PHASE);
  lines.push(`INTID,${movements.join(",")}`);
  intersections.forEach((_, i) => {
    const intid = i + 1;
    const row = movements.map((m) => NEMA_PHASE[m]);
    lines.push(`${intid},${row.join(",")}`);
  });

  // Trailing newline so curl/file-save tools see a clean end.
  lines.push(``);
  return lines.join("\n");
}

function normDirection(d: string | undefined): string {
  if (!d) return "NB";
  const u = d.toUpperCase().slice(0, 2);
  if (["NB", "SB", "EB", "WB"].includes(u)) return u;
  return "NB";
}

function scenarioVol(a: EngineApproach, scenario: "current" | "no_build" | "build"): number {
  const v =
    scenario === "current"
      ? a.currentVolumeVph
      : scenario === "no_build"
        ? a.existingVolumeVph
        : a.futureVolumeVph ?? a.existingVolumeVph ?? a.currentVolumeVph;
  return Number.isFinite(v) ? Number(v) : 0;
}

function scenarioVc(a: EngineApproach, scenario: "current" | "no_build" | "build"): number {
  const vc =
    scenario === "current"
      ? a.existingVc
      : scenario === "no_build"
        ? a.existingVc
        : a.futureVc ?? a.existingVc;
  return Number.isFinite(vc) ? Number(vc) : 0.5;
}

function csvEscape(s: string): string {
  // UTDF is comma-delimited with no documented escape mechanism for
  // commas in names. Strip them defensively — names are display-only
  // in Synchro and aren't parsed for layout, so substituting a
  // hyphen is fine.
  return s.replace(/,/g, " -");
}
