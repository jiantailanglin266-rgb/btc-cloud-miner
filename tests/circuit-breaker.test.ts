import { describe, it, expect } from "vitest";
import { CircuitBreaker, CircuitOpenError, TimeoutError } from "@/lib/circuit-breaker";

/** テスト用に時刻を操作できる breaker を作る */
function makeBreaker(over: { failureThreshold?: number; resetMs?: number } = {}) {
  let now = 1_000_000;
  const breaker = new CircuitBreaker({
    name: "test",
    failureThreshold: over.failureThreshold ?? 3,
    resetMs: over.resetMs ?? 60_000,
    timeoutMs: 500,
    now: () => now,
  });
  return { breaker, advance: (ms: number) => (now += ms) };
}

const fail = () => Promise.reject(new Error("boom"));
const succeed = () => Promise.resolve("ok");

describe("CircuitBreaker", () => {
  it("成功時は CLOSED のまま", async () => {
    const { breaker } = makeBreaker();
    expect(await breaker.run(succeed, 0)).toBe("ok");
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("閾値まで失敗すると OPEN になる", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(breaker.run(fail, 0)).rejects.toThrow("boom");
    }
    expect(breaker.getState()).toBe("OPEN");
  });

  it("OPEN 中は即座に CircuitOpenError（相手を呼ばない）", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 1 });
    await expect(breaker.run(fail, 0)).rejects.toThrow("boom");
    let called = false;
    await expect(
      breaker.run(() => {
        called = true;
        return succeed();
      }, 0),
    ).rejects.toThrow(CircuitOpenError);
    expect(called).toBe(false); // ★ 呼ばれていないことが重要
  });

  it("resetMs 経過後は HALF_OPEN になり、成功すれば CLOSED に復帰する", async () => {
    const { breaker, advance } = makeBreaker({ failureThreshold: 1, resetMs: 60_000 });
    await expect(breaker.run(fail, 0)).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");

    advance(61_000);
    expect(breaker.getState()).toBe("HALF_OPEN");

    expect(await breaker.run(succeed, 0)).toBe("ok");
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("HALF_OPEN で失敗すると即 OPEN に戻る", async () => {
    const { breaker, advance } = makeBreaker({ failureThreshold: 2, resetMs: 60_000 });
    await expect(breaker.run(fail, 0)).rejects.toThrow();
    await expect(breaker.run(fail, 0)).rejects.toThrow();
    advance(61_000);
    expect(breaker.getState()).toBe("HALF_OPEN");
    await expect(breaker.run(fail, 0)).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("OPEN");
  });

  it("リトライ後に成功すれば失敗にカウントしない", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 2 });
    let attempts = 0;
    const flaky = () => {
      attempts++;
      return attempts < 2 ? Promise.reject(new Error("flaky")) : Promise.resolve("ok");
    };
    expect(await breaker.run(flaky, 2)).toBe("ok");
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getStats().consecutiveFailures).toBe(0);
  });

  it("タイムアウトを失敗として扱う", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 1 });
    const slow = () => new Promise<string>((r) => setTimeout(() => r("late"), 2000));
    await expect(breaker.run(slow, 0)).rejects.toThrow(TimeoutError);
    expect(breaker.getState()).toBe("OPEN");
  });

  it("手動リセットで CLOSED に戻る", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 1 });
    await expect(breaker.run(fail, 0)).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");
    breaker.reset();
    expect(breaker.getState()).toBe("CLOSED");
  });
});
