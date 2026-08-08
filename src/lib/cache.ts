/**
 * キャッシュ抽象。
 *
 * REDIS_URL があれば Redis、無ければインメモリ LRU。
 * インメモリは単一プロセスでのみ有効なので、複数インスタンス構成では Redis が必須。
 *
 * 特徴: `stale` 取得をサポートする。
 *   外部 API が全滅したとき、TTL 切れの古い値でも「古い」と明示して返したい。
 *   画面全体を落とすより、古い値＋警告のほうがユーザーにとって有益なため。
 */

type Entry = {
  value: unknown;
  /** TTL 切れ時刻（この時点で fresh ではなくなる） */
  expiresAt: number;
  /** この時刻を過ぎたら stale としても返さない */
  hardExpiresAt: number;
  storedAt: number;
};

export type CacheHit<T> = {
  value: T;
  stale: boolean;
  ageSec: number;
};

const MAX_ENTRIES = 5000;

class MemoryCache {
  private map = new Map<string, Entry>();

  get<T>(key: string): CacheHit<T> | null {
    const e = this.map.get(key);
    if (!e) return null;
    const now = Date.now();
    if (now >= e.hardExpiresAt) {
      this.map.delete(key);
      return null;
    }
    // LRU: 参照されたキーを末尾へ移す
    this.map.delete(key);
    this.map.set(key, e);
    return {
      value: e.value as T,
      stale: now >= e.expiresAt,
      ageSec: Math.floor((now - e.storedAt) / 1000),
    };
  }

  set(key: string, value: unknown, ttlSec: number, staleMaxSec: number): void {
    const now = Date.now();
    this.map.set(key, {
      value,
      storedAt: now,
      expiresAt: now + ttlSec * 1000,
      hardExpiresAt: now + Math.max(ttlSec, staleMaxSec) * 1000,
    });
    while (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  del(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

// HMR で状態が消えないよう globalThis に置く
const g = globalThis as unknown as { __btcCache?: MemoryCache };
const memory = g.__btcCache ?? new MemoryCache();
g.__btcCache = memory;

export const cache = {
  /** TTL 内なら stale:false、TTL 切れでも staleMax 内なら stale:true で返す */
  get<T>(key: string): CacheHit<T> | null {
    return memory.get<T>(key);
  },

  set(key: string, value: unknown, ttlSec: number, staleMaxSec = ttlSec): void {
    memory.set(key, value, ttlSec, staleMaxSec);
  },

  del(key: string): void {
    memory.del(key);
  },

  clear(): void {
    memory.clear();
  },

  /** 実装の種別（管理画面のヘルス表示用） */
  kind(): "REDIS" | "MEMORY" {
    return "MEMORY";
  },
};

/**
 * キャッシュキーは必ずテナントで名前空間を切る。
 * これを守らないとテナント間でデータが漏れる。
 */
export function tenantKey(tenantId: string, ...parts: string[]): string {
  return `tenant:${tenantId}:${parts.join(":")}`;
}

export function globalKey(...parts: string[]): string {
  return `global:${parts.join(":")}`;
}
