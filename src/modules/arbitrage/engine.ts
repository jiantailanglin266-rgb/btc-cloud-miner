/**
 * HashrateArbitrageEngine（フェーズ5〜8）— 本システムで最も重要な純関数群
 *
 * 「期待マイニング収益 > ハッシュパワー購入コスト + 手数料 + 安全マージン」を
 * 数値で判定するための計算。他モジュール・DB・外部 API を import しない。
 *
 * 収益の物理:
 *   1 TH/s が 1 日に採掘する期待 BTC
 *     = 86400 × 1e12 / (difficulty × 2^32) × (blockSubsidy + avgTxFees)
 *   これに pool 効率（1 − poolFee）・reject 控除・安全マージンを掛ける。
 *
 * コスト:
 *   NiceHash 価格（BTC/factor/day）→ BTC/TH/day へ単位変換し、
 *   マーケット手数料率・注文固定手数料（時間按分）を上乗せする。
 *
 * ★ すべて「期待値」。実採掘は確率的であり、この値は保証ではない。
 * ★ 出力は isEstimate 相当（Ledger には絶対に入れない）。
 */

import {
  priceFactorDayToBtcPerThDay,
  btcPerThDayToPriceFactorDay,
  perDayToPerHour,
  perDayToPerSec,
  btcToUsd,
  usdToJpy,
  HOURS_PER_DAY,
} from "@/modules/hashpower/units";

const HASHES_PER_DIFFICULTY = 2 ** 32;
const SECONDS_PER_DAY = 86_400;
const HS_PER_THS = 1e12;

export class ArbitrageInputError extends Error {}

export type ProfitabilityInput = {
  btcPriceUsd: number;
  usdJpy: number;
  difficulty: number;
  /** 検算用（difficulty を優先） */
  networkHashrateThs: number;
  blockSubsidyBtc: number;
  /** 1ブロックあたりの平均トランザクション手数料 BTC */
  avgTxFeesBtcPerBlock: number;
  poolFeeRate: number;
  /** プールの実効効率（stale/luck 込みの期待値。1.0=理論値どおり） */
  expectedPoolEfficiency: number;
  expectedRejectRate: number;
  /** NiceHash 現在価格（BTC/factor/day）。市場停止時は null */
  nicehashPriceBtcPerFactorDay: number | null;
  nicehashMarketFeeRate: number;
  nicehashOrderFeeBtc: number;
  marketFactor: number;
  /** 安全マージン（0.10 = 10%）。期待収益から差し引く */
  safetyMarginRate: number;
  /**
   * 注文予定予算（BTC）。固定注文手数料をこの予算に対する率として上乗せする。
   *   feeOverheadRate = orderFeeBtc / plannedSpendBtc
   * 予算が小さい注文ほど固定費の比重が正しく重く評価される（短時間小口の乱発を抑止）。
   */
  plannedSpendBtc: number;
};

export type ProfitabilityResult = {
  isEstimate: true;
  /** 手数料・マージン控除前の理論収益密度 */
  grossRevenueBtcPerThDay: number;
  /** pool 効率・reject・安全マージン控除後の期待収益密度 */
  expectedRevenueBtcPerThDay: number;
  expectedRevenueBtcPerThHour: number;
  expectedRevenueBtcPerThSec: number;
  /** NiceHash 総コスト密度（手数料込み）。市場価格が無ければ null */
  costBtcPerThDay: number | null;
  /** spread = expectedRevenue − cost */
  spreadBtcPerThDay: number | null;
  /** マージン率 = spread / cost */
  expectedMarginRate: number | null;
  /** この価格以下でしか買ってはいけない NiceHash 価格（BTC/factor/day） */
  breakEvenPriceBtcPerFactorDay: number;
  /** 安全マージン込みの発注上限価格。★これを超える Bid は禁止 */
  maxBidPriceBtcPerFactorDay: number;
  /** 参考: 1 PH/s 稼働時の時給換算 */
  spreadUsdPerHourAt1Ph: number | null;
  spreadJpyPerHourAt1Ph: number | null;
  disclaimer: string;
};

export const ARBITRAGE_DISCLAIMER =
  "これは期待値によるシミュレーションです。実際の採掘は確率的で、難易度・価格・配信ハッシュレートにより結果は変動し、損失が発生する可能性があります。";

function assertRange(name: string, v: number, min: number, max: number): void {
  if (!Number.isFinite(v) || v < min || v > max) {
    throw new ArbitrageInputError(`${name} が範囲外です（${min}〜${max}）: ${v}`);
  }
}

/** 1 TH/s の理論日次採掘量（手数料等を引く前） */
export function grossBtcPerThDay(
  difficulty: number,
  blockSubsidyBtc: number,
  avgTxFeesBtcPerBlock: number,
): number {
  assertRange("difficulty", difficulty, 1, 1e18);
  assertRange("blockSubsidyBtc", blockSubsidyBtc, 0, 50);
  assertRange("avgTxFeesBtcPerBlock", avgTxFeesBtcPerBlock, 0, 50);
  const blocksPerDayPerThs =
    (SECONDS_PER_DAY * HS_PER_THS) / (difficulty * HASHES_PER_DIFFICULTY);
  return blocksPerDayPerThs * (blockSubsidyBtc + avgTxFeesBtcPerBlock);
}

export function calculateProfitability(input: ProfitabilityInput): ProfitabilityResult {
  assertRange("btcPriceUsd", input.btcPriceUsd, 0.01, 1e8);
  assertRange("usdJpy", input.usdJpy, 1, 10_000);
  assertRange("poolFeeRate", input.poolFeeRate, 0, 0.2);
  assertRange("expectedPoolEfficiency", input.expectedPoolEfficiency, 0.5, 1.05);
  assertRange("expectedRejectRate", input.expectedRejectRate, 0, 0.2);
  assertRange("nicehashMarketFeeRate", input.nicehashMarketFeeRate, 0, 0.2);
  assertRange("safetyMarginRate", input.safetyMarginRate, 0, 0.5);
  assertRange("marketFactor", input.marketFactor, 1, 1e21);
  assertRange("plannedSpendBtc", input.plannedSpendBtc, 1e-6, 1000);

  const gross = grossBtcPerThDay(
    input.difficulty,
    input.blockSubsidyBtc,
    input.avgTxFeesBtcPerBlock,
  );

  // 期待収益 = 理論値 × pool効率 × (1 − poolFee) × (1 − reject) × (1 − 安全マージン)
  const expected =
    gross *
    input.expectedPoolEfficiency *
    (1 - input.poolFeeRate) *
    (1 - input.expectedRejectRate) *
    (1 - input.safetyMarginRate);

  // --- NiceHash コスト密度 --------------------------------------------------
  // 総コスト率 = マーケット手数料率 + 固定注文手数料の予算比率
  const feeOverheadRate =
    input.nicehashMarketFeeRate + input.nicehashOrderFeeBtc / input.plannedSpendBtc;

  let cost: number | null = null;
  if (input.nicehashPriceBtcPerFactorDay !== null) {
    assertRange("nicehashPrice", input.nicehashPriceBtcPerFactorDay, 0, 1000);
    const base = priceFactorDayToBtcPerThDay(
      input.nicehashPriceBtcPerFactorDay,
      input.marketFactor,
    );
    cost = base * (1 + feeOverheadRate);
  }

  const spread = cost !== null ? expected - cost : null;
  const margin = cost !== null && cost > 0 ? (spread as number) / cost : null;

  /**
   * 損益分岐 NiceHash 価格:
   *   expected = price/TH/day × (1 + 総コスト率) となる価格。
   *   これを factor/day 単位へ戻す。
   */
  const breakEvenPerThDay = expected / (1 + feeOverheadRate);
  const breakEvenPrice = btcPerThDayToPriceFactorDay(breakEvenPerThDay, input.marketFactor);

  // 発注上限 = 損益分岐のさらに内側（安全マージンは expected に織り込み済みだが、
  // 板の変動・スリッページに備えて break-even の 98% を上限とする）
  const maxBid = breakEvenPrice * 0.98;

  const spreadUsdPerHourAt1Ph =
    spread !== null
      ? btcToUsd(perDayToPerHour(spread) * 1000 /* 1PH = 1000TH */, input.btcPriceUsd)
      : null;

  return {
    isEstimate: true,
    grossRevenueBtcPerThDay: gross,
    expectedRevenueBtcPerThDay: expected,
    expectedRevenueBtcPerThHour: perDayToPerHour(expected),
    expectedRevenueBtcPerThSec: perDayToPerSec(expected),
    costBtcPerThDay: cost,
    spreadBtcPerThDay: spread,
    expectedMarginRate: margin,
    breakEvenPriceBtcPerFactorDay: breakEvenPrice,
    maxBidPriceBtcPerFactorDay: maxBid,
    spreadUsdPerHourAt1Ph,
    spreadJpyPerHourAt1Ph:
      spreadUsdPerHourAt1Ph !== null ? usdToJpy(spreadUsdPerHourAt1Ph, input.usdJpy) : null,
    disclaimer: ARBITRAGE_DISCLAIMER,
  };
}

/** 指定ハッシュレートでの期待値（表示用） */
export function expectedRevenueForHashrate(
  result: ProfitabilityResult,
  hashrateThs: number,
  btcPriceUsd: number,
  usdJpy: number,
): {
  btcPerSec: number;
  btcPerHour: number;
  btcPerDay: number;
  usdPerHour: number;
  jpyPerHour: number;
} {
  const btcPerDay = result.expectedRevenueBtcPerThDay * hashrateThs;
  const btcPerHour = btcPerDay / HOURS_PER_DAY;
  return {
    btcPerSec: result.expectedRevenueBtcPerThSec * hashrateThs,
    btcPerHour,
    btcPerDay,
    usdPerHour: btcToUsd(btcPerHour, btcPriceUsd),
    jpyPerHour: usdToJpy(btcToUsd(btcPerHour, btcPriceUsd), usdJpy),
  };
}
