/**
 * TEST CONNECTION（フェーズ4）
 *
 * プロバイダー登録時に実 API を1回叩き、結果を分類して返す。
 * 例外の種別から CONNECTED / AUTHENTICATION_FAILED / RATE_LIMITED / TIMEOUT /
 * INVALID_RESPONSE / PROVIDER_OFFLINE を判定する。
 *
 * ★ この関数は実 API へ接続する。呼び出しは管理者操作に限る。
 */

import type { MiningProvider, TestConnectionResult } from "@/types";
import { createAdapter } from "./registry";
import { F2PoolAdapter, F2PoolAuthError, F2PoolRateLimitError, F2PoolInvalidResponseError } from "./adapters/f2pool";
import { TimeoutError } from "@/lib/circuit-breaker";

export async function testProviderConnection(
  provider: MiningProvider,
): Promise<TestConnectionResult> {
  const started = Date.now();

  // F2Pool は probe() で詳細情報を返せる
  if (provider.kind === "F2POOL") {
    const adapter = new F2PoolAdapter(provider);
    try {
      const p = await adapter.probe();
      return {
        code: "CONNECTED",
        latencyMs: p.latencyMs,
        info: {
          provider: provider.name,
          account: p.account,
          workerCount: p.workerCount,
          currentHashrateThs: p.currentHashrateThs,
          unpaidBtc: p.unpaidBtc,
          paidBtc: p.paidBtc,
        },
        message: "接続に成功しました",
      };
    } catch (err) {
      return classifyError(err, Date.now() - started);
    }
  }

  // その他のプロバイダーは healthCheck + fetchWorkers で判定する
  try {
    const adapter = createAdapter(provider, []);
    const health = await adapter.healthCheck();
    if (health.status === "OFFLINE") {
      return {
        code: "PROVIDER_OFFLINE",
        latencyMs: health.latencyMs,
        info: null,
        message: health.message ?? "プロバイダーに接続できません",
      };
    }
    const result = await adapter.fetchWorkers();
    let unpaidBtc: string | null = null;
    let paidBtc: string | null = null;
    if (adapter.getPoolBalance) {
      try {
        const b = await adapter.getPoolBalance();
        unpaidBtc = b.unpaidBtc;
        paidBtc = b.paidBtc;
      } catch {
        /* balance は任意。取れなくても接続成功は成立する */
      }
    }
    return {
      code: "CONNECTED",
      latencyMs: health.latencyMs,
      info: {
        provider: provider.name,
        account: null,
        workerCount: result.readings.length,
        currentHashrateThs:
          result.reportedTotalHashrateThs ??
          result.readings.reduce((s, w) => s + w.hashrateThs, 0),
        unpaidBtc,
        paidBtc,
      },
      message: "接続に成功しました",
    };
  } catch (err) {
    return classifyError(err, Date.now() - started);
  }
}

function classifyError(err: unknown, latencyMs: number): TestConnectionResult {
  const base = { latencyMs, info: null } as const;
  const msg = err instanceof Error ? err.message : String(err);

  if (err instanceof F2PoolAuthError || /認証|auth|401|403|トークン|アカウント名/i.test(msg)) {
    return { ...base, code: "AUTHENTICATION_FAILED", message: msg };
  }
  if (err instanceof F2PoolRateLimitError || /429|rate.?limit|レート制限/i.test(msg)) {
    return { ...base, code: "RATE_LIMITED", message: "レート制限に達しました。時間をおいて再試行してください" };
  }
  if (err instanceof TimeoutError || /timeout|timed out|タイムアウト|AbortError/i.test(msg)) {
    return { ...base, code: "TIMEOUT", message: "接続がタイムアウトしました" };
  }
  if (err instanceof F2PoolInvalidResponseError || /想定外|invalid|parse|JSON/i.test(msg)) {
    return { ...base, code: "INVALID_RESPONSE", message: "想定外のレスポンス形式です" };
  }
  return { ...base, code: "PROVIDER_OFFLINE", message: msg };
}
