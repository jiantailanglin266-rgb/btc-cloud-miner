/**
 * F2PoolAdapter — F2Pool 接続
 *
 * 選定理由:
 *   - 世界最大級の Bitcoin プールの一つ
 *   - 読み取り系はアカウント名だけで公開 API から取得できる（キー不要で PoC 可能）
 *   - v2 API（要トークン）にも同じアダプタ内で対応できる構造にしてある
 *
 * 公開 API（v1・実装時に最新仕様を確認すること）:
 *   GET https://api.f2pool.com/bitcoin/<account>
 *   → { hashrate, hashrate_history, workers: [[name, hashrate, h1, h24, rejected, ...]],
 *       balance, paid, value_last_day, payout_history: [[date, txid, amount], ...] }
 *
 * ハッシュレートの単位は H/s。
 */

import type { MiningProvider, PoolBalance, ProviderWorkerReading } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
  RawPayout,
} from "../interface";
import { safeNumber } from "../interface";
import { toEnvName } from "./pool-rest";
import { formatNumberAsBtc } from "@/lib/decimal";
import { config } from "@/lib/config";

const HS_TO_THS = 1e-12;

export class F2PoolAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "F2POOL" as const;
  readonly isLive = true;

  private readonly base: string;
  /** アカウント名。credentialsRef の環境変数から読む（例: F2POOL_ACCOUNT=myaccount） */
  private readonly account: string | null;

  constructor(provider: MiningProvider) {
    this.id = provider.id;
    this.name = provider.name;
    this.base = (provider.endpoint || "https://api.f2pool.com").replace(/\/$/, "");
    this.account = provider.credentialsRef
      ? (process.env[toEnvName(provider.credentialsRef)] ?? null)
      : null;
  }

  private async getAccount(): Promise<Record<string, unknown>> {
    if (!this.account) {
      throw new Error(
        `プロバイダー「${this.name}」のアカウント名が未設定です。` +
          `credentialsRef の環境変数にプールアカウント名を設定してください。`,
      );
    }
    const res = await fetch(`${this.base}/bitcoin/${encodeURIComponent(this.account)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(config.mining.timeoutMs),
    });
    if (!res.ok) throw new Error(`F2Pool API エラー: ${res.status} ${res.statusText}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    const json = await this.getAccount();
    const workers = Array.isArray(json.workers) ? (json.workers as unknown[][]) : [];

    // F2Pool の worker 行: [name, hashrate(H/s), h1, h24, rejected(H/s), ..., last_share_ts]
    const readings: ProviderWorkerReading[] = workers.map((row) => {
      const name = String(row[0] ?? "unknown");
      const hs = safeNumber(row[1], { max: 1e24 });
      const h24 = safeNumber(row[3], { max: 1e24 });
      const rejectedHs = safeNumber(row[4], { max: 1e24 });
      const lastShareTs = safeNumber(row[row.length - 1], { max: 4e12 });
      const staleMinutes = lastShareTs > 0 ? (Date.now() / 1000 - lastShareTs) / 60 : Infinity;
      return {
        externalWorkerId: name,
        minerId: "",
        model: "",
        hashrateThs: hs * HS_TO_THS,
        ratedHashrateThs: h24 * HS_TO_THS,
        ratedEfficiencyJPerTh: 0, // プールは効率を知らない。0=不明
        // F2Pool は share 数でなくハッシュレート表現のため、shares は取得不能=0。
        // reject 率はハッシュレート比から近似できるが、偽の絶対数をでっち上げない
        acceptedShares: 0,
        rejectedShares: 0,
        temperatureC: null,
        powerW: null,
        uptimeSec: 0,
        poolStatus: staleMinutes < 15 ? "connected" : "inactive",
        workerStatus: hs > 0 && staleMinutes < 15 ? "ACTIVE" : "OFFLINE",
        estimatedEarningsBtc: null,
      };
    });

    return {
      readings,
      reportedTotalHashrateThs: safeNumber(json.hashrate, { max: 1e24 }) * HS_TO_THS,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getPoolBalance(): Promise<PoolBalance> {
    const json = await this.getAccount();
    return {
      unpaidBtc: formatNumberAsBtc(safeNumber(json.balance, { max: 21_000_000 })),
      paidBtc: formatNumberAsBtc(safeNumber(json.paid, { max: 21_000_000 })),
      source: this.name,
      fetchedAt: new Date().toISOString(),
      isEstimate: false,
      isStale: false,
    };
  }

  async getPayoutHistory(sinceMs?: number): Promise<RawPayout[]> {
    const json = await this.getAccount();
    const history = Array.isArray(json.payout_history)
      ? (json.payout_history as unknown[][])
      : [];
    const out: RawPayout[] = [];
    for (const row of history) {
      // 行形式: [date(string), txid(string), amount(number BTC)]
      const paidAtMs = Date.parse(String(row[0] ?? ""));
      const txId = typeof row[1] === "string" && row[1] ? row[1] : null;
      const amount = safeNumber(row[2], { max: 21_000_000 });
      if (!Number.isFinite(paidAtMs) || amount <= 0) continue;
      if (sinceMs && paidAtMs < sinceMs) continue;
      out.push({
        externalPayoutId: txId ?? `${String(row[0])}:${amount.toFixed(8)}`,
        amountBtc: formatNumberAsBtc(amount),
        paidAt: new Date(paidAtMs).toISOString(),
        txId,
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const started = Date.now();
    try {
      await this.getAccount();
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
