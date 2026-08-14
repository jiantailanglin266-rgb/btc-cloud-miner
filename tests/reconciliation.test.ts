/**
 * Reconciliation のテスト（フェーズ10）
 * sync → allocate 後に、pool payout と Ledger が satoshi 単位で一致することを検証。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { syncPayouts } from "@/modules/provider/registry";
import { allocateAllPending } from "@/modules/revenue/allocation";
import { reconcile } from "@/modules/revenue/reconciliation";
import { resetMemoryStore, DEFAULT_TENANT_ID } from "@/lib/store/memory";
import { toSat } from "@/lib/decimal";

const actor = { userId: null, email: "system", role: "SYSTEM" };

describe("reconcile", () => {
  beforeEach(() => resetMemoryStore());

  it("配賦後、配賦済み payout はすべて OK（差分ゼロ）", async () => {
    await syncPayouts(DEFAULT_TENANT_ID);
    await allocateAllPending(DEFAULT_TENANT_ID, actor);

    const report = await reconcile(DEFAULT_TENANT_ID);
    const allocated = report.rows.filter((r) => r.status !== "UNALLOCATED");
    expect(allocated.length).toBeGreaterThan(0);
    for (const row of allocated) {
      expect(row.status).toBe("OK");
      expect(row.differenceSat).toBe("0");
    }
    expect(report.mismatchCount).toBe(0);
  });

  it("配賦 gross 合計 = 配賦済み pool payout 合計（satoshi）", async () => {
    await syncPayouts(DEFAULT_TENANT_ID);
    await allocateAllPending(DEFAULT_TENANT_ID, actor);
    const report = await reconcile(DEFAULT_TENANT_ID);

    // UNALLOCATED を除いた pool payout 合計と、配賦 gross 合計が一致
    const allocatedPoolSat = report.rows
      .filter((r) => r.status !== "UNALLOCATED")
      .reduce((s, r) => s + toSat(r.poolPayoutBtc), 0n);
    expect(toSat(report.totalAllocatedBtc)).toBe(allocatedPoolSat);
  });

  it("未配賦 payout は UNALLOCATED として区別される", async () => {
    await syncPayouts(DEFAULT_TENANT_ID);
    // 配賦しない状態
    const report = await reconcile(DEFAULT_TENANT_ID);
    expect(report.rows.every((r) => r.status === "UNALLOCATED")).toBe(true);
    expect(report.mismatchCount).toBe(0); // 未配賦は不一致ではない
  });
});
