// The Georgia renderers (Full, Abbreviated, Worksheet) must name only the
// sources the run used. Before this check the Georgia report said:
//   §2.2  capacity analysis "uses calibration data from the GDOT 511 NaviGAtor
//         system, including live incident, camera, and signal data feeds";
//   §6    Existing = "current-year volumes from the GDOT 511 system";
//   §5.1  every ADT labelled "GDOT 511 / TADA" (the engine sets no aadtSource);
//   §5.2  turning movements "sourced from the GDOT 511 NaviGAtor signal-
//         controller feed … supplemented by Gwinnett County DOT counts", each
//         row labelled "GDOT 511" (the engine sets no countSource);
//   §5.3  truck share "approximated from GDOT TADA classification counts" and
//         "applied to the operations analysis" (the engine applies none);
//   §2.1 / §6.1  an absent growthSource credited to GDOT / TADA count growth;
//   §6.2  distribution from "the ARC Activity-Based Model (ABM2)".
// What the engine does: Atlanta signals (ATL- ids) carry a design hour
// modeled from road class, distance from downtown and a per-signal factor,
// with no count joined; other GA inventories join AADT records; GDOT 511 is
// used only as an incident-based delay factor on rows that carry
// `calibration`; §5.1's ADT is a render-time ARC / GDOT lookup.
//
// Scope: the Georgia renderers' own text, plus a whole-report ban on the
// removed GA phrases. NOT covered: shared sections that still call every
// design hour "AADT × K-factor" (the worksheet period note, the leg-volume
// line on network rows, the distribution mass basis). Those are false for
// Atlanta rows and for road-class baseline rows in every state, and need
// per-row branching across renderers; they are left for a follow-up.
//
// Every expected sentence is rebuilt here from the fixture rows, not read
// from the renderer.
// Run: node ./scripts/verify-ga-report-sources.mjs
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pageTexts } from "./lib/pdf-text.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const squash = (s) => s.replace(/\s+/g, "");
const has = (hay, needle) => squash(hay).includes(squash(needle));
const FOOTER = /Screening estimate — not for design submittal without independent verification by a licensed PE\.\s*\|\s*See \/legal\/disclaimer\./g;
const between = (text, a, b) => {
  const i = text.indexOf(a);
  if (i < 0) return "";
  const j = text.indexOf(b, i + a.length);
  return j < 0 ? text.slice(i) : text.slice(i, j);
};
const count = (hay, needle) => squash(hay).split(squash(needle)).length - 1;

// Removed claims: none may appear anywhere in a Georgia report.
const FALSE_CLAIMS = [
  "NaviGAtor",
  "TADA",
  "regional travel patterns from the ARC Activity-Based Model",
  "ABM2",
  "signal-controller",
  "camera, and signal data feeds",
  "uses calibration data from",
  "Per-intersection delay calibration",
  "from the GDOT 511 system",
  "GDOT 511 / TADA",
  "Gwinnett County DOT counts",
  "Truck percentage applied to the operations analysis",
  "consistent with GDOT historical",
];
// Words that must not appear in the rewritten Georgia text.
const BANNED_WORDS = [/\bHCM\b/, /Highway Capacity Manual/i, /\bITE\b/, /\bvalidated\b/i, /\baccurate\b/i, /\bAI\b/];

const ARC = "https://services1.arcgis.com/IkktFdUAcY3WrH25/";
const GDOT_STATEWIDE = "https://services1.arcgis.com/aRfeIYW6Y5KhCFGz/";
const arcgis = (features) => new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
// Offline unless a case answers the ARC / GDOT AADT layers.
function setFetch(lookup) {
  globalThis.fetch = (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (lookup === "arc" && url.startsWith(ARC)) return Promise.resolve(arcgis([{ attributes: { AADT: 18400, YEAR: 2019 } }, { attributes: { AADT: 9100, YEAR: 2019 } }]));
    if (lookup === "gdot" && url.startsWith(ARC)) return Promise.resolve(arcgis([]));
    if (lookup === "gdot" && url.startsWith(GDOT_STATEWIDE)) return Promise.resolve(arcgis([{ attributes: { AADT: 7300 } }]));
    return Promise.reject(new Error("ga-report-sources check: network disabled"));
  };
}

const legs = (main) => [
  { direction: "NB", enteringVph: 900, exitingVph: 900, source: main, oneWay: null },
  { direction: "SB", enteringVph: 900, exitingVph: 900, source: main, oneWay: null },
  { direction: "EB", enteringVph: 300, exitingVph: 300, source: "class_default", oneWay: null },
  { direction: "WB", enteringVph: 300, exitingVph: 300, source: "class_default", oneWay: null },
];
const ME = {
  method: "ipf", iterations: 6, maxResidualVph: 0.3, imbalancePct: 0, exitsNormalized: false, constrainedExits: 4, legsDropped: 0,
  matrix: { NB: { NB: 0, SB: 700, EB: 100, WB: 100 }, SB: { NB: 700, SB: 0, EB: 100, WB: 100 }, EB: { NB: 100, SB: 100, EB: 0, WB: 100 }, WB: { NB: 100, SB: 100, EB: 100, WB: 0 } },
  shares: { NB: { L: 0.11, T: 0.78, R: 0.11 }, SB: { L: 0.11, T: 0.78, R: 0.11 }, EB: { L: 0.33, T: 0.34, R: 0.33 }, WB: { L: 0.33, T: 0.34, R: 0.33 } },
};
const network = (it, main) => { it.volumeSource = "network_estimate"; it.legVolumes = legs(main); it.movementEstimate = ME; };
const cal = (it, m) => { it.calibration = { sampleCount: 40, delayMultiplier: m, delayMultiplierExact: m, lastObservedDelaySec: null }; };
const tmc = (it) => { it.volumeSource = "utdf_tmc"; delete it.legVolumes; delete it.movementEstimate; };

const SAVANNAH = { lat: 32.0809, lon: -81.0912 };
function study(mutate) {
  const fx = JSON.parse(JSON.stringify(loadFixture("ga")));
  mutate(fx, fx.report, fx.report.affectedIntersections);
  return fx;
}
function relocate(fx, { lat, lon }, idPrefix) {
  fx.latitude = lat; fx.longitude = lon;
  fx.report.request = { ...fx.report.request, latitude: lat, longitude: lon };
  fx.report.affectedIntersections.forEach((it, i) => { it.signalId = `${idPrefix}-${1000 + i}`; });
}

// ---- Independent tally: what each row says about its source ----
function basis(it) {
  if (it.volumeSource === "utdf_tmc" || it.volumeSource === "synchro_pdf_tmc") return "tmc";
  const src = (it.legVolumes ?? []).map((l) => l.source);
  const atl = String(it.signalId).startsWith("ATL-");
  if (src.includes("signal_aadt")) return atl ? "atl_model" : "aadt";
  if (src.includes("signal_baseline")) return atl ? "atl_model" : "baseline";
  if (it.volumeSource === "link_csv") return "csv";
  return atl ? "atl_model" : "unitemized";
}
function expectedVolumeSentence(rows) {
  const n = rows.length;
  const t = { atl_model: 0, aadt: 0, baseline: 0, tmc: 0, csv: 0, unitemized: 0 };
  for (const it of rows) t[basis(it)]++;
  const who = (k) => (n === 1 ? "it" : k === n ? `all ${k}` : String(k));
  const one = (k) => k === 1 || n === 1;
  const c = [];
  if (t.atl_model) c.push(`${who(t.atl_model)} ${one(t.atl_model) ? "is a signal" : "are signals"} from the Atlanta inventory, whose design-hour volume is modeled from road class, distance from downtown Atlanta and a fixed per-signal factor, with no count joined`);
  if (t.aadt) c.push(`${who(t.aadt)} ${one(t.aadt) ? "carries" : "carry"} an AADT count record joined to the signal (the design-hour volume is AADT × K-factor)`);
  if (t.baseline) c.push(`${who(t.baseline)} ${one(t.baseline) ? "has" : "have"} no compatible count record and ${one(t.baseline) ? "uses" : "use"} a baseline volume estimated from road class`);
  if (t.tmc) c.push(`${who(t.tmc)} ${one(t.tmc) ? "uses" : "use"} imported turning-movement counts`);
  if (t.csv) c.push(`${who(t.csv)} ${one(t.csv) ? "uses" : "use"} client link counts on the main road`);
  if (t.unitemized) c.push(`the source at the remaining ${t.unitemized === 1 ? "one" : t.unitemized} is not itemized`);
  return { sentence: `${n === 1 ? "Existing volume at the one study signal" : `Existing volumes at the ${n} study signals`}: ${c.join("; ")}`, tally: t };
}
function expectedFactor(rows) {
  const w = rows.filter((it) => it.calibration);
  if (w.length === 0) return null;
  const m = w.map((it) => it.calibration.delayMultiplier);
  const lo = Math.min(...m).toFixed(2), hi = Math.max(...m).toFixed(2);
  const where = w.length === rows.length ? (rows.length === 1 ? "At the one study signal" : `At all ${rows.length} study signals`) : `At ${w.length} of the ${rows.length} study signals`;
  return `${where} the computed control delay is multiplied by ${lo === hi ? lo : `a factor of ${lo}–${hi}`}, taken from the analyzer's GDOT 511 incident archive`;
}
const COUNT_LABEL = { tmc: "Imported TMC", csv: "Client link count", atl_model: "None (modeled)", aadt: "None (AADT × K)", baseline: "None (road class)", unitemized: "None (estimated)" };

const CASES = [
  { label: "Atlanta Full, legacy rows, no delay factor", tier: "full",
    mutate: () => {} },
  { label: "Atlanta Full, network rows (legs mislabelled signal_aadt), factor on 3 rows", tier: "full",
    mutate: (fx, r, rows) => { rows.forEach((it) => network(it, "signal_aadt")); cal(rows[0], 1.12); cal(rows[1], 1.05); cal(rows[2], 1.18); } },
  { label: "Atlanta Full, one signal, factor applied", tier: "full",
    mutate: (fx, r, rows) => { rows.splice(1); network(rows[0], "signal_aadt"); cal(rows[0], 1.1); } },
  { label: "Atlanta Full, all signals imported TMCs", tier: "full",
    mutate: (fx, r, rows) => { rows.forEach(tmc); } },
  { label: "Savannah Full, joined AADT / baseline / imported TMC / unitemized", tier: "full",
    mutate: (fx, r, rows) => {
      relocate(fx, SAVANNAH, "savannah");
      rows.forEach((it, i) => { if (i < 5) network(it, "signal_aadt"); else if (i < 9) network(it, "signal_baseline"); });
      tmc(rows[9]);
    } },
  { label: "Atlanta Abbreviated, ARC lookup answers, network rows", tier: "abbreviated", lookup: "arc",
    mutate: (fx, r, rows) => { rows.forEach((it) => network(it, "signal_aadt")); } },
  { label: "Savannah Abbreviated, GDOT statewide lookup answers, factor on 1 row", tier: "abbreviated", lookup: "gdot",
    mutate: (fx, r, rows) => { relocate(fx, SAVANNAH, "savannah"); rows.forEach((it, i) => network(it, i % 2 ? "signal_baseline" : "signal_aadt")); cal(rows[0], 1.08); } },
  { label: "Atlanta Abbreviated, lookups offline, partial imported TMCs", tier: "abbreviated",
    mutate: (fx, r, rows) => { tmc(rows[0]); tmc(rows[1]); } },
  { label: "Atlanta Worksheet", tier: "worksheet",
    mutate: () => {} },
];

const realFetch = globalThis.fetch;
const { mod, cleanup } = await loadRendererBundle();
try {
  for (const c of CASES) {
    const fx = study(c.mutate);
    fx.report.request.studyTier = c.tier;
    setFetch(c.lookup ?? null);
    const text = (await pageTexts(await mod.renderStudyPdf(projectFromFixture(fx), { name: "GA Sources Check", logoUrl: null }))).join(" ").replace(FOOTER, " ");
    const rows = fx.report.affectedIntersections;
    const vol = expectedVolumeSentence(rows);
    const factor = expectedFactor(rows);

    for (const phrase of FALSE_CLAIMS) ok(!has(text, phrase), `${c.label}: no "${phrase}"`);
    // GDOT 511 is named only where a row carries the incident factor, and then
    // only inside the delay-factor sentence (four mentions in it). A bare "511"
    // is not counted: it can be a table value.
    const n511 = count(text, "GDOT 511");
    ok(factor ? n511 === 4 : n511 === 0, `${c.label}: "GDOT 511" appears ${factor ? "only in the delay-factor sentence" : "nowhere"} (found ${n511})`);
    ok(!/\b511\s*(NaviGAtor|system|feed|v2)/i.test(text), `${c.label}: no 511 system / feed wording`);

    if (c.tier === "worksheet") {
      ok(has(text, "Worksheet-tier deliverable"), `${c.label}: rendered by the worksheet renderer`);
      continue;
    }

    // The data paragraph: §2.2 on the Full tier, §5.2 on the Abbreviated tier.
    const dataPara = c.tier === "full"
      ? between(text, "2.2 Traffic Data Collection", "2.3 ")
      : between(text, "5.2 Current Intersection Turning Movement Peak Period Volumes", "5.3 ");
    ok(has(dataPara, "No traffic counts were collected for this screening."), `${c.label}: says no counts were collected`);
    ok(has(dataPara, vol.sentence), `${c.label}: volume sentence matches the rows (${JSON.stringify(vol.tally)})`);
    if (vol.tally.atl_model > 0) ok(!has(dataPara, "AADT count record joined") || vol.tally.aadt > 0, `${c.label}: Atlanta rows are not credited with an AADT record`);
    if (factor) {
      ok(has(dataPara, factor), `${c.label}: delay-factor sentence names the rows and the range`);
      ok(has(dataPara, "It is not fitted to measured delay.") && has(dataPara, "No GDOT 511 camera or signal data is used, and GDOT 511 data is not used for volumes."),
        `${c.label}: delay factor is not called calibration to measured delay`);
    } else {
      ok(!has(dataPara, "multiplied by"), `${c.label}: no delay-factor sentence without a factor`);
    }
    const t = vol.tally;
    const recommend = t.tmc === 0
      ? "Peak-hour turning-movement counts collected within the most recent 12 months should replace these estimates before a formal submittal."
      : t.tmc === rows.length
        ? "The imported counts carry no collection date or period; confirm them before a formal submittal."
        : "The imported counts carry no collection date or period; confirm them, and collect peak-hour turning-movement counts within the most recent 12 months at the remaining signals, before a formal submittal.";
    ok(has(dataPara, recommend), `${c.label}: count recommendation matches the imported-count share`);
    for (const re of BANNED_WORDS) ok(!re.test(dataPara), `${c.label}: data paragraph has no ${re}`);

    if (c.tier === "full") {
      const s6 = between(text, "6.0 TRAFFIC ANALYSIS", "Intersection");
      ok(has(s6, "(1) Existing — current-year volumes as described in §2.2, no growth applied"), `${c.label}: §6 Existing scenario points to §2.2`);
      const s21 = between(text, "2.1 Growth Rate", "2.2 ");
      ok(!r_hasGrowthSource(fx) ? has(s21, "This is the engine's default rate: no measured growth rate is wired for this region, so the rate is not derived from GDOT count stations") : true,
        `${c.label}: §2.1 names the engine default when no growth source is recorded`);
      for (const re of BANNED_WORDS) ok(!re.test(s21) && !re.test(s6), `${c.label}: §2.1 / §6 have no ${re}`);
      continue;
    }

    // ---- Abbreviated tier ----
    const s51 = between(text, "5.1 Existing ADT Volumes", "5.2 ");
    ok(has(s51, "The engine carries no ADT for the study signals.") && has(s51, "do not feed the operations analysis"), `${c.label}: §5.1 says the ADT is a render-time lookup outside the analysis`);
    if (c.lookup === "arc") {
      ok(has(s51, `A record was found for ${rows.length} of the ${rows.length} study signals.`), `${c.label}: §5.1 counts the records found`);
      ok(count(s51, "ARC count layer (2019)") === rows.length && has(s51, "18,400"), `${c.label}: §5.1 labels each looked-up ADT with the ARC layer and its year`);
    } else if (c.lookup === "gdot") {
      ok(count(s51, "GDOT AADT layer") === rows.length && has(s51, "7,300"), `${c.label}: §5.1 labels each looked-up ADT with the GDOT statewide layer`);
    } else {
      ok(has(s51, "No record was found for any study signal.") && count(s51, "No record found") === rows.length, `${c.label}: §5.1 says no record was found`);
    }
    for (const it of rows) {
      ok(has(dataPara, `${it.name} — — ${COUNT_LABEL[basis(it)]}`), `${c.label}: §5.2 count source for ${it.signalId} is "${COUNT_LABEL[basis(it)]}"`);
    }
    const s53 = between(text, "5.3 Truck Volumes and Circulation", "5.4 ");
    ok(has(s53, "was not measured for this screening, and the operations analysis applies no heavy-vehicle adjustment"), `${c.label}: §5.3 says no truck share is measured or applied`);
    const s61 = between(text, "6.1 Future ADT Volumes", "6.2 ");
    ok(r_hasGrowthSource(fx) || has(s61, "The growth rate is the engine's default rate: no measured growth rate is wired for this region"), `${c.label}: §6.1 names the engine default when no growth source is recorded`);
    const s62 = between(text, "6.2 Distribution and Assignment Assumptions", "Trip Distribution —");
    ok(has(s62, "No directional counts and no ARC regional model run are used."), `${c.label}: §6.2 says no counts and no regional model run`);
    for (const re of BANNED_WORDS) ok(![s51, s53, s61, s62].some((s) => re.test(s)), `${c.label}: rewritten §5.1 / §5.3 / §6.1 / §6.2 have no ${re}`);
  }
} finally {
  globalThis.fetch = realFetch;
  await cleanup();
}
function r_hasGrowthSource(fx) { return typeof fx.report.growthSource === "string" && fx.report.growthSource.length > 0; }
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
