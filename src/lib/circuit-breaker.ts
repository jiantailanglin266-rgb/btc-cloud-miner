/**
 * 外部呼び出しの保護: timeout → retry → circuit breaker
 *
 * なぜ必要か:
 *   マイニングプロバイダーや BTC 情報 API は必ず落ちる。
 *   落ちた先を叩き続けると、自分のスレッドが詰まって「相手の障害が自分の障害になる」。
 *   circuit breaker は「一定回数失敗したらしばらく呼ばない」ことで、これを断ち切る。
 *
 * 状態遷移:
 *   CLOSED（通常）→ 連続失敗が閾値に到達 → OPEN（呼ばない・即失敗）
 *   OPEN → resetMs 経過 → HALF_OPEN（1回だけ試す）
 *   HALF_OPEN → 成功なら CLOSED / 失敗なら OPEN に戻る
 */

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitOpenError extends Error {
  constructor(name: string, public readonly retryAfterMs: number) {
    super(`circuit breaker が開いています: ${name}（あと ${Math.ceil(retryAfterMs / 1000)} 秒）`);
    this.name = "CircuitOpenError";
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`タイムアウトしました（${ms}ms）`);
    this.name = "TimeoutError";
  }
}

export type CircuitBreakerOptions = {
  name: string;
  failureThreshold?: number;
  resetMs?: number;
  timeoutMs?: number;
  /** テスト用に時刻を差し替える */
  now?: () => number;
};

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  private state: BreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetMs = opts.resetMs ?? 60_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.now = opts.now ?? (() => Date.now());
  }

  getState(): BreakerState {
    // OPEN のまま resetMs を過ぎていたら HALF_OPEN に遷移させる（遅延評価）
    if (this.state === "OPEN" && this.now() - this.openedAt >= this.resetMs) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  getStats() {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
    };
  }

  /**
   * 保護付きで実行する。
   * retries は「追加の再試行回数」（1 なら最大 2 回実行）。指数バックオフ。
   */
  async run<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    const state = this.getState();
    if (state === "OPEN") {
      throw new CircuitOpenError(this.name, this.resetMs - (this.now() - this.openedAt));
    }

    let lastErr: unknown;
    // HALF_OPEN のときは 1 回だけ試す（様子見なのでリトライしない）
    const attempts = state === "HALF_OPEN" ? 1 : retries + 1;

    for (let i = 0; i < attempts; i++) {
      try {
        const result = await withTimeout(fn(), this.timeoutMs);
        this.onSuccess();
        return result;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          // 指数バックオフ + ジッタ（同時再試行の集中を避ける）
          const backoff = 200 * 2 ** i + Math.floor(Math.random() * 100);
          await sleep(backoff);
        }
      }
    }

    this.onFailure(lastErr);
    throw lastErr;
  }

  private onSuccess() {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.lastSuccessAt = this.now();
    this.lastError = null;
  }

  private onFailure(err: unknown) {
    this.consecutiveFailures++;
    this.lastError = err instanceof Error ? err.message : String(err);
    if (this.consecutiveFailures >= this.failureThreshold || this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = this.now();
    }
  }

  /** 管理者による手動リセット */
  reset() {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.lastError = null;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 名前ごとに breaker を1つだけ持つ（プロセス内で状態を共有する） */
const registry = new Map<string, CircuitBreaker>();

export function getBreaker(opts: CircuitBreakerOptions): CircuitBreaker {
  const existing = registry.get(opts.name);
  if (existing) return existing;
  const breaker = new CircuitBreaker(opts);
  registry.set(opts.name, breaker);
  return breaker;
}

export function allBreakers(): CircuitBreaker[] {
  return [...registry.values()];
}
