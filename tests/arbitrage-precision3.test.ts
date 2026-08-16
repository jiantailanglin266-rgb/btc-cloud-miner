/**
 * 精密化v3 のテスト
 *   #1 実測ブロック手数料（トリム平均・不足時 null）
 *   #2 難易度リターゲットの時間加重（調和平均）
 *   #4 paper 精算が注文保存時の marketFactor を使う（1e18 で 1000 倍ずれない）
 *   #5 指値が実勢未満の paper 注文は飢餓（コストも採掘もゼロ）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { trimmedMeanBlockFeesBtc } from "@/modules/bitcoin/sources";
import { effectiveDifficultyOverRuntime, runOpportunityScan } from "@/modules/arbitrage/scanner";
import { memoryStore, resetMemoryStore, DEFAULT_TENANT_ID } from "@/lib/store/memory";
import { mockOrderbook, SHA256_ALGORITHM } from "@/modules/hashpower/nicehash";

describe("実測ブロック手数料（精密化v3 #1）", () => {
  it("上下1件を捨てたトリム平均を BTC で返す", () => {
    // sats: 1M / 2M / 3M / 100M(外れ値) → トリム後 (2M+3M)/2 = 2.5M sats
    expect(trimmedMeanBlockFeesBtc([1e6, 100e6, 3e6, 2e6])).toBeCloseTo(0.025, 9);
  });

  it("3件未満・全異常値では null（実測を捏造しない）", () => {
    expect(trimmedMeanBlockFeesBtc([1e6, 2e6])).toBeNull();
    expect(trimmedMeanBlockFeesBtc([])).toBeNull();
    expect(trimmedMeanBlockFeesBtc([NaN, -5, Infinity])).toBeNull();
  });

  it("負値・50BTC超の異常ブロックは除外して計算する", () => {
    // 60e8(=60BTC, 異常) と -1 は除外 → [1e6,2e6,3e6] → トリム後 [2e6] → 0.02
    expect(trimmedMeanBlockFeesBtc([1e6, 2e6, 3e6, 60e8, -1])).toBeCloseTo(0.02, 9);
  });
});

describe("難易度リターゲットの時間加重（精密化v3 #2）", () => {
  it("リターゲットが注文期間外なら現在難易度のまま", () => {
    const r = effectiveDifficultyOverRuntime({
      difficulty: 100e12,
      blocksUntilAdjustment: 100, // 100×600s = 60,000s 先
      estimatedAdjustmentRate: 0.05,
      runtimeSec: 14_400, // 4h
    });
    expect(r.effectiveDifficulty).toBe(100e12);
    expect(r.retargetWeight).toBe(0);
  });

  it("期間の半分でリターゲット（+10%）なら調和平均で加重される", () => {
    const r = effectiveDifficultyOverRuntime({
      difficulty: 100,
      blocksUntilAdjustment: 6, // 3600s 先
      estimatedAdjustmentRate: 0.1,
      runtimeSec: 7200,
    });
    expect(r.retargetWeight).toBeCloseTo(0.5, 6);
    // 1/(0.5/100 + 0.5/110) = 104.7619...
    expect(r.effectiveDifficulty).toBeCloseTo(104.7619, 3);
    // 収益∝1/難易度なので、算術平均(105)より低い側（=収益側に正直）になる
    expect(r.effectiveDifficulty).toBeLessThan(105);
  });

  it("変化率不明（0）なら現在難易度のまま（推測で埋めない）", () => {
    const r = effectiveDifficultyOverRuntime({
      difficulty: 100e12,
      blocksUntilAdjustment: 1,
      estimatedAdjustmentRate: 0,
      runtimeSec: 86_400,
    });
    expect(r.effectiveDifficulty).toBe(100e12);
    expect(r.retargetWeight).toBe(0);
  });

  it("下方調整（難易度低下）は実効難易度を下げる＝期待収益を上げる", () => {
    const r = effectiveDifficultyOverRuntime({
      difficulty: 100,
      blocksUntilAdjustment: 6,
      estimatedAdjustmentRate: -0.1,
      runtimeSec: 7200,
    });
    expect(r.effectiveDifficulty).toBeLessThan(100);
  });
});

function baseOrder(overrides: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    id: "hpo-p3", tenantId: DEFAULT_TENANT_ID, mode: "paper" as const,
    externalOrderId: null, algorithm: SHA256_ALGORITHM, market: "EU" as const,
    poolId: null, status: "ACTIVE" as const,
    priceBtcPerFactorDay: 0.0004, marketFactor: 1e15,
    requestedThs: 100, deliveredThs: 100,
    amountBtc: "0.05000000", spentBtc: "0.00000000", minedBtc: "0.00000000",
    expectedBtc: "0.00010000",
    startedAt: new Date(Date.now() - 3_600_000).toISOString(), stoppedAt: null,
    decisionSnapshotId: null, reason: "test",
    createdAt: now, updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides,
  };
}

describe("paper 精算の marketFactor / 飢餓判定（精密化v3 #4・#5）", () => {
  beforeEach(() => resetMemoryStore());

  it("marketFactor=1e18 の注文は 1e15 換算の 1/1000 のコストで精算される", async () => {
    await memoryStore.updateArbitrageState(DEFAULT_TENANT_ID, { enabled: true });
    const book = mockOrderbook(SHA256_ALGORITHM);
    const current = book.currentPriceBtcPerFactorDay ?? 0.0004;
    // 実勢より高い指値（飢餓にならない）を EH 建てで置く。
    // 密度 = 0.6/1e6 = 6e-7 BTC/TH/day → 100TH × 1h ≈ 2.5e-6 BTC（手数料込み~2.6e-6）
    await memoryStore.upsertHashpowerOrder(
      baseOrder({ priceBtcPerFactorDay: Math.max(0.6, current * 2), marketFactor: 1e18 }),
    );
    await runOpportunityScan(DEFAULT_TENANT_ID);
    const order = await memoryStore.getHashpowerOrder(DEFAULT_TENANT_ID, "hpo-p3");
    const spent = Number(order?.spentBtc);
    expect(spent).toBeGreaterThan(0); // 精算はされている
    expect(spent).toBeLessThan(1e-4); // 1e15 で換算すると ~2.6e-3 になり検出される
  });

  it("指値が実勢未満なら飢餓: コスト・採掘ともゼロのまま", async () => {
    await memoryStore.updateArbitrageState(DEFAULT_TENANT_ID, { enabled: true });
    // mock 板の実勢（~4e-4 前後）より確実に低い指値
    await memoryStore.upsertHashpowerOrder(baseOrder({ priceBtcPerFactorDay: 0.00001 }));
    await runOpportunityScan(DEFAULT_TENANT_ID);
    const order = await memoryStore.getHashpowerOrder(DEFAULT_TENANT_ID, "hpo-p3");
    // 飢餓の本質: 1時間経過していてもコストも採掘も発生しない
    // （その後 STOP で閉じられても PnL への寄与はゼロのまま）
    expect(Number(order?.spentBtc)).toBe(0);
    expect(Number(order?.minedBtc)).toBe(0);
  });
});

describe("DecisionSnapshot に精密化v3 のフィールドが保存される", () => {
  beforeEach(() => resetMemoryStore());

  it("avgTxFeesSource / effectiveDifficulty / orderbookTotalThs が記録される", async () => {
    const r = await runOpportunityScan(DEFAULT_TENANT_ID);
    expect(["MEASURED_BLOCKS", "FEE_PROXY"]).toContain(r.inputs.avgTxFeesSource);
    expect(r.inputs.effectiveDifficulty).toBeGreaterThan(0);
    expect(r.inputs.retargetWeight).toBeGreaterThanOrEqual(0);
    expect(r.inputs.retargetWeight).toBeLessThanOrEqual(1);
    // mock 板の総供給量は TH/s 換算で正の値、かつ網ハッシュレート以下（単位監査 PASS）
    expect(r.outputs.orderbookTotalThs).toBeGreaterThan(0);
    expect(r.outputs.orderbookTotalThs!).toBeLessThanOrEqual(r.inputs.networkHashrateThs);
  });
});
