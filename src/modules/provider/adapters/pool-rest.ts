/**
 * MiningPoolAdapter — マイニングプールの REST API からワーカー統計を取得する
 *
 * 多くのプール（および多くのクラウドマイニング事業者）は
 * 「アカウントのワーカー一覧と統計」を返す REST API を提供している。
 * レスポンス形式はプールごとに違うため、ここで本システムの形へ正規化する。
 *
 * 本アダプタは「よくある形」に対応する汎用実装。
 * 実際のプールに繋ぐ際は parseResponse() を実プールの形式に合わせて調整する。
 * （どこを直せばよいかが1箇所に閉じているのが、この設計の価値）
 */

import type { MiningProvider, ProviderWorkerReading } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
} from "../interface";
import { normalizeWorkerStatus, safeNumber, safeNullableNumber } from "../interface";
import { config } from "@/lib/config";

/** よくあるプール API のレスポンス形（実プールに合わせて調整する） */
type RawWorker = Record<string, unknown>;

export class PoolRestAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "POOL_REST" as const;
  readonly isLive = true;

  private readonly endpoint: string;
  private readonly apiKey: string | null;

  constructor(provider: MiningProvider) {
    if (!provider.endpoint) {
      throw new Error(`プロバイダー ${provider.name} に endpoint が設定されていません`);
    }
    this.id = provider.id;
    this.name = provider.name;
    this.endpoint = provider.endpoint.replace(/\/$/, "");
    // ★ credentialsRef は Secrets Manager のキー名。
    //   本番ではここで Secrets Manager から解決する。
    //   MVP では同名の環境変数を見る（値を DB に置かないという原則は守られる）。
    this.apiKey = provider.credentialsRef
      ? (process.env[toEnvName(provider.credentialsRef)] ?? null)
      : null;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    const res = await fetch(`${this.endpoint}/workers`, {
      headers: this.headers(),
      // Next.js のキャッシュを効かせない（統計は常に最新を取る）
      cache: "no-store",
      signal: AbortSignal.timeout(config.mining.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`プール API がエラーを返しました: ${res.status} ${res.statusText}`);
    }

    const json: unknown = await res.json();
    return {
      readings: this.parseResponse(json),
      reportedTotalHashrateThs: extractTotal(json),
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * ★ 実プール接続時に調整するのはこの関数だけ。
   * 外部から来た値は一切信用せず、safeNumber で範囲を検証してから取り込む。
   */
  private parseResponse(json: unknown): ProviderWorkerReading[] {
    const list = extractWorkerArray(json);
    return list.map((w) => {
      // ハッシュレートの単位はプールにより GH/s・TH/s・H/s と揺れる。
      // 単位フィールドがあれば従い、無ければ TH/s とみなす。
      const rawHashrate = safeNumber(pick(w, ["hashrate", "hashrate_1h", "hs", "speed"]), {
        max: 1e12,
      });
      const unit = String(pick(w, ["unit", "hashrate_unit"]) ?? "TH").toUpperCase();
      const hashrateThs = toThs(rawHashrate, unit);

      return {
        externalWorkerId: String(pick(w, ["worker", "worker_name", "name", "id"]) ?? "unknown"),
        minerId: String(pick(w, ["miner_id", "minerId", "device_id"]) ?? ""),
        model: String(pick(w, ["model", "device_model", "hardware"]) ?? "unknown"),
        hashrateThs,
        ratedHashrateThs: toThs(
          safeNumber(pick(w, ["rated_hashrate", "nominal_hashrate"]), { max: 1e12 }),
          unit,
        ),
        ratedEfficiencyJPerTh: safeNumber(
          pick(w, ["efficiency", "j_per_th", "power_efficiency"]),
          { max: 1000, fallback: 0 },
        ),
        acceptedShares: safeNumber(pick(w, ["accepted", "accepted_shares", "shares_accepted"]), {
          max: 1e15,
        }),
        rejectedShares: safeNumber(pick(w, ["rejected", "rejected_shares", "shares_rejected"]), {
          max: 1e15,
        }),
        temperatureC: safeNullableNumber(pick(w, ["temperature", "temp", "temp_c"]), {
          min: -50,
          max: 200,
        }),
        powerW: safeNullableNumber(pick(w, ["power", "power_w", "watts"]), { min: 0, max: 1e6 }),
        uptimeSec: safeNumber(pick(w, ["uptime", "uptime_sec", "uptime_seconds"]), {
          max: 1e9,
        }),
        poolStatus: String(pick(w, ["pool_status", "connection"]) ?? "unknown"),
        workerStatus: normalizeWorkerStatus(
          String(pick(w, ["status", "state", "worker_status"]) ?? ""),
        ),
        estimatedEarningsBtc: null,
      };
    });
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.endpoint}/health`, {
        headers: this.headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return { status: "DEGRADED", latencyMs, message: `HTTP ${res.status}` };
      }
      // 応答はあるが遅い場合は DEGRADED にする（気付けるようにする）
      return {
        status: latencyMs > 3000 ? "DEGRADED" : "ONLINE",
        latencyMs,
        message: latencyMs > 3000 ? "応答が遅延しています" : null,
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

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function pick(obj: RawWorker, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function toThs(value: number, unit: string): number {
  if (unit.startsWith("H")) return value / 1e12;
  if (unit.startsWith("K")) return value / 1e9;
  if (unit.startsWith("M")) return value / 1e6;
  if (unit.startsWith("G")) return value / 1e3;
  if (unit.startsWith("P")) return value * 1e3;
  if (unit.startsWith("E")) return value * 1e6;
  return value; // TH/s
}

function extractWorkerArray(json: unknown): RawWorker[] {
  if (Array.isArray(json)) return json as RawWorker[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["workers", "data", "result", "items"]) {
      const v = o[key];
      if (Array.isArray(v)) return v as RawWorker[];
      if (v && typeof v === "object") {
        const inner = (v as Record<string, unknown>).workers;
        if (Array.isArray(inner)) return inner as RawWorker[];
      }
    }
  }
  return [];
}

function extractTotal(json: unknown): number | null {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const v = o.total_hashrate ?? o.totalHashrate ?? o.hashrate;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** `btc-cloud-miner/pool/api-key` → `BTC_CLOUD_MINER_POOL_API_KEY` */
export function toEnvName(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}
