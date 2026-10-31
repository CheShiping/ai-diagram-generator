/**
 * 极简内存限流：按 key（通常是 IP）做固定时间窗计数。
 *
 * 局限：Serverless 多实例之间不共享内存，只能挡住单实例上的高频刷取，
 * 属于「轻量防护」，不是严格的配额系统。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function consumeRateLimit(key: string, limitPerMin: number): RateLimitResult {
  if (limitPerMin <= 0) {
    return { ok: true, remaining: Infinity, retryAfterSec: 0 };
  }

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    pruneOccasionally(now);
    return { ok: true, remaining: Math.max(0, limitPerMin - 1), retryAfterSec: 0 };
  }

  if (bucket.count >= limitPerMin) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, limitPerMin - bucket.count), retryAfterSec: 0 };
}

let lastPrune = 0;
function pruneOccasionally(now: number): void {
  if (now - lastPrune < WINDOW_MS) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}
