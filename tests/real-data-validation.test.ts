/**
 * 実データ検証（フェーズ5・6・7・9）のテスト
 *   - Hashrate sanity（異常値は usable=false → スナップショット・収益計算に使われない）
 *   - Payout 取り込み前検証（txid 形式・金額・未来日時）
 *   - Worker 同期整合性
 *   - Allocation Safety Gate（未認証 LIVE payout は PENDING_REVIEW）
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkHashrateSanity,
  validatePayout,
  validateWorkerSync,
  isValidTxid,
  MAX_WORKER_THS,
} from "@/modules/mining/validation";
import { allocatePayoutToUsers, AllocationError } from "@/modules/revenue/allocation";
import { memoryStore, resetMemoryStore, DEFAULT_TENANT_ID } from "@/lib/store/memory";
import type { ProviderWorkerReading, Worker } from "@/types";

function reading(over: Partial<ProviderWorkerReading> = {}): ProviderWorkerReading {
  return {
    externalWorkerId: "w1", minerId: "", model: "",
    hashrateThs: 100, hashrate1hThs: 101, ratedHashrateThs: 99,
    ratedEfficiencyJPerTh: 17, acceptedShares: 1000, rejectedShares: 5,
    temperatureC: null, powerW: null, uptimeSec: 3600,
    poolStatus: "connected", workerStatus: "ACTIVE",
    lastShareAt: new Date().toISOString(), estimatedEarningsBtc: null,
    ...over,
  };
}

describe("checkHashrateSanity（フェーズ6）", () => {
  it("正常値は usable", () => {
    const s = checkHashrateSanity(reading(), 100);
    expect(s.usable).toBe(true);
    expect(s.anomalies).toHaveLength(0);
  });

  it.each([
    ["NaN", { hashrateThs: NaN }],
    ["Infinity", { hashrateThs: Infinity }],
    ["負値", { hashrateThs: -5 }],
    ["上限超過", { hashrateThs: MAX_WORKER_THS + 1 }],
  ] as const)("%s は usable=false（Ledger・収益計算に使わせない）", (_label, over) => {
    const s = checkHashrateSanity(reading(over), 100);
    expect(s.usable).toBe(false);
    expect(s.anomalies.length).toBeGreaterThan(0);
  });

  it("1h/24h の極端な乖離を検出する", () => {
    const s = checkHashrateSanity(reading({ hashrate1hThs: 1000, ratedHashrateThs: 10 }), null);
    expect(s.usable).toBe(false);
  });

  it("前回比90%急落は警告するが usable のまま（物理的にあり得るため）", () => {
    const s = checkHashrateSanity(reading({ hashrateThs: 5 }), 100);
    expect(s.usable).toBe(true);
    expect(s.anomalies.some((a) => a.includes("急落"))).toBe(true);
  });
});

describe("validatePayout（フェーズ7）", () => {
  const validTxid = "a".repeat(64);
  const base = {
    externalPayoutId: "p1",
    amountBtc: "0.00100000",
    paidAt: new Date(Date.now() - 3600_000).toISOString(),
    txId: validTxid,
  };

  it("正常な payout を受理する", () => {
    expect(validatePayout(base).valid).toBe(true);
  });

  it("txid 無し（null）は許容する（プールが公開しない場合）", () => {
    expect(validatePayout({ ...base, txId: null }).valid).toBe(true);
  });

  it.each([
    ["金額ゼロ", { amountBtc: "0.00000000" }],
    ["金額負", { amountBtc: "-0.001" }],
    ["非現実的な金額", { amountBtc: "500.00000000" }],
    ["未来日時", { paidAt: new Date(Date.now() + 3600_000).toISOString() }],
    ["txid 形式不正", { txId: "not-a-txid" }],
    ["txid 桁数不足", { txId: "abc123" }],
  ] as const)("%s を拒否する", (_label, over) => {
    expect(validatePayout({ ...base, ...over }).valid).toBe(false);
  });

  it("isValidTxid は 64 桁 hex のみ受理", () => {
    expect(isValidTxid(validTxid)).toBe(true);
    expect(isValidTxid("A".repeat(64))).toBe(true);
    expect(isValidTxid("g".repeat(64))).toBe(false);
    expect(isValidTxid(null)).toBe(false);
  });
});

describe("validateWorkerSync（フェーズ5）", () => {
  const dbWorker = (id: string): Worker => ({
    id: `wk-${id}`, tenantId: "t1", providerId: "p1", externalWorkerId: id,
    minerId: "", model: "", ratedHashrateThs: 100, ratedEfficiencyJPerTh: 17,
    status: "ACTIVE", lastSeenAt: null,
  });

  it("一致していれば ok", () => {
    const v = validateWorkerSync("p1", [reading({ externalWorkerId: "w1" })], [dbWorker("w1")]);
    expect(v.ok).toBe(true);
  });

  it("API 側の重複ワーカー名を検出する", () => {
    const v = validateWorkerSync(
      "p1",
      [reading({ externalWorkerId: "w1" }), reading({ externalWorkerId: "w1" })],
      [dbWorker("w1")],
    );
    expect(v.ok).toBe(false);
    expect(v.duplicateIds).toContain("w1");
  });

  it("DB 未同期のワーカーを検出する", () => {
    const v = validateWorkerSync("p1", [reading({ externalWorkerId: "w9" })], [dbWorker("w1")]);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes("未同期"))).toBe(true);
  });

  it("API に無い DB ワーカー（削除済み）は異常としない", () => {
    const v = validateWorkerSync(
      "p1",
      [reading({ externalWorkerId: "w1" })],
      [dbWorker("w1"), dbWorker("w-deleted")],
    );
    expect(v.ok).toBe(true); // OFFLINE 表示で扱う（履歴保持のため物理削除しない）
  });
});

describe("Allocation Safety Gate（フェーズ9）", () => {
  beforeEach(() => resetMemoryStore());
  const actor = { userId: "user-admin", email: "admin@example.com", role: "PLATFORM_ADMIN" };

  it("未認証の LIVE payout は PENDING_REVIEW になり配賦されない", async () => {
    // 契約を全プロバイダー対象にして、Gate 本体（provider_certified）の判定に到達させる
    await memoryStore.updateContract(DEFAULT_TENANT_ID, "contract-demo-1", {
      providerId: null,
    });
    // LIVE 扱いの payout を直接投入（source が mock: でない・provider は未認証の POOL_REST）
    await memoryStore.insertPayout({
      id: "po-live-1", tenantId: DEFAULT_TENANT_ID, providerId: "provider-pool-01",
      externalPayoutId: "live-1", amountBtc: "0.00100000",
      paidAt: new Date(Date.now() - 3600_000).toISOString(), txId: "b".repeat(64),
      source: "Real Pool", fetchedAt: new Date().toISOString(),
      allocationStatus: "UNALLOCATED", allocatedAt: null, reviewReason: null,
      verificationStatus: "VERIFICATION_PENDING", confirmations: null, verifiedAt: null,
    });

    await expect(
      allocatePayoutToUsers(DEFAULT_TENANT_ID, "po-live-1", actor),
    ).rejects.toThrow(AllocationError);

    const payout = await memoryStore.getPayout(DEFAULT_TENANT_ID, "po-live-1");
    expect(payout!.allocationStatus).toBe("PENDING_REVIEW");
    expect(payout!.reviewReason).toContain("provider_certified");

    // ALLOCATION_GATE_BLOCKED アラートが出る
    const alerts = await memoryStore.listAlerts(DEFAULT_TENANT_ID);
    expect(alerts.some((a) => a.kind === "ALLOCATION_GATE_BLOCKED")).toBe(true);
  });

  it("bypassGate（管理者の明示操作）なら PENDING_REVIEW でも配賦できる", async () => {
    await memoryStore.insertPayout({
      id: "po-live-2", tenantId: DEFAULT_TENANT_ID, providerId: "provider-mock-01",
      externalPayoutId: "live-2", amountBtc: "0.00050000",
      paidAt: new Date(Date.now() - 3600_000).toISOString(), txId: null,
      source: "Real Pool", fetchedAt: new Date().toISOString(),
      allocationStatus: "PENDING_REVIEW", allocatedAt: null,
      reviewReason: "手動レビュー待ち",
      verificationStatus: "NOT_APPLICABLE", confirmations: null, verifiedAt: null,
    });
    const result = await allocatePayoutToUsers(DEFAULT_TENANT_ID, "po-live-2", actor, {
      bypassGate: true,
    });
    expect(result.allocations.length).toBeGreaterThan(0);
    const payout = await memoryStore.getPayout(DEFAULT_TENANT_ID, "po-live-2");
    expect(payout!.allocationStatus).toBe("ALLOCATED");
  });

  it("Mock payout（デモ）は Gate を通過して配賦される", async () => {
    const { syncPayouts } = await import("@/modules/provider/registry");
    await syncPayouts(DEFAULT_TENANT_ID);
    const payouts = await memoryStore.listPayouts(DEFAULT_TENANT_ID, {
      allocationStatus: "UNALLOCATED",
    });
    const mockPayout = payouts.find((p) => p.providerId === "provider-mock-01")!;
    const result = await allocatePayoutToUsers(DEFAULT_TENANT_ID, mockPayout.id, actor);
    expect(result.allocations.length).toBeGreaterThan(0);
  });
});
