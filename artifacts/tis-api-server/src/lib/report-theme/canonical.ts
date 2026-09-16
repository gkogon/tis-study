/**
 * Canonical heading keys. The extractor maps the sample's H1/H2 titles onto
 * these (derive/synonyms.ts) and draw.ts maps OUR titles onto them at render
 * time, so a firm's wording replaces ours where the two correspond.
 * Order matters: first match wins ("Conclusions and Recommendations" →
 * conclusions).
 *
 * `words` is the key's own vocabulary. A sample heading only becomes a
 * synonym when it shares a word with its key's vocabulary and none of its
 * other words belong to a different key (GENERIC words never count), so a
 * regex that happens to match a heading about something else — "Project
 * Site Distribution and Assignment" is trip distribution, not the site
 * description — cannot retitle one of our sections with a different meaning.
 */
export const CANONICAL: Array<{ key: string; re: RegExp; words: string[] }> = [
  { key: "executive-summary", re: /executive summary|summary of findings/i, words: ["executive", "findings"] },
  // Bare "Background" is a chapter about the project's history as often as an introduction; it maps to nothing.
  { key: "introduction", re: /\bintroduction\b|\bpurpose\b|project description|proposed (development|project)/i, words: ["introduction", "purpose", "description", "proposed", "development"] },
  // "Project Site Distribution and Assignment" is trip distribution; "Area Land Uses" alone is a planning chapter, not the site description.
  { key: "site-description", re: /site (description|plan|location)|project site(?!.*\b(distribution|assignment)\b)|location description|\b(site|proposed|existing|surrounding|adjacent|anticipated|future) land use/i, words: ["description", "plan", "location", "land", "use", "uses"] },
  { key: "study-area", re: /study (area|network|intersections)|scope of (the )?study/i, words: ["area", "network", "intersections", "scope"] },
  // "roadway", "volumes" and "facilities" are generic across TIS headings ("Planned Roadway Improvements", "Future Traffic Volumes", "Pedestrian and Bicycle Facilities"); only "existing" is this key's evidence.
  { key: "existing-conditions", re: /existing (conditions|traffic|roadway|facilities|volumes|network)/i, words: ["existing", "network"] },
  { key: "methodology", re: /methodolog|analysis (approach|assumptions)|\bassumptions\b/i, words: ["methodology", "methodologies", "method", "methods", "approach", "assumptions"] },
  { key: "background-growth", re: /background (traffic|growth)|growth rate|no[- ]build/i, words: ["background", "growth", "rate", "rates", "no-build", "build"] },
  { key: "trip-generation", re: /trip generation|site trips|trip gen\b/i, words: ["trip", "trips", "generation", "gen"] },
  { key: "trip-distribution", re: /trip distribution|distribution and assignment/i, words: ["trip", "trips", "distribution", "assignment"] },
  { key: "trip-assignment", re: /trip assignment|traffic assignment/i, words: ["trip", "trips", "assignment"] },
  { key: "future-conditions", re: /future (conditions|traffic|volumes)|build conditions|opening year|horizon year|design year/i, words: ["future", "build", "opening", "horizon", "design", "year"] },
  { key: "capacity-analysis", re: /capacity analys|level of service|\blos\b|intersection (analysis|operations)|operational analysis|traffic (analysis|operations)/i, words: ["capacity", "level", "service", "los", "intersection", "operations", "operational", "operation"] },
  { key: "queuing", re: /queu/i, words: ["queue", "queues", "queuing", "queueing"] },
  { key: "warrants", re: /warrant/i, words: ["warrant", "warrants", "signal"] },
  { key: "access", re: /site access|access (management|analysis)|driveway|ingress|egress|circulation/i, words: ["access", "driveway", "driveways", "ingress", "egress", "circulation"] },
  { key: "safety", re: /crash|safety|collision/i, words: ["crash", "crashes", "safety", "collision", "collisions"] },
  { key: "multimodal", re: /pedestrian|bicycle|transit|multimodal/i, words: ["pedestrian", "pedestrians", "bicycle", "bicycles", "transit", "multimodal"] },
  { key: "programmed-projects", re: /programmed|planned (roadway|improvements)|committed (projects|improvements)/i, words: ["programmed", "planned", "committed", "projects", "improvements"] },
  // Bare "Improvements" is not mitigation: "Infrastructure Improvements", "Proffered Improvements" and "Roadway Network Improvements" all read differently.
  { key: "mitigation", re: /mitigation|recommended improvements|proposed improvements/i, words: ["mitigation", "mitigations", "improvements", "recommended", "proposed"] },
  { key: "conclusions", re: /conclusion|findings/i, words: ["conclusion", "conclusions", "findings", "recommendations"] },
  { key: "recommendations", re: /recommendation/i, words: ["recommendation", "recommendations"] },
  { key: "certification", re: /certification|seal|signature/i, words: ["certification", "certify", "seal", "signature"] },
  { key: "appendix", re: /appendi/i, words: ["appendix", "appendices"] },
];

/** Words every TIS heading uses; never evidence for or against a key. */
export const GENERIC_HEADING_WORDS = new Set([
  "traffic", "transportation", "transport", "analysis", "analyses", "study", "site", "project", "conditions", "condition", "summary",
  "report", "evaluation", "assessment", "overview", "roadway", "volumes", "facilities",
  "and", "or", "of", "the", "for", "to", "a", "an", "in", "on", "with", "by", "at",
]);

/** "3.1 Title", "Section 2 – Title", "B. Title", "VII. Title" → "Title". */
export function stripNumbering(text: string): string {
  return text
    .replace(/^\s*section\s+\d+\s*[-–—:.]?\s*/i, "")
    // Roman chapter numbers ("II.", "IV.", "VII.") are a heading form the
    // schema has no numbering style for; the wording must still come out
    // bare, or a title-cased synonym reads "Ii. Introduction".
    .replace(/^\s*(?:\d+(?:\.\d+)*\.?|[A-Z]\.|[IVXLC]{2,6}\.)\s+/, "")
    .trim();
}

export function canonicalKey(text: string): string | null {
  const t = stripNumbering(text);
  for (const c of CANONICAL) if (c.re.test(t)) return c.key;
  return null;
}

/** Heading text → lower-cased words with surrounding punctuation stripped ("No-Build" stays one word). */
export function headingWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);
}

/**
 * Whether a sample heading may stand in for `key` (spec §5.2 synonyms):
 * it must share a word with the key's own vocabulary, and no other word
 * of it may belong to a different key. Generic words are ignored.
 */
export function synonymFitsKey(text: string, key: string): boolean {
  const entry = CANONICAL.find((c) => c.key === key);
  if (!entry) return false;
  const own = new Set(entry.words);
  const words = headingWords(text).filter((w) => !GENERIC_HEADING_WORDS.has(w));
  if (!words.some((w) => own.has(w))) return false;
  for (const w of words) {
    if (own.has(w)) continue;
    if (CANONICAL.some((c) => c.key !== key && c.words.includes(w))) return false;
  }
  return true;
}
