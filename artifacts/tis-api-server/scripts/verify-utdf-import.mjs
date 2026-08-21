// Regression check for the UTDF reader (utdf-import.ts).
//
// Two independent proofs:
//
//  1. ROUND-TRIP: build an engine result, export it with generateUtdf (the
//     shipped exporter), re-import with parseUtdf, and assert everything the
//     exporter encoded comes back exactly — node coordinates, per-movement
//     volumes (10/80/10 of the approach volumes), lane defaults, cycle length
//     and phase splits. If the two ever disagree, one of them is lying about
//     the format.
//
//  2. FOREIGN FILE: a Synchro-style MATRIX-layout fixture (RECORDNAME-first,
//     one row per record type) that our exporter has never produced — CRLF
//     line endings, a BOM, PHF and HeavyVehicles records, an unknown section.
//     This is the shape real customer files arrive in.
//
// Run: node ./scripts/verify-utdf-import.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { generateUtdf } = await import(path.resolve(here, "../src/lib/utdf-export.ts"));
const { parseUtdf, approachVolumes, UTDF_MOVEMENTS } = await import(path.resolve(here, "../src/lib/utdf-import.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// ---------------------------------------------------------------------------
// 1. Round-trip through our own exporter
// ---------------------------------------------------------------------------
{
  const result = {
    request: { projectName: "Roundtrip Test", latitude: 25.8456, longitude: -80.2103 },
    affectedIntersections: [
      {
        signalId: "sig-1", name: "NW 7 Ave & NW 79 St",
        latitude: 25.8461, longitude: -80.2105,
        approaches: [
          { direction: "NB", futureVolumeVph: 900, futureVc: 0.82 },
          { direction: "SB", futureVolumeVph: 700, futureVc: 0.66 },
          { direction: "EB", futureVolumeVph: 400, futureVc: 0.41 },
          { direction: "WB", futureVolumeVph: 300, futureVc: 0.35 },
        ],
      },
      {
        signalId: "sig-2", name: "NW 7 Ave & NW 81 St, north leg",
        latitude: 25.8489, longitude: -80.2106,
        approaches: [
          { direction: "NB", futureVolumeVph: 850, futureVc: 0.75 },
          { direction: "SB", futureVolumeVph: 640, futureVc: 0.58 },
        ],
      },
    ],
  };

  const text = generateUtdf(result, { scenario: "build", projectName: "Roundtrip Test" });
  const doc = parseUtdf(text);

  ok(doc.warnings.length === 0, `roundtrip: no warnings (${doc.warnings.join("; ") || "clean"})`);
  ok(doc.nodes.length === 2, `roundtrip: both nodes parsed (${doc.nodes.length})`);

  const n1 = doc.nodes.find((n) => n.intId === 1);
  ok(n1?.name === "NW 7 Ave & NW 79 St", `roundtrip: node name survives (${n1?.name})`);
  ok(n1?.latitude === 25.8461 && n1?.longitude === -80.2105,
    `roundtrip: node lat/lon survive exactly (${n1?.latitude}, ${n1?.longitude})`);
  const n2 = doc.nodes.find((n) => n.intId === 2);
  // The exporter STRIPS commas (UTDF has no documented escape for them), so
  // the round-trip contract is "comma becomes ' -'", not byte identity.
  ok(n2?.name === "NW 7 Ave & NW 81 St - north leg",
    `roundtrip: comma'd name survives via the exporter's documented sanitisation (${n2?.name})`);

  // Volumes: exporter applies 10/80/10 to each approach volume.
  const v1 = doc.volumes.find((v) => v.intId === 1);
  ok(v1?.movements.NBL === 90 && v1?.movements.NBT === 720 && v1?.movements.NBR === 90,
    `roundtrip: NB 900 splits 90/720/90 (got ${v1?.movements.NBL}/${v1?.movements.NBT}/${v1?.movements.NBR})`);
  ok(v1?.movements.WBL === 30 && v1?.movements.WBT === 240 && v1?.movements.WBR === 30,
    "roundtrip: WB 300 splits 30/240/30");
  const av = approachVolumes(v1);
  ok(av.NB === 900 && av.SB === 700 && av.EB === 400 && av.WB === 300,
    `roundtrip: approachVolumes reassembles the originals (${av.NB}/${av.SB}/${av.EB}/${av.WB})`);

  // Node 2 has only NB/SB approaches — EB/WB must be zero, not invented.
  const v2 = doc.volumes.find((v) => v.intId === 2);
  const av2 = approachVolumes(v2);
  ok(av2.EB === 0 && av2.WB === 0, "roundtrip: absent approaches stay zero");

  // Lanes: 1L/2T/1R defaults for every approach with data.
  const l1 = doc.lanes.find((l) => l.intId === 1);
  ok(l1?.movements.NBL?.lanes === 1 && l1?.movements.NBT?.lanes === 2 && l1?.movements.NBR?.lanes === 1,
    "roundtrip: lane defaults survive (NB 1L/2T/1R)");
  const l2 = doc.lanes.find((l) => l.intId === 2);
  ok(l2 && Object.keys(l2.movements).length === 6,
    `roundtrip: node 2 has exactly NB+SB movements (${Object.keys(l2?.movements ?? {}).length})`);

  // Timings: cycle 90s, 8 phases, split ∝ v/c.
  const t1 = doc.timings.find((t) => t.intId === 1);
  ok(t1?.cycleLengthS === 90, `roundtrip: cycle length survives (${t1?.cycleLengthS})`);
  ok(t1?.phases.length === 8, `roundtrip: all 8 NEMA phases parsed (${t1?.phases.length})`);
  const p2 = t1?.phases.find((p) => p.phase === 2);
  const p4 = t1?.phases.find((p) => p.phase === 4);
  ok(p2 && p4 && p2.splitS > p4.splitS,
    `roundtrip: NS split > EW split, matching the v/c ratio (${p2?.splitS}s vs ${p4?.splitS}s)`);
  ok(t1?.coordinated === false, "roundtrip: Coordinated=No parses as false");
}

// ---------------------------------------------------------------------------
// 2. Synchro-style matrix layout (foreign file)
// ---------------------------------------------------------------------------
{
  const foreign = [
    "﻿[Network]",
    "RECORDNAME,DATA",
    "Metric,0",
    "",
    "[Nodes]",
    "INTID,TYPE,X,Y",
    "5,0,1200,3400",
    "",
    "[Volumes]",
    "RECORDNAME,INTID,NBL,NBT,NBR,SBL,SBT,SBR,EBL,EBT,EBR,WBL,WBT,WBR",
    "Volume,5,45,505,50,60,610,35,25,150,20,30,140,25",
    "PHF,5,0.92,0.92,0.92,0.95,0.95,0.95,0.90,0.90,0.90,0.88,0.88,0.88",
    "HeavyVehicles,5,2,3,2,2,3,2,5,5,5,4,4,4",
    "Growth,5,1,1,1,1,1,1,1,1,1,1,1,1",
    "",
    "[Lanes]",
    "RECORDNAME,INTID,NBL,NBT,NBR,SBL,SBT,SBR,EBL,EBT,EBR,WBL,WBT,WBR",
    "Lanes,5,1,2,1,1,2,1,1,1,0,1,1,0",
    "Storage,5,150,0,100,175,0,0,80,0,0,90,0,0",
    "Shared,5,0,0,0,0,0,0,0,0,0,0,0,0",
    "",
    "[SomeFutureSection]",
    "RECORDNAME,DATA",
    "Whatever,1",
    "",
  ].join("\r\n");

  const doc = parseUtdf(foreign);

  ok(doc.nodes.length === 1 && doc.nodes[0].intId === 5,
    "foreign: BOM + CRLF + matrix layout parse");
  const v = doc.volumes.find((x) => x.intId === 5);
  ok(v?.movements.NBT === 505 && v?.movements.SBT === 610,
    `foreign: matrix Volume row lands per-movement (NBT=${v?.movements.NBT}, SBT=${v?.movements.SBT})`);
  ok(v?.phf?.NBL === 0.92 && v?.phf?.WBR === 0.88,
    "foreign: PHF record captured per movement");
  ok(v?.heavyVehiclesPct?.EBL === 5, "foreign: HeavyVehicles record captured");
  const l = doc.lanes.find((x) => x.intId === 5);
  ok(l?.movements.NBT?.lanes === 2 && l?.movements.EBR?.lanes === 0,
    "foreign: matrix Lanes row lands per movement (incl. explicit 0-lane)");
  ok(l?.movements.NBL?.storageFt === 150 && l?.movements.SBL?.storageFt === 175,
    "foreign: Storage lengths captured — the turn-bay data the engine estimates today");
  ok(doc.warnings.some((w) => w.includes("SomeFutureSection")),
    `foreign: unknown section skipped LOUDLY, not silently (${doc.warnings.find((w) => w.includes("SomeFutureSection"))})`);
  ok(doc.warnings.some((w) => w.toLowerCase().includes('"growth"')),
    "foreign: unconsumed Growth record named in warnings");
}

// ---------------------------------------------------------------------------
// 3. Garbage stays safe
// ---------------------------------------------------------------------------
{
  const empty = parseUtdf("");
  ok(empty.warnings.length === 1 && empty.nodes.length === 0, "empty string → warning, no crash");
  const junk = parseUtdf("this,is\nnot,a\nutdf,file\n");
  ok(junk.warnings.length >= 1 && junk.volumes.length === 0, "non-UTDF text → warning, no data");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
