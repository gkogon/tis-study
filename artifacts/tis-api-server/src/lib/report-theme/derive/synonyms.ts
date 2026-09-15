import { canonicalKey, headingWords, stripNumbering, synonymFitsKey } from "../canonical";
import { isGarbledText } from "../pdf-scan";

/**
 * A sample heading is only a reusable synonym when it is generic wording:
 * a year, a parenthetical or a long title carries the sample's own study
 * into every new one ("Existing Conditions (2024)", "Annual Growth Rate and
 * Nearby Developments").
 */
export function isReusableWording(text: string): boolean {
  if (/\d/.test(text)) return false;
  if (/[()]/.test(text)) return false;
  if (headingWords(text).length > 5) return false;
  return true;
}

/** Sample H1/H2 titles → { canonicalKey: firm's wording }. First occurrence per key wins. */
export function mapSynonyms(headingTexts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const text of headingTexts) {
    const clean = stripNumbering(text).trim();
    if (!clean || clean.length > 80 || isGarbledText(clean)) continue;
    if (!isReusableWording(clean)) continue;
    const key = canonicalKey(clean);
    if (!key || out[key]) continue;
    if (!synonymFitsKey(clean, key)) continue;
    out[key] = clean;
  }
  return out;
}
