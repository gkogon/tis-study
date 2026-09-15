/**
 * Canonical heading keys. The extractor maps the sample's H1/H2 titles onto
 * these (derive/synonyms.ts) and draw.ts maps OUR titles onto them at render
 * time, so a firm's wording replaces ours where the two correspond.
 * Order matters: first match wins ("Conclusions and Recommendations" →
 * conclusions).
 */
export const CANONICAL: Array<{ key: string; re: RegExp }> = [
  { key: "executive-summary", re: /executive summary|summary of findings/i },
  { key: "introduction", re: /\bintroduction\b|\bpurpose\b|project description|proposed (development|project)|background/i },
  { key: "site-description", re: /site (description|plan|location)|project site|location description|land use/i },
  { key: "study-area", re: /study (area|network|intersections)|scope of (the )?study/i },
  { key: "existing-conditions", re: /existing (conditions|traffic|roadway|facilities|volumes|network)/i },
  { key: "methodology", re: /methodolog|analysis (approach|assumptions)|\bassumptions\b/i },
  { key: "background-growth", re: /background (traffic|growth)|growth rate|no[- ]build/i },
  { key: "trip-generation", re: /trip generation|site trips|trip gen\b/i },
  { key: "trip-distribution", re: /trip distribution|distribution and assignment/i },
  { key: "trip-assignment", re: /trip assignment|traffic assignment/i },
  { key: "future-conditions", re: /future (conditions|traffic|volumes)|build conditions|opening year|horizon year|design year/i },
  { key: "capacity-analysis", re: /capacity analys|level of service|\blos\b|intersection (analysis|operations)|operational analysis|traffic (analysis|operations)/i },
  { key: "queuing", re: /queu/i },
  { key: "warrants", re: /warrant/i },
  { key: "access", re: /site access|access (management|analysis)|driveway|ingress|egress|circulation/i },
  { key: "safety", re: /crash|safety|collision/i },
  { key: "multimodal", re: /pedestrian|bicycle|transit|multimodal/i },
  { key: "programmed-projects", re: /programmed|planned (roadway|improvements)|committed (projects|improvements)/i },
  { key: "mitigation", re: /mitigation|recommended improvements|\bimprovements\b/i },
  { key: "conclusions", re: /conclusion|findings/i },
  { key: "recommendations", re: /recommendation/i },
  { key: "certification", re: /certification|seal|signature/i },
  { key: "appendix", re: /appendi/i },
];

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
