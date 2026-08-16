/**
 * 実測パラメータ（精密化 #2・#3）
 *
 * 従来は pool 効率 0.97・reject 率 1%・ボラティリティ 0.3 を固定値で使っていた。
 * ここでは自システムが蓄積した実データから測定し、
 * データが不足する場合のみ既定値へフォールバックする（出所を必ず返す）。
 */

import type { MarketSample, WorkerSnapshot } from "@/types";
import { getStore } from "@/lib/store";

export type MeasuredPoolPerformance = {
  /** 実効/定格 の実測平均（プール効率の代理指標） */
  efficiency: number;
  rejectRate: number;
  /** 測定に使ったスナップショット数。0 なら既定値 */
  sampleCount: number;
  source: "MEASURED" | "DEFAULT";
};

export const DEFAULT_POOL_EFFICIENCY = 0.97;
export const DEFAULT_REJECT_RATE = 0.01;
export const DEFAULT_VOLATILITY = 0.3;

/** 外れ値を除いた平均（上下 10% をトリム） */
function trimmedMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.1);
  const body = sorted.slice(cut, sorted.length - cut || sorted.length);
  return body.reduce((s, v) => s + v, 0) / body.length;
}

/**
 * 直近24時間のワーカースナップショットから pool 効率と reject 率を実測する。
 * - 効率 = 実効ハッシュレート / 定格（1h平均があればそちら）をトリム平均
 * - reject 率 = Σrejected / Σ(accepted+rejected)（share 数を返すプールのみ）
 */
export async function measurePoolPerformance(
  tenantId: string,
): Promise<MeasuredPoolPerformance> {
  const store = await getStore();
  const snapshots = await store.listSnapshots(tenantId, {
    fromMs: Date.now() - 24 * 3600_000,
    limit: 5000,
  });
  // Mock 由来のスナップショットは実測に使わない（実データと混同しない）
  const live = snapshots.filter((s) => !s.source.startsWith("mock"));
  const usable = live.length >= 12 ? live : [];

  if (usable.length === 0) {
    return {
      efficiency: DEFAULT_POOL_EFFICIENCY,
      rejectRate: DEFAULT_REJECT_RATE,
      sampleCount: 0,
      source: "DEFAULT",
    };
  }

  // 効率: hashrate1h があれば current/1h の安定側を使う
  const ratios: number[] = [];
  for (const s of usable) {
    const base = s.hashrate1hThs ?? s.hashrateThs;
    if (base > 0 && s.hashrateThs > 0) {
      ratios.push(Math.min(1.1, s.hashrateThs / base));
    }
  }
  const efficiency =
    ratios.length > 0
      ? Math.max(0.5, Math.min(1.05, trimmedMean(ratios)))
      : DEFAULT_POOL_EFFICIENCY;

  // reject 率: share 数を返しているスナップショットのみで集計
  let accepted = 0;
  let rejected = 0;
  for (const s of usable) {
    accepted += s.acceptedShares;
    rejected += s.rejectedShares;
  }
  const total = accepted + rejected;
  const rejectRate =
    total > 1000 ? Math.min(0.2, rejected / total) : DEFAULT_REJECT_RATE;

  return { efficiency, rejectRate, sampleCount: usable.length, source: "MEASURED" };
}

export type MeasuredVolatility = {
  /** NiceHash 価格の変動係数（σ/μ）を 0〜1 にクランプ */
  volatility: number;
  sampleCount: number;
  source: "MEASURED" | "DEFAULT";
};

/**
 * 直近24時間の MarketSample から NiceHash 価格のボラティリティを実測する。
 * 変動係数（標準偏差/平均）をそのままポジションサイズの縮小係数に使う。
 */
export function measureVolatilityFromSamples(samples: MarketSample[]): MeasuredVolatility {
  const prices = samples
    .filter((s) => s.nicehashPriceBtcPerFactorDay > 0)
    .map((s) => s.nicehashPriceBtcPerFactorDay);
  if (prices.length < 12) {
    return { volatility: DEFAULT_VOLATILITY, sampleCount: prices.length, source: "DEFAULT" };
  }
  const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
  if (mean <= 0) {
    return { volatility: DEFAULT_VOLATILITY, sampleCount: prices.length, source: "DEFAULT" };
  }
  const variance =
    prices.reduce((s, v) => s + (v - mean) ** 2, 0) / (prices.length - 1);
  const cov = Math.sqrt(variance) / mean;
  // CoV は日中変動で概ね 0.02〜0.3。サイズ係数として 0〜1 に写像（×3 で感度を持たせる）
  return {
    volatility: Math.max(0, Math.min(1, cov * 3)),
    sampleCount: prices.length,
    source: "MEASURED",
  };
}

export async function measureVolatility(): Promise<MeasuredVolatility> {
  const store = await getStore();
  const samples = await store.listMarketSamples(Date.now() - 24 * 3600_000);
  return measureVolatilityFromSamples(samples);
}
