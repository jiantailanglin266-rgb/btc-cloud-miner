/**
 * 精密化のテスト
 *   #1 板 VWAP・スリッページ・深さ
 *   #2/#3 実測 pool 効率・reject・ボラティリティ（フォールバック含む）
 *   #4 データ出所係数付き信頼度
 *   #5 予測誤差の学習（注文クローズ時の EMA 更新）
 *   #6 累積 PnL によるドローダウン
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  effectivePriceForHashrate,
  depthBelowPrice,
} from "@/modules/hashpower/orderbook";
import {
  measureVolatilityFromSamples,
  DEFAULT_VOLATILITY,
} from "@/modules/arbitrage/measured";
import { decide, DATA_MODE_CONFIDENCE } from "@/modules/arbitrage/decision";
import { calculateProfitability } from "@/modules/arbitrage/engine";
import { runOpportunityScan } from "@/modules/arbitrage/scanner";
import { memoryStore, resetMemoryStore, DEFAULT_TENANT_ID } from "@/lib/store/memory";
import type { MarketSample, OrderbookLevel } from "@/types";

const PH = 1e15;

function level(price: number, speedPh: number): OrderbookLevel {
  return { priceBtcPerFactorDay: price, speedFactor: speedPh, market: "EU" };
}

describe("板 VWAP（精密化 #1）", () => {
  const book = {
    marketFactor: PH,
    // 0.0004 で 2PH、0.00042 で 3PH、0.00045 で 5PH
    levels: [level(0.0004, 2), level(0.00042, 3), level(0.00045, 5)],
  };

  it("最良レベル内に収まる量は best 価格・スリッページ 0", () => {
    const r = effectivePriceForHashrate(book, 1000); // 1PH
    expect(r.vwapPriceBtcPerFactorDay).toBeCloseTo(0.0004, 9);
    expect(r.slippageRate).toBeCloseTo(0, 9);
    expect(r.levelsUsed).toBe(1);
  });

  it("複数レベルを跨ぐと VWAP が best より高くなる（スリッページを正直に反映）", () => {
    const r = effectivePriceForHashrate(book, 4000); // 4PH = 2 + 2
    // VWAP = (0.0004×2 + 0.00042×2)/4 = 0.00041
    expect(r.vwapPriceBtcPerFactorDay).toBeCloseTo(0.00041, 9);
    expect(r.slippageRate).toBeCloseTo(0.025, 6);
    expect(r.levelsUsed).toBe(2);
  });

  it("深さ不足なら null を返す（安値をでっち上げない）", () => {
    const r = effectivePriceForHashrate(book, 20_000); // 20PH > 板全量 10PH
    expect(r.vwapPriceBtcPerFactorDay).toBeNull();
    expect(r.slippageRate).toBeNull();
    expect(r.fillableThs).toBeCloseTo(10_000, 3);
  });

  it("depthBelowPrice は上限価格以下の実在量だけを数える", () => {
    expect(depthBelowPrice(book, 0.00042)).toBeCloseTo(5000, 3); // 2+3 PH
    expect(depthBelowPrice(book, 0.0001)).toBe(0);
    expect(depthBelowPrice(book, 1)).toBeCloseTo(10_000, 3);
  });

  it("VWAP は常に best 以上・最悪レベル以下（不変条件）", () => {
    for (const ths of [500, 1500, 3000, 6000, 9999]) {
      const r = effectivePriceForHashrate(book, ths);
      if (r.vwapPriceBtcPerFactorDay !== null) {
        expect(r.vwapPriceBtcPerFactorDay).toBeGreaterThanOrEqual(0.0004);
        expect(r.vwapPriceBtcPerFactorDay).toBeLessThanOrEqual(0.00045);
      }
    }
  });
});

describe("実測ボラティリティ（精密化 #3）", () => {
  function sample(price: number, i: number): MarketSample {
    return {
      id: `s${i}`, at: new Date(Date.now() - i * 60_000).toISOString(),
      btcPriceUsd: 95000, usdJpy: 150, difficulty: 126e12,
      networkHashrateThs: 9e8, blockSubsidyBtc: 3.125, avgTxFeesBtcPerBlock: 0.05,
      nicehashPriceBtcPerFactorDay: price, nicehashAvailableFactor: 10,
      poolEfficiency: 0.97, sourceMode: "LIVE_API",
    };
  }

  it("サンプル不足時は既定値へフォールバック（出所 DEFAULT）", () => {
    const r = measureVolatilityFromSamples([sample(0.0004, 0)]);
    expect(r.source).toBe("DEFAULT");
    expect(r.volatility).toBe(DEFAULT_VOLATILITY);
  });

  it("一定価格なら volatility ≈ 0、変動が大きいほど大きい", () => {
    const flat = measureVolatilityFromSamples(
      Array.from({ length: 24 }, (_, i) => sample(0.0004, i)),
    );
    expect(flat.source).toBe("MEASURED");
    expect(flat.volatility).toBeCloseTo(0, 5);

    const wild = measureVolatilityFromSamples(
      Array.from({ length: 24 }, (_, i) => sample(0.0004 * (1 + 0.2 * (i % 2)), i)),
    );
    expect(wild.volatility).toBeGreaterThan(flat.volatility);
  });
});

describe("データ出所係数付き信頼度（精密化 #4）", () => {
  const profitability = calculateProfitability({
    btcPriceUsd: 95_000, usdJpy: 150, difficulty: 126.4e12,
    networkHashrateThs: 904_800_000, blockSubsidyBtc: 3.125, avgTxFeesBtcPerBlock: 0.05,
    poolFeeRate: 0.02, expectedPoolEfficiency: 0.97, expectedRejectRate: 0.01,
    nicehashPriceBtcPerFactorDay: 0.00032, nicehashMarketFeeRate: 0.03,
    nicehashOrderFeeBtc: 0.0001, marketFactor: 1e15, safetyMarginRate: 0.10,
    plannedSpendBtc: 0.005,
  });

  const base = {
    profitability, startMarginRate: 0.08, stopMarginRate: 0.03, minConfidence: 0.6,
    marketDataAgeSec: 10, maxDataAgeSec: 180, poolOnline: true, nicehashOnline: true,
    accountingHealthy: true, riskLimitOk: true, killSwitchOn: false,
    hasActiveOrder: false, activeOrderRuntimeSec: 0, minRuntimeSec: 300,
    maxRuntimeSec: 1800, forecastErrorEma: 0.1, depthSufficient: true,
  } as const;

  it("LIVE_API では BUY、STALE_LIVE では信頼度低下で WAIT", () => {
    expect(decide({ ...base, dataMode: "LIVE_API" }).action).toBe("BUY");
    // (1-0.1)×0.6 = 0.54 < 0.6 → WAIT
    const stale = decide({ ...base, dataMode: "STALE_LIVE" });
    expect(stale.action).toBe("WAIT");
    expect(stale.confidence).toBeCloseTo(0.9 * DATA_MODE_CONFIDENCE.STALE_LIVE, 6);
  });

  it("深さ不足では他条件を満たしても BUY しない", () => {
    const d = decide({ ...base, dataMode: "LIVE_API", depthSufficient: false });
    expect(d.action).toBe("WAIT");
    expect(d.reasons.some((r) => r.includes("深さ不足"))).toBe(true);
  });
});

describe("予測誤差の学習と累積PnL（精密化 #5・#6）", () => {
  beforeEach(() => resetMemoryStore());

  it("注文クローズで forecastErrorEma と cumulativePnlBtc が更新される", async () => {
    await memoryStore.updateArbitrageState(DEFAULT_TENANT_ID, { enabled: true });
    const before = await memoryStore.getArbitrageState(DEFAULT_TENANT_ID);

    // expected=0.0001 / mined=0.00013（誤差30%）の稼働注文を投入し、Kill Switch で閉じさせる
    await memoryStore.upsertHashpowerOrder({
      id: "hpo-learn-1", tenantId: DEFAULT_TENANT_ID, mode: "paper",
      externalOrderId: null, algorithm: "SHA256ASICBOOST", market: "EU", poolId: null,
      status: "ACTIVE", priceBtcPerFactorDay: 0.0004, marketFactor: 1e15,
      requestedThs: 100, deliveredThs: 100,
      amountBtc: "0.00500000", spentBtc: "0.00010000", minedBtc: "0.00013000",
      expectedBtc: "0.00010000",
      startedAt: new Date(Date.now() - 600_000).toISOString(), stoppedAt: null,
      decisionSnapshotId: null, reason: "test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), // dt≈0 → accrue はほぼ変化しない
    });
    await memoryStore.updateArbitrageState(DEFAULT_TENANT_ID, { enabled: false });
    await runOpportunityScan(DEFAULT_TENANT_ID);

    const after = await memoryStore.getArbitrageState(DEFAULT_TENANT_ID);
    // EMA: 0.1×0.8 + 0.3×0.2 = 0.14（±accrue の微小誤差）
    expect(after.forecastErrorEma).toBeGreaterThan(before.forecastErrorEma);
    expect(after.forecastErrorEma).toBeCloseTo(0.14, 1);
    // 累積 PnL に mined−spent ≈ +0.00003 が計上される
    expect(Number(after.cumulativePnlBtc)).toBeGreaterThan(0.000025);
  });
});
