/**
 * NiceHash 署名・Profitability Engine・Decision Engine・Position・Fees のテスト
 */

import { describe, it, expect } from "vitest";
import { buildSignature, buildAuthHeaders } from "@/modules/hashpower/signing";
import {
  calculateProfitability,
  grossBtcPerThDay,
  ArbitrageInputError,
  type ProfitabilityInput,
} from "@/modules/arbitrage/engine";
import {
  decide,
  adaptiveSafetyMargin,
  confidenceFromForecastError,
  type DecisionInput,
} from "@/modules/arbitrage/decision";
import { sizePosition, checkRiskLimits } from "@/modules/arbitrage/position";
import { calculatePerformanceFee } from "@/modules/arbitrage/fees";
import { mockOrderbook } from "@/modules/hashpower/nicehash";

// ---------------------------------------------------------------------------
// 署名（公式デモ実装と同じ連結順序であることを固定）
// ---------------------------------------------------------------------------

describe("NiceHash 署名", () => {
  const creds = { apiKey: "key-1", apiSecret: "secret-1", organizationId: "org-1" };
  const req = {
    method: "GET",
    path: "/main/api/v2/hashpower/myOrders",
    query: "algorithm=SHA256ASICBOOST",
    body: null,
    timeMs: 1700000000000,
    nonce: "n".repeat(32),
  };

  it("決定的（同じ入力 → 同じ署名）", () => {
    expect(buildSignature(creds, req)).toBe(buildSignature(creds, req));
    expect(buildSignature(creds, req)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("入力のどの要素が変わっても署名が変わる", () => {
    const base = buildSignature(creds, req);
    expect(buildSignature(creds, { ...req, timeMs: req.timeMs + 1 })).not.toBe(base);
    expect(buildSignature(creds, { ...req, path: "/other" })).not.toBe(base);
    expect(buildSignature(creds, { ...req, query: "" })).not.toBe(base);
    expect(buildSignature({ ...creds, organizationId: "org-2" }, req)).not.toBe(base);
  });

  it("body 有無で署名が変わる（\\0 body の付与）", () => {
    const withBody = buildSignature(creds, { ...req, method: "POST", body: "{}" });
    const without = buildSignature(creds, { ...req, method: "POST", body: null });
    expect(withBody).not.toBe(without);
  });

  it("X-Auth は apiKey:hex 形式・secret はヘッダに含まれない", () => {
    const headers = buildAuthHeaders(creds, req);
    expect(headers["X-Auth"]).toMatch(/^key-1:[0-9a-f]{64}$/);
    expect(JSON.stringify(headers)).not.toContain("secret-1");
    expect(headers["X-Organization-Id"]).toBe("org-1");
  });
});

// ---------------------------------------------------------------------------
// Profitability Engine
// ---------------------------------------------------------------------------

// 実勢スケール: 理論採掘収益 ≈ 5.05e-7 BTC/TH/day（= 0.000505 BTC/PH/day）
const BASE: ProfitabilityInput = {
  btcPriceUsd: 95_000,
  usdJpy: 150,
  difficulty: 126.4e12,
  networkHashrateThs: 904_800_000,
  blockSubsidyBtc: 3.125,
  avgTxFeesBtcPerBlock: 0.05,
  poolFeeRate: 0.02,
  expectedPoolEfficiency: 0.97,
  expectedRejectRate: 0.01,
  nicehashPriceBtcPerFactorDay: 0.00037, // BTC/PH/day（margin ≈ +10%）
  nicehashMarketFeeRate: 0.03,
  nicehashOrderFeeBtc: 0.0001,
  marketFactor: 1e15,
  safetyMarginRate: 0.10,
  plannedSpendBtc: 0.005, // 固定手数料の overhead = 0.0001/0.005 = 2%
};

describe("Profitability Engine", () => {
  it("理論採掘量: difficulty 126.4T・報酬3.175 で ≈5.053e-7 BTC/TH/day", () => {
    const g = grossBtcPerThDay(126.4e12, 3.125, 0.05);
    // 既存 Revenue Engine の検証値 0.00024494(500TH/s, subsidyのみ) と同一原理:
    // 4.899e-7 × (3.175/3.125) = 4.977e-7 …ではなく uptime を含まない素の値
    expect(g).toBeCloseTo(5.053e-7, 9);
    // PH 換算で 0.000505 BTC/PH/day（Mock orderbook の基準と一致）
    expect(g * 1000).toBeCloseTo(0.000505, 5);
  });

  it("spread と margin が計算され、isEstimate=true", () => {
    const r = calculateProfitability(BASE);
    expect(r.isEstimate).toBe(true);
    expect(r.costBtcPerThDay).not.toBeNull();
    expect(r.spreadBtcPerThDay).not.toBeNull();
    // cost = 0.00037/1000 × (1 + 0.03 + 0.02) = 3.885e-7
    expect(r.costBtcPerThDay!).toBeCloseTo(3.885e-7, 10);
    // rev = 5.053e-7 × 0.97×0.98×0.99×0.90 = 4.281e-7 → margin ≈ +10.2%
    expect(r.expectedMarginRate!).toBeGreaterThan(0.08);
    expect(r.expectedMarginRate!).toBeLessThan(0.13);
  });

  it("★ maxBid は break-even より必ず低い（break-even 超 Bid の構造的禁止）", () => {
    const r = calculateProfitability(BASE);
    expect(r.maxBidPriceBtcPerFactorDay).toBeLessThan(r.breakEvenPriceBtcPerFactorDay);
  });

  it("break-even 価格で買うと margin ≈ 0 になる（自己整合）", () => {
    const r0 = calculateProfitability(BASE);
    const r = calculateProfitability({
      ...BASE,
      nicehashPriceBtcPerFactorDay: r0.breakEvenPriceBtcPerFactorDay,
    });
    expect(Math.abs(r.expectedMarginRate!)).toBeLessThan(0.001);
  });

  it("NiceHash 価格 null（板なし）では cost/spread/margin が null（0 を装わない）", () => {
    const r = calculateProfitability({ ...BASE, nicehashPriceBtcPerFactorDay: null });
    expect(r.costBtcPerThDay).toBeNull();
    expect(r.spreadBtcPerThDay).toBeNull();
    expect(r.expectedMarginRate).toBeNull();
  });

  it("安全マージンを上げると期待収益・break-even が下がる（保守化）", () => {
    const low = calculateProfitability({ ...BASE, safetyMarginRate: 0.05 });
    const high = calculateProfitability({ ...BASE, safetyMarginRate: 0.20 });
    expect(high.expectedRevenueBtcPerThDay).toBeLessThan(low.expectedRevenueBtcPerThDay);
    expect(high.breakEvenPriceBtcPerFactorDay).toBeLessThan(low.breakEvenPriceBtcPerFactorDay);
  });

  it("不正入力を拒否", () => {
    expect(() => calculateProfitability({ ...BASE, difficulty: 0 })).toThrow(ArbitrageInputError);
    expect(() => calculateProfitability({ ...BASE, safetyMarginRate: 0.9 })).toThrow(ArbitrageInputError);
  });
});

// ---------------------------------------------------------------------------
// Decision Engine + Hysteresis
// ---------------------------------------------------------------------------

function decisionInput(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    // margin ≈ +26%（0.00032 BTC/PH/day）→ 明確な BUY 圏
    profitability: calculateProfitability({ ...BASE, nicehashPriceBtcPerFactorDay: 0.00032 }),
    startMarginRate: 0.08,
    stopMarginRate: 0.03,
    minConfidence: 0.6,
    marketDataAgeSec: 10,
    maxDataAgeSec: 180,
    poolOnline: true,
    nicehashOnline: true,
    accountingHealthy: true,
    riskLimitOk: true,
    killSwitchOn: false,
    hasActiveOrder: false,
    activeOrderRuntimeSec: 0,
    minRuntimeSec: 300,
    maxRuntimeSec: 1800,
    forecastErrorEma: 0.1,
    dataMode: "LIVE_API",
    depthSufficient: true,
    ...over,
  };
}

describe("Decision Engine", () => {
  it("高マージン + 全条件充足で BUY（理由が数値付きで付く）", () => {
    const d = decide(decisionInput());
    expect(d.action).toBe("BUY");
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.numbers.expectedMarginRate).not.toBeNull();
  });

  it("★ 利益がプラスでも開始閾値未満なら BUY しない", () => {
    // margin ≈ 5%（0 < 5% < 8%）の価格を作る
    const p = calculateProfitability({ ...BASE, nicehashPriceBtcPerFactorDay: 0.000388 });
    expect(p.expectedMarginRate!).toBeGreaterThan(0);
    expect(p.expectedMarginRate!).toBeLessThan(0.08);
    const d = decide(decisionInput({ profitability: p }));
    expect(d.action).toBe("WAIT");
  });

  it("Hysteresis: 稼働中は margin 5% でも HOLD（stop 3% を上回るため）", () => {
    const p = calculateProfitability({ ...BASE, nicehashPriceBtcPerFactorDay: 0.000388 });
    const d = decide(
      decisionInput({ profitability: p, hasActiveOrder: true, activeOrderRuntimeSec: 600 }),
    );
    expect(d.action).toBe("HOLD");
  });

  it("stop 閾値割れ + minRuntime 経過で STOP", () => {
    const p = calculateProfitability({ ...BASE, nicehashPriceBtcPerFactorDay: 0.000400 });
    expect(p.expectedMarginRate!).toBeLessThan(0.03);
    const d = decide(
      decisionInput({ profitability: p, hasActiveOrder: true, activeOrderRuntimeSec: 600 }),
    );
    expect(d.action).toBe("STOP");
  });

  it("minRuntime 未満なら stop 閾値割れでも HOLD（振動防止）", () => {
    const p = calculateProfitability({ ...BASE, nicehashPriceBtcPerFactorDay: 0.000400 });
    const d = decide(
      decisionInput({ profitability: p, hasActiveOrder: true, activeOrderRuntimeSec: 100 }),
    );
    expect(d.action).toBe("HOLD");
  });

  it("maxRuntime 到達で STOP（再評価のため）", () => {
    const d = decide(decisionInput({ hasActiveOrder: true, activeOrderRuntimeSec: 1900 }));
    expect(d.action).toBe("STOP");
  });

  it("Kill Switch / 会計エラー / リスク超過は Emergency（minRuntime 無視で STOP）", () => {
    for (const over of [
      { killSwitchOn: true },
      { accountingHealthy: false },
      { riskLimitOk: false },
    ] as const) {
      const d = decide(
        decisionInput({ ...over, hasActiveOrder: true, activeOrderRuntimeSec: 10 }),
      );
      expect(d.action).toBe("STOP");
    }
  });

  it("データ stale / NiceHash offline では新規注文しない", () => {
    expect(decide(decisionInput({ marketDataAgeSec: 999 })).action).toBe("WAIT");
    expect(decide(decisionInput({ nicehashOnline: false })).action).toBe("WAIT");
  });

  it("信頼度不足で WAIT", () => {
    const d = decide(decisionInput({ forecastErrorEma: 0.5 })); // confidence 0.5 < 0.6
    expect(d.action).toBe("WAIT");
  });
});

describe("Adaptive Safety Margin（説明可能）", () => {
  it("誤差 0 → 8% / 誤差 0.3 以上 → 20%", () => {
    expect(adaptiveSafetyMargin(0)).toBeCloseTo(0.08, 3);
    expect(adaptiveSafetyMargin(0.3)).toBeCloseTo(0.2, 3);
    expect(adaptiveSafetyMargin(0.6)).toBeCloseTo(0.2, 3);
  });
  it("信頼度 = 1 − 誤差EMA", () => {
    expect(confidenceFromForecastError(0.25)).toBeCloseTo(0.75, 6);
    expect(confidenceFromForecastError(2)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Position Sizing + Risk Limits
// ---------------------------------------------------------------------------

describe("Position Sizing", () => {
  const base = {
    availableBtc: "1.00000000",
    expectedMarginRate: 0.12,
    confidence: 0.8,
    volatility: 0.3,
    recentPnlBtc: "0.00100000",
    drawdownRate: 0,
    costBtcPerThDay: 0.0002,
    maxRuntimeSec: 1800,
  };

  it("★ 全資金投入は構造的に不可能（最大でも 10%）", () => {
    const r = sizePosition({ ...base, expectedMarginRate: 0.5, confidence: 1, volatility: 0 });
    expect(Number(r.maxSpendBtc)).toBeLessThanOrEqual(0.1);
    expect(r.breakdown.baseFraction).toBe(0.1);
  });

  it("直近 PnL がマイナスなら半減", () => {
    const win = sizePosition(base);
    const lose = sizePosition({ ...base, recentPnlBtc: "-0.00100000" });
    expect(Number(lose.maxSpendBtc)).toBeLessThan(Number(win.maxSpendBtc));
    expect(lose.breakdown.pnlFactor).toBe(0.5);
  });

  it("推奨ハッシュレートは予算とコスト密度から逆算される", () => {
    const r = sizePosition(base);
    const days = 1800 / 86400;
    expect(r.recommendedThs).toBeCloseTo(Number(r.maxSpendBtc) / (0.0002 * days), 0);
  });
});

describe("Risk Limits", () => {
  const limits = {
    maxOrderBtc: "0.005",
    maxDailySpendBtc: "0.02",
    maxDailyLossBtc: "0.005",
    maxConcurrentOrders: 2,
    maxHashrateThs: 2000,
    maxDrawdownRate: 0.2,
  };
  const okState = {
    daySpentBtc: "0.001",
    dayPnlBtc: "0.0001",
    activeOrderCount: 0,
    activeHashrateThs: 0,
    drawdownRate: 0.05,
  };

  it("正常時は違反なし", () => {
    expect(checkRiskLimits(limits, okState, { spendBtc: "0.004", hashrateThs: 100 })).toHaveLength(0);
  });

  it.each([
    ["1注文上限", okState, { spendBtc: "0.006", hashrateThs: 10 }],
    ["日次支出", { ...okState, daySpentBtc: "0.018" }, { spendBtc: "0.004", hashrateThs: 10 }],
    ["日次損失", { ...okState, dayPnlBtc: "-0.006" }, { spendBtc: "0.001", hashrateThs: 10 }],
    ["同時注文数", { ...okState, activeOrderCount: 2 }, { spendBtc: "0.001", hashrateThs: 10 }],
    ["ハッシュレート", { ...okState, activeHashrateThs: 1950 }, { spendBtc: "0.001", hashrateThs: 100 }],
    ["ドローダウン", { ...okState, drawdownRate: 0.25 }, { spendBtc: "0.001", hashrateThs: 10 }],
  ] as const)("%s 超過を検出", (_l, state, proposal) => {
    expect(checkRiskLimits(limits, state, proposal).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Performance Fee + High-Water Mark
// ---------------------------------------------------------------------------

describe("Performance Fee（実現益のみ・HWM）", () => {
  it("HWM 超過分の 20% を課金し、HWM を更新", () => {
    const r = calculatePerformanceFee({
      cumulativeRealizedPnlBtc: "0.10000000",
      highWaterMarkBtc: "0.04000000",
      performanceFeeRate: 0.2,
    });
    expect(r.gainAboveHwmBtc).toBe("0.06000000");
    expect(r.feeBtc).toBe("0.01200000");
    expect(r.newHighWaterMarkBtc).toBe("0.10000000");
  });

  it("★ 損失回復中（HWM 未満）は課金ゼロ・HWM 据え置き（二重課金禁止）", () => {
    const r = calculatePerformanceFee({
      cumulativeRealizedPnlBtc: "0.03000000",
      highWaterMarkBtc: "0.04000000",
      performanceFeeRate: 0.2,
    });
    expect(r.feeBtc).toBe("0.00000000");
    expect(r.newHighWaterMarkBtc).toBe("0.04000000");
  });

  it("累積損失（負）でも課金ゼロ", () => {
    const r = calculatePerformanceFee({
      cumulativeRealizedPnlBtc: "-0.01000000",
      highWaterMarkBtc: "0.00000000",
      performanceFeeRate: 0.2,
    });
    expect(r.feeBtc).toBe("0.00000000");
  });
});

// ---------------------------------------------------------------------------
// Mock orderbook（決定性）
// ---------------------------------------------------------------------------

describe("mockOrderbook", () => {
  it("決定的かつ sourceMode=MOCK", () => {
    const t = Date.UTC(2026, 7, 14, 12, 0, 0);
    const a = mockOrderbook("SHA256ASICBOOST", t);
    const b = mockOrderbook("SHA256ASICBOOST", t);
    expect(a.currentPriceBtcPerFactorDay).toBe(b.currentPriceBtcPerFactorDay);
    expect(a.sourceMode).toBe("MOCK");
    expect(a.levels.length).toBeGreaterThan(0);
  });
});
