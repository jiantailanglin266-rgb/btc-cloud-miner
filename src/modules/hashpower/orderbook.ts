/**
 * Orderbook 解析（精密化 #1: スリッページの正確な評価）— 純関数
 *
 * 従来は「板の最安値」をコストとして使っていたが、実際には必要ハッシュレートを
 * 集めるには複数の価格帯を跨ぐ必要があり、実効価格は最安値より高くなる。
 *
 * ここでは板を安い順に歩き、
 *   - 目標ハッシュレートを満たす数量加重平均価格（VWAP）
 *   - 最安値からの乖離（slippageRate）
 *   - 指定上限価格以下で調達可能なハッシュレート（深さ）
 * を厳密に計算する。
 *
 * ★ 板に十分な深さが無い場合は「埋まらない」と正直に返す（安値をでっち上げない）。
 */

import type { HashpowerOrderbook, OrderbookLevel } from "@/types";
import { speedFactorToThs, thsToSpeedFactor } from "./units";

export type EffectivePriceResult = {
  /** 目標量を満たす数量加重平均価格（BTC/factor/day）。深さ不足なら null */
  vwapPriceBtcPerFactorDay: number | null;
  /** 実際に確保できる量（TH/s）。深さ不足時は板の全量 */
  fillableThs: number;
  /** 最良価格からの乖離率（vwap/best − 1）。深さ不足なら null */
  slippageRate: number | null;
  /** 参照した価格帯数 */
  levelsUsed: number;
  bestPriceBtcPerFactorDay: number | null;
};

/**
 * 目標ハッシュレート（TH/s）を板から調達する場合の実効価格を計算する。
 * levels は価格昇順である前提（NiceHashAdapter が整列済みで渡す）。
 */
export function effectivePriceForHashrate(
  book: Pick<HashpowerOrderbook, "levels" | "marketFactor">,
  targetThs: number,
): EffectivePriceResult {
  const active = book.levels.filter((l) => l.speedFactor > 0 && l.priceBtcPerFactorDay > 0);
  if (active.length === 0 || !(targetThs > 0)) {
    return {
      vwapPriceBtcPerFactorDay: null,
      fillableThs: 0,
      slippageRate: null,
      levelsUsed: 0,
      bestPriceBtcPerFactorDay: active[0]?.priceBtcPerFactorDay ?? null,
    };
  }

  const best = active[0].priceBtcPerFactorDay;
  const targetFactor = thsToSpeedFactor(targetThs, book.marketFactor);

  let remaining = targetFactor;
  let costWeighted = 0; // Σ price × speed
  let taken = 0;
  let levelsUsed = 0;

  for (const level of active) {
    if (remaining <= 0) break;
    const take = Math.min(level.speedFactor, remaining);
    costWeighted += level.priceBtcPerFactorDay * take;
    taken += take;
    remaining -= take;
    levelsUsed++;
  }

  const fillableThs = speedFactorToThs(taken, book.marketFactor);

  if (remaining > 1e-12) {
    // 深さ不足: 全量でも足りない
    return {
      vwapPriceBtcPerFactorDay: null,
      fillableThs,
      slippageRate: null,
      levelsUsed,
      bestPriceBtcPerFactorDay: best,
    };
  }

  const vwap = costWeighted / taken;
  return {
    vwapPriceBtcPerFactorDay: vwap,
    fillableThs,
    slippageRate: best > 0 ? vwap / best - 1 : null,
    levelsUsed,
    bestPriceBtcPerFactorDay: best,
  };
}

/** 指定上限価格以下で調達可能な量（TH/s）。BUY 実行可否の深さ判定に使う */
export function depthBelowPrice(
  book: Pick<HashpowerOrderbook, "levels" | "marketFactor">,
  maxPriceBtcPerFactorDay: number,
): number {
  const factor = book.levels
    .filter(
      (l) =>
        l.speedFactor > 0 &&
        l.priceBtcPerFactorDay > 0 &&
        l.priceBtcPerFactorDay <= maxPriceBtcPerFactorDay,
    )
    .reduce((s, l) => s + l.speedFactor, 0);
  return speedFactorToThs(factor, book.marketFactor);
}

/** 板から市場ボラティリティ推定に使う中間値（レベル間の価格分散） */
export function levelPriceSpreadRate(levels: OrderbookLevel[]): number {
  const active = levels.filter((l) => l.speedFactor > 0);
  if (active.length < 2) return 0;
  const prices = active.map((l) => l.priceBtcPerFactorDay);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min > 0 ? (max - min) / min : 0;
}
