// Turning-movement diagram axis labels (src/lib/diagram-labels.ts).
//
// A diagram labels its north–south axis (the NB/SB legs) and its east–west
// axis (the EB/WB legs). The labels used to come from the order of the
// intersection name — first street north–south, the rest east–west — so a
// Datum proofread of the Mecklenburg sample (B12/D10) found Albemarle Rd and
// Idlewild Rd, both east–west, drawn as the north–south street, with their
// counted EB/WB volumes reading as the cross street's traffic. Each axis now
// names the street(s) its legs lie on (legVolumes[].street, the road
// network's name for each leg); a row whose legs carry no street keeps the
// name-order labels.
//
// Fixture: PM rows of the Mecklenburg sample regenerated with each leg's
// street (scripts/fixtures/mecklenburg-diagram-axes.json).
//
// Run: node ./scripts/verify-diagram-axis-labels.mjs
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pageTexts } from "./lib/pdf-text.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const { diagramStreetLabels } = await import(path.resolve(here, "../src/lib/diagram-labels.ts"));

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const same = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), `${msg} — ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);

const fx = JSON.parse(readFileSync(path.resolve(here, "fixtures/mecklenburg-diagram-axes.json"), "utf8"));
const row = (name) => {
  const r = fx.rows.find((x) => x.name === name);
  if (!r) throw new Error(`fixture has no row ${JSON.stringify(name)}`);
  return r;
};
const labelsOf = (r) => diagramStreetLabels(r.name, r.legVolumes);
const AXIS_DIRS = [["NB", "SB"], ["EB", "WB"]];

// ---- 1. Albemarle and Idlewild label the east–west axis where their legs are ----
same(labelsOf(row("Albemarle Road & North Sharon Amity Road")), ["North Sharon Amity Road", "Albemarle Road"],
  "A.2: Albemarle Road (EB/WB legs) labels east–west, North Sharon Amity Road (NB/SB) north–south");
same(labelsOf(row("Albemarle Rd & Reddman Rd")), ["Reddman Rd", "Albemarle Rd"],
  "A.9: Albemarle Rd labels east–west, so EB T→ reads as Albemarle traffic; the labels keep the name's spelling (Rd, not Road)");
same(labelsOf(row("Idlewild Road & Connection Point Boulevard")), ["Connection Point Boulevard", "Idlewild Road"],
  "A.7: Idlewild Road labels east–west, Connection Point Boulevard (the SB leg) north–south");
for (const r of fx.rows) {
  const [ns] = labelsOf(r);
  ok(!/albemarle|idlewild/i.test(ns), `${r.name}: Albemarle / Idlewild never label the north–south axis (got ${JSON.stringify(ns)})`);
}

// ---- 2. Every label names a street with a leg on that axis ----
const tokens = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
for (const r of fx.rows) {
  const labels = labelsOf(r);
  AXIS_DIRS.forEach((dirs, axis) => {
    const streets = r.legVolumes.filter((l) => dirs.includes(l.direction)).map((l) => tokens(l.street));
    const parts = labels[axis] ? labels[axis].split(" / ") : [];
    const grounded = parts.every((p) => streets.some((st) => st.includes(tokens(p).find((t) => t.length > 2) ?? "")));
    ok(grounded, `${r.name}: the ${axis === 0 ? "north–south" : "east–west"} label ${JSON.stringify(labels[axis])} names only streets whose legs lie on that axis`);
  });
}

// ---- 3. Where the network disagrees with the name, the label follows the legs ----
// A.6: Monroe Rd (NW–SE, legs at 128°/313°) and Idlewild Rd (legs at 71°/261°)
// both round to east and west; the 4×4 matrix keeps Monroe's legs and drops
// Idlewild's, so the EB/WB volumes are Monroe Road's and nothing is north–south.
same(labelsOf(row("Idlewild Rd & Monroe Rd & Rama Rd")), ["", "Monroe Rd"],
  "A.6: the carried east–west legs are Monroe Road's; no leg lies north–south, so that axis is unlabeled");
// A.8: the signal resolves to the network junction of Wilshire Place and East
// Independence (no node joins Albemarle Road and Pierson Drive), so the drawn
// volumes are those legs' and the labels say so.
same(labelsOf(row("Albemarle Road & Pierson Drive")), ["Wilshire Place", "East Independence Expressway / East Independence Boulevard"],
  "A.8: the labels name the legs the signal resolved to, not the name's first street");
same(labelsOf(row("North Sharon Amity Road & Monroe Road")), ["North Sharon Amity Road", "Monroe Road"],
  "A.1: name order already matched the legs; unchanged");

// ---- 4. Spelling: the name's own spelling wins wherever a leg is that street ----
const legs = (ns, ew) => [
  ...(ns ? [{ direction: "NB", street: ns }, { direction: "SB", street: ns }] : []),
  ...(ew ? [{ direction: "EB", street: ew }, { direction: "WB", street: ew }] : []),
];
same(diagramStreetLabels("Oak Ave & Main St", legs("Main Street", "Oak Avenue")), ["Main St", "Oak Ave"],
  "street types match abbreviated or spelled out; the name's spelling is printed");
same(diagramStreetLabels("Albemarle Rd & Sharon Amity", legs("North Sharon Amity Road", "Albemarle Road")), ["Sharon Amity", "Albemarle Rd"],
  "a leading direction and the street type may be missing from the name");
same(diagramStreetLabels("US 441/SR 7 & Griffin Rd", legs("Griffin Road", "State Road 7")), ["Griffin Rd", "US 441/SR 7"],
  "a slash-joined route matches a leg carrying any one of its names (SR 7 = State Road 7)");
same(diagramStreetLabels("NW 62 St & NW 7 Ave", legs("Northwest 7th Avenue", "Northwest 62nd Street")), ["NW 7 Ave", "NW 62 St"],
  "numbered streets match with or without the ordinal suffix");
same(diagramStreetLabels("Fox Rd. & Old Wake Forest & Segal (Walmart)", [
  { direction: "NB", street: "Fox Road" }, { direction: "SB", street: "Segal Drive" },
  { direction: "EB", street: "Old Wake Forest Road" }, { direction: "WB", street: "Fox Road" },
]), ["Fox Rd. / Segal (Walmart)", "Fox Rd. / Old Wake Forest"],
  "a parenthesized note in the name (Wake's \"Segal (Walmart)\") still matches its street; Fox Road turns, so it labels both axes");
same(diagramStreetLabels("Main St & Oak Ave", legs("Main Street", "Elm Street")), ["Main St", "Elm Street"],
  "a leg street the name does not list is printed as the network names it");
same(diagramStreetLabels("Main St & Oak Ave", [{ direction: "NB", street: "Main Street" }, { direction: "EB", street: "Main Street" }, { direction: "WB", street: "Oak Avenue" }]),
  ["Main St", "Main St / Oak Ave"], "a street that turns at the junction labels both axes");

// ---- 5. No street on any leg: the name-order labels stand ----
const unnamed = (r) => ({ ...r, legVolumes: r.legVolumes.map(({ street, ...l }) => l) });
same(labelsOf(unnamed(row("Albemarle Rd & Reddman Rd"))), ["Albemarle Rd", "Reddman Rd"],
  "legs from before legs carried a street: name order");
same(diagramStreetLabels("Albemarle Rd & Reddman Rd", [{ direction: "NB", street: null }, { direction: "EB", street: null }]), ["Albemarle Rd", "Reddman Rd"],
  "every leg on an unnamed way: name order");
same(diagramStreetLabels("Idlewild Rd & Monroe Rd & Rama Rd"), ["Idlewild Rd", "Monroe Rd / Rama Rd"], "no legs at all: name order, every street after the first on the second label");
same(diagramStreetLabels(null, undefined), ["", ""], "no name, no legs: empty labels");

// ---- 6. The renderer draws them: north–south label above the crossroads, east–west beside it ----
// Inject two Mecklenburg rows into the ny preview fixture's first two
// intersections (top-level and every period row, which is what the diagrams
// read). drawTurningMovementDiagram writes the figure title, then the
// north–south label, then the east–west label, then the SB block.
const { mod, cleanup } = await loadRendererBundle();
try {
  const base = loadFixture("ny");
  const inject = (report, idx, src) => {
    const id = report.affectedIntersections[idx].signalId;
    for (const rows of [report.affectedIntersections, ...report.periodReports.map((p) => p.affectedIntersections)]) {
      const r = rows.find((z) => z.signalId === id);
      if (r) { r.name = src.name; r.legVolumes = src.legVolumes; }
    }
  };
  const injected = JSON.parse(JSON.stringify(base));
  inject(injected.report, 0, row("Albemarle Rd & Reddman Rd"));
  inject(injected.report, 1, row("Idlewild Rd & Monroe Rd & Rama Rd"));
  const text = (await pageTexts(await mod.renderStudyPdf(projectFromFixture(injected), { name: "Axis Label Check", logoUrl: null }))).join(" ");
  const count = (re) => (text.match(re) ?? []).length;
  ok(count(/— Build Reddman Rd Albemarle Rd SB L/g) === 3,
    "rendered A.9: every period's diagram prints Reddman Rd on the north–south axis and Albemarle Rd on the east–west axis");
  ok(count(/— Build Albemarle Rd Reddman Rd SB L/g) === 0, "rendered A.9: no diagram still draws Albemarle Rd north–south");
  ok(count(/— Build Monroe Rd SB L/g) === 3, "rendered A.6: east–west label Monroe Rd, north–south unlabeled (no leg there)");
  const legacy = (await pageTexts(await mod.renderStudyPdf(projectFromFixture(base), { name: "Axis Label Check", logoUrl: null }))).join(" ");
  ok(/— Build Glen Cove Avenue Charles Street SB L/.test(legacy), "rendered legacy row (no legVolumes): name-order labels");
} finally {
  await cleanup();
}

console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
