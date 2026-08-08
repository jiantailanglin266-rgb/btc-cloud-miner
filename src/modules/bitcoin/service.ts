/**
 * BitcoinNetworkService — Bitcoin ネットワーク情報と価格の取得
 *
 * ★ 設計の要点 ★
 *   外部 API は必ず落ちる。落ちてもサービス全体を落とさないために 4 段構えにする。
 *
 *     1. キャッシュ（TTL 内）           → 即返す
 *     2. ソースを優先度順にフェイルオーバー → 成功したらキャッシュ更新
 *     3. 全ソース失敗 → stale キャッシュ  → 「古い値です」と明示して返す
 *     4. stale も無い → Mock            → 「デモ値です」と明示して返す
 *
 *   どの段でも例外を投げない。呼び出し側は必ず値を得られる。
 *   ただし freshness に「どこから来た値か・何秒前の値か」を必ず載せ、
 *   UI で正直に表示する（古い値を新しいふりで見せない）。
 */

import type { BitcoinNetworkInfo, BitcoinPrice, Freshness } from "@/types";
import { cache, globalKey } from "@/lib/cache";
import { config } from "@/lib/config";
import { getBreaker } from "@/lib/circuit-breaker";
import {
  buildNetworkSources,
  buildPriceSources,
  mockNetworkSource,
  mockPriceSource,
  type NetworkRaw,
  type PriceRaw,
} from "./sources";

const NETWORK_CACHE_KEY = globalKey("bitcoin", "network");
const PRICE_CACHE_KEY = globalKey("bitcoin", "price");

type Cached<T> = { data: T; source: string; fetchedAt: string };

function freshnessOf(
  entry: Cached<unknown>,
  stale: boolean,
  ageSec: number,
): Freshness {
  return { source: entry.source, fetchedAt: entry.fetchedAt, stale, ageSec };
}

/**
 * 複数ソースからのフェイルオーバー取得。
 * 各ソースは独立した circuit breaker を持つので、
 * 落ちているソースを毎回叩いて遅くなることがない。
 */
async function fetchWithFailover<T>(
  sources: Array<{ name: string; fetch: () => Promise<T> }>,
  label: string,
): Promise<Cached<T> | null> {
  const errors: string[] = [];

  for (const source of sources) {
    const breaker = getBreaker({
      name: `${label}:${source.name}`,
      failureThreshold: 3,
      resetMs: 60_000,
      timeoutMs: 6_000,
    });
    try {
      // フェイルオーバー先が控えているので、1ソースあたりのリトライは 1 回に留める
      const data = await breaker.run(() => source.fetch(), 1);
      return { data, source: source.name, fetchedAt: new Date().toISOString() };
    } catch (err) {
      errors.push(`${source.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.warn(`[bitcoin] 全ソースの取得に失敗しました (${label})`, errors);
  return null;
}

// ---------------------------------------------------------------------------
// ネットワーク情報
// ---------------------------------------------------------------------------

export async function getNetworkInfo(): Promise<BitcoinNetworkInfo> {
  const hit = cache.get<Cached<NetworkRaw>>(NETWORK_CACHE_KEY);

  // ① TTL 内のキャッシュ
  if (hit && !hit.stale) {
    return { ...hit.value.data, freshness: freshnessOf(hit.value, false, hit.ageSec) };
  }

  // ② ソースからの取得
  const fetched = await fetchWithFailover(buildNetworkSources(), "bitcoin-network");
  if (fetched) {
    cache.set(
      NETWORK_CACHE_KEY,
      fetched,
      config.bitcoin.cacheTtlSec,
      config.bitcoin.staleMaxSec,
    );
    return { ...fetched.data, freshness: freshnessOf(fetched, false, 0) };
  }

  // ③ stale キャッシュ
  if (hit) {
    return { ...hit.value.data, freshness: freshnessOf(hit.value, true, hit.ageSec) };
  }

  // ④ 最終手段: Mock（ここに来るのは起動直後に全ソースが落ちている場合のみ）
  const mock = await mockNetworkSource.fetch();
  const entry: Cached<NetworkRaw> = {
    data: mock,
    source: "mock(fallback)",
    fetchedAt: new Date().toISOString(),
  };
  return { ...mock, freshness: freshnessOf(entry, true, 0) };
}

// ---------------------------------------------------------------------------
// 価格
// ---------------------------------------------------------------------------

export async function getPrice(): Promise<BitcoinPrice> {
  const hit = cache.get<Cached<PriceRaw>>(PRICE_CACHE_KEY);

  if (hit && !hit.stale) {
    return { ...hit.value.data, freshness: freshnessOf(hit.value, false, hit.ageSec) };
  }

  const fetched = await fetchWithFailover(buildPriceSources(), "bitcoin-price");
  if (fetched) {
    cache.set(PRICE_CACHE_KEY, fetched, config.price.cacheTtlSec, config.bitcoin.staleMaxSec);
    return { ...fetched.data, freshness: freshnessOf(fetched, false, 0) };
  }

  if (hit) {
    return { ...hit.value.data, freshness: freshnessOf(hit.value, true, hit.ageSec) };
  }

  const mock = await mockPriceSource.fetch();
  const entry: Cached<PriceRaw> = {
    data: mock,
    source: "mock(fallback)",
    fetchedAt: new Date().toISOString(),
  };
  return { ...mock, freshness: freshnessOf(entry, true, 0) };
}

/** ネットワーク情報と価格をまとめて取得する（ダッシュボードで使う） */
export async function getNetworkAndPrice(): Promise<{
  network: BitcoinNetworkInfo;
  price: BitcoinPrice;
}> {
  const [network, price] = await Promise.all([getNetworkInfo(), getPrice()]);
  return { network, price };
}

/**
 * 次回難易度調整の推定日時。
 * 残ブロック数 × 平均10分 で概算する（実際は現在のハッシュレートに依存する）。
 */
export function estimateNextAdjustmentAt(info: BitcoinNetworkInfo): string {
  const minutes = info.blocksUntilAdjustment * 10;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * 次の半減期までの残ブロック数と推定日時。
 * 「今の報酬がずっと続かない」ことを UI で示すために使う。
 */
export function nextHalving(info: BitcoinNetworkInfo): {
  height: number;
  blocksRemaining: number;
  estimatedAt: string;
  nextRewardBtc: number;
} {
  const nextHalvingHeight = (Math.floor(info.blockHeight / 210_000) + 1) * 210_000;
  const blocksRemaining = nextHalvingHeight - info.blockHeight;
  return {
    height: nextHalvingHeight,
    blocksRemaining,
    estimatedAt: new Date(Date.now() + blocksRemaining * 10 * 60_000).toISOString(),
    nextRewardBtc: info.blockRewardBtc / 2,
  };
}

/** デモ値かどうか（UI のバッジ表示に使う） */
export function isMockData(freshness: Freshness): boolean {
  return freshness.source.startsWith("mock");
}
