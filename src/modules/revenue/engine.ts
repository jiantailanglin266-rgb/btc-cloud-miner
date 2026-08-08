/**
 * MiningRevenueEngine — 収益計算エンジン
 *
 * ★ このファイルは純関数のみ。他モジュール・DB・外部 API を一切 import しない。
 *   理由: 金額計算はシステムの中で最も「間違ってはいけない」部分であり、
 *   入力と出力だけで完全にテストできる状態を保つ必要があるため。
 *
 * ─────────────────────────────────────────────────────────────────
 * 計算の根拠（Bitcoin のマイニング数学）
 * ─────────────────────────────────────────────────────────────────
 *
 * Bitcoin は「difficulty（難易度）」という値で、ブロックを見つける難しさを表す。
 * 難易度 D のとき、1 ブロックを見つけるのに平均で必要なハッシュ計算回数は:
 *
 *     D × 2^32   （2^32 = 4,294,967,296）
 *
 * したがって、毎秒 h 回ハッシュ計算できるマイナーが 1 日（86,400秒）で
 * 見つけられるブロック数の期待値は:
 *
 *     blocks/day = 86400 × h / (D × 2^32)
 *
 * 1 ブロックの報酬が R BTC なら:
 *
 *     BTC/day = R × 86400 × h / (D × 2^32)
 *
 * これに稼働率（uptime）を掛けたものが推定採掘量。
 *
 * ★ これは「期待値」であって確定値ではない。
 *   実際の採掘はランダムなので、短期では大きくぶれる。
 *   プールに参加している場合はプールの支払方式で平滑化される。
 *
 * ─────────────────────────────────────────────────────────────────
 * 電力コスト
 * ─────────────────────────────────────────────────────────────────
 *     消費電力(W) = hashrate(TH/s) × efficiency(J/TH)
 *     1日の消費電力量(kWh) = W × 24 / 1000
 *     電力コスト = kWh × 単価
 *
 *   停止中のマイナーは電力も消費しないため、稼働率を電力にも掛ける。
 *
 * ─────────────────────────────────────────────────────────────────
 * ★★ 重要 ★★
 * 出力は必ず「推定値」であり、収益を保証するものではない。
 * `isEstimate: true` と `disclaimer` は構造上必ず含まれる（型で強制）。
 */

import type {
  RevenueInput,
  RevenueResult,
  SensitivityPoint,
  SensitivityResult,
} from "@/types";

/** 1 ブロックの発見に必要なハッシュ計算回数の係数 */
export const HASHES_PER_DIFFICULTY = 2 ** 32;
export const SECONDS_PER_DAY = 86_400;
/** 収益表示に使う「1ヶ月」の日数（30日固定。月ごとの差で数値がぶれるのを防ぐ） */
export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = 365;

export const REVENUE_DISCLAIMER =
  "これは推定値です。実際の採掘量はネットワーク難易度・BTC価格・稼働率・プールの支払方式により変動し、" +
  "収益を保証するものではありません。条件によっては損失が発生する可能性があります。";

export class RevenueInputError extends Error {}

/** 入力の妥当性を検証する。DoS と表示崩れを防ぐため上限も設ける */
function validate(input: RevenueInput): void {
  const checks: Array<[string, number, number, number]> = [
    ["hashrateThs", input.hashrateThs, 0, 10_000_000],
    ["difficulty", input.difficulty, 1, 1e18],
    ["blockRewardBtc", input.blockRewardBtc, 0, 50],
    ["btcPriceUsd", input.btcPriceUsd, 0, 100_000_000],
    ["electricityPriceKwh", input.electricityPriceKwh, 0, 100],
    ["efficiencyJPerTh", input.efficiencyJPerTh, 0, 1000],
    ["poolFeeRate", input.poolFeeRate, 0, 1],
    ["platformFeeRate", input.platformFeeRate, 0, 1],
    ["uptimeRate", input.uptimeRate, 0, 1],
  ];
  for (const [name, value, min, max] of checks) {
    if (!Number.isFinite(value)) {
      throw new RevenueInputError(`${name} が数値ではありません`);
    }
    if (value < min || value > max) {
      throw new RevenueInputError(`${name} が範囲外です（${min}〜${max}）: ${value}`);
    }
  }
  if (input.poolFeeRate + input.platformFeeRate >= 1) {
    throw new RevenueInputError("手数料率の合計が 100% 以上です");
  }
}

/**
 * 推定採掘量（BTC/日）。
 * difficulty から求める方法を主とする（difficulty が最も権威のある値のため）。
 */
export function estimateBtcPerDay(params: {
  hashrateThs: number;
  difficulty: number;
  blockRewardBtc: number;
  uptimeRate: number;
}): number {
  const hashesPerSec = params.hashrateThs * 1e12;
  const expectedBlocksPerDay =
    (SECONDS_PER_DAY * hashesPerSec) / (params.difficulty * HASHES_PER_DIFFICULTY);
  return expectedBlocksPerDay * params.blockRewardBtc * params.uptimeRate;
}

/**
 * ネットワークハッシュレートから求める方法（検算用）。
 * difficulty が取得できない場合のフォールバックにも使う。
 */
export function estimateBtcPerDayFromNetworkHashrate(params: {
  hashrateThs: number;
  networkHashrateThs: number;
  blockRewardBtc: number;
  uptimeRate: number;
}): number {
  if (params.networkHashrateThs <= 0) return 0;
  const blocksPerDay = SECONDS_PER_DAY / 600; // 平均 10 分に 1 ブロック = 144
  const share = params.hashrateThs / params.networkHashrateThs;
  return blocksPerDay * params.blockRewardBtc * share * params.uptimeRate;
}

/** 消費電力（kW）。稼働率を反映する */
export function powerConsumptionKw(params: {
  hashrateThs: number;
  efficiencyJPerTh: number;
  uptimeRate: number;
}): number {
  // J/TH × TH/s = J/s = W
  const watts = params.hashrateThs * params.efficiencyJPerTh;
  return (watts / 1000) * params.uptimeRate;
}

/**
 * メインの計算。
 *
 * 手数料の適用順序（この順序を変えると金額が変わるので固定する）:
 *   1. 総収益 = 推定BTC × 価格
 *   2. プール手数料 = 総収益 × poolFeeRate
 *   3. プラットフォーム手数料 = 総収益 × platformFeeRate
 *   4. 電力コスト = 消費電力量 × 単価
 *   5. 純収益 = 総収益 − プール手数料 − プラットフォーム手数料 − 電力コスト
 */
export function calculateRevenue(input: RevenueInput): RevenueResult {
  validate(input);

  const btcPerDay = estimateBtcPerDay({
    hashrateThs: input.hashrateThs,
    difficulty: input.difficulty,
    blockRewardBtc: input.blockRewardBtc,
    uptimeRate: input.uptimeRate,
  });

  const kw = powerConsumptionKw({
    hashrateThs: input.hashrateThs,
    efficiencyJPerTh: input.efficiencyJPerTh,
    uptimeRate: input.uptimeRate,
  });
  const kwhPerDay = kw * 24;

  const grossPerDay = btcPerDay * input.btcPriceUsd;
  const poolFee = grossPerDay * input.poolFeeRate;
  const platformFee = grossPerDay * input.platformFeeRate;
  const electricity = kwhPerDay * input.electricityPriceKwh;
  const netPerDay = grossPerDay - poolFee - platformFee - electricity;

  const feeRateTotal = input.poolFeeRate + input.platformFeeRate;

  /**
   * 損益分岐 BTC 価格:
   *   netPerDay = 0 となる価格
   *   btcPerDay × P × (1 − 手数料率合計) − 電力コスト = 0
   *   P = 電力コスト / (btcPerDay × (1 − 手数料率合計))
   */
  const breakEvenBtcPriceUsd =
    btcPerDay > 0 && feeRateTotal < 1
      ? electricity / (btcPerDay * (1 - feeRateTotal))
      : Number.POSITIVE_INFINITY;

  /**
   * 損益分岐 電力単価:
   *   総収益 × (1 − 手数料率合計) = kWh × 単価
   *   単価 = 総収益 × (1 − 手数料率合計) / kWh
   */
  const breakEvenElectricityPriceKwh =
    kwhPerDay > 0
      ? (grossPerDay * (1 - feeRateTotal)) / kwhPerDay
      : Number.POSITIVE_INFINITY;

  const upfront = input.upfrontCostUsd ?? 0;
  // 純収益が 0 以下なら回収不能（null）。「いつか回収できる」と誤解させない
  const roiDays = upfront > 0 && netPerDay > 0 ? upfront / netPerDay : null;

  return {
    isEstimate: true,
    estimatedBtcPerDay: btcPerDay,
    estimatedBtcPerMonth: btcPerDay * DAYS_PER_MONTH,
    estimatedBtcPerYear: btcPerDay * DAYS_PER_YEAR,
    grossRevenueUsdPerDay: grossPerDay,
    electricityCostUsdPerDay: electricity,
    poolFeeUsdPerDay: poolFee,
    platformFeeUsdPerDay: platformFee,
    netRevenueUsdPerDay: netPerDay,
    netRevenueUsdPerMonth: netPerDay * DAYS_PER_MONTH,
    profitMargin: grossPerDay > 0 ? netPerDay / grossPerDay : 0,
    breakEvenBtcPriceUsd,
    breakEvenElectricityPriceKwh,
    roiDays,
    powerConsumptionKw: kw,
    disclaimer: REVENUE_DISCLAIMER,
  };
}

/**
 * 感度分析。
 * 「今の条件で儲かる」だけを見せるのは不誠実なので、
 * 悪化シナリオ（価格下落・難易度上昇・電力高騰）を必ず併せて出す。
 */
export function calculateSensitivity(input: RevenueInput): SensitivityResult {
  const priceFactors = [0.5, 0.7, 0.85, 1.0, 1.25, 1.5];
  const difficultyFactors = [0.9, 1.0, 1.1, 1.2, 1.3];
  const electricityFactors = [0.5, 1.0, 1.5, 2.0];

  const point = (label: string, factor: number, patch: Partial<RevenueInput>): SensitivityPoint => {
    const r = calculateRevenue({ ...input, ...patch });
    return {
      label,
      factor,
      netRevenueUsdPerDay: r.netRevenueUsdPerDay,
      profitMargin: r.profitMargin,
    };
  };

  return {
    btcPrice: priceFactors.map((f) =>
      point(`価格 ${signed(f)}`, f, { btcPriceUsd: input.btcPriceUsd * f }),
    ),
    difficulty: difficultyFactors.map((f) =>
      point(`難易度 ${signed(f)}`, f, {
        difficulty: input.difficulty * f,
        networkHashrateThs: input.networkHashrateThs * f,
      }),
    ),
    electricityPrice: electricityFactors.map((f) =>
      point(`電力 ${signed(f)}`, f, {
        electricityPriceKwh: input.electricityPriceKwh * f,
      }),
    ),
  };
}

function signed(factor: number): string {
  const pct = Math.round((factor - 1) * 100);
  if (pct === 0) return "現状";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * 難易度の推定変化率から、N 日後の推定収益を出す。
 * 難易度は約 2 週間ごとに調整され、長期的には上昇傾向にある。
 * 「今の収益がずっと続く」と誤解させないために使う。
 */
export function projectRevenueOverTime(
  input: RevenueInput,
  days: number,
  /** 1回の調整あたりの難易度上昇率（例 0.02 = +2%）。約14日ごとに適用 */
  difficultyGrowthPerAdjustment = 0.02,
): { day: number; cumulativeBtc: number; cumulativeNetUsd: number }[] {
  const out: { day: number; cumulativeBtc: number; cumulativeNetUsd: number }[] = [];
  let difficulty = input.difficulty;
  let cumulativeBtc = 0;
  let cumulativeNetUsd = 0;

  for (let day = 1; day <= days; day++) {
    if (day > 1 && day % 14 === 1) {
      difficulty *= 1 + difficultyGrowthPerAdjustment;
    }
    const r = calculateRevenue({ ...input, difficulty });
    cumulativeBtc += r.estimatedBtcPerDay;
    cumulativeNetUsd += r.netRevenueUsdPerDay;
    out.push({ day, cumulativeBtc, cumulativeNetUsd });
  }
  return out;
}
