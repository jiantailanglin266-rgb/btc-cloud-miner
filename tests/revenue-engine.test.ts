/**
 * MiningRevenueEngine のテスト
 *
 * 金額計算はシステムの中で最も間違ってはいけない部分。
 * 既知のパラメータでの期待値を「固定値」としてテストに埋め込み、
 * 将来の変更で計算式が変わったら必ずテストが落ちるようにする。
 */

import { describe, it, expect } from "vitest";
import {
  calculateRevenue,
  calculateSensitivity,
  estimateBtcPerDay,
  estimateBtcPerDayFromNetworkHashrate,
  projectRevenueOverTime,
  RevenueInputError,
  REVENUE_DISCLAIMER,
} from "@/modules/revenue/engine";
import type { RevenueInput } from "@/types";

/** docs/コスト構造.md の試算例と同一パラメータ */
const BASE: RevenueInput = {
  hashrateThs: 500,
  networkHashrateThs: 904_800_000,
  difficulty: 126.4e12,
  blockRewardBtc: 3.125,
  btcPriceUsd: 95_000,
  electricityPriceKwh: 0.06,
  efficiencyJPerTh: 17.5,
  poolFeeRate: 0.02,
  platformFeeRate: 0.02,
  uptimeRate: 0.985,
  upfrontCostUsd: 3000,
};

describe("estimateBtcPerDay", () => {
  it("既知のパラメータで docs の試算例と一致する", () => {
    const btc = estimateBtcPerDay({
      hashrateThs: 500,
      difficulty: 126.4e12,
      blockRewardBtc: 3.125,
      uptimeRate: 0.985,
    });
    // docs/コスト構造.md: 0.00024494 BTC/day
    expect(btc).toBeCloseTo(0.00024494, 7);
  });

  it("difficulty 由来と networkHashrate 由来の計算が近似する（相互検算）", () => {
    const fromDifficulty = estimateBtcPerDay({
      hashrateThs: 500,
      difficulty: BASE.difficulty,
      blockRewardBtc: 3.125,
      uptimeRate: 1,
    });
    const fromHashrate = estimateBtcPerDayFromNetworkHashrate({
      hashrateThs: 500,
      networkHashrateThs: (BASE.difficulty * 2 ** 32) / 600 / 1e12,
      blockRewardBtc: 3.125,
      uptimeRate: 1,
    });
    expect(fromDifficulty).toBeCloseTo(fromHashrate, 10);
  });

  it("ハッシュレートに比例する", () => {
    const x1 = estimateBtcPerDay({ hashrateThs: 100, difficulty: 1e14, blockRewardBtc: 3.125, uptimeRate: 1 });
    const x2 = estimateBtcPerDay({ hashrateThs: 200, difficulty: 1e14, blockRewardBtc: 3.125, uptimeRate: 1 });
    expect(x2 / x1).toBeCloseTo(2, 10);
  });

  it("難易度に反比例する", () => {
    const x1 = estimateBtcPerDay({ hashrateThs: 500, difficulty: 1e14, blockRewardBtc: 3.125, uptimeRate: 1 });
    const x2 = estimateBtcPerDay({ hashrateThs: 500, difficulty: 2e14, blockRewardBtc: 3.125, uptimeRate: 1 });
    expect(x1 / x2).toBeCloseTo(2, 10);
  });
});

describe("calculateRevenue", () => {
  const r = calculateRevenue(BASE);

  it("docs のコスト構造の試算例と一致する（固定値）", () => {
    expect(r.grossRevenueUsdPerDay).toBeCloseTo(23.27, 1);
    expect(r.electricityCostUsdPerDay).toBeCloseTo(12.41, 1);
    expect(r.poolFeeUsdPerDay).toBeCloseTo(0.47, 1);
    expect(r.platformFeeUsdPerDay).toBeCloseTo(0.47, 1);
    expect(r.netRevenueUsdPerDay).toBeCloseTo(9.93, 1);
    expect(r.profitMargin).toBeCloseTo(0.427, 2);
    expect(r.breakEvenBtcPriceUsd).toBeCloseTo(52_780, -2);
    expect(r.breakEvenElectricityPriceKwh).toBeCloseTo(0.108, 3);
    expect(r.powerConsumptionKw).toBeCloseTo(8.62, 1);
  });

  it("★ isEstimate と disclaimer が必ず含まれる（コンプライアンス要件）", () => {
    expect(r.isEstimate).toBe(true);
    expect(r.disclaimer).toBe(REVENUE_DISCLAIMER);
    expect(r.disclaimer).toContain("推定");
    expect(r.disclaimer).toContain("保証するものではありません");
    // 保証をうたう語を含まないこと
    expect(r.disclaimer).not.toMatch(/必ず|確実|元本保証/);
  });

  it("収支の恒等式: gross = net + electricity + poolFee + platformFee", () => {
    const sum =
      r.netRevenueUsdPerDay +
      r.electricityCostUsdPerDay +
      r.poolFeeUsdPerDay +
      r.platformFeeUsdPerDay;
    expect(sum).toBeCloseTo(r.grossRevenueUsdPerDay, 8);
  });

  it("損益分岐 BTC 価格では純収益がゼロになる", () => {
    const atBreakEven = calculateRevenue({ ...BASE, btcPriceUsd: r.breakEvenBtcPriceUsd });
    expect(atBreakEven.netRevenueUsdPerDay).toBeCloseTo(0, 6);
  });

  it("損益分岐 電力単価では純収益がゼロになる", () => {
    const atBreakEven = calculateRevenue({
      ...BASE,
      electricityPriceKwh: r.breakEvenElectricityPriceKwh,
    });
    expect(atBreakEven.netRevenueUsdPerDay).toBeCloseTo(0, 6);
  });

  it("赤字条件では roiDays が null（回収可能に見せない）", () => {
    const losing = calculateRevenue({ ...BASE, btcPriceUsd: 20_000 });
    expect(losing.netRevenueUsdPerDay).toBeLessThan(0);
    expect(losing.roiDays).toBeNull();
  });

  it("ROI = 初期費用 ÷ 日次純収益", () => {
    expect(r.roiDays).toBeCloseTo(3000 / r.netRevenueUsdPerDay, 6);
  });

  it("稼働率ゼロなら収益も電力もゼロ", () => {
    const idle = calculateRevenue({ ...BASE, uptimeRate: 0 });
    expect(idle.estimatedBtcPerDay).toBe(0);
    expect(idle.electricityCostUsdPerDay).toBe(0);
  });

  it("不正入力を拒否する", () => {
    expect(() => calculateRevenue({ ...BASE, hashrateThs: -1 })).toThrow(RevenueInputError);
    expect(() => calculateRevenue({ ...BASE, hashrateThs: NaN })).toThrow(RevenueInputError);
    expect(() => calculateRevenue({ ...BASE, difficulty: 0 })).toThrow(RevenueInputError);
    expect(() => calculateRevenue({ ...BASE, poolFeeRate: 0.6, platformFeeRate: 0.5 })).toThrow(
      RevenueInputError,
    );
    expect(() => calculateRevenue({ ...BASE, uptimeRate: 1.5 })).toThrow(RevenueInputError);
    expect(() =>
      calculateRevenue({ ...BASE, hashrateThs: 20_000_000 }),
    ).toThrow(RevenueInputError);
  });
});

describe("calculateSensitivity", () => {
  const s = calculateSensitivity(BASE);

  it("価格・難易度・電力の3軸を返す", () => {
    expect(s.btcPrice.length).toBeGreaterThan(3);
    expect(s.difficulty.length).toBeGreaterThan(3);
    expect(s.electricityPrice.length).toBeGreaterThan(2);
  });

  it("価格 -50% は現状より悪化する（悪化シナリオを隠さない）", () => {
    const half = s.btcPrice.find((p) => p.factor === 0.5)!;
    const current = s.btcPrice.find((p) => p.factor === 1.0)!;
    expect(half.netRevenueUsdPerDay).toBeLessThan(current.netRevenueUsdPerDay);
  });

  it("難易度 +30% は現状より悪化する", () => {
    const up = s.difficulty.find((p) => p.factor === 1.3)!;
    const current = s.difficulty.find((p) => p.factor === 1.0)!;
    expect(up.netRevenueUsdPerDay).toBeLessThan(current.netRevenueUsdPerDay);
  });
});

describe("projectRevenueOverTime", () => {
  it("難易度上昇により日次収益は逓減する（累積の増分が減る）", () => {
    const proj = projectRevenueOverTime(BASE, 90, 0.02);
    const first30 = proj[29].cumulativeBtc;
    const second30 = proj[59].cumulativeBtc - proj[29].cumulativeBtc;
    const third30 = proj[89].cumulativeBtc - proj[59].cumulativeBtc;
    expect(second30).toBeLessThan(first30);
    expect(third30).toBeLessThan(second30);
  });

  it("累積は単調増加する", () => {
    const proj = projectRevenueOverTime(BASE, 30);
    for (let i = 1; i < proj.length; i++) {
      expect(proj[i].cumulativeBtc).toBeGreaterThan(proj[i - 1].cumulativeBtc);
    }
  });
});
