/**
 * テナント分離のテスト（セキュリティ上の最重要テスト）。
 *
 * 「テナント A の ID を知っていても、テナント B のコンテキストからは何も見えない」
 * ことを Store レベルで検証する。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { memoryStore, resetMemoryStore, DEFAULT_TENANT_ID, ACME_TENANT_ID } from "@/lib/store/memory";
import { extractSlugFromHost } from "@/modules/tenant/resolve";

beforeEach(() => {
  resetMemoryStore();
});

describe("Store レベルのテナント分離", () => {
  it("他テナントのユーザーは email で引けない", async () => {
    // demo@example.com は DEFAULT テナントのユーザー
    const own = await memoryStore.getUserByEmail(DEFAULT_TENANT_ID, "demo@example.com");
    expect(own).not.toBeNull();

    const cross = await memoryStore.getUserByEmail(ACME_TENANT_ID, "demo@example.com");
    expect(cross).toBeNull();
  });

  it("他テナントのユーザーは ID を知っていても引けない", async () => {
    const cross = await memoryStore.getUserById(ACME_TENANT_ID, "user-demo");
    expect(cross).toBeNull();
  });

  it("他テナントの出金は ID を知っていても引けない", async () => {
    const own = await memoryStore.getWithdrawal(DEFAULT_TENANT_ID, "wd-1002");
    expect(own).not.toBeNull();
    const cross = await memoryStore.getWithdrawal(ACME_TENANT_ID, "wd-1002");
    expect(cross).toBeNull();
  });

  it("他テナントの元帳は読めない", async () => {
    const entries = await memoryStore.listLedgerEntries(ACME_TENANT_ID, "acct-user-demo");
    expect(entries).toHaveLength(0);
  });

  it("ユーザー一覧はテナント内に閉じる", async () => {
    const defaultUsers = await memoryStore.listUsers(DEFAULT_TENANT_ID);
    const acmeUsers = await memoryStore.listUsers(ACME_TENANT_ID);
    expect(defaultUsers.length).toBeGreaterThan(0);
    expect(acmeUsers.length).toBeGreaterThan(0);
    const overlap = defaultUsers.filter((u) => acmeUsers.some((a) => a.id === u.id));
    expect(overlap).toHaveLength(0);
  });

  it("監査ログはテナント内に閉じる", async () => {
    const logs = await memoryStore.listAuditLogs(ACME_TENANT_ID);
    for (const log of logs) expect(log.tenantId).toBe(ACME_TENANT_ID);
  });

  it("テナント設定は独立している（ホワイトラベルの手数料上書き）", async () => {
    const def = await memoryStore.getTenantSettings(DEFAULT_TENANT_ID);
    const acme = await memoryStore.getTenantSettings(ACME_TENANT_ID);
    expect(def.brandName).not.toBe(acme.brandName);
    expect(def.platformFeeRate).not.toBe(acme.platformFeeRate);

    // 片方を変更してももう片方に影響しない
    await memoryStore.updateTenantSettings(ACME_TENANT_ID, { platformFeeRate: 0.05 });
    const defAfter = await memoryStore.getTenantSettings(DEFAULT_TENANT_ID);
    expect(defAfter.platformFeeRate).toBe(def.platformFeeRate);
  });
});

describe("テナント解決（Host ヘッダ）", () => {
  it("サブドメインから slug を抽出する", () => {
    expect(extractSlugFromHost("acme.btccloudminer.io")).toBe("acme");
    expect(extractSlugFromHost("acme.btccloudminer.io:3000")).toBe("acme");
  });

  it("サブドメインなし・localhost・IP は null（既定テナント）", () => {
    expect(extractSlugFromHost("btccloudminer.io")).toBeNull();
    expect(extractSlugFromHost("localhost:3000")).toBeNull();
    expect(extractSlugFromHost("127.0.0.1:3000")).toBeNull();
    expect(extractSlugFromHost(null)).toBeNull();
  });

  it("www / app は slug として扱わない", () => {
    expect(extractSlugFromHost("www.btccloudminer.io")).toBeNull();
    expect(extractSlugFromHost("app.btccloudminer.io")).toBeNull();
  });
});
