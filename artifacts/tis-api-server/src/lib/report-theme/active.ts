/**
 * The theme in force for the current synchronous draw pass.
 *
 * Module-level on purpose (the same pattern as `velocityPaletteActive` in
 * pdf-export.ts): the regional renderers call shared primitives from
 * hundreds of sites, and threading a parameter through them all is not
 * worth it. Safe because `withTheme` only wraps synchronous code — an
 * `await` inside it would let a concurrent request read the wrong theme,
 * which is why `withTheme` refuses a function that returns a Promise.
 */
import { DEFAULT_THEME, isDefaultTheme as isDefault, type Theme } from "./theme";

let active: Theme = DEFAULT_THEME;
let usedSynonyms = new Set<string>();

export function activeTheme(): Theme {
  return active;
}
export function isDefaultTheme(): boolean {
  return isDefault(active);
}
/** Left (= right) page margin of the active theme; 50 for the default. */
export function pageMargin(): number {
  return active.page.margins.left;
}
/**
 * The firm's wording for a canonical heading key, handed out once per draw
 * pass so two of our headings that map to the same key (e.g. FINDINGS and
 * CONCLUSIONS) cannot both become the sample's "Conclusions".
 */
export function takeSynonym(key: string): string | null {
  const w = active.synonyms[key];
  if (!w || usedSynonyms.has(key)) return null;
  usedSynonyms.add(key);
  return w;
}
export function withTheme<T>(theme: Theme, fn: () => T): T {
  const prevTheme = active;
  const prevUsed = usedSynonyms;
  active = theme;
  usedSynonyms = new Set();
  try {
    const out = fn();
    if (out instanceof Promise) throw new Error("withTheme(fn): fn must be synchronous — the active theme is module state");
    return out;
  } finally {
    active = prevTheme;
    usedSynonyms = prevUsed;
  }
}
