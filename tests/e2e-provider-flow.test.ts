/**
 * E2E Real Provider Flow（フェーズ19）
 *
 * 実 API キーなしの CI でも動くよう、記録済み fixture を使って
 *   Provider Response → Adapter → Payout(RawPayout) → PoolPayout保存 →
 *   Allocation → Ledger → Balance
 * までをメモリストア上で End-to-End 検証する。
 *
 * fixture は実 F2Pool レスポンスを sanitize したもの（実アカウント名・実txidを含まない）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { F2PoolAdapter } from "@/modules/provider/adapters/f2pool";
import { ProviderFacade } from "@/modules/provider/interface";
import { allocatePayout } from "@/modules/revenue/allocation";
import { deriveBalance } from "@/modules/wallet/ledger";
import { toSat } from "@/lib/decimal";
import type { LedgerEntry, MiningProvider } from "@/types";

const fixture = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "f2pool-account.json"),
    "utf8",
  ),
);

function provider(): MiningProvider {
  return {
    id: "p-f2", tenantId: "t1", kind: "F2POOL", name: "F2Pool Test",
    region: "", endpoint: null, credentialsRef: "test/account", credentialsEnc: null,
    workerPrefix: null, status: "ONLINE", lastOkAt: null, lastError: null,
    consecutiveFailures: 0, lastLatencyMs: null, lastSyncAt: null, priority: 1,
    enabled: true, poolName: "", payoutScheme: "FPPS",
  };
}

beforeEach(() => {
  process.env.TEST_ACCOUNT = "sanitized-account";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => fixture })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TEST_ACCOUNT;
});

describe("E2E: F2Pool fixture → Ledger", () => {
  it("1) Adapter が fixture から Worker/Hashrate を正規化する", async () => {
    const adapter = new F2PoolAdapter(provider());
    const result = await adapter.fetchWorkers();
    // 500 TH/s 総計・4 ワーカー（うち1台 OFFLINE）
    expect(result.reportedTotalHashrateThs).toBeCloseTo(500, 3);
    expect(result.readings).toHaveLength(4);
    expect(result.readings[0].hashrateThs).toBeCloseTo(200, 3);
    expect(result.readings[0].hashrate1hThs).toBeCloseTo(201, 3);
    expect(result.readings[3].workerStatus).toBe("OFFLINE"); // last_share が古い
  });

  it("2) Facade の getActualRevenue は payout 合計（実績・satoshi正確）", async () => {
    const facade = new ProviderFacade(new F2PoolAdapter(provider()));
    const actual = await facade.getActualRevenue();
    // 0.00120000 + 0.00118000 + 0.00123000 = 0.00361000
    expect(actual!.value).toBe("0.00361000");
    expect(actual!.isEstimate).toBe(false);
  });

  it("3) getEstimatedRevenue は isEstimate=true（実績と混同しない）", async () => {
    const facade = new ProviderFacade(new F2PoolAdapter(provider()));
    const est = await facade.getEstimatedRevenue();
    expect(est!.value).toBe("0.00024500");
    expect(est!.isEstimate).toBe(true);
  });

  it("4) getPayoutHistory は txid を冪等キーに使う", async () => {
    const adapter = new F2PoolAdapter(provider());
    const payouts = await adapter.getPayoutHistory();
    expect(payouts).toHaveLength(3);
    expect(payouts[0].externalPayoutId).toContain("fixturetx");
    expect(payouts[0].txId).toContain("fixturetx");
  });

  it("5) Payout → Allocation → Ledger: satoshi 保存則が成立する", async () => {
    const adapter = new F2PoolAdapter(provider());
    const payouts = await adapter.getPayoutHistory();
    const target = payouts[0]; // 0.00120000 BTC

    // 2 ユーザーへ 200:180 のハッシュレート比で配賦
    const allocations = allocatePayout(target.amountBtc, [
      { userId: "u1", contractId: "c1", weightThs: 200, poolFeeRate: 0.02, platformFeeRate: 0.02, revenueShareRate: 0, hostingFeeRate: 0 },
      { userId: "u2", contractId: "c2", weightThs: 180, poolFeeRate: 0.02, platformFeeRate: 0.02, revenueShareRate: 0, hostingFeeRate: 0 },
    ]);

    // gross の合計は payout と 1 satoshi も違わない
    const grossSum = allocations.reduce((s, a) => s + toSat(a.grossBtc), 0n);
    expect(grossSum).toBe(toSat(target.amountBtc));

    // Ledger へ記帳して残高を導出（gross − platformFee = net）
    const entries: LedgerEntry[] = [];
    let seq = 0;
    for (const a of allocations) {
      entries.push(mkEntry(seq++, "u1-acct", "MINING_REWARD", a.grossBtc));
      entries.push(mkEntry(seq++, "u1-acct", "PLATFORM_FEE", neg(a.platformFeeBtc)));
    }
    const balance = deriveBalance(entries);
    // 2 ユーザー合算残高 = payout × (1 − 2%)（satoshi 丸めの範囲で）
    const expectedNet = toSat(target.amountBtc) - allocations.reduce((s, a) => s + toSat(a.platformFeeBtc), 0n);
    expect(toSat(balance.availableBtc)).toBe(expectedNet);
  });
});

function mkEntry(i: number, accountId: string, entryType: LedgerEntry["entryType"], amountBtc: string): LedgerEntry {
  return {
    id: `e${i}`, tenantId: "t1", accountId, entryType, bucket: "AVAILABLE",
    amountBtc, refType: "payout", refId: "p1", idempotencyKey: `k${i}`, memo: "",
    createdAt: new Date().toISOString(),
  };
}
function neg(btc: string): string {
  return btc.startsWith("-") ? btc.slice(1) : `-${btc}`;
}
