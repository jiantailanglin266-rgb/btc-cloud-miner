/**
 * 出金モード（フェーズ9）のテスト
 *   - Sandbox プロバイダーの安全弁（mainnet 拒否・意図的失敗・冪等）
 *   - 金額上限（Amount Limit）
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SandboxWalletProvider } from "@/modules/wallet/providers/sandbox-custodian";
import { MockWalletProvider } from "@/modules/wallet/providers/mock-custodian";
import { requestWithdrawal, WithdrawalError } from "@/modules/wallet";
import { memoryStore, resetMemoryStore, DEFAULT_TENANT_ID } from "@/lib/store/memory";

// BIP-173 公式テストベクタのアドレス
const MAINNET_ADDR = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TESTNET_ADDR = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

describe("SandboxWalletProvider", () => {
  const sandbox = new SandboxWalletProvider();

  it("isLive=false（実送金しない）", () => {
    expect(sandbox.isLive).toBe(false);
  });

  it("★ mainnet アドレスを拒否する（sandbox からの誤送金防止）", async () => {
    await expect(
      sandbox.send({ toAddress: MAINNET_ADDR, amountBtc: "0.00100000", idempotencyKey: "k1" }),
    ).rejects.toThrow(/mainnet/);
  });

  it("testnet アドレスへは sandbox txid を返す", async () => {
    const result = await sandbox.send({
      toAddress: TESTNET_ADDR,
      amountBtc: "0.00100000",
      idempotencyKey: "k2",
    });
    expect(result.txId.startsWith("sandbox-")).toBe(true);
  });

  it("冪等: 同じキーは同じ結果（二重送金しない）", async () => {
    const a = await sandbox.send({
      toAddress: TESTNET_ADDR,
      amountBtc: "0.00100000",
      idempotencyKey: "k3",
    });
    const b = await sandbox.send({
      toAddress: TESTNET_ADDR,
      amountBtc: "0.00100000",
      idempotencyKey: "k3",
    });
    expect(a.txId).toBe(b.txId);
  });

  it("末尾 satoshi=9 で意図的に失敗する（補償トランザクション検証用）", async () => {
    await expect(
      sandbox.send({ toAddress: TESTNET_ADDR, amountBtc: "0.00100009", idempotencyKey: "k4" }),
    ).rejects.toThrow(/意図的な送金失敗/);
  });
});

describe("MockWalletProvider", () => {
  it("demo- txid を返し、冪等", async () => {
    const mock = new MockWalletProvider();
    const a = await mock.send({ toAddress: MAINNET_ADDR, amountBtc: "0.001", idempotencyKey: "m1" });
    const b = await mock.send({ toAddress: MAINNET_ADDR, amountBtc: "0.001", idempotencyKey: "m1" });
    expect(a.txId.startsWith("demo-")).toBe(true);
    expect(a.txId).toBe(b.txId);
  });
});

describe("出金上限（requestWithdrawal）", () => {
  beforeEach(() => resetMemoryStore());

  async function demoContext() {
    const user = (await memoryStore.getUserByEmail(DEFAULT_TENANT_ID, "demo@example.com"))!;
    const settings = await memoryStore.getTenantSettings(DEFAULT_TENANT_ID);
    return { user, settings };
  }

  it("1回あたり上限（0.5 BTC）を超える申請を拒否する", async () => {
    const { user, settings } = await demoContext();
    await expect(
      requestWithdrawal({
        user,
        settings,
        addressId: "addr-1",
        amountBtc: "0.60000000",
        idempotencyKey: "test-over-max",
        ip: "203.0.113.20",
        userAgent: null,
      }),
    ).rejects.toThrow(/出金上限/);
  });

  it("残高不足を拒否し、レコードを作らない", async () => {
    const { user, settings } = await demoContext();
    await expect(
      requestWithdrawal({
        user,
        settings,
        addressId: "addr-1",
        amountBtc: "0.40000000", // 上限内だが残高（約0.029）超
        idempotencyKey: "test-insufficient",
        ip: "203.0.113.20",
        userAgent: null,
      }),
    ).rejects.toThrow(/残高が不足/);
    const list = await memoryStore.listWithdrawals(DEFAULT_TENANT_ID, { userId: user.id });
    expect(list.some((w) => w.idempotencyKey === "test-insufficient")).toBe(false);
  });

  it("正常な申請は PENDING_REVIEW で作成され、冪等キー再送で同一レコードを返す", async () => {
    const { user, settings } = await demoContext();
    const params = {
      user,
      settings,
      addressId: "addr-1",
      amountBtc: "0.00200000",
      idempotencyKey: "test-ok",
      ip: "203.0.113.20",
      userAgent: null,
    };
    const first = await requestWithdrawal(params);
    expect(first.status).toBe("PENDING_REVIEW");
    const second = await requestWithdrawal(params);
    expect(second.id).toBe(first.id); // 二重申請されない
  });
});
