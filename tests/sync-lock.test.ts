/**
 * 同期ロック（フェーズ7）のテスト。
 * 二重同期・二重 payout を防ぐ排他制御を検証。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { memoryStore, resetMemoryStore } from "@/lib/store/memory";

describe("同期ロック（store.acquireLock / releaseLock）", () => {
  beforeEach(() => resetMemoryStore());

  it("空きロックは取得できる", async () => {
    expect(await memoryStore.acquireLock("provider-sync:t1", "holderA", 60_000)).toBe(true);
  });

  it("他者が保持中のロックは取得できない（二重同期の防止）", async () => {
    await memoryStore.acquireLock("payout-sync:t1", "holderA", 60_000);
    expect(await memoryStore.acquireLock("payout-sync:t1", "holderB", 60_000)).toBe(false);
  });

  it("同じ保持者は再取得（延長）できる（再入可能）", async () => {
    await memoryStore.acquireLock("k", "holderA", 60_000);
    expect(await memoryStore.acquireLock("k", "holderA", 60_000)).toBe(true);
  });

  it("解放後は他者が取得できる", async () => {
    await memoryStore.acquireLock("k", "holderA", 60_000);
    await memoryStore.releaseLock("k", "holderA");
    expect(await memoryStore.acquireLock("k", "holderB", 60_000)).toBe(true);
  });

  it("TTL 切れのロックは他者が奪取できる（デッドロック防止）", async () => {
    // 過去に期限切れになるロックを直接注入する代わりに ttl=0 で取得→即失効を確認
    await memoryStore.acquireLock("k", "holderA", 0);
    // 0ms TTL は即座に期限切れ扱い → 他者取得可
    await new Promise((r) => setTimeout(r, 5));
    expect(await memoryStore.acquireLock("k", "holderB", 60_000)).toBe(true);
  });

  it("他者のロックは解放できない", async () => {
    await memoryStore.acquireLock("k", "holderA", 60_000);
    await memoryStore.releaseLock("k", "holderB"); // 効果なし
    expect(await memoryStore.acquireLock("k", "holderC", 60_000)).toBe(false);
  });
});
