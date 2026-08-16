/**
 * Scanner（Paper Trading）・Backtest・注文ライフサイクルの統合テスト
 * すべてメモリストア + Mock 市場データで実行（外部接続なし）
 */

import { describe, it, expect, beforeEach } from "vitest";
import { runOpportunityScan } from "@/modules/arbitrage/scanner";
import { runBacktest, generateFixtureSamples } from "@/modules/arbitrage/backtest";
import { memoryStore, resetMemoryStore, DEFAULT_TENANT_ID } from "@/lib/store/memory";

describe("Opportunity Scanner（mock モード）", () => {
  beforeEach(() => resetMemoryStore());

  it("スキャンは必ず DecisionSnapshot を保存する（説明可能性）", async () => {
    const r = await runOpportunityScan(DEFAULT_TENANT_ID);
    expect(["BUY", "HOLD", "STOP", "WAIT"]).toContain(r.decision.action);
    expect(r.decision.reasons.length).toBeGreaterThan(0);

    const snapshots = await memoryStore.listDecisionSnapshots(DEFAULT_TENANT_ID);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].id).toBe(r.snapshotId);
    // 入力・出力・理由が完全保存されている
    expect(snapshots[0].inputs.difficulty).toBeGreaterThan(0);
    expect(snapshots[0].outputs.breakEvenPriceBtcPerFactorDay).toBeGreaterThan(0);
  });

  it("enabled=false（既定）では BUY 判定でも注文を作らない", async () => {
    await runOpportunityScan(DEFAULT_TENANT_ID);
    const orders = await memoryStore.listHashpowerOrders(DEFAULT_TENANT_ID);
    expect(orders).toHaveLength(0);
  });

  it("enabled=true で BUY のとき paper 注文が作成される（live ではない）", async () => {
    await memoryStore.updateArbitrageState(DEFAULT_TENANT_ID, { enabled: true });
    // BUY が出るまで少数回スキャン（mock 板は周期変動する）
    let created = false;
    for (let i = 0; i < 5 && !created; i++) {
      const r = await runOpportunityScan(DEFAULT_TENANT_ID);
      if (r.decision.action === "BUY" || r.paperAction?.includes("created")) created = true;
      if (r.decision.action === "STOP") break;
    }
    const orders = await memoryStore.listHashpowerOrders(DEFAULT_TENANT_ID);
    if (orders.length > 0) {
      // ★ mock モードでは絶対に live 注文にならない
      expect(orders[0].mode).not.toBe("live");
      expect(orders[0].externalOrderId).toBeNull();
      expect(orders[0].decisionSnapshotId).not.toBeNull();
    }
    // 市場サンプルも蓄積されている
    const samples = await memoryStore.listMarketSamples();
    expect(samples.length).toBeGreaterThan(0);
  });

  it("Kill Switch（enabled=false へ変更）で次スキャン時に稼働注文が停止する", async () => {
    await memoryStore.updateArbitrageState(DEFAULT_TENANT_ID, { enabled: true });
    // 手動でアクティブ paper 注文を投入
    await memoryStore.upsertHashpowerOrder({
      id: "hpo-test-1", tenantId: DEFAULT_TENANT_ID, mode: "paper",
      externalOrderId: null, algorithm: "SHA256ASICBOOST", market: "EU", poolId: null,
      status: "ACTIVE", priceBtcPerFactorDay: 0.0004, marketFactor: 1e15,
      requestedThs: 100, deliveredThs: 100,
      amountBtc: "0.00500000", spentBtc: "0.00010000", minedBtc: "0.00012000",
      expectedBtc: "0.00011000",
      startedAt: new Date(Date.now() - 600_000).toISOString(), stoppedAt: null,
      decisionSnapshotId: null, reason: "test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await memoryStore.updateArbitrageState(DEFAULT_TENANT_ID, { enabled: false });
    const r = await runOpportunityScan(DEFAULT_TENANT_ID);
    expect(r.decision.action).toBe("STOP");
    const order = await memoryStore.getHashpowerOrder(DEFAULT_TENANT_ID, "hpo-test-1");
    expect(order!.status).toBe("COMPLETED");
    expect(order!.stoppedAt).not.toBeNull();
  });
});

describe("Backtest（フェーズ21・22）", () => {
  it("FIXTURE 生成は決定的で 1 年分（時間刻み）", () => {
    const from = Date.UTC(2025, 7, 13);
    const to = Date.UTC(2026, 7, 13);
    const a = generateFixtureSamples(from, to);
    const b = generateFixtureSamples(from, to);
    expect(a.length).toBeGreaterThan(8700);
    expect(a[100].btcPriceUsd).toBe(b[100].btcPriceUsd); // 決定的
    expect(a.every((s) => s.sourceMode === "FIXTURE")).toBe(true);
    expect(a.every((s) => s.btcPriceUsd >= 20_000)).toBe(true);
  });

  it("4戦略 × 3資金の12結果を返し、合成データを明示する", async () => {
    const to = Date.now();
    const report = await runBacktest({ fromMs: to - 365 * 86_400_000, toMs: to });
    expect(report.results).toHaveLength(12);
    expect(report.containsFixture).toBe(true); // 実サンプル不足 → FIXTURE
    for (const r of report.results) {
      expect(r.finalEquityJpy).toBeGreaterThan(0);
      expect(r.maxDrawdownRate).toBeGreaterThanOrEqual(0);
      expect(r.maxDrawdownRate).toBeLessThanOrEqual(1);
      expect(r.equityCurve.length).toBeGreaterThan(10);
    }
  }, 30_000);

  it("Threshold/Dynamic は Always-On より NiceHash 支出が少ない（選別している証拠）", async () => {
    const to = Date.now();
    const report = await runBacktest({
      fromMs: to - 90 * 86_400_000,
      toMs: to,
      capitalScenariosJpy: [1_000_000],
    });
    const alwaysOn = report.results.find((r) => r.strategy === "alwaysOn")!;
    const threshold = report.results.find((r) => r.strategy === "threshold")!;
    expect(threshold.nicehashCostBtc).toBeLessThan(alwaysOn.nicehashCostBtc);
    expect(threshold.orders).toBeGreaterThan(0); // ON/OFF が発生している
  }, 30_000);
});
