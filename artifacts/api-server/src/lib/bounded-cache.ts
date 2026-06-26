/**
 * Tiny LRU bound for the per-region module caches. Each metro's road /
 * intersection / signal / zone data is large (~tens of MB); without a bound a
 * process that serves many regions (a batch sweep, or just broad traffic)
 * retains every metro forever and OOMs. Keep only the most-recently-used N.
 *
 * Map preserves insertion order, so the first key is the oldest. We re-insert
 * on read elsewhere only where it matters; for these load-once caches, bounding
 * on write is sufficient to keep memory flat regardless of how many regions are
 * touched over the process lifetime.
 */
export function lruSet<K, V>(map: Map<K, V>, key: K, value: V, cap = 8): void {
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next().value as K;
    map.delete(oldest);
  }
}
