/**
 * 複式元帳のテスト。
 * 「残高が消えない・二重計上されない」という不変条件を固定する。
 */

import { describe, it, expect } from "vitest";
import { deriveBalance, verifyInvariants } from "@/modules/wallet/ledger";
import type { LedgerEntry } from "@/types";

let seq = 0;
function entry(
  over: Partial<LedgerEntry> & Pick<LedgerEntry, "entryType" | "bucket" | "amountBtc">,
): LedgerEntry {
  return {
    id: `e${seq++}`,
    tenantId: "t1",
    accountId: "a1",
    refType: null,
    refId: null,
    idempotencyKey: null,
    memo: "",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("deriveBalance", () => {
  it("報酬の積み上げ", () => {
    const entries = [
      entry({ entryType: "MINING_REWARD", bucket: "AVAILABLE", amountBtc: "0.00100000" }),
      entry({ entryType: "MINING_REWARD", bucket: "AVAILABLE", amountBtc: "0.00200000" }),
    ];
    const b = deriveBalance(entries);
    expect(b.availableBtc).toBe("0.00300000");
    expect(b.lockedBtc).toBe("0.00000000");
    expect(b.lifetimeEarnedBtc).toBe("0.00300000");
  });

  it("出金申請（ロック）: available → locked へ移動し、合計は不変", () => {
    const entries = [
      entry({ entryType: "MINING_REWARD", bucket: "AVAILABLE", amountBtc: "0.01000000" }),
      entry({ entryType: "WITHDRAWAL_LOCK", bucket: "AVAILABLE", amountBtc: "-0.00500000" }),
      entry({ entryType: "WITHDRAWAL_LOCK", bucket: "LOCKED", amountBtc: "0.00500000" }),
    ];
    const b = deriveBalance(entries);
    expect(b.availableBtc).toBe("0.00500000");
    expect(b.lockedBtc).toBe("0.00500000");
  });

  it("却下（リバース）: locked → available へ戻り、残高が消えない", () => {
    const entries = [
      entry({ entryType: "MINING_REWARD", bucket: "AVAILABLE", amountBtc: "0.01000000" }),
      entry({ entryType: "WITHDRAWAL_LOCK", bucket: "AVAILABLE", amountBtc: "-0.00500000" }),
      entry({ entryType: "WITHDRAWAL_LOCK", bucket: "LOCKED", amountBtc: "0.00500000" }),
      entry({ entryType: "WITHDRAWAL_REVERSE", bucket: "LOCKED", amountBtc: "-0.00500000" }),
      entry({ entryType: "WITHDRAWAL_REVERSE", bucket: "AVAILABLE", amountBtc: "0.00500000" }),
    ];
    const b = deriveBalance(entries);
    expect(b.availableBtc).toBe("0.01000000"); // 完全に元通り
    expect(b.lockedBtc).toBe("0.00000000");
  });

  it("送金完了（セトル）: locked から確定減算、累計出金に計上", () => {
    const entries = [
      entry({ entryType: "MINING_REWARD", bucket: "AVAILABLE", amountBtc: "0.01000000" }),
      entry({ entryType: "WITHDRAWAL_LOCK", bucket: "AVAILABLE", amountBtc: "-0.00500000" }),
      entry({ entryType: "WITHDRAWAL_LOCK", bucket: "LOCKED", amountBtc: "0.00500000" }),
      entry({ entryType: "WITHDRAWAL_SETTLE", bucket: "LOCKED", amountBtc: "-0.00500000" }),
    ];
    const b = deriveBalance(entries);
    expect(b.availableBtc).toBe("0.00500000");
    expect(b.lockedBtc).toBe("0.00000000");
    expect(b.lifetimeWithdrawnBtc).toBe("0.00500000");
  });
});

describe("verifyInvariants", () => {
  it("正常な元帳は違反なし", () => {
    const entries = [
      entry({ entryType: "MINING_REWARD", bucket: "AVAILABLE", amountBtc: "0.01000000" }),
    ];
    expect(verifyInvariants(entries).ok).toBe(true);
  });

  it("負の available を検出する", () => {
    const entries = [
      entry({ entryType: "WITHDRAWAL_LOCK", bucket: "AVAILABLE", amountBtc: "-0.00100000" }),
    ];
    const result = verifyInvariants(entries);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("利用可能残高が負");
  });

  it("冪等キーの重複を検出する", () => {
    const entries = [
      entry({
        entryType: "MINING_REWARD",
        bucket: "AVAILABLE",
        amountBtc: "0.001",
        idempotencyKey: "dup",
      }),
      entry({
        entryType: "MINING_REWARD",
        bucket: "AVAILABLE",
        amountBtc: "0.001",
        idempotencyKey: "dup",
      }),
    ];
    const result = verifyInvariants(entries);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("冪等キー"))).toBe(true);
  });
});
