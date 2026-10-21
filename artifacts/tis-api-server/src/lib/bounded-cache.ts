/**
 * A bounded in-process cache: an entry expires `ttlMs` after it was stored,
 * and the map never holds more than `maxEntries`. The same two guards as
 * network-assignment.ts's roadsMemo, packaged for the per-coordinate lookup
 * caches of the regional data adapters (nysdot-data, nyc-transit-data,
 * tfl-ptal), whose keys come from study coordinates and so are unbounded:
 *
 *   - Every get / set / size sweeps the entries past their TTL, so expiry
 *     frees memory rather than merely skipping the read.
 *   - A set over the cap evicts the least recently USED entry (Map keeps
 *     insertion order and a hit re-inserts its key at the tail, so eviction is
 *     LRU, not FIFO). A hit does NOT extend the TTL — that runs from the store,
 *     so upstream data that changed is picked up on schedule.
 *
 * `get` returns undefined only on a miss, so a stored null — a definitive
 * "nothing here" — is a hit. What NOT to store is the caller's job: a
 * transient failure (non-OK status, timeout, network error) must never be
 * set, or one blip is served as data until the entry expires.
 */
export type BoundedCache<V> = {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  /** Live entry count, after the same sweep a get runs. Test hook. */
  size(): number;
  clear(): void;
};

export function createBoundedCache<V>(ttlMs: number, maxEntries: number): BoundedCache<V> {
  const entries = new Map<string, { at: number; value: V }>();
  const sweep = (now: number) => {
    for (const [key, entry] of entries) {
      if (now - entry.at >= ttlMs) entries.delete(key);
    }
  };
  return {
    get(key) {
      sweep(Date.now());
      const hit = entries.get(key);
      if (!hit) return undefined;
      // Refresh recency: delete + set moves the key to the tail. `at` is kept.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      const now = Date.now();
      sweep(now);
      entries.delete(key);
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      entries.set(key, { at: now, value });
    },
    size() {
      sweep(Date.now());
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}
