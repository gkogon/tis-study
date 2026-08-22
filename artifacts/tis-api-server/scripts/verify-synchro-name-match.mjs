// Regression check for the Synchro-report name matcher
// (synchro-name-match.ts) — the piece that lets a report PDF's
// coordinate-less intersections attach to inventory signals.
//
// Three proofs:
//
//  1. NORMALIZATION TABLE: every drift class the matcher must absorb
//     (separator style, suffix abbreviation, ordinal suffixes, leading
//     directionals, "/" alternate labels, label order) plus the classes it
//     must NOT absorb (different street names/numbers).
//
//  2. MATCH CONTRACT: unambiguous best match ⇒ match; two candidates with
//     the same normalized name ⇒ TIE (matches nothing); zero ⇒ none with
//     near-misses listed. Ambiguity must never resolve silently.
//
//  3. REAL-WORLD TORTURE SET: names transcribed from a real Caltran
//     Engineering Synchro 12 report (HCA Westside TIS appendix) against
//     OSM-style inventory spellings.
//
// Run: node ./scripts/verify-synchro-name-match.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { normalizeStreetName, sameIntersectionName, matchIntersectionByName } =
  await import(path.resolve(here, "../src/lib/synchro-name-match.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// ---------------------------------------------------------------------------
// 1. Street-name normalization
// ---------------------------------------------------------------------------
const NORM = [
  ["NW 79th St", "79"],
  ["NW 79 Street", "79"],
  ["N Pine Island Rd", "pine island"],
  ["Pine Island Road", "pine island"],
  ["Cleary Blvd", "cleary"],
  ["Cleary Boulevard.", "cleary"],
  ["W Broward Blvd", "broward"],
  ["University Dr", "university"],
  ["NW 82nd Terrace", "82"],
  ["State Road 54", "state 54"], // "road" is a suffix word; "state 54" is stable both sides
  ["North Street", "north street"], // all tokens would drop → falls back to full tokens
];
for (const [input, want] of NORM) {
  const got = normalizeStreetName(input);
  ok(got === want, `normalize "${input}" → "${got}" (want "${want}")`);
}

// ---------------------------------------------------------------------------
// 2. Same-intersection equivalence (true and FALSE cases)
// ---------------------------------------------------------------------------
const SAME = [
  // separator styles
  ["NW 79th St & NW 7th Ave", "NW 79 Street at NW 7 Avenue", true],
  ["Main St @ First Ave", "Main Street & First Avenue", true],
  ["Main St and First Ave", "First Ave & Main St", true], // label order
  // suffix + directional drift
  ["N Pine Island Rd & W Broward Blvd", "Pine Island Road & Broward Boulevard", true],
  // ordinal drift (real HCA pages print BOTH "NW 5 Street" and "NW 5th Street")
  ["N Pine Island Rd & NW 5 Street", "N Pine Island Rd & NW 5th St", true],
  // "/" alternate label for one leg
  ["N Pine Island Rd & Park Center Pl", "N Pine Island Rd at Park Center Pl/NW 4th Street", true],
  // NOT the same: different street number
  ["NW 79th St & NW 7th Ave", "NW 79th St & NW 8th Ave", false],
  // NOT the same: different name
  ["Cleary Blvd & N Pine Island Rd", "Cleary Blvd & University Dr", false],
  // single-label names only match on whole-name equality
  ["Nearest-Wins Blvd", "Nearest-Wins Blvd", true],
  ["Nearest-Wins Blvd", "Farthest-Loses Blvd", false],
  // a 2-leg name never matches a bare single label
  ["Main St & First Ave", "Main St", false],
];
for (const [a, b, want] of SAME) {
  const got = sameIntersectionName(a, b);
  ok(got === want, `same("${a}", "${b}") = ${got} (want ${want})`);
}

// ---------------------------------------------------------------------------
// 3. Match contract: unambiguous / tie / none
// ---------------------------------------------------------------------------
const candidates = [
  { id: "sig-1", name: "Cleary Blvd & N Pine Island Rd" },
  { id: "sig-2", name: "University Dr & Cleary Blvd" },
  { id: "sig-3", name: "N Pine Island Rd & NW 5th St" },
  { id: "sig-4", name: null }, // inventory names are sometimes null
];
const nameOf = (c) => c.name;

let r = matchIntersectionByName("1: Cleary Blvd & N Pine Island Rd", candidates, nameOf);
ok(r.kind === "match" && r.candidate.id === "sig-1", `intId-prefixed record matches sig-1 (${r.kind})`);

r = matchIntersectionByName("Pine Island Road at NW 5 Street", candidates, nameOf);
ok(r.kind === "match" && r.candidate.id === "sig-3", `suffix/ordinal/directional drift matches sig-3 (${r.kind})`);

r = matchIntersectionByName("Cleary Blvd & Nowhere Ln", candidates, nameOf);
ok(r.kind === "none", `unknown cross street ⇒ none (${r.kind})`);
ok(r.kind === "none" && r.nearMisses.length > 0 && r.nearMisses.some((c) => c.id === "sig-1"),
  "near-misses list the one-leg matches for the warning");

// TIE: divided-arterial twin signals share a normalized name — matching must
// refuse to guess.
const twinCandidates = [
  ...candidates,
  { id: "sig-1b", name: "N Pine Island Road & Cleary Boulevard" },
];
r = matchIntersectionByName("Cleary Blvd & N Pine Island Rd", twinCandidates, nameOf);
ok(r.kind === "tie" && r.candidates.length === 2, `twin normalized names ⇒ tie of 2 (${r.kind})`);

// All-null inventory names ⇒ none, never a crash.
r = matchIntersectionByName("Cleary Blvd & N Pine Island Rd", [{ id: "x", name: null }], nameOf);
ok(r.kind === "none" && r.nearMisses.length === 0, "all-null candidate names ⇒ none");

// ---------------------------------------------------------------------------
// 4. Real-world torture set: HCA report names vs OSM-style inventory labels
// ---------------------------------------------------------------------------
const osmStyle = [
  { id: "a", name: "Northwest 5th Street & North Pine Island Road" },
  { id: "b", name: "West Broward Boulevard & Northwest 82nd Avenue" },
  { id: "c", name: "West Broward Boulevard & University Drive" },
  { id: "d", name: "Park Center Place & North Pine Island Road" },
];
const HCA = [
  ["3: N Pine Island Rd & NW 5 Street", "a"],
  ["10: NW 82 Avenue & W Broward Blvd", "b"],
  ["11: University Dr & W Broward Blvd", "c"],
  ["6: N Pine Island Rd & Park Center Pl", "d"],
];
for (const [rec, want] of HCA) {
  const res = matchIntersectionByName(rec, osmStyle, nameOf);
  ok(res.kind === "match" && res.candidate.id === want,
    `HCA "${rec}" → ${res.kind === "match" ? res.candidate.id : res.kind} (want ${want})`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
