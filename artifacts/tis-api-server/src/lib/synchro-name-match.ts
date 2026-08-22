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
 * Both suffixes and directionals are DROPPED from the key. That is
 * deliberately aggressive — "Main St & 1st Ave" and "Main Ave & 1st Ave"
 * would collide — because the match contract makes aggression safe: a key
 * that matches MORE than one candidate is a TIE, and a tie is reported
 * loudly and matches nothing. Silence never masquerades as a match
 * (the road-parser lesson).
 *
 * Dependency-free leaf module so the rules are testable with plain node.
 */

/** Street-type suffixes dropped from the key (either abbreviated or spelled out). */
const SUFFIX_WORDS = new Set([
  "st", "street", "sts",
  "ave", "av", "avenue",
  "blvd", "boulevard",
  "rd", "road",
  "dr", "drive",
  "ln", "lane",
  "ct", "court",
  "pl", "place",
  "ter", "terr", "terrace",
  "cir", "circle",
  "hwy", "highway",
  "pkwy", "pky", "parkway",
  "expy", "expressway",
  "fwy", "freeway",
  "trl", "trail",
  "way",
  "pike",
  "plz", "plaza",
  "sq", "square",
  "xing", "crossing",
  "rte", "route",
]);

/** Leading/trailing directional tokens dropped from the key. */
const DIRECTIONAL_WORDS = new Set([
  "n", "s", "e", "w", "nb", "sb", "eb", "wb",
  "ne", "nw", "se", "sw",
  "north", "south", "east", "west",
  "northeast", "northwest", "southeast", "southwest",
]);

/**
 * Normalize ONE street label to its key: lowercase, punctuation stripped,
 * ordinal suffixes removed (79th → 79), directionals and street-type
 * suffixes dropped, whitespace collapsed. Returns "" when nothing survives
 * (e.g. the label was only a directional).
 */
export function normalizeStreetName(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[.,'’()]/g, " ")
    .replace(/#/g, " ")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1") // 79th → 79, 3rd → 3
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const kept: string[] = [];
  for (const t of tokens) {
    if (SUFFIX_WORDS.has(t)) continue;
    if (DIRECTIONAL_WORDS.has(t)) continue;
    kept.push(t);
  }
  // If dropping suffix/directional words consumed EVERYTHING (a street
  // actually named "North Street"), fall back to the full token list minus
  // punctuation so the label still has a key.
  return (kept.length > 0 ? kept : tokens).join(" ");
}

/**
 * Split an intersection name into its cross-street labels. Handles the
 * "12: " Synchro node prefix, "&" / "at" / "@" / "and" separators, and
 * "/"-joined ALTERNATE labels for one leg ("Park Center Pl/NW 4th Street").
 * Returns one entry per leg; each entry is the set of normalized alternate
 * keys for that leg (usually a single key).
 */
export function intersectionLegKeys(name: string): string[][] {
  const stripped = name.trim().replace(/^\d+\s*:\s*/, "");
  const legs = stripped
    .split(/\s*&\s*|\s+at\s+|\s*@\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return legs.map((leg) =>
    Array.from(
      new Set(
        leg
          .split("/")
          .map((alt) => normalizeStreetName(alt))
          .filter((k) => k.length > 0),
      ),
    ),
  );
}

/** True when the two leg-key sets share at least one alternate key. */
function legsMatch(a: string[], b: string[]): boolean {
  return a.some((k) => b.includes(k));
}

/**
 * True when two intersection names denote the same cross-street set: every
 * leg of the smaller name matches a DISTINCT leg of the other (bijective for
 * equal counts). A name that yields fewer than 2 legs (a single label, or
 * everything normalized away) only matches on whole-name key equality —
 * there is no cross-street pair to anchor on.
 */
export function sameIntersectionName(nameA: string, nameB: string): boolean {
  const a = intersectionLegKeys(nameA);
  const b = intersectionLegKeys(nameB);
  if (a.length < 2 || b.length < 2) {
    const flatA = a.flat().sort().join(" & ");
    const flatB = b.flat().sort().join(" & ");
    return flatA.length > 0 && flatA === flatB;
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
 * inventory names instead of a bare "no match".
 */
export function matchIntersectionByName<T>(
  recordName: string,
  candidates: T[],
  nameOf: (c: T) => string | null | undefined,
): NameMatchResult<T> {
  const full: T[] = [];
  const partial: T[] = [];
  const recLegs = intersectionLegKeys(recordName);
  for (const c of candidates) {
    const cn = nameOf(c);
    if (!cn || cn.trim().length === 0) continue;
    if (sameIntersectionName(recordName, cn)) {
      full.push(c);
      continue;
    }
    const candLegs = intersectionLegKeys(cn);
    if (
      recLegs.some((rl) => candLegs.some((cl) => legsMatch(rl, cl)))
    ) {
      partial.push(c);
    }
  }
  if (full.length === 1) return { kind: "match", candidate: full[0]! };
  if (full.length > 1) return { kind: "tie", candidates: full };
  return { kind: "none", nearMisses: partial.slice(0, 5) };
}
