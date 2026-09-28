// In-process stand-ins for the HTTP upstreams a lookup module calls, shared by
// the lookup-cache checks (check:lookup-caches, check:streetview-geolocate-caches).
// Nothing leaves the machine: an unknown URL is rejected.

/**
 * Replace globalThis.fetch. Each request goes to the upstream whose URL prefix
 * it starts with (longest prefix wins, so ".../streetview/metadata" beats
 * ".../streetview"), is counted in `calls[name]`, and is answered by
 * `responder[name](url, init)` — which a check swaps per scenario.
 */
export function stubUpstreams(prefixes) {
  const names = Object.keys(prefixes).sort((a, b) => prefixes[b].length - prefixes[a].length);
  const responder = {};
  const calls = Object.fromEntries(names.map((n) => [n, 0]));
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const name = names.find((n) => url.startsWith(prefixes[n]));
    if (!name) return Promise.reject(new Error(`fetch stub: unexpected upstream ${url}`));
    calls[name]++;
    return Promise.resolve().then(() => responder[name](url, init));
  };
  return { responder, calls };
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** An upstream that never answers: the request settles only when the caller's
 *  own AbortController fires — which is what a timeout is. */
export const never = (_url, init) => {
  if (!init?.signal) return Promise.reject(new Error("request carries no abort signal: a real hang would never end"));
  return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
};

/** Run fn with every timer due at once, so a module's request timeout
 *  (setTimeout -> AbortController.abort) fires now instead of in seconds. */
export async function withTimeoutsDueNow(fn) {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (cb, _ms, ...args) => realSetTimeout(cb, 0, ...args);
  try { return await fn(); } finally { globalThis.setTimeout = realSetTimeout; }
}

/**
 * The bound every lookup cache must keep (src/lib/bounded-cache.ts): at most
 * `max` entries, the least recently USED evicted first (a hit refreshes
 * recency), and past `ttl` every entry deleted — not merely skipped — with
 * the TTL running from the fetch, so a hit does not extend it.
 *   fresh()      -> a key no earlier lookup has used
 *   lookup(key)  -> one lookup the upstream answers successfully; resolves to
 *                   the number of upstream requests it made (0 = from memory;
 *                   a miss may take more than one, e.g. metadata + image)
 *   size()       -> the cache's live entry count
 * `ok(cond, msg)` is the calling check's reporter.
 */
export async function checkBounded(ok, { max, ttl, size, fresh, lookup }) {
  if (!(Number.isInteger(max) && max > 0 && Number.isFinite(ttl) && ttl > 0 && Number.isInteger(size()))) {
    ok(false, `exports an entry cap, a TTL and a size hook (got max=${max}, ttl=${ttl}, size=${size()})`);
    return;
  }
  const fetched = async (key) => (await lookup(key)) > 0;
  const count = max + 4;
  const keys = Array.from({ length: count }, fresh);
  let misses = 0;
  for (const k of keys) if (await fetched(k)) misses++;
  ok(misses === count && size() === max, `${count} distinct keys: ${misses} fetched, cache holds ${size()} (cap ${max})`);
  ok(!(await fetched(keys[count - 1])), "the newest key is still cached");
  ok((await fetched(keys[0])) && size() === max, "the oldest key was evicted (asked again) and the cap still holds");
  // LRU, not FIFO: keys 0..3 fell out, then key 4 was evicted for key 0's
  // re-fetch, so key 5 is the oldest survivor. Touch it, add max - 1 fresh
  // keys (enough to evict everything older than it), and it must survive
  // while its untouched neighbour goes.
  const keep = count - max + 1;
  ok(!(await fetched(keys[keep])), `key ${keep} (the oldest survivor) is still cached`);
  for (let i = 0; i < max - 1; i++) await lookup(fresh());
  ok(!(await fetched(keys[keep])) && size() === max,
    `a recently read key survives ${max - 1} newer inserts (LRU — under FIFO it would have gone first)`);
  ok(await fetched(keys[keep + 1]), `its untouched neighbour (key ${keep + 1}) was evicted instead`);

  // TTL: runs from the fetch, a hit does not extend it, expiry deletes.
  const realNow = Date.now;
  const key = fresh();
  const t0 = realNow(); // before the fetch, so the entry expires at or after t0 + ttl
  await lookup(key);
  try {
    Date.now = () => t0 + ttl - 1000;
    ok(!(await fetched(key)), "an entry is still served just before its TTL");
    Date.now = () => t0 + ttl + 1000;
    ok(size() === 0, "past the TTL every entry is deleted, not merely skipped");
    ok((await fetched(key)) && size() === 1,
      "the entry read just before its TTL expired on schedule (a hit does not extend it) and is fetched afresh");
  } finally {
    Date.now = realNow;
  }
}
