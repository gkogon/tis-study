// Regression check: a signal inventory may only hold devices that control an
// intersection with a signal cycle.
//
// The bug: the city, county and FDOT layers overlaid onto the OSM baseline by
// scripts/src/fetch-city-signals.ts hold every device their agency maintains,
// not just traffic signals, and the regional loader grades every tuple as a
// signalized intersection.
//
// Charlotte (CDOT Accela MapServer/11): of 1,307 records with SERVSTAT='OP' on
// 2026-09-25, 411 were school flashers (SF/SFS, 206), mid-block ped beacons and
// crossings (MPB/MPS/MPCS, 78), multi-way stop flashers (MSF, 54), fire-station
// emergency signals (ES, 30), RRFBs (28), warning/stop flashers (SWSF, 10) and
// parking wayfinding signs (PWFS, 5); two more carry a type code and a
// description that contradict each other. Six of the fifteen study
// intersections of the hosted Mecklenburg sample were devices:
//   charlotte-cdot-80017  "Mcclintock Middle School"            SF  school flasher
//   charlotte-cdot-80097  "Oakhurst Elementary School"          SFS school flasher
//   charlotte-172295413   "Flasher Sheffield Dr & Woodland Dr"  MSF multi-way stop
//                          (OSM tags the node traffic_signals=blinker)
//   charlotte-cdot-1721   "... West Of Reddman Rd Ped Beacon Mid Block"  MPB
//   charlotte-cdot-1614   "Sharon Amity & Ped Beacon Mid Block ..."      MPB
//   charlotte-cdot-1896   "Ashmore Dr & Monroe Rd"              MPB -- no tag in
//                          the name, so no name filter would have caught it
// The devices were gravity zones too. In the sample as hosted before #232 the
// Sheffield Dr flasher was the largest zone (25.7% of project trips) and
// printed v/c 6.35, the outlier that sent the sample into #232. In #232's
// re-run the six drew 37.8% of project trips between them, and the report
// indicated mitigation at all three mid-block ped beacons and a school flasher.
//
// Miami-Dade (county TrafficSignals_gdb, no where clause): 6,038 records on
// 2026-09-28, of which 3,055 are existing traffic signals; the rest are school
// signs, flashing beacons and signals, cameras, reversible lanes, and records
// marked Future, New Construction or Removed. Eight of the eleven study rows of
// the hosted Miami-Dade sample were not existing signals: five flashing
// beacons, three school signs and a Future Construction signal (ASSETID 8338,
// printed LOS D 44.4 s). None carried a device word in its name.
// FDOT's statewide layer (tampa, orlando, miami-dade passes) types beacons
// (01), mid-block ped controls (03) and emergency signals (04) alongside
// signals (02); Orlando's city layer carries flashing beacons (FLBEA) and
// school flashers (SCHFL); Raleigh's carries HAWK and ped-only signals.
//
// The overlay was also last-write-wins across device types, so a device
// processed after a real signal inside the 50 m match radius took the
// signal's name and moved its node: the Quail Hollow Rd & Heathstead Place
// signal printed as "Beverly Woods Elementary School".
//
// FDOT's FIDs were renumbered upstream after the May fetch, so every
// FDOT-derived id in the committed files is stale. A plain rebuild would hand
// 305 Miami-Dade, 19 Orlando and 6 Tampa records an id that another location's
// AADT record is keyed by, silently attaching the wrong count.
//
// The invariants this guards:
//   - each record is classified signal / device / exclude from the source's
//     own type fields (and its own device annotations), and only signals
//     enter an inventory;
//   - an OSM node that maps a look-alike device is dropped, unless any pass
//     puts a signal within 50 m;
//   - an id stays with its location across rebuilds, and no two tuples share
//     one;
//   - an AADT record survives only on the tuple it was snapped to.
//
// Run: node ./scripts/verify-signal-device-types.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
// ts-loader lives in the sibling package; api-server has no scripts harness.
register(pathToFileURL(path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs")).href, import.meta.url);

const {
  classifyCdot,
  classifyMiamiDadeCounty,
  classifyFdot,
  classifyOrlandoCity,
  classifyRaleigh,
  dropNodesAtNonSignalDevices,
  reconcileCoarseSignals,
  buildSignalInventory,
  reconcileAadtKeys,
  FDOT_ID_NAMESPACE,
} = await import(path.resolve(here, "../src/lib/signal-device-types.ts"));
const { loadRegionalIntersections } = await import(path.resolve(here, "../src/lib/regional-intersections.ts"));

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else console.log("ok:", msg);
};
const S = "signal", D = "device", X = "exclude";

/** Run a classifier over a table of [args..., want] rows; report each miss. */
function table(label, rows, fn) {
  const wrong = rows.filter((r) => fn(...r.slice(0, -1)) !== r[r.length - 1]);
  for (const r of wrong) {
    ok(false, `${label} ${JSON.stringify(r.slice(0, -1))} should be ${r[r.length - 1]} (got ${fn(...r.slice(0, -1))})`);
  }
  ok(wrong.length === 0, `${label}: all ${rows.length} rows classify as expected`);
}

// ── 1. Classifiers, one table per layer ─────────────────────────────────────
// Charlotte CDOT: every (UNITTYPE, UNITTYPEDESC) pair served as OP on
// 2026-09-25 (record counts in comments). Look-alike device codes trigger the
// OSM purge; a record the source cannot classify consistently, or a sign, is
// only excluded.
table("CDOT", [
  ["TSL", "TRAFFIC SIGNAL WITH LOOPS", S], // 499
  ["TSV", "TRAFFIC SIGNAL W/ VIDEO DETECT", S], // 155
  ["TS", "TRAFFIC SIGNAL W/ FIXED TIME", S], // 88
  ["TSL", "TRAFFIC SIGNAL WITH LOOPS (OPTICOM)", S], // 73
  ["TSV", "TRAFFIC SIGNAL W/ VIDEO DETECT (OPTICOM)", S], // 24
  ["TSV", "TRAFFIC SIGNAL WITH LOOPS", S], // 15
  ["TSL", "TRAFFIC SIGNAL W/ VIDEO DETECT", S], // 8
  ["TSV", "TRAFFIC SIGNAL WITH LOOPS (OPTICOM)", S], // 8
  ["TS", "TRAFFIC SIGNAL WITH LOOPS", S], // 7
  ["TSL", "TRAFFIC SIGNAL W/ VIDEO DETECT (OPTICOM)", S], // 4
  ["TSL", "TRAFFIC SIGNAL W/ FIXED TIME", S], // 3
  ["TS", "TRAFFIC SIGNAL", S], // 2
  ["TS", "TRAFFIC SIGNAL W/ VIDEO DETECT", S], // 2
  ["TSL", " TRAFFIC SIGNAL WITH LOOPS", S], // 2, leading space in the source
  ["TS", "TRAFFIC SIGNAL W/ FIXED TIME (OPTICOM)", S], // 1
  ["TS", "TRAFFIC SIGNAL W/FIXED TIME", S], // 1
  ["TSV", null, S], // 1, Goose Creek Dr & Ridge Rd: signal code, no description
  ["TSV", "TRAFFIC SIGNAL W/ FIXED TIME", S], // 1
  ["SF", "SCHOOL FLASHER (SPEED REDUCT)", D], // 131
  ["SFS", "SCHOOL FLASHER SOLAR", D], // 70
  ["MPB", "MID BLOCK PED BEACON", D], // 66
  ["MSF", "MULTI-WAY STOP FLASHER", D], // 54
  ["ES", "Emergency signal", D], // 30
  ["RRFB", "RAPID RECTANGULAR FLASHING BEACON", D], // 28
  ["SWSF", "SOLAR WARNING/STOP FLASHER", D], // 10
  ["MPCS", "MID BLOCK PED CROSSING SOLAR", D], // 8
  ["SF", "SCHOOL FLASHER", D], // 5
  ["MPS", "MID-BLOCK PEDESTRIAN SIGNAL", D], // 2
  ["MPB", "MID-BLOCK PEDESTRIAN SIGNAL", D], // 1
  ["MPS", "MID BLOCK PED BEACON", D], // 1
  // Rensselaer Av & South Bv: ped-beacon code, signal description; OSM tags
  // both nodes traffic_signals=pedestrian_crossing, so the code is right.
  ["MPB", "TRAFFIC SIGNAL WITH LOOPS", D], // 1
  ["PWFS", "PARKING WAYFINDING SIGN", X], // 5: a sign, never mapped as a signal
  // "E 4TH ST CROSSING DR": signal code, mid-block ped description.
  ["TS", "MID-BLOCK PEDESTRIAN SIGNAL", X], // 1
  [null, null, X],
], classifyCdot);

// Miami-Dade county: ASSETTYPE 1 Traffic Signal, 2 School Sign, 3 Flashing
// Signal, 4 Flashing Beacon, 5 Reversible Lane, 6 Camera (8 is undocumented);
// CNSTRSTAT 0 Unknown, 1 Future, 2 New Construction, 3 Existing,
// 4 Reconstructing, 5 Deconstructing, 6 Removed. Counts on 2026-09-28.
table("Miami-Dade county", [
  [1, 3, S], // 3055
  [2, 3, D], // 1005 school signs
  [3, 3, D], // 15 flashing signals
  [4, 3, D], // 604 flashing beacons
  [5, 3, X], // 23 reversible lanes
  [6, 3, X], // 203 cameras: at real intersections, never mapped as signals
  [8, 3, X], // 8, undocumented type
  [1, 1, X], // 179 future signals, e.g. ASSETID 8338 in the hosted sample
  [1, 2, X], // 36 new construction
  [1, 4, X], // 4 reconstructing
  [1, 5, X], // 4 deconstructing
  [1, 6, X], // 231 removed
  [1, 0, X],
  [4, 1, X], // 350 future beacons: not there yet, so not a purge trigger
  [2, 6, X], // 23 removed school signs
  [null, null, X],
], classifyMiamiDadeCounty);

// FDOT SIGNALTY: VALUE_ is the type; SIGNALNC stands in when VALUE_ is N/A.
// Beacons are excluded, not devices: at all 7 Miami-Dade locations where the
// county (which operates them) also has a record, it files a traffic signal,
// among them NW 27 Av & NW 36 St, typed a beacon by FDOT.
table("FDOT", [
  ["02", "N/A", "SR 60", S],
  ["N/A", "02", "SR 60", S],
  ["02", "02", null, S],
  ["01", "N/A", "Cr 42", X], // beacon
  ["03", "N/A", null, D], // mid-block ped control
  ["03", "03", null, D],
  ["04", "N/A", "Macdill", D], // emergency signal
  ["N/A", "01", null, X],
  ["N/A", "03", null, D],
  ["05", "N/A", null, X], // at school: flasher or signal, the code does not say
  ["N/A", "N/A", null, X], // untyped
  ["02", "01", null, X], // codes disagree
  // Typed as a signal but the side street is a fire station: a full signal
  // with fire preemption or an emergency-vehicle signal; not decidable.
  ["02", "N/A", "BAY AVE FIRE STATION", X],
  ["02", "N/A", "GIBBS HIGH SCHOOL", S], // a signal at a school driveway
  [null, null, null, X],
], classifyFdot);

// City of Orlando: Type is the controller class; the city annotates what a
// signal controls in the cross-street text.
table("Orlando city", [
  ["RCSS", "CURRY FORD RD & GASTON FOSTER RD", S],
  ["ISOL", "LAKE UNDERHILL RD & OXALIS DR", S],
  ["EAGLE", "CONWAY RD & MICHIGAN ST", S],
  ["TRAFSIG", "Gatlin Rd & Dixie Belle", S],
  ["FLBEA", "N FOREST AV & NEBRASKA ST", D],
  ["SCHFL", "AARON AV & BOOKER ST (ECCLESTON ES)", D],
  ["RCSS", "INTERNATIONAL DR & HOLIDAY INN (6550 BLK)     (CROSS WALK)", D],
  ["RCSS", "HOWARD JR HIGH X WALK & ROBINSON ST (Howard MS)(CROSS WALK)", D],
  ["RCSS", "N ORANGE AV & WALL ST            (PEDESTRIAN CROSSING)", D],
  ["RCSS", "OIA Ped Crossing & Terminal A", D],
  ["ISOL", "BENNET RD & CADY WY BIKE PATH", D],
  // fire department annotation: same ambiguity as FDOT's fire-station 02s
  ["ISOL", "ELIZABETH AV & PRINCETON ST (OFD#3)", X],
  ["RCSS", "CURRIN DR & HIAWASSEE RD (OFD#12)", X],
  ["XYZ", "A & B", X],
  [null, "", X],
], classifyOrlandoCity);

// Raleigh: Subtype, plus the fire-station ambiguity.
table("Raleigh", [
  ["Signal", "AVENT FERRY RD. / TRAILWOOD DR.", S],
  ["Signal", "NEW BERN AVE. / WAKEMED EMERGENCY ENTRANCE", S], // hospital driveway
  ["Signal", "ROCK QUARRY RD. / FIRE STATION #3", X],
  ["HAWK Signal", "(HAWK) PACE ST. / PERSON ST.", D],
  ["Pedestrian Signal", "(PED ONLY) HILLSBOROUGH ST. / OBERLIN RD.", D],
  ["Unknown", "A / B", X],
  [null, "", X],
], classifyRaleigh);

// ── 2. A coarse-typed signal yields to a more specific device, mid-block ────
// The county layer has no ped or emergency type, so those appear as
// "Traffic Signal"; FDOT types the same device 03 or 04. FDOT's typing only
// confirms what the county's own name says: a record the operating agency
// names as an intersection is never overridden. FDOT types full signals at
// major intersections as beacons (NW 27 Av & NW 36 St, SIGNALNC 01) or
// emergency signals (NW 7 Av & NW 36 St, 04, a full signal serving a fire
// station). Real records:
{
  const rec = (id, lat, lon, name, cls) => ({ id, lat, lon, name, cls });
  const county = {
    idNamespace: 0,
    coarseSignalType: true,
    records: [
      rec(4535, 25.628898, -80.34215, "Coral Reef Dr @ SW 9200 Blk", S), // FDOT 04 2.5 m, block address
      rec(6112, 25.806873, -80.124176, "Collins Av / 31 St / 32 St", S), // FDOT 03 15.9 m, between streets
      rec(5983, 25.586181, -80.387103, "Quail Roost Dr @ SW 12100 Blk", S), // FDOT 04 29.3 m, block address
      rec(7673, 25.825195, -80.198713, "NW 54 St/ NW 1 Av & 1 Ct", S), // FDOT 03 1.7 m, between streets
      rec(7715, 25.811904, -80.124407, "Indian Creek Dr & 39 St", S), // FDOT 03 40.4 m
      rec(2049, 25.810034, -80.207568, "NW 7 Av & NW 36 St", S), // FDOT 04 3.6 m
      rec(2056, 25.809092, -80.240243, "NW 27 Av & NW 36 ST", S), // FDOT SIGNALNC 01 9.8 m
    ],
  };
  const fdot = {
    idNamespace: FDOT_ID_NAMESPACE,
    records: [
      rec(9664, 25.628897, -80.342175, null, D),
      rec(4164, 25.807005, -80.124116, null, D),
      rec(5739, 25.585999, -80.387315, null, D),
      rec(6631, 25.825207, -80.198702, null, D),
      rec(6047, 25.812262, -80.124342, null, D),
      rec(7337, 25.810054, -80.20754, null, D),
      rec(5249, 25.809156, -80.240177, null, D),
    ],
  };
  const { passes, reclassified } = reconcileCoarseSignals([county, fdot]);
  const clsOf = (id) => passes[0].records.find((r) => r.id === id).cls;
  ok(clsOf(4535) === D, "a block-address county signal 2.5 m from an FDOT emergency signal becomes a device");
  ok(clsOf(6112) === D, "a between-streets county signal 15.9 m from an FDOT mid-block ped control becomes a device");
  ok(clsOf(5983) === D, "a block-address county signal 29.3 m from an FDOT emergency signal becomes a device");
  ok(clsOf(7673) === D, "\"NW 54 St/ NW 1 Av & 1 Ct\" (between 1 Av and 1 Ct) 1.7 m from an FDOT ped control becomes a device");
  ok(clsOf(7715) === S, "an intersection-named county signal 40.4 m from an FDOT ped control stays a signal");
  ok(clsOf(2049) === S, "NW 7 Av & NW 36 St stays a signal though FDOT types a device 3.6 m away 04");
  ok(clsOf(2056) === S, "NW 27 Av & NW 36 ST stays a signal though FDOT types a beacon 9.8 m away");
  ok(JSON.stringify(reclassified.map((r) => r.id).sort()) === JSON.stringify([4535, 5983, 6112, 7673]),
    `the reconciled records are reported (${JSON.stringify(reclassified.map((r) => r.id))})`);
  ok(passes[1].records.every((r) => r.cls === D), "FDOT's own classes are untouched");
}

// ── 3. OSM nodes that map a device are dropped (Charlotte coordinates) ─────
{
  const nodes = [
    [172295413, 35.20366, -80.77732, null, 2], // OSM traffic_signals=blinker, Sheffield Dr & Woodland Dr
    [172164141, 35.13043, -80.83783, null, 2], // OSM signal, Quail Hollow Rd & Heathstead Place
    [9000000001, 35.20421, -80.77732, null, 2], // 60 m north of the Sheffield flasher, nothing else near
  ];
  const signals = [
    { lat: 35.13042, lon: -80.83781 }, // CDOT 1783 TSL Quail Hollow Rd & Heathstead Place (1.8 m)
    { lat: 35.20783, lon: -80.78348 }, // CDOT 437 TSL Eastway Dr & Woodland Dr (727 m from Sheffield)
  ];
  const devices = [
    { lat: 35.20367, lon: -80.77732 }, // CDOT 90032 MSF Flasher Sheffield Dr & Woodland Dr (1.1 m)
    { lat: 35.13036, lon: -80.83762 }, // CDOT 80001 SF Beverly Woods Elementary School (20 m from the signal)
    { lat: 35.2069, lon: -80.77982 }, // CDOT 90026 MSF Norland Rd & Woodland Dr (426 m)
  ];
  const { kept, dropped } = dropNodesAtNonSignalDevices(nodes, signals, devices, 50);
  const keptIds = kept.map((t) => t[0]);
  ok(JSON.stringify(dropped.map((t) => t[0])) === JSON.stringify([172295413]),
    "the OSM blinker node at a CDOT multi-way stop flasher is dropped");
  ok(keptIds.includes(172164141),
    "a signalized junction is kept when a school flasher sits 20 m away but the CDOT signal is 1.8 m away");
  ok(keptIds.includes(9000000001), "a node 60 m from the nearest device is outside the 50 m radius and kept");
  ok(kept.length + dropped.length === nodes.length, "every input node is either kept or dropped");
}

// ── 4. The chained build ────────────────────────────────────────────────────
{
  const rec = (id, lat, lon, name, cls) => ({ id, lat, lon, name, cls });
  const ids = (ts) => ts.map((t) => t[0]);

  // 4a. Protection spans passes: a pass-1 signal 22 m north protects the node
  // from a pass-2 device 33 m south; without it, the node is dropped.
  const archiveA = [[1, 25.0, -80.0, null, 2]];
  const p1 = { idNamespace: 0, records: [rec(11, 25.0002, -80.0, "Main St & 1st Av", S)] };
  const p2 = { idNamespace: FDOT_ID_NAMESPACE, records: [rec(22, 24.9997, -80.0, null, D)] };
  const a = buildSignalInventory(archiveA, [p1, p2], []);
  ok(JSON.stringify(a.tuples) === JSON.stringify([[1, 25.0002, -80.0, "Main St & 1st Av", 2]]),
    `a pass-1 signal protects its node from a pass-2 device and names it (got ${JSON.stringify(a.tuples)})`);
  const a2 = buildSignalInventory(archiveA, [{ idNamespace: 0, records: [] }, p2], []);
  ok(a2.tuples.length === 0 && ids(a2.dropped).includes(1), "the same node, unprotected, is dropped");

  // 4b. Exclude records neither name a node nor drop it. OSM 925462144 at NW
  // 107 Av & NW 41 St: the county camera (11 m) had been naming it; the
  // county signal (13 m) must.
  const b = buildSignalInventory(
    [[925462144, 25.81157, -80.36944, null, 2]],
    [{ idNamespace: 0, records: [
      rec(14887, 25.811655, -80.369503, "NW 107 Av & NW 41 St", X), // camera
      rec(4887, 25.811674, -80.369379, "NW 107 Av & NW 41 St", S),
      rec(8338, 25.818886, -80.369676, "NW 107 Av & NW 50 St", X), // Future Construction
    ] }],
    [],
  );
  ok(JSON.stringify(b.tuples) === JSON.stringify([[925462144, 25.81167, -80.36938, "NW 107 Av & NW 41 St", 2]]),
    `a camera never overlays and a future signal is never added (got ${JSON.stringify(b.tuples)})`);

  // 4c. Ids stay with their location. FDOT "Mystic Oaks Blvd" was FID 3023 in
  // the committed file and is FID 43 today; no OSM node within 322 m.
  const fdotRec = rec(43, 28.1856, -82.37162, "Mystic Oaks Blvd", S);
  const prev = [[-3023, 28.1856, -82.37162, "Mystic Oaks Blvd", 2]];
  const c1 = buildSignalInventory([], [{ idNamespace: FDOT_ID_NAMESPACE, records: [fdotRec] }], prev);
  ok(JSON.stringify(ids(c1.tuples)) === JSON.stringify([-3023]),
    `a record at the same place under the same name keeps its previous id (got ${JSON.stringify(ids(c1.tuples))})`);
  const c2 = buildSignalInventory([], [{ idNamespace: FDOT_ID_NAMESPACE, records: [fdotRec] }], []);
  ok(JSON.stringify(ids(c2.tuples)) === JSON.stringify([-10000043]),
    `a new FDOT record gets an id in FDOT's own range (got ${JSON.stringify(ids(c2.tuples))})`);
  const c3 = buildSignalInventory([], [{ idNamespace: FDOT_ID_NAMESPACE, records: [fdotRec] }],
    [[-3023, 28.1856, -82.37162, "Some Other Rd", 2]]);
  ok(JSON.stringify(ids(c3.tuples)) === JSON.stringify([-10000043]),
    "a previous tuple under a different name does not lend its id");
  const c4 = buildSignalInventory([], [{ idNamespace: 0, records: [rec(5983, 25.586181, -80.387103, "Quail Roost Dr", S)] }], []);
  ok(JSON.stringify(ids(c4.tuples)) === JSON.stringify([-5983]), "a new record from a stable-id source keeps -id");

  // 4d. Idempotent: rebuilding on its own output reproduces it exactly.
  const archiveD = [[1, 25.0, -80.0, null, 2], [2, 25.01, -80.0, null, 2]];
  const passesD = [
    { idNamespace: 0, records: [rec(11, 25.0001, -80.0, "A & B", S), rec(12, 25.3, -80.3, "C & D", S)] },
    { idNamespace: FDOT_ID_NAMESPACE, records: [rec(7, 25.5, -80.5, "E", S), rec(8, 25.01, -80.0002, null, D)] },
  ];
  const d1 = buildSignalInventory(archiveD, passesD, []);
  const d2 = buildSignalInventory(archiveD, passesD, d1.tuples);
  ok(JSON.stringify(d1.tuples) === JSON.stringify(d2.tuples), "a second build on the first build's output is identical");
  ok(new Set(ids(d1.tuples)).size === d1.tuples.length, "no two tuples share an id");
}

// ── 5. AADT records follow their tuple, or are dropped ─────────────────────
{
  const previous = [
    [-1, 25.0, -80.0, "A & B", 2],
    [5091071465, 25.77, -80.38, "Flagler St W WB @ W 11700 Blk", 2], // hijacked position
    [-7, 25.1, -80.1, "C & D", 2],
    [-7, 25.2, -80.2, "E & F", 2], // shared id: owner unknown
    [-9, 25.3, -80.3, "G & H", 2], // removed next
  ];
  const next = [
    [-1, 25.0, -80.0, "A & B", 2],
    [5091071465, 25.77068, -80.38, null, 2], // back at the junction, 76 m north
    [-7, 25.1, -80.1, "C & D", 2],
    [-11, 25.4, -80.4, "new", 2], // a new tuple on a key that had no tuple before
  ];
  const aadt = { "-1": { aadt: 1 }, "5091071465": { aadt: 2 }, "-7": { aadt: 3 }, "-9": { aadt: 4 }, "-11": { aadt: 5 } };
  const r = reconcileAadtKeys(aadt, previous, next, 50);
  ok(JSON.stringify(Object.keys(r.kept)) === JSON.stringify(["-1"]), `only the unmoved key is kept (got ${JSON.stringify(Object.keys(r.kept))})`);
  ok(JSON.stringify(r.moved) === JSON.stringify(["5091071465"]), "a tuple that moved 76 m loses its record");
  ok(JSON.stringify(r.shared) === JSON.stringify(["-7"]), "a key two tuples shared is dropped");
  ok(JSON.stringify([...r.orphaned].sort()) === JSON.stringify(["-11", "-9"]), "keys with no tuple before or after are dropped");
}

// ── 6. The committed inventories ────────────────────────────────────────────
const SLUGS = ["charlotte", "miami-dade", "orlando", "raleigh-durham", "tampa"];
const dataPath = (f) => path.resolve(here, "../src/data", f);
const tuplesOf = (slug) => JSON.parse(fs.readFileSync(dataPath(`${slug}-signals.json`), "utf8"));

// 6a. Hosted-sample rows that were not signals are no longer served.
{
  const byId = new Map(loadRegionalIntersections("charlotte_metro").map((s) => [s.id, s]));
  for (const [id, what] of [
    ["charlotte-cdot-80017", "Mcclintock Middle School (SF school flasher)"],
    ["charlotte-cdot-80097", "Oakhurst Elementary School (SFS school flasher)"],
    ["charlotte-172295413", "Flasher Sheffield Dr & Woodland Dr (MSF, OSM blinker)"],
    ["charlotte-cdot-1721", "Albemarle Rd & West Of Reddman Rd Ped Beacon Mid Block (MPB)"],
    ["charlotte-cdot-1614", "Sharon Amity & Ped Beacon Mid Block (MPB)"],
    ["charlotte-cdot-1896", "Ashmore Dr & Monroe Rd (MPB)"],
  ]) {
    ok(!byId.has(id), `${id} ${what} is not served as a signalized intersection`);
  }
  for (const [id, want] of [
    ["charlotte-172164141", "Quail Hollow Rd & Heathstead Place"], // was "Beverly Woods Elementary School"
    ["charlotte-172318595", "E 9th St & N Caldwell St"], // was "First Ward Elementary School"
  ]) {
    const got = byId.get(id)?.name;
    ok(got === want, `${id} is named ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
  }
  for (const id of [
    "charlotte-172660814", "charlotte-2181076118", "charlotte-7810838990", "charlotte-2181076171",
    "charlotte-5527699422", "charlotte-7945928189", "charlotte-5516526369", "charlotte-172211825",
  ]) {
    ok(byId.has(id), `${id} (${byId.get(id)?.name ?? "missing"}) is still served`);
  }
}
{
  const byId = new Map(loadRegionalIntersections("miami_dade_metro").map((s) => [s.id, s]));
  for (const [id, what] of [
    ["miami-dade-cdot-8338", "NW 107 Av & NW 50 St (Traffic Signal, Future Construction)"],
    ["miami-dade-cdot-7490", "NW 52 St @ 10400 Blk (Flashing Beacon)"],
    ["miami-dade-cdot-7519", "NW 109 Av @ NW 4800 Blk (Flashing Beacon)"],
    ["miami-dade-cdot-7489", "NW 52 St @ NW 104 Av (Flashing Beacon)"],
    ["miami-dade-cdot-7270", "NW 50 St @ NW 10900 Blk (Flashing Beacon)"],
    ["miami-dade-cdot-7269", "NW 50 St @ NW 11000 Blk (Flashing Beacon)"],
    ["miami-dade-cdot-6072", "NW 50 St @ NW 10800 Blk (School Sign)"],
    ["miami-dade-cdot-5777", "NW 52 St @ NW 10400 Blk (School Sign)"],
    ["miami-dade-cdot-7450", "NW 58 St @ NW 10400 Blk (School Sign)"],
  ]) {
    ok(!byId.has(id), `${id} ${what} is not served as a signalized intersection`);
  }
  for (const id of ["miami-dade-925462710", "miami-dade-9175370051"]) {
    ok(byId.has(id), `${id} (${byId.get(id)?.name ?? "missing"}) is still served`);
  }
}

// 6b. No device descriptor survives in an embedded (source-given) name. Only
// embedded names are scanned: roads-derived names can read "Beacon Hill Rd",
// and FDOT side streets legitimately read "Gibbs High School".
{
  const COMMON = [
    /^flasher\b/i, /\bflashing beacon\b/i, /\bschool flasher\b/i, /\bbeacon\b.*\bmid[- ]?block\b/i,
    /\bped beacon\b/i, /\bphb\b/i, /\(hawk\)/i, /\(ped only\)/i, /\bcross ?walk\b/i, /\bx walk\b/i,
    /\bped(estrian)? crossing\b/i, /\bbike path\b/i, /\bemergency signal\b/i, /\bfire station\b/i,
    /\(ofd#\d+\)/i, /\bwayfinding\b/i,
  ];
  const CDOT_ONLY = [/\bbeacon\b/i, /\bhawk$/i, /\bmid[- ]?block\b/i, /\b(elementary|middle|high) school$/i];
  for (const slug of SLUGS) {
    const pats = slug === "charlotte" ? [...COMMON, ...CDOT_ONLY] : COMMON;
    const leaked = tuplesOf(slug).filter((t) => typeof t[3] === "string" && pats.some((rx) => rx.test(t[3])));
    ok(leaked.length === 0,
      `${slug}: no embedded name carries a device descriptor (found ${leaked.length}` +
        `${leaked.length ? `, e.g. ${leaked.slice(0, 3).map((t) => JSON.stringify(t[3])).join(", ")}` : ""})`);
  }
}

// 6c. Ids are unique, and every AADT key names a tuple that exists.
for (const slug of SLUGS) {
  const tuples = tuplesOf(slug);
  const seen = new Map();
  for (const t of tuples) seen.set(t[0], (seen.get(t[0]) ?? 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  ok(dup.length === 0, `${slug}: no two tuples share an id (${dup.length ? `duplicated: ${dup.slice(0, 5).join(", ")}` : "none"})`);
  const aadtFile = dataPath(`${slug}-aadt.json`);
  if (fs.existsSync(aadtFile)) {
    const keys = Object.keys(JSON.parse(fs.readFileSync(aadtFile, "utf8")));
    const orphan = keys.filter((k) => !seen.has(Number(k)));
    ok(orphan.length === 0, `${slug}: every AADT key names an existing tuple (${orphan.length} orphaned of ${keys.length})`);
  }
}

console.log(fails === 0 ? "\nAll signal-device-type checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
