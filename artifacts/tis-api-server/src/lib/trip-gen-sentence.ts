/**
 * §3.5 trip-generation sentence construction — dependency-free so it can be
 * unit-tested without pulling the renderer's PDFKit graph.
 *
 * `tripGenSource` in the state config table is a period-terminated paragraph:
 * a rate-source phrase, then optional state-specific guidance. The generic state
 * renderer interpolated the whole thing mid-sentence, so every one of the 46
 * generic-renderer states rendered a doubled terminator. It shipped in the
 * Allegheny County sample as:
 *
 *   "Trip generation is calculated using Public-data screening rates (NHTS 2017
 *    / SANDAG 2002 / NCHRP 716). PennDOT Pub 282 explicitly references ITE.,
 *    as used in Pennsylvania screening practice."
 *
 * Splitting at the first sentence boundary keeps the rate-source phrase inside
 * the carrier sentence and lets any state guidance stand as its own sentence.
 */

/**
 * Split a `tripGenSource` paragraph into the rate-source phrase (no terminator,
 * safe to embed mid-sentence) and any remaining guidance sentences.
 */
export function splitTripGenSource(src: string): { head: string; tail: string } {
  const t = (src ?? "").trim();
  const cut = t.search(/\.\s+/);
  if (cut === -1) return { head: t.replace(/\.$/, ""), tail: "" };
  return { head: t.slice(0, cut), tail: t.slice(cut + 1).trim() };
}
