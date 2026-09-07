/**
 * Regression guard: the study-scope disclosure must state the REAL reason
 * records are absent, and must not misreport raw inventory nodes as
 * intersections.
 *
 * #191 correctly stopped reporting the post-merge count as the study-area
 * population, but the sentence that consumes the number was left describing
 * the OLD cause. On the Allegheny County sample (site 40.5250,-80.0130,
 * r=2.0 mi) that shipped as:
 *
 *   "72 signalized intersections lie within the 2-mile study area; 36 are
 *    carried as study intersections ... The remainder receive net new site
 *    traffic below the impact-significance threshold (de-minimis, per ITE
 *    MTIASD §2.2) and are not analyzed individually."
 *
 * Every clause after the semicolon is false there. Measured from
 * pittsburgh-signals.json: 72 records sit in the radius, but 50 of them have a
 * nearest neighbour within DEDUP_DISTANCE_M and the MEDIAN nearest-neighbour
 * distance is 25.6 m -- OSM tagging one node per approach. 35 of the 36 merges
 * fire on co-location alone, naming-independent. The gap is exactly the merge
 * count (72 - 36 merged = 36 kept = 36 analyzed): NOTHING was removed by an
 * impact-significance screen, and scopeStudyIntersections defaults false so no
 * such screen was even running.
 *
 * Contrast tacoma_metro, the case #191 was written for: there all 4 merges sat
 * 104-129 m apart and fired on name equality. Nearest-neighbour distance is the
 * discriminator, so the note discloses the merge either way and never claims a
 * screen that did not run.
 *
 * Also guards the generic state renderer's §3.5 sentence, which interpolates a
 * period-terminated paragraph mid-sentence and shipped "... NCHRP 716).
 * PennDOT Pub 282 explicitly references ITE., as used in Pennsylvania screening
 * practice."
 *
 * Standalone node script (no test runner configured). Run:
 *   pnpm run check:study-scope-note
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { buildStudyScopeNote } = await import(path.resolve(here, "../src/lib/study-scope-note.ts"));

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

// A first-person methodological citation of ITE is what the 2026-07-08 C&D
// removed (#104/#144/#146/#147/#148/#151). Bare "ITE" must not reappear here.
const CITES_ITE = (s) => /\bITE\b/.test(s) || /MTIASD/i.test(s);

// --- 1. Allegheny County: the whole gap is same-junction merging ---
{
  const note = buildStudyScopeNote({
    inRadiusRecords: 72, mergedAsDuplicates: 36, analyzed: 36, studyRadiusMi: 2,
  });
  ok(note != null, "a note is produced when records were merged away");
  ok(
    /\b36 signalized intersections lie within\b/.test(note),
    "leads with the POST-merge intersection count (36), not the raw node count",
  );
  ok(
    !/\b72 signalized intersections\b/.test(note),
    "never calls the 72 raw inventory records 'signalized intersections'",
  );
  ok(note.includes("72"), "still discloses the 72 raw inventory records (#191's intent: no invisible loss)");
  ok(note.includes("36 were merged") || /merged/.test(note), "attributes the gap to merging");
  ok(
    !/de-minimis/i.test(note) && !/impact-significance/i.test(note),
    "does NOT claim an impact-significance screen removed anything (none ran)",
  );
  ok(!CITES_ITE(note), "carries no standalone ITE / MTIASD citation");
}

// --- 2. Tacoma: the merge is still disclosed, no screen is claimed ---
{
  const note = buildStudyScopeNote({
    inRadiusRecords: 17, mergedAsDuplicates: 4, analyzed: 13, studyRadiusMi: 1,
  });
  ok(/\b13 signalized intersections lie within\b/.test(note), "Tacoma leads with 13 post-merge intersections");
  ok(note.includes("17") && /merged/.test(note), "Tacoma discloses 4 of 17 records merged -- the loss stays visible");
  ok(!CITES_ITE(note), "Tacoma note carries no ITE / MTIASD citation");
}

// --- 3. a real significance screen DID trim: say so, still without citing ITE ---
{
  const note = buildStudyScopeNote({
    inRadiusRecords: 20, mergedAsDuplicates: 0, analyzed: 12, studyRadiusMi: 0.5,
  });
  ok(/\b20 signalized intersections lie within\b/.test(note), "no merges -> raw count IS the intersection count");
  ok(/\b8\b/.test(note) && /impact-significance/i.test(note), "the 8 genuinely screened out are described as screened");
  ok(!CITES_ITE(note), "screened-out note carries no ITE / MTIASD citation");
}

// --- 4. nothing to disclose -> no sentence at all ---
{
  ok(
    buildStudyScopeNote({ inRadiusRecords: 12, mergedAsDuplicates: 0, analyzed: 12, studyRadiusMi: 1 }) == null,
    "emits nothing when the study set is complete (no merge, no trim)",
  );
  ok(
    buildStudyScopeNote({ inRadiusRecords: 0, mergedAsDuplicates: 0, analyzed: 0, studyRadiusMi: 1 }) == null,
    "emits nothing for an empty study area",
  );
}

// --- 5. §3.5 trip-generation sentence must not render a doubled terminator ---
// Renders the real sentence for every state in the table, rather than trusting
// the template's shape.
{
  const statesPath = path.resolve(here, "../src/lib/pdf-export-states.ts");
  const statesSrc = fs.readFileSync(statesPath, "utf8");
  const { splitTripGenSource } = await import(path.resolve(here, "../src/lib/trip-gen-sentence.ts"));

  const entries = [...statesSrc.matchAll(/stateName:\s*"((?:[^"\\]|\\.)*)"[\s\S]{0,4000}?tripGenSource:\s*"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => ({ stateName: m[1], tripGenSource: m[2] }));
  ok(entries.length > 20, `found the state config table (${entries.length} entries)`);

  const render = (e) => {
    const t = splitTripGenSource(e.tripGenSource);
    return `Trip generation is calculated using ${t.head}, as used in ${e.stateName} screening practice.`
      + `${t.tail ? ` ${t.tail}` : ""} The published rate or equation for Land Use Code 820 ...`;
  };

  // The defect is a terminator landing on the interpolation seam. Match THAT,
  // not any "." before a comma -- "(e.g., Chick-fil-A)" in the NC guidance is
  // ordinary prose and must stay legal.
  const doubled = entries.filter((e) => /[.!?],\s*as used in/.test(render(e)));
  ok(
    doubled.length === 0,
    `no state renders a doubled terminator at the seam (".., as used in" in ${doubled.length} of ${entries.length})`,
  );

  const pa = entries.find((e) => /Pennsylvania/i.test(e.stateName));
  ok(pa != null, "Pennsylvania is in the state table");
  if (pa) {
    const out = render(pa);
    ok(!out.includes("ITE.,"), `Pennsylvania no longer renders "ITE.," -> ${out.slice(0, 190)}`);
    ok(
      /explicitly references ITE\./.test(out),
      "the PennDOT clause survives as its own sentence (a statement of what PennDOT's own publication references)",
    );
  }

  const empties = entries.filter((e) => !splitTripGenSource(e.tripGenSource).head.trim());
  ok(empties.length === 0, `no state produces an empty rate-source phrase (${empties.length})`);
}

// --- 6. the renderers must actually USE the helpers ---
// Without this, both fixes can be reverted in the renderer while every check
// above still passes: the helpers would stay correct and simply stop being called.
{
  const exp = fs.readFileSync(path.resolve(here, "../src/lib/pdf-export.ts"), "utf8");
  ok(
    /buildStudyScopeNote\(/.test(exp),
    "pdf-export.ts calls buildStudyScopeNote (the appendix note is not hand-built)",
  );
  ok(
    !/signalized intersections lie within/.test(exp),
    "pdf-export.ts no longer hand-writes the scope sentence",
  );
  ok(
    !/MTIASD\s*§|de-minimis/i.test(exp),
    "pdf-export.ts carries no de-minimis / MTIASD citation",
  );
  ok(
    /mergedAsDuplicates/.test(exp) && /intersectionsMergedAsDuplicates/.test(exp),
    "the merge count is plumbed from the report into the appendix",
  );

  const states = fs.readFileSync(path.resolve(here, "../src/lib/pdf-export-states.ts"), "utf8");
  const sentence = states.match(/Trip generation is calculated using \$\{([^}]+)\}/);
  ok(sentence != null, "found the §3.5 trip-generation sentence");
  ok(
    sentence != null && !/cfg\.tripGenSource/.test(sentence[1]),
    `§3.5 interpolates the SPLIT phrase, not the raw paragraph (got \${${sentence ? sentence[1] : "?"}})`,
  );
  ok(/splitTripGenSource\(/.test(states), "pdf-export-states.ts calls splitTripGenSource");
}

console.log(fails === 0 ? "\nstudy-scope note OK" : `\n${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
