/**
 * BraiinsPoolAdapter — Braiins Pool（旧 Slush Pool）接続
 *
 * 選定理由:
 *   - 世界最古の Bitcoin プールで API が文書化されている
 *   - ユーザー自身が発行する read-only API トークンで利用できる（資金操作権限を持たない）
 *   - ワーカー単位の統計・未払い残高・payout 履歴がすべて REST で取れる
 *
 * API 仕様（実装時に必ず最新版を確認すること）:
 *   GET https://pool.braiins.com/accounts/profile/json/btc/
 *   GET https://pool.braiins.com/accounts/workers/json/btc/
 *   GET https://pool.braiins.com/accounts/rewards/json/btc/
 *   認証: `Pool-Auth-Token: <token>` ヘッダ
 *
 * ★ トークンはコードに書かない。credentialsRef（環境変数/Secrets Manager の参照名）から解決する。
 * ★ 外部レスポンスは一切信用せず、safeNumber で範囲検証してから取り込む。
 */

import type { MiningProvider, PoolBalance, ProviderWorkerReading } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
  RawPayout,
} from "../interface";
import { normalizeWorkerStatus, safeNumber, safeNullableNumber } from "../interface";
import { toEnvName } from "./pool-rest";
import { resolveProviderSecret } from "./secret";
import { formatNumberAsBtc } from "@/lib/decimal";
import { config } from "@/lib/config";

export class MissingCredentialsError extends Error {
  constructor(providerName: string, ref: string) {
    super(
      `プロバイダー「${providerName}」の API トークンが見つかりません。` +
        `環境変数 ${toEnvName(ref)}（本番は Secrets Manager の ${ref}）を設定してください。`,
    );
    this.name = "MissingCredentialsError";
  }
}

/** Braiins のハッシュレート単位文字列 → TH/s 係数 */
function unitToThs(unit: string): number {
  switch ((unit || "").toLowerCase()) {
    case "h/s": return 1e-12;
    case "kh/s": return 1e-9;
    case "mh/s": return 1e-6;
    case "gh/s": return 1e-3;
    case "th/s": return 1;
    case "ph/s": return 1e3;
    case "eh/s": return 1e6;
    default: return 1; // 単位不明時は TH/s とみなす（Braiins の既定）
  }
}

export class BraiinsPoolAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "BRAIINS" as const;
  readonly isLive = true;

  private readonly base: string;
  private readonly token: string | null;

  constructor(private readonly provider: MiningProvider) {
    this.id = provider.id;
    this.name = provider.name;
    this.base = (provider.endpoint || "https://pool.braiins.com").replace(/\/$/, "");
    this.token = resolveProviderSecret(provider);
  }

  private async get(path: string): Promise<unknown> {
    if (!this.token) {
      throw new MissingCredentialsError(this.name, this.provider.credentialsRef ?? "braiins/token");
    }
    const res = await fetch(`${this.base}${path}`, {
      headers: { "Pool-Auth-Token": this.token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(config.mining.timeoutMs),
    });
    if (!res.ok) throw new Error(`Braiins API エラー: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    const json = (await this.get("/accounts/workers/json/btc/")) as {
      btc?: { workers?: Record<string, Record<string, unknown>> };
    };
    const workers = json.btc?.workers ?? {};
    const readings: ProviderWorkerReading[] = Object.entries(workers).map(([name, w]) => {
      const unit = String(w.hash_rate_unit ?? "TH/s");
      const k = unitToThs(unit);
      const h1 = safeNumber(w.hash_rate_60m ?? w.hash_rate_1h, { max: 1e12 }) * k;
      return {
        externalWorkerId: name,
        minerId: "",
        model: "",
        hashrateThs: safeNumber(w.hash_rate_5m, { max: 1e12 }) * k,
        hashrate1hThs: h1 > 0 ? h1 : null,
        ratedHashrateThs: safeNumber(w.hash_rate_24h, { max: 1e12 }) * k,
        ratedEfficiencyJPerTh: 0, // Braiins は効率を返さない。0=不明（でっち上げない）
        acceptedShares: safeNumber(w.shares_5m ?? w.shares, { max: 1e15 }),
        rejectedShares: 0,
        temperatureC: null,
        powerW: null,
        uptimeSec: 0,
        poolStatus: String(w.state ?? "unknown"),
        workerStatus: normalizeWorkerStatus(String(w.state ?? "")),
        lastShareAt:
          typeof w.last_share === "number"
            ? new Date(w.last_share * 1000).toISOString()
            : null,
        estimatedEarningsBtc: null,
      };
    });

    return {
      readings,
      reportedTotalHashrateThs: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getPoolBalance(): Promise<PoolBalance> {
    const json = (await this.get("/accounts/profile/json/btc/")) as {
      btc?: Record<string, unknown>;
    };
    const b = json.btc ?? {};
    const now = new Date().toISOString();
    return {
      unpaidBtc: formatNumberAsBtc(
        safeNumber(b.confirmed_reward, { max: 21_000_000 }) +
          safeNumber(b.unconfirmed_reward, { max: 21_000_000 }),
      ),
      paidBtc: formatNumberAsBtc(safeNumber(b.all_time_reward, { max: 21_000_000 })),
      source: this.name,
      fetchedAt: now,
      isEstimate: false,
      isStale: false,
    };
  }

  async getPayoutHistory(sinceMs?: number): Promise<RawPayout[]> {
    const json = (await this.get("/accounts/rewards/json/btc/")) as {
      btc?: { rewards?: Array<Record<string, unknown>> };
    };
    const rewards = json.btc?.rewards ?? [];
    const out: RawPayout[] = [];
    for (const r of rewards) {
      // Braiins は日次報酬明細を返す。date は "YYYY-MM-DD" または unix
      const rawDate = r.date ?? r.timestamp;
      const paidAtMs =
        typeof rawDate === "number"
          ? rawDate * 1000
          : Date.parse(String(rawDate ?? ""));
      if (!Number.isFinite(paidAtMs)) continue;
      if (sinceMs && paidAtMs < sinceMs) continue;
      const amount = safeNumber(r.total_reward ?? r.amount, { max: 21_000_000 });
      if (amount <= 0) continue;
      out.push({
        // プール側に明示 ID が無い場合は「日付+金額」を決定的 ID にする（同日再取得でも同一）
        externalPayoutId: String(r.id ?? `${String(rawDate)}:${amount.toFixed(8)}`),
        amountBtc: formatNumberAsBtc(amount),
        paidAt: new Date(paidAtMs).toISOString(),
        txId: typeof r.txid === "string" ? r.txid : null,
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const started = Date.now();
    try {
      await this.get("/accounts/profile/json/btc/");
      const latencyMs = Date.now() - started;
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
