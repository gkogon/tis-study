// §4.1 Roadway Network of the generic states renderer (renderTisState — every
// US state without a dedicated renderer, Pennsylvania included) must name the
// sources the engine actually used. It used to splice r.growthSource — the
// growth-rate basis, e.g. "Explicit override — 1.50%/yr was supplied with the
// request…", sent by the web form and demo on nearly every study — in as a
// volume source, and to claim field observations and an inventory of posted
// speeds and access management that never happened.
//
// Renders the generic report for sites in three states that route to it (a
// fixture relocated the way verify-theme-default-identity.mjs relocates one to
// London), with an override growthSource, and checks §4.1 / §4.2 against the
// payload. The PA cases cover every mix that hides a signal's AADT join status
// (imported TMCs, main-road link counts, screening-mode and unresolved rows),
// where a "none of the N carries a joined count" clause would be false:
//   PA  Pittsburgh — mixed, unitemized, TMC + screening, baseline + unresolved,
//                    all TMC, all link counts, a single signal; plus a TMAS
//                    §4.2a block that must point at §4.1, not "§4.2 AADT";
//   CO  Denver     — AADT from CDOT and FHWA HPMS, so the agency must not be
//                    named as the count source;
//   MS  Jackson    — no MDOT AADT feed is wired (only FHWA HPMS 2018), and the
//                    study joined no count: every signal is a baseline.
// fetch is stubbed offline so the render is deterministic.
// Run: node ./scripts/verify-states-roadway-sources.mjs
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pageTexts } from "./lib/pdf-text.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const OVERRIDE_GROWTH = "Explicit override — 1.50%/yr was supplied with the request and applied in place of the engine's own rate. No measured growth rate is wired for this region, so there is no measured value to compare the override against. The applied rate is not derived from measured data; its basis must be stated by the preparer.";
const BANNED = /\bHCM\b|Highway Capacity Manual|\bITE\b|validated|accurate|\bAI\b/;
// pdf.js joins wrapped lines with a space, and PDFKit may wrap after a hyphen,
// so phrases are compared with all whitespace removed.
const squash = (s) => s.replace(/\s+/g, "");
const has = (hay, needle) => squash(hay).includes(squash(needle));
// The running page footer lands mid-sentence wherever a paragraph crosses a
// page break, so it is dropped before any phrase is looked for.
const FOOTER = /Screening estimate — not for design submittal without independent verification by a licensed PE\.\s*\|\s*See \/legal\/disclaimer\./g;

const legs = (main) => [
  { direction: "NB", enteringVph: 700, exitingVph: 700, source: main, oneWay: null },
  { direction: "SB", enteringVph: 700, exitingVph: 700, source: main, oneWay: null },
  { direction: "EB", enteringVph: 350, exitingVph: 350, source: "class_default", oneWay: null },
  { direction: "WB", enteringVph: 350, exitingVph: 350, source: "class_default", oneWay: null },
];
const movementEstimate = {
  method: "ipf", iterations: 5, maxResidualVph: 0.2, imbalancePct: 0, exitsNormalized: false, constrainedExits: 4, legsDropped: 0,
  matrix: { NB: { NB: 0, SB: 500, EB: 100, WB: 100 }, SB: { NB: 500, SB: 0, EB: 100, WB: 100 }, EB: { NB: 100, SB: 100, EB: 0, WB: 150 }, WB: { NB: 100, SB: 100, EB: 150, WB: 0 } },
  shares: { NB: { L: 0.143, T: 0.714, R: 0.143 }, SB: { L: 0.143, T: 0.714, R: 0.143 }, EB: { L: 0.286, T: 0.429, R: 0.286 }, WB: { L: 0.286, T: 0.429, R: 0.286 } },
};
// A FHWA TMAS corridor station, the feed PA / MD / NJ map to (atr-counts.ts).
const TMAS_SUMMARY = {
  windowYears: 10, radiusMi: 3, source: "fhwa_tmas", totalSegmentsFound: 1,
  segments: [{ street: "I-279", direction: "NB", distanceMi: 1.8, latestCountDate: "2023-06-14", sampleDays: 300, amPeakHourVph: 2400, pmPeakHourVph: 2600, avgDailyVeh: 41000 }],
};

/**
 * A tx fixture relocated to (lat, lon), override growth, row i shaped as
 * kinds(i): the payload each engine path emits (row-math.ts): network rows
 * carry legVolumes, a measured import carries utdf_tmc and no legVolumes, a
 * screening-mode / unresolved row carries neither.
 */
function study(lat, lon, kinds, { rows, atr } = {}) {
  const fx = JSON.parse(JSON.stringify(loadFixture("tx")));
  fx.latitude = lat; fx.longitude = lon;
  fx.report.request = { ...fx.report.request, latitude: lat, longitude: lon };
  fx.report.growthSource = OVERRIDE_GROWTH;
  if (rows) fx.report.affectedIntersections = fx.report.affectedIntersections.slice(0, rows);
  if (atr) fx.report.atrSummary = atr;
  fx.report.affectedIntersections.forEach((row, i) => {
    delete row.volumeSource; delete row.legVolumes; delete row.movementEstimate;
    const kind = kinds(i);
    if (kind === "aadt" || kind === "baseline") {
      row.volumeSource = "network_estimate";
      row.legVolumes = legs(kind === "aadt" ? "signal_aadt" : "signal_baseline");
      row.movementEstimate = movementEstimate;
    } else if (kind === "csv") {
      row.volumeSource = "link_csv";
      row.legVolumes = legs("csv");
      row.movementEstimate = movementEstimate;
    } else if (kind === "tmc") {
      row.volumeSource = "utdf_tmc";
    }
  });
  return fx;
}

/** Independent tally from the payload, per the leg-source contract (openapi TisAffectedIntersection.legVolumes). */
function tally(rows) {
  const t = { aadt: 0, baseline: 0, tmc: 0, csv: 0, unitemized: 0 };
  for (const r of rows) {
    const src = (r.legVolumes ?? []).map((l) => l.source);
    if (r.volumeSource === "utdf_tmc" || r.volumeSource === "synchro_pdf_tmc") t.tmc++;
    else if (src.includes("signal_aadt")) t.aadt++;
    else if (src.includes("signal_baseline")) t.baseline++;
    else if (r.volumeSource === "link_csv") t.csv++;
    else t.unitemized++;
  }
  return t;
}

const between = (text, a, b) => {
  const i = text.indexOf(a);
  if (i < 0) return "";
  const j = text.indexOf(b, i + a.length);
  return j < 0 ? text.slice(i) : text.slice(i, j);
};

const PA = { lat: 40.5250, lon: -80.0130, agency: "Pennsylvania Department of Transportation", abbrev: "PennDOT" };
const RULE = "Background volumes: each study signal's design-hour volume is AADT × K-factor from an AADT count record joined to the signal where a compatible record exists, and otherwise a baseline volume estimated from road class; this study's output does not itemize which signals carry a joined count.";
const JOINED = "carry an AADT count record joined to the signal (the signal's design-hour volume, AADT × K-factor, is applied to its main-road legs)";
const UNITEMIZED = (k) => `the source at the remaining ${k} is not itemized in this study's output (a joined AADT count record where one exists, otherwise a baseline volume estimated from road class)`;
const MINOR = "Where a signal's legs are itemized, legs off the main road carry the road-class baseline unless a client link count covers them.";

// `s41` / `s42` are the exact sentences the case must print (n is 17 unless
// `rows` trims it). The rendered text is also checked against the payload tally.
const CASES = [
  { label: "PA Pittsburgh (mixed + TMAS §4.2a)", ...PA, atr: TMAS_SUMMARY,
    kinds: (i) => (i < 3 ? "aadt" : i < 5 ? "baseline" : i === 5 ? "tmc" : "none"), want: { aadt: 3, baseline: 2, tmc: 1, unitemized: 11 },
    s41: [`Background volumes at the 17 study signals: 3 ${JOINED}; 2 have no compatible count record and use a baseline volume estimated from road class; 1 uses imported turning-movement counts; ${UNITEMIZED(11)}. ${MINOR}`],
    s42: ["Turning-movement counts imported from the engineer's Synchro model are used at 1 of the 17 study signals", "Existing peak-hour volumes at the remaining 16 come from the other sources in §4.1"] },
  { label: "PA Pittsburgh (no per-signal provenance)", ...PA,
    kinds: () => "none", want: { unitemized: 17 }, s41: [RULE] },
  { label: "PA Pittsburgh (screening mode + one imported TMC)", ...PA,
    kinds: (i) => (i === 0 ? "tmc" : "none"), want: { tmc: 1, unitemized: 16 },
    s41: [`Background volumes at the 17 study signals: 1 uses imported turning-movement counts; ${UNITEMIZED(16)}.`],
    s42: ["Turning-movement counts imported from the engineer's Synchro model are used at 1 of the 17 study signals"] },
  { label: "PA Pittsburgh (network: baselines + unresolved junctions + TMAS §4.2a)", ...PA, atr: TMAS_SUMMARY,
    kinds: (i) => (i < 2 ? "baseline" : "none"), want: { baseline: 2, unitemized: 15 },
    s41: [`Background volumes at the 17 study signals: 2 have no compatible count record and use a baseline volume estimated from road class; ${UNITEMIZED(15)}. ${MINOR}`] },
  { label: "PA Pittsburgh (all imported TMCs)", ...PA,
    kinds: () => "tmc", want: { tmc: 17 },
    s41: ["Background volumes at the 17 study signals: all 17 use imported turning-movement counts."],
    s42: ["Existing peak-hour volumes at all 17 study signals are turning-movement counts imported from the engineer's Synchro model; the import carries no collection date or period"] },
  { label: "PA Pittsburgh (all client link counts)", ...PA,
    kinds: () => "csv", want: { csv: 17 },
    s41: [`Background volumes at the 17 study signals: all 17 use client link counts on the main road. ${MINOR}`] },
  { label: "PA Pittsburgh (single signal, imported TMC)", ...PA, rows: 1,
    kinds: () => "tmc", want: { tmc: 1 },
    s41: ["Background volume at the one study signal: it uses imported turning-movement counts."],
    s42: ["Existing peak-hour volumes at the study signal are turning-movement counts imported from the engineer's Synchro model"] },
  { label: "CO Denver (CDOT + FHWA HPMS AADT)", lat: 39.7392, lon: -104.9903, agency: "Colorado Department of Transportation", abbrev: "CDOT",
    kinds: (i) => (i < 2 ? "aadt" : "baseline"), want: { aadt: 2, baseline: 15 },
    s41: [`Background volumes at the 17 study signals: 2 ${JOINED}; 15 have no compatible count record and use a baseline volume estimated from road class. ${MINOR}`] },
  { label: "MS Jackson (no MDOT AADT wired)", lat: 32.2988, lon: -90.1848, agency: "Mississippi Department of Transportation", abbrev: "MDOT",
    kinds: () => "baseline", want: { baseline: 17 },
    s41: [`Background volumes at the 17 study signals: all 17 have no compatible count record and use a baseline volume estimated from road class. ${MINOR}`] },
];

const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error("states-roadway-sources check: network disabled"));
const { mod, cleanup } = await loadRendererBundle();
try {
  for (const c of CASES) {
    const fx = study(c.lat, c.lon, c.kinds, { rows: c.rows, atr: c.atr });
    const rows = fx.report.affectedIntersections;
    const t = tally(rows);
    for (const [k, v] of Object.entries(t)) ok(v === (c.want[k] ?? 0), `${c.label}: fixture carries ${v} ${k} row(s) as intended`);
    const text = (await pageTexts(await mod.renderStudyPdf(projectFromFixture(fx), { name: "Roadway Sources Check", logoUrl: null }))).join(" ").replace(FOOTER, " ");
    ok(!text.includes("See /legal/disclaimer"), `${c.label}: page footers stripped before phrase checks`);

    ok(text.includes(`${c.agency} (${c.abbrev})`), `${c.label}: rendered by the generic states renderer as ${c.abbrev}`);
    const s41 = between(text, "4.1 Roadway Network", "4.2 Traffic Volumes");
    ok(s41.length > 0, `${c.label}: §4.1 Roadway Network is present`);

    // The defect: growth prose, field observations, an inventory that never happened.
    ok(!/override|%\/yr|growth/i.test(s41), `${c.label}: §4.1 carries no growth-rate prose`);
    ok(!/field observation|inventoried|posted speed|functional classification maps/i.test(s41),
      `${c.label}: §4.1 claims no field observations, inventory, posted speeds or agency classification maps`);
    ok(!new RegExp(`${c.abbrev} (AADT|count)`).test(s41), `${c.label}: §4.1 does not attribute the AADT records to ${c.abbrev}`);
    ok(!BANNED.test(s41), `${c.label}: §4.1 uses no banned wording`);
    // The router transforms the attributes (km/h to mph, per-direction lanes,
    // class clamping and defaults — network-assignment.ts buildGraph), so they
    // must not be claimed to be used as mapped.
    ok(!/as mapped/i.test(s41), `${c.label}: §4.1 does not claim the OSM attributes are used as mapped`);

    // The fix: the real network source and a volume source matching the payload.
    ok(has(s41, "The study network is taken from OpenStreetMap and was not surveyed.")
      && has(s41, "Study signals are OpenStreetMap traffic-signal nodes"),
      `${c.label}: §4.1 names OpenStreetMap as the signal and road source`);
    ok(has(s41, `highway classification (used in place of ${c.abbrev} functional classification), street name, lane count and speed limit where tagged, and one-way direction.`),
      `${c.label}: §4.1 lists only the OSM attributes the engine reads`);
    for (const want of c.s41) ok(has(s41, want), `${c.label}: §4.1 states the payload's volume source — "${want.slice(0, 70)}…"`);

    // Invariants against the payload, independent of the expected sentences:
    // no clause may speak for signals whose join status the payload hides.
    ok(!/\bnone\b/i.test(s41), `${c.label}: §4.1 never says "none" carries a joined count`);
    ok(t.baseline === rows.length || !has(s41, `all ${rows.length} have no compatible count record`),
      `${c.label}: "all N have no compatible count record" only when every row is a baseline`);
    ok(t.aadt > 0 || !has(s41, "joined to the signal (the signal's design-hour"), `${c.label}: no joined-count clause without a signal_aadt row`);
    ok(t.tmc > 0 === has(s41, "imported turning-movement counts"), `${c.label}: §4.1 mentions imported counts iff a row carries one`);
    ok(t.csv > 0 === has(s41, "client link counts on the main road"), `${c.label}: §4.1 mentions main-road link counts iff a row is covered by one`);

    // The growth disclosure stays where it belongs.
    ok(has(between(text, "3.6 Background Growth Rate", "3.7 Level of Service"), "Source: Explicit override — 1.50%/yr was supplied with the request"),
      `${c.label}: §3.6 still discloses the override growth basis`);
    ok(has(between(text, "4.2 Traffic Volumes", "4.3 "), "Growth source Explicit override — 1.50%/yr"),
      `${c.label}: §4.2 still carries the Growth source row`);

    // §4.2 must agree with §4.1 on imported counts.
    const s42 = between(text, "4.2 Traffic Volumes", "Growth rate applied");
    ok(!BANNED.test(s42), `${c.label}: §4.2 uses no banned wording`);
    ok(!/AADT base:\s*—/.test(text) && !/Base AADT\s*—/.test(text), `${c.label}: no placeholder "AADT base: —" line (the engine emits no baseAadt)`);
    if (t.tmc === 0) {
      ok(has(s42, "This screening collected no traffic counts; existing peak-hour volumes at the study signals come from the sources in §4.1.")
        && has(s42, "should replace them before submittal"), `${c.label}: §4.2 says no counts were collected or imported`);
      ok(has(text, "None — no counts collected for this screening"), `${c.label}: count collection period says none were collected`);
    } else {
      ok(!has(s42, "existing peak-hour volumes at the study signals come from the sources in §4.1"), `${c.label}: §4.2 does not deny the imported counts`);
      ok(t.tmc < rows.length || !has(s42, "should replace them"), `${c.label}: §4.2 does not ask to replace imported counts at every signal`);
      ok(has(text, "Not recorded — the imported turning-movement counts carry no collection date")
        && !has(text, "None — no counts collected for this screening"), `${c.label}: count collection period reflects the import`);
    }
    for (const want of c.s42 ?? []) ok(has(s42, want), `${c.label}: §4.2 — "${want.slice(0, 70)}…"`);
    ok(!/field observations|field-collected|were inventoried|Traffic counts were collected|to current counts/.test(text),
      `${c.label}: no fieldwork claim anywhere in the report`);

    // §4.2a (TMAS) must point at the volumes §4.1 describes, not "AADT-derived volumes in §4.2".
    if (c.atr) {
      const s42a = between(text, "4.2a Measured Traffic Counts", "4.3 ");
      ok(s42a.length > 0, `${c.label}: §4.2a renders for the TMAS station`);
      // Imported counts are not estimates, so "estimated" only without them.
      ok(has(s42a, `sanity check on the ${t.tmc === 0 ? "estimated " : ""}existing volumes described in §4.1 and`),
        `${c.label}: §4.2a cross-references §4.1${t.tmc === 0 ? " (estimated)" : " (with imported counts)"}`);
    }
    ok(!has(text, "AADT-derived volumes in §4.2"), `${c.label}: no cross-reference to AADT volumes in §4.2`);
  }
} finally {
  globalThis.fetch = realFetch;
  await cleanup();
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
