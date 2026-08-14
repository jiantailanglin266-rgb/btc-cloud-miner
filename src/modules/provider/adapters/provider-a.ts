/**
 * ProviderAAdapter — クラウドマイニング事業者 A 向けアダプタ（テンプレート）
 *
 * ★ これは実際の事業者に接続する実装ではない。★
 *   契約が成立した時点で、以下の 3 箇所を実 API に合わせて埋めるだけで動くように、
 *   構造だけを先に用意してある。アプリの他の部分は一切変更不要。
 *
 *     1. buildRequest()  — 認証方式・エンドポイント・クエリ
 *     2. parseWorkers()  — レスポンス → ProviderWorkerReading[] への正規化
 *     3. healthCheck()   — 疎通確認の方法
 *
 *   埋めていない状態で本番実行された場合は、黙って空データを返すのではなく
 *   例外を投げる（「繋がっているように見えて実は繋がっていない」状態を作らない）。
 */

import type { MiningProvider, ProviderWorkerReading } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
} from "../interface";
import { normalizeWorkerStatus, safeNumber, safeNullableNumber } from "../interface";
import { toEnvName } from "./pool-rest";
import { config } from "@/lib/config";

export class NotImplementedProviderError extends Error {
  constructor(providerName: string) {
    super(
      `プロバイダー「${providerName}」のアダプタは未実装です。` +
        `src/modules/provider/adapters/provider-a.ts の parseWorkers() を実 API に合わせて実装してください。`,
    );
    this.name = "NotImplementedProviderError";
  }
}

export class ProviderAAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "PROVIDER_A" as const;
  readonly isLive = true;

  private readonly endpoint: string;
  private readonly apiKey: string | null;

  constructor(private readonly provider: MiningProvider) {
    this.id = provider.id;
    this.name = provider.name;
    this.endpoint = (provider.endpoint ?? "").replace(/\/$/, "");
    this.apiKey = provider.credentialsRef
      ? (process.env[toEnvName(provider.credentialsRef)] ?? null)
      : null;
  }

  /** ① 認証方式・エンドポイントを実 API に合わせる */
  private buildRequest(path: string): [string, RequestInit] {
    if (!this.endpoint) {
      throw new NotImplementedProviderError(this.name);
    }
    return [
      `${this.endpoint}${path}`,
      {
        headers: {
          Accept: "application/json",
          // 事業者により X-API-KEY / Bearer / HMAC 署名など様々。ここで吸収する
          ...(this.apiKey ? { "X-API-KEY": this.apiKey } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(config.mining.timeoutMs),
      },
    ];
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    const [url, init] = this.buildRequest("/v1/mining/workers");
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new Error(`Provider A API エラー: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as unknown;
    return {
      readings: this.parseWorkers(json),
      reportedTotalHashrateThs: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** ② レスポンスの正規化。実 API のフィールド名に合わせて書き換える */
  private parseWorkers(json: unknown): ProviderWorkerReading[] {
    const arr = Array.isArray(json)
      ? json
      : ((json as { workers?: unknown[] })?.workers ?? null);

    if (!Array.isArray(arr)) {
      // 想定した形でなければ、推測で埋めずに失敗させる
      throw new NotImplementedProviderError(this.name);
    }

    return arr.map((raw) => {
      const w = raw as Record<string, unknown>;
      return {
        externalWorkerId: String(w.worker_id ?? w.id ?? "unknown"),
        minerId: String(w.miner_serial ?? ""),
        model: String(w.model ?? "unknown"),
        hashrateThs: safeNumber(w.hashrate_ths, { max: 1e9 }),
        hashrate1hThs: safeNullableNumber(w.hashrate_1h_ths, { min: 0, max: 1e9 }),
        ratedHashrateThs: safeNumber(w.rated_hashrate_ths, { max: 1e9 }),
        ratedEfficiencyJPerTh: safeNumber(w.efficiency_j_per_th, { max: 1000 }),
        acceptedShares: safeNumber(w.accepted_shares, { max: 1e15 }),
        rejectedShares: safeNumber(w.rejected_shares, { max: 1e15 }),
        temperatureC: safeNullableNumber(w.temperature_c, { min: -50, max: 200 }),
        powerW: safeNullableNumber(w.power_w, { min: 0, max: 1e6 }),
        uptimeSec: safeNumber(w.uptime_sec, { max: 1e9 }),
        poolStatus: String(w.pool_status ?? "unknown"),
        workerStatus: normalizeWorkerStatus(String(w.status ?? "")),
        lastShareAt:
          typeof w.last_share_at === "string" && Number.isFinite(Date.parse(w.last_share_at))
            ? new Date(w.last_share_at).toISOString()
            : null,
        estimatedEarningsBtc:
          typeof w.estimated_earnings_btc === "string" ? w.estimated_earnings_btc : null,
      };
    });
  }

  /** ③ 疎通確認 */
  async healthCheck(): Promise<ProviderHealthResult> {
    const started = Date.now();
    try {
      const [url, init] = this.buildRequest("/v1/status");
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - started;
      return {
        status: res.ok ? (latencyMs > 3000 ? "DEGRADED" : "ONLINE") : "DEGRADED",
        latencyMs,
        message: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        status: "OFFLINE",
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : "接続できません",
      };
    }
  }
}
