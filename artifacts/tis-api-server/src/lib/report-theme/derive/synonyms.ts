import { canonicalKey, stripNumbering } from "../canonical";

/** Sample H1/H2 titles → { canonicalKey: firm's wording }. First occurrence per key wins. */
export function mapSynonyms(headingTexts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const text of headingTexts) {
    const clean = stripNumbering(text).trim();
    if (!clean || clean.length > 80) continue;
    const key = canonicalKey(clean);
    if (key && !out[key]) out[key] = clean;
  }
  return out;
}
