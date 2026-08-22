/**
 * Name-based intersection matching for Synchro REPORT imports.
 *
 * Why this exists: a Synchro report PDF (Timings / Queues / HCM pages —
 * what engineers actually email around) carries intersection NAMES but NO
 * coordinates, so the coordinate snap that matches UTDF-text records to
 * study candidates (#124) has nothing to work with. This module normalizes
 * both sides — the extracted report name and the inventory signal name —
 * into a canonical cross-street key and requires an UNAMBIGUOUS best match.
 *
 * The normalization has to absorb the real-world drift between a Synchro
 * modeler's labels and an OSM-derived inventory:
 *   - separator style:  "A & B" / "A at B" / "A @ B" / "A and B"
 *   - suffix style:     "St" / "Street" / "ST", "Ave" / "Avenue", ...
 *   - ordinal style:    "NW 79th St" vs "NW 79 St" vs "NW 79 Street"
 *   - directionals:     "N Pine Island Rd" vs "Pine Island Road"
 *   - alternate labels: "Park Center Pl/NW 4th Street" names ONE leg two ways
 *
 * Suffixes and directionals are dropped from the KEY, but each leg remembers
 * the CANONICAL suffix/directional tokens it carried, and two legs REFUSE to
 * match when both sides state a value for the same slot and the values
 * disagree ("NW 7 Ave" never matches "NW 7 Ct"; "NW 79 St" never matches
 * "SW 79 St"). Absent-vs-present is NOT a conflict — that is the legitimate
 * drift ("Pine Island Road" vs "N Pine Island Rd") this module exists to
 * absorb. The guard matters because tie detection alone only protects when
 * BOTH colliding intersections are study candidates: a grid metro's parallel
 * "NW 7th Ave"/"NW 7th Ct" (or the NW/SW quadrant twin of the same street
 * numbers) can put the record's TRUE intersection outside the study while
 * its doppelgänger sits inside — a single plausible-looking wrong candidate,
 * no tie to save us. A wrong-but-plausible attachment is worse than none
 * (the road-parser lesson), so explicit disagreement refuses loudly and the
 * record lands in unmatchedNames with the near-miss named.
 *
 * A key that still matches MORE than one candidate is a TIE, and a tie is
 * reported loudly and matches nothing. Silence never masquerades as a match.
 *
 * Dependency-free leaf module so the rules are testable with plain node.
 */

/** Street-type suffixes → canonical short form. Dropped from the key;
 *  retained (canonicalized) for the explicit-disagreement guard. */
const SUFFIX_CANON: Record<string, string> = {
  st: "st", street: "st", sts: "st",
  ave: "ave", av: "ave", avenue: "ave",
  blvd: "blvd", boulevard: "blvd",
  rd: "rd", road: "rd",
  dr: "dr", drive: "dr",
  ln: "ln", lane: "ln",
  ct: "ct", court: "ct",
  pl: "pl", place: "pl",
  ter: "ter", terr: "ter", terrace: "ter",
  cir: "cir", circle: "cir",
  hwy: "hwy", highway: "hwy",
  pkwy: "pkwy", pky: "pkwy", parkway: "pkwy",
  expy: "expy", expressway: "expy",
  fwy: "fwy", freeway: "fwy",
  trl: "trl", trail: "trl",
  way: "way",
  pike: "pike",
  plz: "plz", plaza: "plz",
  sq: "sq", square: "sq",
  xing: "xing", crossing: "xing",
  rte: "rte", route: "rte",
};

/** Directional tokens → canonical form. NB/SB/EB/WB (direction of travel)
 *  fold onto the plain compass point — "US 1 NB" and "N US 1" are the same
 *  road for matching purposes. */
const DIR_CANON: Record<string, string> = {
  n: "n", north: "n", nb: "n",
  s: "s", south: "s", sb: "s",
  e: "e", east: "e", eb: "e",
  w: "w", west: "w", wb: "w",
  ne: "ne", northeast: "ne",
  nw: "nw", northwest: "nw",
  se: "se", southeast: "se",
  sw: "sw", southwest: "sw",
};

/** One alternate label of one leg: the residual KEY plus the canonical
 *  suffix/directional tokens the label explicitly carried. */
type LegAlt = { key: string; suffixes: string[]; dirs: string[] };

function tokensOf(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[.,'’()]/g, " ")
    .replace(/#/g, " ")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1") // 79th → 79, 3rd → 3
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function altProfile(raw: string): LegAlt | null {
  const tokens = tokensOf(raw);
  const kept: string[] = [];
  const suffixes = new Set<string>();
  const dirs = new Set<string>();
  for (const t of tokens) {
    const sfx = SUFFIX_CANON[t];
    if (sfx !== undefined) {
      suffixes.add(sfx);
      continue;
    }
    const dir = DIR_CANON[t];
    if (dir !== undefined) {
      dirs.add(dir);
      continue;
    }
    kept.push(t);
  }
  // If dropping suffix/directional words consumed EVERYTHING (a street
  // actually named "North Street"), fall back to the full token list — in
  // CANONICAL form, so "North St" and "North Street" share the key "n st".
  const key = (kept.length > 0
    ? kept
    : tokens.map((t) => SUFFIX_CANON[t] ?? DIR_CANON[t] ?? t)
  ).join(" ");
  if (key.length === 0) return null;
  return { key, suffixes: Array.from(suffixes), dirs: Array.from(dirs) };
}

/**
 * Normalize ONE street label to its key: lowercase, punctuation stripped,
 * ordinal suffixes removed (79th → 79), directionals and street-type
 * suffixes dropped, whitespace collapsed. Returns "" when nothing survives.
 */
export function normalizeStreetName(raw: string): string {
  return altProfile(raw)?.key ?? "";
}

/** Both sides state a value for the slot and no value is shared ⇒ explicit
 *  disagreement. Absent-vs-present is never a conflict. */
function disagree(a: string[], b: string[]): boolean {
  return a.length > 0 && b.length > 0 && !a.some((x) => b.includes(x));
}

/** Two alternate labels denote the same street: keys equal AND no explicit
 *  suffix/directional disagreement ("NW 7 Ave" ≠ "NW 7 Ct" ≠ "SW 7 Ave"). */
function altsMatch(a: LegAlt, b: LegAlt): boolean {
  return a.key === b.key && !disagree(a.suffixes, b.suffixes) && !disagree(a.dirs, b.dirs);
}

/** Per-leg alternate profiles for an intersection name (see
 *  intersectionLegKeys for the splitting rules). */
function legProfiles(name: string): LegAlt[][] {
  const stripped = name.trim().replace(/^\d+\s*:\s*/, "");
  const legs = stripped
    .split(/\s*&\s*|\s+at\s+|\s*@\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return legs.map((leg) => {
    const seen = new Set<string>();
    const alts: LegAlt[] = [];
    for (const alt of leg.split("/")) {
      const p = altProfile(alt);
      if (!p) continue;
      const id = `${p.key}|${p.suffixes.slice().sort().join(",")}|${p.dirs.slice().sort().join(",")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      alts.push(p);
    }
    return alts;
  });
}

/**
 * Split an intersection name into its cross-street labels. Handles the
 * "12: " Synchro node prefix, "&" / "at" / "@" / "and" separators, and
 * "/"-joined ALTERNATE labels for one leg ("Park Center Pl/NW 4th Street").
 * Returns one entry per leg; each entry is the set of normalized alternate
 * keys for that leg (usually a single key).
 */
export function intersectionLegKeys(name: string): string[][] {
  return legProfiles(name).map((alts) => Array.from(new Set(alts.map((a) => a.key))));
}

/** True when the two leg-profile sets share at least one matching alternate. */
function legsMatch(a: LegAlt[], b: LegAlt[]): boolean {
  return a.some((x) => b.some((y) => altsMatch(x, y)));
}

/**
 * True when two intersection names denote the same cross-street set: every
 * leg of the smaller name matches a DISTINCT leg of the other (bijective for
 * equal counts). A name that yields fewer than 2 legs (a single label, or
 * everything normalized away) only matches on whole-name equality —
 * there is no cross-street pair to anchor on.
 */
export function sameIntersectionName(nameA: string, nameB: string): boolean {
  const a = legProfiles(nameA);
  const b = legProfiles(nameB);
  if (a.length < 2 || b.length < 2) {
    const fa = a.flat();
    const fb = b.flat();
    if (fa.length === 0 || fa.length !== fb.length) return false;
    const sa = fa.slice().sort((x, y) => x.key.localeCompare(y.key));
    const sb = fb.slice().sort((x, y) => x.key.localeCompare(y.key));
    return sa.every((x, i) => altsMatch(x, sb[i]!));
  }
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  // Greedy bijection over ≤ ~4 legs; backtracking is unnecessary at this
  // size ONLY when we try every assignment — do the tiny recursion instead
  // so "A & A" pathologies can't double-consume a leg.
  const used = new Array(large.length).fill(false);
  const assign = (i: number): boolean => {
    if (i === small.length) return true;
    for (let j = 0; j < large.length; j++) {
      if (used[j] || !legsMatch(small[i]!, large[j]!)) continue;
      used[j] = true;
      if (assign(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0);
}

export type NameMatchResult<T> =
  | { kind: "match"; candidate: T }
  | { kind: "tie"; candidates: T[] }
  | { kind: "none"; nearMisses: T[] };

/**
 * Match one extracted intersection name against the study candidates.
 * Contract: exactly one candidate whose name denotes the same cross-street
 * set ⇒ match. More than one ⇒ tie (caller warns, nothing attaches — a
 * wrong-but-plausible attachment is worse than none). Zero ⇒ none, with
 * up to 5 one-leg near-misses so the caller's warning can show the closest
 * inventory names instead of a bare "no match". Near-misses compare KEYS
 * only (no disagreement guard) on purpose: a candidate refused for an
 * explicit suffix/directional conflict is exactly the neighbor the warning
 * should name.
 */
export function matchIntersectionByName<T>(
  recordName: string,
  candidates: T[],
  nameOf: (c: T) => string | null | undefined,
): NameMatchResult<T> {
  const full: T[] = [];
  const partial: T[] = [];
  const recKeys = intersectionLegKeys(recordName);
  for (const c of candidates) {
    const cn = nameOf(c);
    if (!cn || cn.trim().length === 0) continue;
    if (sameIntersectionName(recordName, cn)) {
      full.push(c);
      continue;
    }
    const candKeys = intersectionLegKeys(cn);
    if (
      recKeys.some((rl) => candKeys.some((cl) => rl.some((k) => cl.includes(k))))
    ) {
      partial.push(c);
    }
  }
  if (full.length === 1) return { kind: "match", candidate: full[0]! };
  if (full.length > 1) return { kind: "tie", candidates: full };
  return { kind: "none", nearMisses: partial.slice(0, 5) };
}
