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
  lines.push(`# 1. Turning movement counts: NOT measured. Approach volumes are`);
  lines.push(`#    distributed by 10% LEFT / 80% THROUGH / 10% RIGHT. Public TMC`);
  lines.push(`#    data does not exist at scale; PE must overlay field counts.`);
  lines.push(`# 2. Lane configuration: defaults to 1 LEFT + 2 THROUGH + 1 RIGHT`);
  lines.push(`#    per approach (4 lanes total). PE substitutes field-verified`);
  lines.push(`#    geometry from as-built plans or driveway survey.`);
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
  lines.push(`[Nodes]`);
  lines.push(`INTID,Name,X,Y,Z,TYPE,LATITUDE,LONGITUDE,Notes`);
  intersections.forEach((it, i) => {
    const intid = i + 1;
    const name = csvEscape(it.name ?? it.signalId ?? `Node ${intid}`);
    const lat = Number.isFinite(it.latitude) ? it.latitude : "";
    const lon = Number.isFinite(it.longitude) ? it.longitude : "";
    // X/Y in Synchro are arbitrary planar units. We use lat/lon × 1000
    // as a rough metric proxy — Synchro re-projects on import anyway,
    // and the relative layout matters more than absolute position for
    // the capacity calculation.
    const x = Number.isFinite(it.longitude) ? Math.round((it.longitude as number) * 100000) : 0;
    const y = Number.isFinite(it.latitude) ? Math.round((it.latitude as number) * 100000) : 0;
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
    for (const dir of ["NB", "SB", "EB", "WB"]) {
      if (!dirsWithData.has(dir)) continue;
      lines.push(
        `${intid},${dir}L,${DEFAULT_LEFT_LANES},${DEFAULT_LANE_WIDTH_FT},0,0,0,default-1L`,
      );
      lines.push(
        `${intid},${dir}T,${DEFAULT_THROUGH_LANES},${DEFAULT_LANE_WIDTH_FT},0,0,0,default-2T`,
      );
      lines.push(
        `${intid},${dir}R,${DEFAULT_RIGHT_LANES},${DEFAULT_LANE_WIDTH_FT},0,0,0,default-1R`,
      );
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
    for (const a of approaches) {
      const dir = normDirection(a.direction);
      const vol = scenarioVol(a, scenario);
      v[dir] = vol;
    }
    // Apply 10/80/10 L/T/R split per direction.
    const row = ["NB", "SB", "EB", "WB"].flatMap((dir) => {
      const vol = v[dir] ?? 0;
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
