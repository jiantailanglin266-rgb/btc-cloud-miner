/**
 * Revenue Allocation のテスト（フェーズ7の最重要保証）
 *   - satoshi 保存則: 按分合計は必ず元の payout と一致する
 *   - 冪等性: 同じ payout を二度配賦しても二重計上されない
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  allocatePayout,
  allocatePayoutToUsers,
  AllocationError,
  type AllocationShare,
} from "@/modules/revenue/allocation";
import { syncPayouts } from "@/modules/provider/registry";
import { getBalance } from "@/modules/wallet/ledger";
import { memoryStore, resetMemoryStore, DEFAULT_TENANT_ID } from "@/lib/store/memory";
import { toSat } from "@/lib/decimal";

function share(over: Partial<AllocationShare> & { userId: string }): AllocationShare {
  return {
    contractId: `c-${over.userId}`,
    weightThs: 100,
    poolFeeRate: 0.02,
    platformFeeRate: 0.02,
    revenueShareRate: 0,
    hostingFeeRate: 0,
    ...over,
  };
}

describe("allocatePayout（純関数）", () => {
  it("ハッシュレート比率で按分される", () => {
    const out = allocatePayout("0.30000000", [
      share({ userId: "a", weightThs: 100 }),
      share({ userId: "b", weightThs: 200 }),
    ]);
    expect(out.find((x) => x.userId === "a")!.grossBtc).toBe("0.10000000");
    expect(out.find((x) => x.userId === "b")!.grossBtc).toBe("0.20000000");
  });

  it("★ satoshi 保存則: 割り切れない金額でも合計が厳密に一致する", () => {
    // 0.00000100 BTC (100 sat) を 3 等分 → 33/33/34
    const out = allocatePayout("0.00000100", [
      share({ userId: "a", weightThs: 1 }),
      share({ userId: "b", weightThs: 1 }),
      share({ userId: "c", weightThs: 1 }),
    ]);
    const total = out.reduce((s, x) => s + toSat(x.grossBtc), 0n);
    expect(total).toBe(100n);
    // 端数は決定的に割り当てられる（実行のたびに変わらない）
    const again = allocatePayout("0.00000100", [
      share({ userId: "a", weightThs: 1 }),
      share({ userId: "b", weightThs: 1 }),
      share({ userId: "c", weightThs: 1 }),
    ]);
    expect(out.map((x) => x.grossBtc)).toEqual(again.map((x) => x.grossBtc));
  });

  it("既定では Pool Fee を再控除しない（プールは手数料控除後に払い出すため）", () => {
    const out = allocatePayout("0.10000000", [share({ userId: "a", poolFeeRate: 0.02 })]);
    expect(out[0].poolFeeBtc).toBe("0.00000000");
    // gross からプラットフォーム手数料 2% のみ控除
    expect(out[0].platformFeeBtc).toBe("0.00200000");
    expect(out[0].netBtc).toBe("0.09800000");
  });

  it("payoutIsNetOfPoolFee=false のときのみ Pool Fee を控除する", () => {
    const out = allocatePayout(
      "0.10000000",
      [share({ userId: "a", poolFeeRate: 0.02 })],
      { payoutIsNetOfPoolFee: false },
    );
    expect(out[0].poolFeeBtc).toBe("0.00200000");
    expect(out[0].netBtc).toBe("0.09600000");
  });

  it("revenueShare / hostingFee も控除され、net = gross − 全控除", () => {
    const out = allocatePayout("1.00000000", [
      share({
        userId: "a",
        platformFeeRate: 0.02,
        revenueShareRate: 0.1,
        hostingFeeRate: 0.05,
      }),
    ]);
    const a = out[0];
    expect(a.platformFeeBtc).toBe("0.02000000");
    expect(a.revenueShareBtc).toBe("0.10000000");
    expect(a.hostingFeeBtc).toBe("0.05000000");
    expect(a.netBtc).toBe("0.83000000");
    const sum =
      toSat(a.netBtc) +
      toSat(a.platformFeeBtc) +
      toSat(a.revenueShareBtc) +
      toSat(a.hostingFeeBtc);
    expect(sum).toBe(toSat(a.grossBtc));
  });

  it("不正入力を拒否する", () => {
    expect(() => allocatePayout("0.1", [])).toThrow(AllocationError);
    expect(() =>
      allocatePayout("0.1", [share({ userId: "a", weightThs: 0 })]),
    ).toThrow(AllocationError);
    expect(() => allocatePayout("0.00000000", [share({ userId: "a" })])).toThrow(
      AllocationError,
    );
  });
});

describe("配賦オーケストレーション（冪等性）", () => {
  beforeEach(() => {
    resetMemoryStore();
  });

  const actor = { userId: "user-admin", email: "admin@example.com", role: "PLATFORM_ADMIN" };

  it("sync → allocate → 残高が増える。再実行しても二重計上されない", async () => {
    // 1. Mock プロバイダーから payout を同期
    const sync1 = await syncPayouts(DEFAULT_TENANT_ID);
    expect(sync1.saved).toBeGreaterThan(0);

    // 2. 再同期しても重複は保存されない（冪等 第1層）
    const sync2 = await syncPayouts(DEFAULT_TENANT_ID);
    expect(sync2.saved).toBe(0);
    expect(sync2.skippedDuplicates).toBeGreaterThan(0);

    const before = await getBalance(DEFAULT_TENANT_ID, "user-demo");

    // 3. 配賦
    const payouts = await memoryStore.listPayouts(DEFAULT_TENANT_ID, {
      allocationStatus: "UNALLOCATED",
    });
    expect(payouts.length).toBeGreaterThan(0);
    const target = payouts[0];
    const result1 = await allocatePayoutToUsers(DEFAULT_TENANT_ID, target.id, actor);
    expect(result1.allocations.length).toBeGreaterThan(0);
    expect(result1.skippedUsers).toHaveLength(0);

    const after1 = await getBalance(DEFAULT_TENANT_ID, "user-demo");
    const credited = toSat(after1.availableBtc) - toSat(before.availableBtc);
    expect(credited).toBeGreaterThan(0n);

    // 4. ★ 同じ payout を再配賦 → 状態フラグで no-op（冪等 第2層）
    const result2 = await allocatePayoutToUsers(DEFAULT_TENANT_ID, target.id, actor);
    expect(result2.allocations).toHaveLength(0);

    const after2 = await getBalance(DEFAULT_TENANT_ID, "user-demo");
    expect(after2.availableBtc).toBe(after1.availableBtc); // 残高不変

    // 5. Earning は ACTUAL として記録され、payout に紐づく
    const earnings = await memoryStore.listEarnings(DEFAULT_TENANT_ID, "user-demo");
    const actual = earnings.filter((e) => e.kind === "ACTUAL");
    expect(actual.length).toBeGreaterThan(0);
    expect(actual[0].payoutId).toBe(target.id);
  });

  it("状態フラグを偽装しても元帳の冪等キーが二重計上を阻止する（冪等 第3層）", async () => {
    await syncPayouts(DEFAULT_TENANT_ID);
    const payouts = await memoryStore.listPayouts(DEFAULT_TENANT_ID, {
      allocationStatus: "UNALLOCATED",
    });
    const target = payouts[0];
    await allocatePayoutToUsers(DEFAULT_TENANT_ID, target.id, actor);
    const balance1 = await getBalance(DEFAULT_TENANT_ID, "user-demo");

    // 攻撃シナリオ: allocationStatus を手で UNALLOCATED に戻して再実行
    await memoryStore.updatePayout(DEFAULT_TENANT_ID, target.id, {
      allocationStatus: "UNALLOCATED",
      allocatedAt: null,
    });
    const result = await allocatePayoutToUsers(DEFAULT_TENANT_ID, target.id, actor);

    // 元帳キー衝突により全ユーザーがスキップされ、残高は 1 satoshi も増えない
    expect(result.skippedUsers.length).toBeGreaterThan(0);
    const balance2 = await getBalance(DEFAULT_TENANT_ID, "user-demo");
    expect(balance2.availableBtc).toBe(balance1.availableBtc);

    // DUPLICATE_PAYOUT アラートが発報されている
    const alerts = await memoryStore.listAlerts(DEFAULT_TENANT_ID);
    expect(alerts.some((a) => a.kind === "DUPLICATE_PAYOUT")).toBe(true);
  });
});
