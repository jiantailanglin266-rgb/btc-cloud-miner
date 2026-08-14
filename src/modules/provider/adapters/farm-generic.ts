/**
 * GenericMiningFarmProvider — 提携マイニングファーム向け汎用アダプタ（接続モデル A）
 *
 * 想定: 本 SaaS 事業者がファーム事業者と提携し、ファームが提供する管理 API から
 * 「当社契約分のワーカー統計」を取得する。ファームごとに API 形式が違うため、
 * ここでは本システムが定義する「ファーム標準形」を受け口とし、
 * ファーム側にこの形式でのエクスポートを依頼する（または薄い変換プロキシを挟む）。
 *
 * ファーム標準形（endpoint が返すべき JSON）:
 * {
 *   "farm": "reykjavik-01",
 *   "workers": [
 *     { "worker_id": "w1", "miner_serial": "S21-...", "model": "Antminer S21",
 *       "hashrate_ths": 200.5, "rated_ths": 200, "efficiency_j_th": 17.5,
 *       "accepted": 123, "rejected": 1, "temp_c": 62, "power_w": 3500,
 *       "uptime_sec": 86000, "status": "active" }
 *   ],
 *   "payouts": [ { "id": "p-2026-08-01", "amount_btc": "0.015", "paid_at": "...", "txid": null } ]
 * }
 *
 * 認証: Bearer トークン（credentialsRef → 環境変数/Secrets Manager）
 * ★ ファーム固有の変換ロジックが必要になったら、このファイルをコピーして
 *   kind を追加する（サービス本体には一切手を入れない）。
 */

import type { MiningProvider, ProviderWorkerReading } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
  RawPayout,
} from "../interface";
import { normalizeWorkerStatus, safeNumber, safeNullableNumber } from "../interface";
import { toEnvName } from "./pool-rest";
import { formatNumberAsBtc } from "@/lib/decimal";
import { config } from "@/lib/config";

export class GenericMiningFarmAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "FARM_GENERIC" as const;
  readonly isLive = true;

  private readonly endpoint: string;
  private readonly token: string | null;

  constructor(provider: MiningProvider) {
    if (!provider.endpoint) {
      throw new Error(`ファーム「${provider.name}」に endpoint が設定されていません`);
    }
    this.id = provider.id;
    this.name = provider.name;
    this.endpoint = provider.endpoint.replace(/\/$/, "");
    this.token = provider.credentialsRef
      ? (process.env[toEnvName(provider.credentialsRef)] ?? null)
      : null;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { Accept: "application/json" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.endpoint}${path}`, {
      headers: this.headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(config.mining.timeoutMs),
    });
    if (!res.ok) throw new Error(`ファーム API エラー: ${res.status} ${res.statusText}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    const json = await this.get("/v1/export");
    const workers = Array.isArray(json.workers)
      ? (json.workers as Record<string, unknown>[])
      : [];

    const readings: ProviderWorkerReading[] = workers.map((w) => ({
      externalWorkerId: String(w.worker_id ?? "unknown"),
      minerId: String(w.miner_serial ?? ""),
      model: String(w.model ?? ""),
      hashrateThs: safeNumber(w.hashrate_ths, { max: 1e9 }),
      hashrate1hThs: safeNullableNumber(w.hashrate_1h_ths, { min: 0, max: 1e9 }),
      ratedHashrateThs: safeNumber(w.rated_ths, { max: 1e9 }),
      ratedEfficiencyJPerTh: safeNumber(w.efficiency_j_th, { max: 1000 }),
      acceptedShares: safeNumber(w.accepted, { max: 1e15 }),
      rejectedShares: safeNumber(w.rejected, { max: 1e15 }),
      temperatureC: safeNullableNumber(w.temp_c, { min: -50, max: 200 }),
      powerW: safeNullableNumber(w.power_w, { min: 0, max: 1e6 }),
      uptimeSec: safeNumber(w.uptime_sec, { max: 1e9 }),
      poolStatus: String(w.pool_status ?? "unknown"),
      workerStatus: normalizeWorkerStatus(String(w.status ?? "")),
      lastShareAt:
        typeof w.last_share_at === "string" && Number.isFinite(Date.parse(w.last_share_at))
          ? new Date(w.last_share_at).toISOString()
          : null,
      estimatedEarningsBtc: null,
    }));

    return {
      readings,
      reportedTotalHashrateThs: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** ファームが payout（当社取り分の送金記録）も返す場合に対応 */
  async getPayoutHistory(sinceMs?: number): Promise<RawPayout[]> {
    const json = await this.get("/v1/export");
    const payouts = Array.isArray(json.payouts)
      ? (json.payouts as Record<string, unknown>[])
      : [];
    const out: RawPayout[] = [];
    for (const p of payouts) {
      const paidAtMs = Date.parse(String(p.paid_at ?? ""));
      const amount = safeNumber(p.amount_btc, { max: 21_000_000 });
      if (!Number.isFinite(paidAtMs) || amount <= 0 || !p.id) continue;
      if (sinceMs && paidAtMs < sinceMs) continue;
      out.push({
        externalPayoutId: String(p.id),
        amountBtc: formatNumberAsBtc(amount),
        paidAt: new Date(paidAtMs).toISOString(),
        txId: typeof p.txid === "string" ? p.txid : null,
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.endpoint}/v1/health`, {
        headers: this.headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
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
