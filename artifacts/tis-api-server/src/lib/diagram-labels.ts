/** The part of a legVolumes entry the labels read. */
export type DiagramLeg = { direction?: unknown; street?: string | null };

/**
 * The two street labels of a turning-movement diagram: [north–south,
 * east–west].
 *
 * Each axis names the street(s) its legs lie on: legVolumes[].street, the
 * road network's name for each leg, with the NB/SB legs on the north–south
 * axis and the EB/WB legs on the east–west one. A street the intersection
 * name lists keeps the name's spelling ("Albemarle Rd", not the network's
 * "Albemarle Road"); a street it does not list prints as the network names
 * it. An axis with no named leg stays unlabeled rather than borrowing a
 * street from the name.
 *
 * With no leg street at all (a row solved before legs carried one, or every
 * leg on an unnamed way) the labels follow the name "A & B & C": the first
 * street labels one axis and every other street the other, joined with
 * " / ". Authority names list every street at a junction (CDOT's "Idlewild
 * Rd & Monroe Rd & Rama Rd", Raleigh's "Fox Rd. & Malone Ct. & Sumner
 * Blvd."), so taking only the second part dropped the third street.
 */
export function diagramStreetLabels(
  name: string | null | undefined,
  legs?: readonly DiagramLeg[] | null,
): [string, string] {
  const parts = String(name ?? "").split(/\s*&\s*/);
  const named = (Array.isArray(legs) ? legs : []).flatMap((l) =>
    typeof l?.street === "string" && l.street.trim() !== ""
      ? [{ dir: String(l.direction).toUpperCase(), street: l.street.trim() }]
      : []);
  if (named.length === 0) return [parts[0] ?? "", parts.slice(1).join(" / ")];

  const axis = (dirs: readonly string[]): string => {
    const labels: Array<{ text: string; order: number }> = [];
    for (const { dir, street } of named) {
      if (!dirs.includes(dir)) continue;
      const i = namePartFor(parts, street);
      const text = i >= 0 ? parts[i]! : street;
      if (labels.some((x) => normalized(x.text) === normalized(text))) continue;
      // Streets the name lists keep the name's order; the rest follow, in leg order.
      labels.push({ text, order: i >= 0 ? i : parts.length + labels.length });
    }
    return labels.sort((a, b) => a.order - b.order).map((x) => x.text).join(" / ");
  };
  return [axis(["NB", "SB"]), axis(["EB", "WB"])];
}

// Street-type words and their abbreviations, compared as one token. Both
// spellings of a name pass through this table, so "Road" and "Rd" agree.
const STREET_TYPES: Record<string, string> = {
  road: "rd", street: "st", avenue: "ave", av: "ave", boulevard: "blvd", bv: "blvd",
  drive: "dr", lane: "ln", court: "ct", place: "pl", parkway: "pkwy", py: "pkwy",
  highway: "hwy", hy: "hwy", expressway: "expy", expwy: "expy", freeway: "fwy",
  circle: "cir", terrace: "ter", trail: "trl", wy: "way", square: "sq",
  turnpike: "tpke", crossing: "xing", extension: "ext", driveway: "dwy", dw: "dwy", dy: "dwy",
};
const DIRECTIONS: Record<string, string> = {
  north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};
const TYPE_TOKENS = new Set([...Object.values(STREET_TYPES), "way", "pike", "ramp"]);
const DIRECTION_TOKENS = new Set(Object.values(DIRECTIONS));

function tokens(s: string): string[] {
  const t = s.toLowerCase()
    .replace(/[.,'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bstate (road|route|highway)\b/g, "sr")
    .replace(/\bus (highway|route)\b/g, "us")
    .replace(/\bcounty (road|route)\b/g, "cr")
    .replace(/\binterstate( highway)?\b/g, "i");
  return t.split(" ").filter(Boolean).map((w) => {
    const ordinal = /^(\d+)(st|nd|rd|th)$/.exec(w);
    if (ordinal) return ordinal[1]!;
    return STREET_TYPES[w] ?? DIRECTIONS[w] ?? w;
  });
}
const normalized = (s: string): string => tokens(s).join(" ");
/** The name without its directions and street types: "North Sharon Amity Road" → "sharon amity". */
const core = (s: string): string => tokens(s).filter((w) => !TYPE_TOKENS.has(w) && !DIRECTION_TOKENS.has(w)).join(" ");

/** A name part's alternatives: a route's names joined with "/" ("US 441/SR 7")
 *  and a parenthesized note ("Segal (Walmart)", "SR 500(US 441-Obt)") — the
 *  part with the note removed, and the note itself. */
function alts(part: string): string[] {
  const out: string[] = [];
  for (const raw of part.split("/")) {
    const a = raw.trim();
    if (!a) continue;
    out.push(a);
    const bare = a.replace(/\([^)]*\)/g, " ").trim();
    if (bare && bare !== a) out.push(bare);
    for (const m of a.matchAll(/\(([^)]*)\)/g)) if (m[1]!.trim()) out.push(m[1]!.trim());
  }
  return out;
}

/** Index of the name part that is this street, or -1; matching any of the
 *  part's alternatives counts. */
function namePartFor(parts: readonly string[], street: string): number {
  const exact = normalized(street);
  const i = parts.findIndex((p) => alts(p).some((a) => normalized(a) === exact));
  if (i >= 0) return i;
  const c = core(street);
  if (!c) return -1;
  return parts.findIndex((p) => alts(p).some((a) => core(a) === c));
}
