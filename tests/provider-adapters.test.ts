/**
 * Provider Adapter のテスト
 *   - ProviderFacade の派生値（getHashrate / getAcceptedShares 等）
 *   - F2Pool / Braiins のレスポンス解析（fetch をスタブして外部接続なしで検証）
 *   - CustomerOwned の委譲
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { ProviderFacade, type MiningProviderAdapter } from "@/modules/provider/interface";
import { F2PoolAdapter } from "@/modules/provider/adapters/f2pool";
import { BraiinsPoolAdapter } from "@/modules/provider/adapters/braiins";
import { CustomerOwnedMinerAdapter } from "@/modules/provider/adapters/customer-owned";
import type { MiningProvider } from "@/types";

function provider(over: Partial<MiningProvider>): MiningProvider {
  return {
    id: "p1",
    tenantId: "t1",
    kind: "F2POOL",
    name: "test-pool",
    region: "",
    endpoint: null,
    credentialsRef: "test/account",
    credentialsEnc: null,
    workerPrefix: null,
    status: "ONLINE",
    lastOkAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastLatencyMs: null,
    lastSyncAt: null,
    priority: 1,
    enabled: true,
    poolName: "",
    payoutScheme: "FPPS",
    ...over,
  };
}

function stubFetch(json: unknown) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => json,
  }));
  vi.stubGlobal("fetch", fn as unknown as typeof fetch);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TEST_ACCOUNT;
});

describe("ProviderFacade", () => {
  const fake: MiningProviderAdapter = {
    id: "fake",
    name: "fake",
    kind: "MOCK",
    isLive: false,
    async fetchWorkers() {
      return {
        readings: [
          mkReading("w1", 100, 5000, 50),
          mkReading("w2", 50, 3000, 30),
        ],
        reportedTotalHashrateThs: null,
        fetchedAt: new Date().toISOString(),
      };
    },
    async healthCheck() {
      return { status: "ONLINE", latencyMs: 1, message: null };
    },
    async getPayoutHistory() {
      return [
        { externalPayoutId: "p1", amountBtc: "0.00100000", paidAt: new Date().toISOString(), txId: null },
        { externalPayoutId: "p2", amountBtc: "0.00200000", paidAt: new Date().toISOString(), txId: null },
      ];
    },
  };

  it("getHashrate は fetchWorkers の合計を返す", async () => {
    const facade = new ProviderFacade(fake);
    const h = await facade.getHashrate();
    expect(h.value).toBe(150);
    expect(h.source).toContain("mock:"); // isLive=false → mock: プレフィックス
    expect(h.isEstimate).toBe(false);
  });

  it("shares とワーカー状態の派生", async () => {
    const facade = new ProviderFacade(fake);
    expect((await facade.getAcceptedShares()).value).toBe(8000);
    expect((await facade.getRejectedShares()).value).toBe(80);
    const status = await facade.getWorkerStatus();
    expect(status.value.w1).toBe("ACTIVE");
  });

  it("getActualRevenue は payout 合計（satoshi 正確）", async () => {
    const facade = new ProviderFacade(fake);
    const actual = await facade.getActualRevenue();
    expect(actual!.value).toBe("0.00300000");
    expect(actual!.isEstimate).toBe(false);
  });

  it("payout 非対応アダプタでは null（0 を装わない）", async () => {
    const noPayout: MiningProviderAdapter = {
      ...fake,
      getPayoutHistory: undefined,
    };
    const facade = new ProviderFacade(noPayout);
    expect(await facade.getActualRevenue()).toBeNull();
    expect(await facade.getPayoutHistory()).toBeNull();
  });
});

describe("F2PoolAdapter（レスポンス解析）", () => {
  it("worker 行と payout_history を正規化する", async () => {
    process.env.TEST_ACCOUNT = "myaccount";
    const nowSec = Math.floor(Date.now() / 1000);
    stubFetch({
      hashrate: 150e12, // 150 TH/s (H/s 単位)
      workers: [
        ["worker1", 100e12, 100e12, 95e12, 1e12, 0, nowSec], // 最終 share 直近
        ["worker2", 0, 0, 50e12, 0, 0, nowSec - 3600], // 1時間 share なし → OFFLINE
      ],
      balance: 0.005,
      paid: 1.25,
      payout_history: [
        ["2026-08-01", "txid-abc", 0.01],
        ["2026-08-02", "", 0.02],
      ],
    });

    const adapter = new F2PoolAdapter(provider({ credentialsRef: "test/account" }));
    const result = await adapter.fetchWorkers();
    expect(result.reportedTotalHashrateThs).toBeCloseTo(150, 5);
    expect(result.readings[0].hashrateThs).toBeCloseTo(100, 5);
    expect(result.readings[0].workerStatus).toBe("ACTIVE");
    expect(result.readings[1].workerStatus).toBe("OFFLINE");

    const balance = await adapter.getPoolBalance();
    expect(balance.unpaidBtc).toBe("0.00500000");
    expect(balance.paidBtc).toBe("1.25000000");
    expect(balance.isEstimate).toBe(false);

    const payouts = await adapter.getPayoutHistory();
    expect(payouts).toHaveLength(2);
    expect(payouts[0].externalPayoutId).toBe("txid-abc");
    expect(payouts[0].amountBtc).toBe("0.01000000");
    // txid が無い行は日付+金額の決定的 ID
    expect(payouts[1].externalPayoutId).toContain("2026-08-02");
  });

  it("アカウント未設定なら明示的に失敗する（黙って空を返さない）", async () => {
    const adapter = new F2PoolAdapter(provider({ credentialsRef: "unset/ref" }));
    await expect(adapter.fetchWorkers()).rejects.toThrow(/アカウント名が未設定/);
  });
});

describe("BraiinsPoolAdapter（レスポンス解析）", () => {
  it("workers と rewards を正規化する", async () => {
    process.env.TEST_ACCOUNT = "braiins-token";
    stubFetch({
      btc: {
        workers: {
          "acct.w1": {
            state: "ok",
            hash_rate_5m: 110,
            hash_rate_24h: 105,
            hash_rate_unit: "TH/s",
            shares_5m: 1234,
          },
        },
        rewards: [{ date: "2026-08-07", total_reward: 0.00123456 }],
        confirmed_reward: 0.001,
        unconfirmed_reward: 0.0005,
        all_time_reward: 0.5,
      },
    });

    const adapter = new BraiinsPoolAdapter(provider({ kind: "BRAIINS", credentialsRef: "test/account" }));
    const result = await adapter.fetchWorkers();
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0].hashrateThs).toBeCloseTo(110, 5);
    expect(result.readings[0].workerStatus).toBe("ACTIVE");

    const payouts = await adapter.getPayoutHistory();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amountBtc).toBe("0.00123456");

    const balance = await adapter.getPoolBalance();
    expect(balance.unpaidBtc).toBe("0.00150000");
  });

  it("トークン未設定なら明示的に失敗する", async () => {
    const adapter = new BraiinsPoolAdapter(
      provider({ kind: "BRAIINS", credentialsRef: "unset/token" }),
    );
    await expect(adapter.fetchWorkers()).rejects.toThrow(/トークンが見つかりません/);
  });
});

describe("CustomerOwnedMinerAdapter（委譲）", () => {
  it("poolName で委譲先を選び、fetchWorkers を委譲する", async () => {
    process.env.TEST_ACCOUNT = "myaccount";
    stubFetch({ hashrate: 10e12, workers: [], balance: 0, paid: 0, payout_history: [] });
    const adapter = new CustomerOwnedMinerAdapter(
      provider({ kind: "CUSTOMER_OWNED", poolName: "f2pool", credentialsRef: "test/account" }),
    );
    const result = await adapter.fetchWorkers();
    expect(result.reportedTotalHashrateThs).toBeCloseTo(10, 5);
    // 委譲先（F2Pool）が payout 対応 → ケイパビリティが公開される
    expect(adapter.getPayoutHistory).toBeDefined();
  });

  it("不明な委譲先を拒否する", () => {
    expect(
      () =>
        new CustomerOwnedMinerAdapter(
          provider({ kind: "CUSTOMER_OWNED", poolName: "unknown-pool" }),
        ),
    ).toThrow(/委譲先プールが不明/);
  });
});

function mkReading(id: string, ths: number, accepted: number, rejected: number) {
  return {
    externalWorkerId: id,
    minerId: "",
    model: "",
    hashrateThs: ths,
    hashrate1hThs: ths,
    ratedHashrateThs: ths,
    ratedEfficiencyJPerTh: 17,
    acceptedShares: accepted,
    rejectedShares: rejected,
    temperatureC: null,
    powerW: null,
    uptimeSec: 1000,
    poolStatus: "connected",
    workerStatus: "ACTIVE" as const,
    lastShareAt: null,
    estimatedEarningsBtc: null,
  };
}
