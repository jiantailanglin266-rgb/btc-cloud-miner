/**
 * トークンバケット方式のレート制限。
 *
 * 制限値は API.md §1.6 と対応する。
 * Redis が無い場合はインメモリ（単一プロセス内でのみ有効）。
 * 複数インスタンス構成では Redis 実装に差し替えること。
 */

type Bucket = { tokens: number; lastRefillMs: number };

const g = globalThis as unknown as { __btcRateLimit?: Map<string, Bucket> };
const buckets = g.__btcRateLimit ?? new Map<string, Bucket>();
g.__btcRateLimit = buckets;

export type RateLimitRule = {
  /** 期間内に許可する回数 */
  limit: number;
  /** 期間（秒） */
  windowSec: number;
};

export const RATE_LIMITS = {
  login: { limit: 5, windowSec: 900 },
  register: { limit: 3, windowSec: 3600 },
  twoFactor: { limit: 5, windowSec: 300 },
  withdrawal: { limit: 5, windowSec: 3600 },
  simulator: { limit: 60, windowSec: 60 },
  api: { limit: 300, windowSec: 60 },
  anonymous: { limit: 60, windowSec: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const refillPerMs = rule.limit / (rule.windowSec * 1000);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: rule.limit, lastRefillMs: now };
    buckets.set(key, bucket);
  }

  // 経過時間に応じてトークンを補充
  const elapsed = now - bucket.lastRefillMs;
  bucket.tokens = Math.min(rule.limit, bucket.tokens + elapsed * refillPerMs);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    const needMs = (1 - bucket.tokens) / refillPerMs;
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil(needMs / 1000) };
  }

  bucket.tokens -= 1;
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    retryAfterSec: 0,
  };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** メモリ肥大を防ぐための掃除。満タンのバケットは捨ててよい */
export function pruneRateLimits(): void {
  for (const [key, bucket] of buckets) {
    if (Date.now() - bucket.lastRefillMs > 3600_000) buckets.delete(key);
  }
}
