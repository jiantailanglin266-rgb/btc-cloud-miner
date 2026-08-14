/**
 * ProviderBAdapter — クラウドマイニング事業者 B 向けアダプタ（テンプレート）
 *
 * ProviderA との違いを示すための2例目。
 * 実務では事業者ごとに以下のような差異があり、それを吸収するのがアダプタの役目:
 *
 *   - 認証: API Key ヘッダ / Bearer / HMAC 署名（タイムスタンプ + nonce）
 *   - ページング: offset/limit / cursor / なし
 *   - 単位: TH/s / GH/s / H/s
 *   - 粒度: ワーカー単位 / 契約単位（ワーカー単位で取れない事業者もある）
 *
 * ★ ワーカー単位で取得できない事業者の場合 ★
 *   「契約全体で 500 TH/s」しか返ってこないことがある。
 *   その場合、存在しないワーカーを勝手にでっち上げてはいけない。
 *   契約単位の 1 レコードとして返し、UI 側で「この事業者はワーカー単位の
 *   詳細を提供していません」と明示する。
 */

import type { MiningProvider, ProviderWorkerReading } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
} from "../interface";
import { normalizeWorkerStatus, safeNumber, safeNullableNumber } from "../interface";
import { toEnvName } from "./pool-rest";
import { hmacHex } from "@/lib/crypto";
import { config } from "@/lib/config";

export class ProviderBAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "PROVIDER_B" as const;
  readonly isLive = true;

  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly apiSecret: string | null;

  constructor(provider: MiningProvider) {
    this.id = provider.id;
    this.name = provider.name;
    this.endpoint = (provider.endpoint ?? "").replace(/\/$/, "");
    const base = provider.credentialsRef ? toEnvName(provider.credentialsRef) : null;
    this.apiKey = base ? (process.env[`${base}_KEY`] ?? null) : null;
    this.apiSecret = base ? (process.env[`${base}_SECRET`] ?? null) : null;
  }

  /** HMAC 署名方式の例。署名対象は「メソッド + パス + タイムスタンプ」 */
  private signedHeaders(method: string, path: string): Record<string, string> {
    if (!this.apiKey || !this.apiSecret) return { Accept: "application/json" };
    const ts = Math.floor(Date.now() / 1000).toString();
    const signature = hmacHex(this.apiSecret, `${method}\n${path}\n${ts}`);
    return {
      Accept: "application/json",
      "X-Api-Key": this.apiKey,
      "X-Timestamp": ts,
      "X-Signature": signature,
    };
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    if (!this.endpoint) {
      throw new Error(
        `プロバイダー「${this.name}」に endpoint が設定されていません。` +
          `管理画面から設定するか、アダプタを実 API に合わせて実装してください。`,
      );
    }

    // カーソルページングの例。全件取り切るまでループする
    const readings: ProviderWorkerReading[] = [];
    let cursor: string | null = null;
    let guard = 0;

    do {
      const path = `/api/miners${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(`${this.endpoint}${path}`, {
        headers: this.signedHeaders("GET", path),
        cache: "no-store",
        signal: AbortSignal.timeout(config.mining.timeoutMs),
      });
      if (!res.ok) throw new Error(`Provider B API エラー: ${res.status}`);

      const json = (await res.json()) as {
        miners?: unknown[];
        next_cursor?: string | null;
      };
      for (const raw of json.miners ?? []) {
        readings.push(this.parseMiner(raw as Record<string, unknown>));
      }
      cursor = json.next_cursor ?? null;
      guard++;
    } while (cursor && guard < 100); // 無限ループの保険

    return {
      readings,
      reportedTotalHashrateThs: readings.reduce((s, r) => s + r.hashrateThs, 0),
      fetchedAt: new Date().toISOString(),
    };
  }

  /** この事業者は GH/s で返す想定。単位変換をここで吸収する */
  private parseMiner(m: Record<string, unknown>): ProviderWorkerReading {
    const ghs = safeNumber(m.hashrate_ghs, { max: 1e12 });
    return {
      externalWorkerId: String(m.name ?? m.id ?? "unknown"),
      minerId: String(m.serial ?? ""),
      model: String(m.hardware ?? "unknown"),
      hashrateThs: ghs / 1000,
      hashrate1hThs: safeNullableNumber(m.hashrate_1h_ghs, { min: 0, max: 1e12 })
        ? safeNumber(m.hashrate_1h_ghs, { max: 1e12 }) / 1000
        : null,
      ratedHashrateThs: safeNumber(m.nominal_ghs, { max: 1e12 }) / 1000,
      ratedEfficiencyJPerTh: safeNumber(m.watt_per_ths, { max: 1000 }),
      acceptedShares: safeNumber(m.accepted ?? m.shares_accepted, { max: 1e15 }),
      rejectedShares: safeNumber(m.rejected, { max: 1e15 }),
      temperatureC: safeNullableNumber(m.temp, { min: -50, max: 200 }),
      powerW: safeNullableNumber(m.watts, { min: 0, max: 1e6 }),
      uptimeSec: safeNumber(m.uptime, { max: 1e9 }),
      poolStatus: String(m.pool ?? "unknown"),
      workerStatus: normalizeWorkerStatus(String(m.state ?? "")),
      lastShareAt:
        typeof m.last_share_at === "string" && Number.isFinite(Date.parse(m.last_share_at))
          ? new Date(m.last_share_at).toISOString()
          : null,
      estimatedEarningsBtc: null,
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const started = Date.now();
    try {
      const path = "/api/ping";
      const res = await fetch(`${this.endpoint}${path}`, {
        headers: this.signedHeaders("GET", path),
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
