// Regression check: a signal inventory may only hold devices that control an
// intersection with a signal cycle.
//
// The bug: CDOT's "Traffic Signals" layer (Accela MapServer/11) holds every
// device CDOT maintains, not just traffic signals. Of the 1,307 records with
// SERVSTAT='OP' on 2026-09-25, 411 were school flashers (SF/SFS, 206),
// mid-block ped beacons and crossings (MPB/MPS/MPCS, 78), multi-way stop
// flashers (MSF, 54), fire-station emergency signals (ES, 30), RRFBs (28),
// warning/stop flashers (SWSF, 10) and parking wayfinding signs (PWFS, 5);
// two more carry a type code and a description that contradict each other.
// The overlay into charlotte-signals.json filtered on SERVSTAT only, and the
// regional loader treats every tuple as a signalized intersection named after
// CDOT's UNITDESC.
//
// Observed live (mecklenburg-county.pdf, site 35.1954/-80.7643, 1.0 mi): six
// of fifteen study intersections were not signals, and each received a
// signalized delay and LOS grade:
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
// The overlay was also last-write-wins across device types, so a school
// flasher processed after a real signal inside the 50 m match radius took the
// signal's name: the Quail Hollow Rd & Heathstead Place signal printed as
// "Beverly Woods Elementary School".
//
// The invariant this guards: only CDOT traffic-signal records (UNITTYPE
// TS/TSL/TSV, with a description that agrees) enter the Charlotte inventory,
// and an OSM node that maps a CDOT non-signal device is dropped rather than
// kept as a signal.
//
// Run: node ./scripts/verify-signal-device-types.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
// ts-loader lives in the sibling package; api-server has no scripts harness.
register(pathToFileURL(path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs")).href, import.meta.url);

const { isCdotTrafficSignal, dropNodesAtNonSignalDevices } = await import(
  path.resolve(here, "../src/lib/signal-device-types.ts")
);
const { loadRegionalIntersections } = await import(path.resolve(here, "../src/lib/regional-intersections.ts"));

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else console.log("ok:", msg);
};

// ── 1. Classifier: every (UNITTYPE, UNITTYPEDESC) pair CDOT publishes as OP ──
// Pairs and counts as served by the layer on 2026-09-25. Expected values are
// set by hand from the device each pair describes.
const CDOT_OP_TYPES = [
  // traffic signals, every detection / preemption variant
  ["TSL", "TRAFFIC SIGNAL WITH LOOPS", 499, true],
  ["TSV", "TRAFFIC SIGNAL W/ VIDEO DETECT", 155, true],
  ["TS", "TRAFFIC SIGNAL W/ FIXED TIME", 88, true],
  ["TSL", "TRAFFIC SIGNAL WITH LOOPS (OPTICOM)", 73, true],
  ["TSV", "TRAFFIC SIGNAL W/ VIDEO DETECT (OPTICOM)", 24, true],
  ["TSV", "TRAFFIC SIGNAL WITH LOOPS", 15, true],
  ["TSL", "TRAFFIC SIGNAL W/ VIDEO DETECT", 8, true],
  ["TSV", "TRAFFIC SIGNAL WITH LOOPS (OPTICOM)", 8, true],
  ["TS", "TRAFFIC SIGNAL WITH LOOPS", 7, true],
  ["TSL", "TRAFFIC SIGNAL W/ VIDEO DETECT (OPTICOM)", 4, true],
  ["TSL", "TRAFFIC SIGNAL W/ FIXED TIME", 3, true],
  ["TS", "TRAFFIC SIGNAL", 2, true],
  ["TS", "TRAFFIC SIGNAL W/ VIDEO DETECT", 2, true],
  ["TSL", " TRAFFIC SIGNAL WITH LOOPS", 2, true], // leading space in the source
  ["TS", "TRAFFIC SIGNAL W/ FIXED TIME (OPTICOM)", 1, true],
  ["TS", "TRAFFIC SIGNAL W/FIXED TIME", 1, true],
  ["TSV", null, 1, true], // Goose Creek Dr & Ridge Rd: code says signal, no description
  ["TSV", "TRAFFIC SIGNAL W/ FIXED TIME", 1, true],
  // devices with no signal cycle at an intersection
  ["SF", "SCHOOL FLASHER (SPEED REDUCT)", 131, false],
  ["SFS", "SCHOOL FLASHER SOLAR", 70, false],
  ["MPB", "MID BLOCK PED BEACON", 66, false],
  ["MSF", "MULTI-WAY STOP FLASHER", 54, false],
  ["ES", "Emergency signal", 30, false],
  ["RRFB", "RAPID RECTANGULAR FLASHING BEACON", 28, false],
  ["SWSF", "SOLAR WARNING/STOP FLASHER", 10, false],
  ["MPCS", "MID BLOCK PED CROSSING SOLAR", 8, false],
  ["PWFS", "PARKING WAYFINDING SIGN", 5, false],
  ["SF", "SCHOOL FLASHER", 5, false],
  ["MPS", "MID-BLOCK PEDESTRIAN SIGNAL", 2, false],
  ["MPB", "MID-BLOCK PEDESTRIAN SIGNAL", 1, false],
  ["MPS", "MID BLOCK PED BEACON", 1, false],
  // code and description disagree: excluded, not guessed.
  // Rensselaer Av & South Bv: OSM tags both nodes traffic_signals=pedestrian_crossing.
  ["MPB", "TRAFFIC SIGNAL WITH LOOPS", 1, false],
  // "E 4TH ST CROSSING DR": no cross street, described as a mid-block ped signal.
  ["TS", "MID-BLOCK PEDESTRIAN SIGNAL", 1, false],
];
{
  const wrong = CDOT_OP_TYPES.filter(([code, desc, , want]) => isCdotTrafficSignal(code, desc) !== want);
  for (const [code, desc, n, want] of wrong) {
    ok(false, `${code} / ${JSON.stringify(desc)} (${n} records) should classify as ${want ? "signal" : "non-signal"}`);
  }
  const kept = CDOT_OP_TYPES.filter(([, , , want]) => want).reduce((s, r) => s + r[2], 0);
  const dropped = CDOT_OP_TYPES.filter(([, , , want]) => !want).reduce((s, r) => s + r[2], 0);
  ok(wrong.length === 0,
    `all ${CDOT_OP_TYPES.length} CDOT type pairs classify as expected (${kept} signal records kept, ${dropped} devices excluded)`);
  ok(isCdotTrafficSignal(null, null) === false, "a record with no type code is not a signal");
}

// ── 2. OSM nodes that map a CDOT non-signal device are dropped ────────────
// Real coordinates: archived OSM nodes and the CDOT records around them.
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
  const droppedIds = dropped.map((t) => t[0]);
  ok(JSON.stringify(droppedIds) === JSON.stringify([172295413]),
    `the OSM blinker node at a CDOT multi-way stop flasher is dropped (dropped: ${JSON.stringify(droppedIds)})`);
  ok(keptIds.includes(172164141),
    "a signalized junction is kept when a school flasher sits 20 m away but the CDOT signal is 1.8 m away");
  ok(keptIds.includes(9000000001), "a node 60 m from the nearest device is outside the 50 m radius and kept");
  ok(kept.length + dropped.length === nodes.length, "every input node is either kept or dropped");
}

// ── 3. The committed Charlotte inventory ─────────────────────────────────
const tuples = JSON.parse(
  fs.readFileSync(path.resolve(here, "../src/data/charlotte-signals.json"), "utf8"),
);
const served = loadRegionalIntersections("charlotte_metro");
const byId = new Map(served.map((s) => [s.id, s]));

// 3a. The six non-signal rows of the hosted Mecklenburg sample are gone.
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

// 3b. No CDOT device descriptor survives in an embedded (CDOT-sourced) name.
// Only embedded names are scanned: roads-derived names can legitimately read
// "Beacon Hill Rd" or "Middle School Rd".
{
  const DEVICE_NAME = [
    /^flasher\b/i,
    /\bbeacon\b/i,
    /\bphb\b/i,
    /\bhawk$/i,
    /^fire station\b/i,
    /\bmid[- ]?block\b/i,
    /\b(elementary|middle|high) school$/i,
    /\bwayfinding\b/i,
  ];
  const leaked = tuples.filter((t) => typeof t[3] === "string" && DEVICE_NAME.some((rx) => rx.test(t[3])));
  ok(leaked.length === 0,
    `no embedded Charlotte name carries a device descriptor (found ${leaked.length}` +
      `${leaked.length ? `, e.g. ${leaked.slice(0, 3).map((t) => JSON.stringify(t[3])).join(", ")}` : ""})`);
}

// 3c. Real signals that a school flasher had renamed carry their own name.
for (const [id, want] of [
  ["charlotte-172164141", "Quail Hollow Rd & Heathstead Place"], // was "Beverly Woods Elementary School"
  ["charlotte-172318595", "E 9th St & N Caldwell St"], // was "First Ward Elementary School"
]) {
  const got = byId.get(id)?.name;
  ok(got === want, `${id} is named ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
}

// 3d. The real signals of the Mecklenburg study are still served.
for (const id of [
  "charlotte-172660814", "charlotte-2181076118", "charlotte-7810838990", "charlotte-2181076171",
  "charlotte-5527699422", "charlotte-7945928189", "charlotte-5516526369", "charlotte-172211825",
]) {
  ok(byId.has(id), `${id} (${byId.get(id)?.name ?? "missing"}) is still served`);
}

console.log(fails === 0 ? "\nAll signal-device-type checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
