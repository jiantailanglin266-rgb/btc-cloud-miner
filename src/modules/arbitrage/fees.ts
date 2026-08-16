/**
 * Performance Fee + High-Water Mark（フェーズ36・37）— 純関数
 *
 * ★ 課金対象は「実現した Actual Net Profit」のみ。
 *   Estimated Profit への課金は禁止（この関数は実現損益しか受け取らない設計）。
 * ★ High-Water Mark: 累積実現純益が過去ピークを超えた分にのみ成功報酬を課す。
 *   損失を取り戻しただけの期間に二重課金しない。
 *
 * すべて satoshi 整数（bigint）で計算する。
 */

import { toSat, fromSat } from "@/lib/decimal";

export type PerformanceFeeInput = {
  /** 期間終了時点の累積実現純益（BTC。損失なら負） */
  cumulativeRealizedPnlBtc: string;
  /** 現在の High-Water Mark（過去に成功報酬を課した時点の累積純益ピーク） */
  highWaterMarkBtc: string;
  /** 成功報酬率（0.2 = 20%） */
  performanceFeeRate: number;
};

export type PerformanceFeeResult = {
  /** 今回課金できる成功報酬（BTC）。HWM 未超過なら 0 */
  feeBtc: string;
  /** 課金後の新しい HWM */
  newHighWaterMarkBtc: string;
  /** HWM を超えた利益部分（課金ベース） */
  gainAboveHwmBtc: string;
};

export class PerformanceFeeError extends Error {}

export function calculatePerformanceFee(input: PerformanceFeeInput): PerformanceFeeResult {
  if (
    !Number.isFinite(input.performanceFeeRate) ||
    input.performanceFeeRate < 0 ||
    input.performanceFeeRate >= 1
  ) {
    throw new PerformanceFeeError(`成功報酬率が不正です: ${input.performanceFeeRate}`);
  }

  const pnl = toSat(input.cumulativeRealizedPnlBtc);
  const hwm = toSat(input.highWaterMarkBtc);

  // HWM 以下（損失回復中を含む）は課金ゼロ・HWM 据え置き
  if (pnl <= hwm) {
    return {
      feeBtc: "0.00000000",
      newHighWaterMarkBtc: fromSat(hwm),
      gainAboveHwmBtc: "0.00000000",
    };
  }

  const gain = pnl - hwm;
  const rateScaled = BigInt(Math.round(input.performanceFeeRate * 1e6));
  const fee = (gain * rateScaled) / 1_000_000n; // 切り捨て（顧客有利）

  return {
    feeBtc: fromSat(fee),
    newHighWaterMarkBtc: fromSat(pnl), // 課金した時点の累積純益が新しいピーク
    gainAboveHwmBtc: fromSat(gain),
  };
}
