/** Sliding-window rate limiter, in memory, keyed per user. */
export function createRateLimiter({ limit, windowMs = 60_000 }) {
  const hits = new Map();

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, windowMs).unref();

  return {
    /** Returns { ok, retryAfterSec }. Records the hit when ok. */
    check(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => t > now - windowMs);
      if (arr.length >= limit) {
        hits.set(key, arr);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
      }
      arr.push(now);
      hits.set(key, arr);
      return { ok: true, retryAfterSec: 0 };
    },
  };
}
