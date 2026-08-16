/**
 * Decision Engine（フェーズ9〜13・25・38）— 純関数
 *
 * BUY / HOLD / STOP / WAIT を返す。
 * ★ expectedProfit > 0 だけでは絶対に BUY しない。
 *   マージン閾値（Hysteresis）・信頼度・データ鮮度・稼働時間・障害状態を全て満たすこと。
 * ★ 判断根拠（reasons）を必ず添付する（AI ブラックボックス禁止・説明可能性）。
 */

import type { ArbitrageAction } from "@/types";
import type { ProfitabilityResult } from "./engine";

export type DecisionInput = {
  profitability: ProfitabilityResult;
  /** Hysteresis: 開始閾値（例 0.08 = 8%）と停止閾値（例 0.03） */
  startMarginRate: number;
  stopMarginRate: number;
  minConfidence: number;
  /** データ鮮度（秒）。maxDataAgeSec を超えたら注文しない */
  marketDataAgeSec: number;
  maxDataAgeSec: number;
  poolOnline: boolean;
  nicehashOnline: boolean;
  /** 会計系の健全性（Ledger 不整合・Reconciliation エラー時は false） */
  accountingHealthy: boolean;
  riskLimitOk: boolean;
  killSwitchOn: boolean;
  /** 現在アクティブな注文があるか（HOLD/STOP 判定に使う） */
  hasActiveOrder: boolean;
  /** アクティブ注文の経過秒。minRuntime 未満は STOP しない（Emergency を除く） */
  activeOrderRuntimeSec: number;
  minRuntimeSec: number;
  maxRuntimeSec: number;
  /** 予測誤差 EMA（0.0〜）。信頼度の算出に使う */
  forecastErrorEma: number;
};

export type Decision = {
  action: ArbitrageAction;
  confidence: number;
  reasons: string[];
  /** 数値根拠（Explainability。Admin にそのまま表示する） */
  numbers: {
    expectedMarginRate: number | null;
    startThreshold: number;
    stopThreshold: number;
    breakEvenPrice: number;
    maxBidPrice: number;
    marketDataAgeSec: number;
  };
};

/**
 * 信頼度 = 1 − 予測誤差EMA（0〜1にクランプ）。
 * 誤差が大きい＝過去の予測が外れている＝確信を下げる。計算根拠が説明可能。
 */
export function confidenceFromForecastError(forecastErrorEma: number): number {
  if (!Number.isFinite(forecastErrorEma) || forecastErrorEma < 0) return 0;
  return Math.max(0, Math.min(1, 1 - forecastErrorEma));
}

/**
 * Adaptive Safety Margin（フェーズ25）。
 * 予測誤差 EMA に応じて安全マージンを 8%〜20% の間で線形に調整する。
 *   誤差 0%  → 8%（安定）
 *   誤差 30%以上 → 20%（保守的）
 * 完全な式で説明可能（ブラックボックスなし）。
 */
export function adaptiveSafetyMargin(forecastErrorEma: number): number {
  const e = Math.max(0, Math.min(0.3, Number.isFinite(forecastErrorEma) ? forecastErrorEma : 0.3));
  const min = 0.08;
  const max = 0.2;
  return Math.round((min + (max - min) * (e / 0.3)) * 1000) / 1000;
}

export function decide(input: DecisionInput): Decision {
  const reasons: string[] = [];
  const margin = input.profitability.expectedMarginRate;
  const confidence = confidenceFromForecastError(input.forecastErrorEma);

  const numbers = {
    expectedMarginRate: margin,
    startThreshold: input.startMarginRate,
    stopThreshold: input.stopMarginRate,
    breakEvenPrice: input.profitability.breakEvenPriceBtcPerFactorDay,
    maxBidPrice: input.profitability.maxBidPriceBtcPerFactorDay,
    marketDataAgeSec: input.marketDataAgeSec,
  };

  // --- Emergency STOP（minRuntime より優先。フェーズ12・38・39） ------------
  const emergencies: string[] = [];
  if (input.killSwitchOn) emergencies.push("Kill Switch が作動しています");
  if (!input.accountingHealthy) emergencies.push("会計系エラー（Ledger/Reconciliation）");
  if (!input.riskLimitOk) emergencies.push("リスク上限を超過しています");
  if (emergencies.length > 0) {
    return {
      action: input.hasActiveOrder ? "STOP" : "WAIT",
      confidence: 0,
      reasons: emergencies,
      numbers,
    };
  }

  // --- 市場停止・鮮度切れ ---------------------------------------------------
  if (!input.nicehashOnline) reasons.push("NiceHash に接続できません");
  if (!input.poolOnline) reasons.push("マイニングプールがオフラインです");
  if (input.marketDataAgeSec > input.maxDataAgeSec) {
    reasons.push(
      `市場データが古すぎます（${input.marketDataAgeSec}s > 許容 ${input.maxDataAgeSec}s）`,
    );
  }
  if (margin === null) reasons.push("NiceHash 価格が取得できません（板が空）");

  if (reasons.length > 0) {
    // データが信頼できない間は新規注文しない。稼働中なら停止する
    if (input.hasActiveOrder) {
      return { action: "STOP", confidence, reasons, numbers };
    }
    return { action: "WAIT", confidence, reasons, numbers };
  }

  const m = margin as number;

  // --- 稼働中: STOP 判定（Hysteresis の下側 + maxRuntime） ------------------
  if (input.hasActiveOrder) {
    if (input.activeOrderRuntimeSec >= input.maxRuntimeSec) {
      return {
        action: "STOP",
        confidence,
        reasons: [
          `最大稼働時間 ${input.maxRuntimeSec}s に到達しました。市場を再評価して必要なら再発注します`,
        ],
        numbers,
      };
    }
    if (m <= input.stopMarginRate) {
      if (input.activeOrderRuntimeSec < input.minRuntimeSec) {
        return {
          action: "HOLD",
          confidence,
          reasons: [
            `マージン ${(m * 100).toFixed(1)}% が停止閾値 ${(input.stopMarginRate * 100).toFixed(1)}% を下回りましたが、最小稼働時間 ${input.minRuntimeSec}s 未満のため継続します（振動防止）`,
          ],
          numbers,
        };
      }
      return {
        action: "STOP",
        confidence,
        reasons: [
          `期待マージン ${(m * 100).toFixed(1)}% ≤ 停止閾値 ${(input.stopMarginRate * 100).toFixed(1)}%`,
        ],
        numbers,
      };
    }
    return {
      action: "HOLD",
      confidence,
      reasons: [
        `稼働継続: マージン ${(m * 100).toFixed(1)}% > 停止閾値 ${(input.stopMarginRate * 100).toFixed(1)}%`,
      ],
      numbers,
    };
  }

  // --- 未稼働: BUY 判定（Hysteresis の上側） --------------------------------
  if (m < input.startMarginRate) {
    return {
      action: "WAIT",
      confidence,
      reasons: [
        `期待マージン ${(m * 100).toFixed(1)}% < 開始閾値 ${(input.startMarginRate * 100).toFixed(1)}%（Hysteresis: 停止閾値 ${(input.stopMarginRate * 100).toFixed(1)}% とは別）`,
      ],
      numbers,
    };
  }
  if (confidence < input.minConfidence) {
    return {
      action: "WAIT",
      confidence,
      reasons: [
        `信頼度 ${(confidence * 100).toFixed(0)}% < 最低 ${(input.minConfidence * 100).toFixed(0)}%（過去の予測誤差が大きいため見送り）`,
      ],
      numbers,
    };
  }

  return {
    action: "BUY",
    confidence,
    reasons: [
      `期待マージン ${(m * 100).toFixed(1)}% ≥ 開始閾値 ${(input.startMarginRate * 100).toFixed(1)}%`,
      `信頼度 ${(confidence * 100).toFixed(0)}% ≥ ${(input.minConfidence * 100).toFixed(0)}%`,
      "市場データは新鮮・プール/NiceHash ともにオンライン",
    ],
    numbers,
  };
}
