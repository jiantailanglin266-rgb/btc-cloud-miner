/**
 * Capital Allocation Engine + Risk Limits（フェーズ16・17）— 純関数
 *
 * ★ 「利益が出そうだから全資金投入」を構造的に禁止する。
 *   ベースは資金の一定割合 × マージン・信頼度・ボラティリティ・直近成績による減額。
 *   すべての係数が式で説明可能（ブラックボックスなし）。
 */

import { toSat, fromSat } from "@/lib/decimal";

export type PositionInput = {
  /** 口座資金（NiceHash 側の利用可能 BTC） */
  availableBtc: string;
  expectedMarginRate: number;
  confidence: number;
  /** 市場ボラティリティの目安（価格変動係数 0〜1。高いほど縮小） */
  volatility: number;
  /** 直近の戦略 PnL（BTC。マイナスなら縮小） */
  recentPnlBtc: string;
  /** 現在のドローダウン率（0〜1） */
  drawdownRate: number;
  /** コスト密度（BTC/TH/day）。推奨ハッシュレートの換算に使う */
  costBtcPerThDay: number;
  maxRuntimeSec: number;
};

export type RiskLimits = {
  maxOrderBtc: string;
  maxDailySpendBtc: string;
  maxDailyLossBtc: string;
  maxConcurrentOrders: number;
  maxHashrateThs: number;
  maxDrawdownRate: number;
};

export type RiskState = {
  daySpentBtc: string;
  dayPnlBtc: string;
  activeOrderCount: number;
  activeHashrateThs: number;
  drawdownRate: number;
};

export type PositionResult = {
  recommendedThs: number;
  maxSpendBtc: string;
  maxOrderDurationSec: number;
  /** 配分率の内訳（説明可能性） */
  breakdown: {
    baseFraction: number;
    marginFactor: number;
    confidenceFactor: number;
    volatilityFactor: number;
    pnlFactor: number;
    finalFraction: number;
  };
};

export class RiskLimitError extends Error {}

/** 資金の最大 10% を上限に、状況で減額していく */
const BASE_FRACTION = 0.1;

export function sizePosition(input: PositionInput): PositionResult {
  const availSat = toSat(input.availableBtc);

  // マージンが厚いほど大きく（8%→x0.5、20%以上→x1.0 の線形）
  const marginFactor = clamp((input.expectedMarginRate - 0.08) / 0.12, 0, 1) * 0.5 + 0.5;
  // 信頼度そのまま係数に
  const confidenceFactor = clamp(input.confidence, 0, 1);
  // ボラティリティが高いほど縮小（0→1.0、1→0.3）
  const volatilityFactor = 1 - clamp(input.volatility, 0, 1) * 0.7;
  // 直近 PnL がマイナスなら半減（連敗時に張り続けない）
  const pnlFactor = toSat(input.recentPnlBtc) < 0n ? 0.5 : 1.0;

  const finalFraction =
    BASE_FRACTION * marginFactor * confidenceFactor * volatilityFactor * pnlFactor;

  const spendSat = (availSat * BigInt(Math.round(finalFraction * 10_000))) / 10_000n;
  const maxSpendBtc = fromSat(spendSat);

  // 支出予算と期間から発注ハッシュレートを逆算
  const days = input.maxRuntimeSec / 86_400;
  const recommendedThs =
    input.costBtcPerThDay > 0 && days > 0
      ? Number(maxSpendBtc) / (input.costBtcPerThDay * days)
      : 0;

  return {
    recommendedThs: Math.max(0, Math.floor(recommendedThs * 100) / 100),
    maxSpendBtc,
    maxOrderDurationSec: input.maxRuntimeSec,
    breakdown: {
      baseFraction: BASE_FRACTION,
      marginFactor: round3(marginFactor),
      confidenceFactor: round3(confidenceFactor),
      volatilityFactor: round3(volatilityFactor),
      pnlFactor,
      finalFraction: round3(finalFraction),
    },
  };
}

/**
 * リスク上限の検査（フェーズ17・38）。
 * 1 つでも超過していれば理由の配列を返す（空配列 = OK）。
 */
export function checkRiskLimits(
  limits: RiskLimits,
  state: RiskState,
  proposal: { spendBtc: string; hashrateThs: number },
): string[] {
  const violations: string[] = [];

  if (toSat(proposal.spendBtc) > toSat(limits.maxOrderBtc)) {
    violations.push(
      `1注文の上限超過: ${proposal.spendBtc} > MAX_ORDER_BTC ${limits.maxOrderBtc}`,
    );
  }
  const projectedSpend = toSat(state.daySpentBtc) + toSat(proposal.spendBtc);
  if (projectedSpend > toSat(limits.maxDailySpendBtc)) {
    violations.push(
      `日次支出上限超過: ${fromSat(projectedSpend)} > MAX_DAILY_SPEND_BTC ${limits.maxDailySpendBtc}`,
    );
  }
  if (toSat(state.dayPnlBtc) < -toSat(limits.maxDailyLossBtc)) {
    violations.push(
      `日次損失上限到達: ${state.dayPnlBtc} < -MAX_DAILY_LOSS_BTC ${limits.maxDailyLossBtc}`,
    );
  }
  if (state.activeOrderCount >= limits.maxConcurrentOrders) {
    violations.push(
      `同時注文数上限: ${state.activeOrderCount} >= MAX_CONCURRENT_ORDERS ${limits.maxConcurrentOrders}`,
    );
  }
  if (state.activeHashrateThs + proposal.hashrateThs > limits.maxHashrateThs) {
    violations.push(
      `ハッシュレート上限超過: ${(state.activeHashrateThs + proposal.hashrateThs).toFixed(0)} > MAX_HASHRATE_THS ${limits.maxHashrateThs}`,
    );
  }
  if (state.drawdownRate >= limits.maxDrawdownRate) {
    violations.push(
      `最大ドローダウン到達: ${(state.drawdownRate * 100).toFixed(1)}% >= ${(limits.maxDrawdownRate * 100).toFixed(0)}%`,
    );
  }
  return violations;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
