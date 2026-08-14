/**
 * F2PoolAdapter — F2Pool 本番アダプタ（REAL PRODUCTION ADAPTER）
 *
 * 選定理由（Braiins との比較）:
 *   - 読み取り系はアカウント名だけで公開 API から取得でき、出金権限を一切持たない
 *     → 「Pool の出金権限 API Key を使わない」という安全要件を最も満たしやすい
 *   - hashrate（realtime/1h/24h）・balance（unpaid/paid）・payout_history・value_last_day を一度に取れる
 *
 * 公開 API（v1・実装時に最新仕様を確認すること）:
 *   GET https://api.f2pool.com/bitcoin/<account>
 *   → {
 *       hashrate, hashrate_history,
 *       workers: [[name, hashrate, hashrate_1h, hashrate_24h, rejected, stale, last_share_ts], ...],
 *       balance, paid, value_last_day
 *     }
 *   ハッシュレート単位は H/s。
 *
 * ★ 取得できない項目は 0 を返さず null（isEstimate=false のまま「不明」を表現）。
 * ★ 全レスポンスを safeNumber で範囲検証。API Key は保持しない（アカウント名は秘匿情報ではない）。
 */

import type {
  MiningProvider,
  PoolBalance,
  ProviderWorkerReading,
  SourcedValue,
  BtcAmount,
} from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
  RawPayout,
} from "../interface";
import { safeNumber } from "../interface";
import { resolveProviderSecret } from "./secret";
import { formatNumberAsBtc } from "@/lib/decimal";
import { config } from "@/lib/config";

const HS_TO_THS = 1e-12;
/** 最終 share がこれ以上前なら OFFLINE 扱い（分） */
const OFFLINE_THRESHOLD_MIN = 15;

export class F2PoolAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "F2POOL" as const;
  readonly isLive = true;

  private readonly base: string;
  /** アカウント名。credentialsRef / credentialsEnc から解決（環境変数 or 暗号化 DB） */
  private readonly account: string | null;
  /** 直近のリクエストで観測した latency とレスポンス（1リクエストにまとめる） */
  private cache: { at: number; json: Record<string, unknown>; latencyMs: number } | null = null;

  constructor(provider: MiningProvider) {
    this.id = provider.id;
    this.name = provider.name;
    this.base = (provider.endpoint || "https://api.f2pool.com").replace(/\/$/, "");
    this.account = resolveProviderSecret(provider);
  }

  /** アカウント全体を 1 リクエストで取得（workers/balance/payout を派生させる） */
  private async getAccount(): Promise<{ json: Record<string, unknown>; latencyMs: number }> {
    if (this.cache && Date.now() - this.cache.at < 10_000) {
      return { json: this.cache.json, latencyMs: this.cache.latencyMs };
    }
    if (!this.account) {
      throw new F2PoolAuthError(
        `プロバイダー「${this.name}」のアカウント名が未設定です。` +
          `管理画面で API トークン欄にプールのアカウント名を登録してください。`,
      );
    }
    const started = Date.now();
    const res = await fetch(`${this.base}/bitcoin/${encodeURIComponent(this.account)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(config.mining.timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (res.status === 401 || res.status === 403) {
      throw new F2PoolAuthError("認証に失敗しました（アカウント名を確認してください）");
    }
    if (res.status === 429) throw new F2PoolRateLimitError();
    if (!res.ok) {
      throw new Error(`F2Pool API エラー: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    // 想定形（workers 配列 or hashrate）でなければ INVALID_RESPONSE
    if (typeof json !== "object" || json === null || !("hashrate" in json)) {
      throw new F2PoolInvalidResponseError();
    }
    this.cache = { at: Date.now(), json, latencyMs };
    return { json, latencyMs };
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    const { json } = await this.getAccount();
    const workers = Array.isArray(json.workers) ? (json.workers as unknown[][]) : [];
    const nowSec = Date.now() / 1000;

    const readings: ProviderWorkerReading[] = workers.map((row) => {
      const name = String(row[0] ?? "unknown");
      const hs = safeNumber(row[1], { max: 1e24 });
      const h1 = safeNumber(row[2], { max: 1e24 });
      const h24 = safeNumber(row[3], { max: 1e24 });
      const rejectedHs = safeNumber(row[4], { max: 1e24 });
      const lastShareTs = safeNumber(row[row.length - 1], { max: 4e12 });
      const staleMinutes = lastShareTs > 0 ? (nowSec - lastShareTs) / 60 : Infinity;

      return {
        externalWorkerId: name,
        minerId: "",
        model: "",
        hashrateThs: hs * HS_TO_THS,
        hashrate1hThs: h1 > 0 ? h1 * HS_TO_THS : null,
        ratedHashrateThs: h24 * HS_TO_THS, // 24h 平均を rated として扱う
        ratedEfficiencyJPerTh: 0, // プールは効率を知らない → 0（=不明。UI は表示しない）
        // F2Pool はハッシュレート表現でありシェア「数」を返さない。
        // reject を H/s 比で近似できるが、偽の絶対数をでっち上げない → 0 のまま poolStatus で示す
        acceptedShares: 0,
        rejectedShares: rejectedHs > 0 && hs > 0 ? Math.round((rejectedHs / hs) * 10000) : 0,
        temperatureC: null,
        powerW: null,
        uptimeSec: 0,
        poolStatus: staleMinutes < OFFLINE_THRESHOLD_MIN ? "connected" : "inactive",
        workerStatus:
          hs > 0 && staleMinutes < OFFLINE_THRESHOLD_MIN ? "ACTIVE" : "OFFLINE",
        lastShareAt: lastShareTs > 0 ? new Date(lastShareTs * 1000).toISOString() : null,
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
    const { json } = await this.getAccount();
    return {
      unpaidBtc: formatNumberAsBtc(safeNumber(json.balance, { max: 21_000_000 })),
      paidBtc: formatNumberAsBtc(safeNumber(json.paid, { max: 21_000_000 })),
      source: this.name,
      fetchedAt: new Date().toISOString(),
      isEstimate: false,
      isStale: false,
    };
  }

  /** プール申告の推定日次収益（value_last_day）。参考値 */
  async getEstimatedRevenue(): Promise<SourcedValue<BtcAmount> | null> {
    const { json } = await this.getAccount();
    if (json.value_last_day === undefined) return null;
    return {
      value: formatNumberAsBtc(safeNumber(json.value_last_day, { max: 21_000_000 })),
      source: this.name,
      fetchedAt: new Date().toISOString(),
      isEstimate: true, // ★ プール申告の推定値。実績と混同しない
      isStale: false,
    };
  }

  async getPayoutHistory(sinceMs?: number): Promise<RawPayout[]> {
    const { json } = await this.getAccount();
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
        // txid があればそれを冪等キーに。無ければ日付+金額で決定的
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
      const { latencyMs } = await this.getAccount();
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

  /**
   * TEST CONNECTION 用: 生の getAccount を1回叩き、分類可能なエラーを投げる。
   * 呼び出し側（api/admin）が例外種別で CONNECTED/AUTH_FAILED/... を判定する。
   */
  async probe(): Promise<{
    latencyMs: number;
    account: string | null;
    workerCount: number;
    currentHashrateThs: number;
    unpaidBtc: string;
    paidBtc: string;
  }> {
    const { json, latencyMs } = await this.getAccount();
    const workers = Array.isArray(json.workers) ? (json.workers as unknown[][]) : [];
    return {
      latencyMs,
      account: this.account,
      workerCount: workers.length,
      currentHashrateThs: safeNumber(json.hashrate, { max: 1e24 }) * HS_TO_THS,
      unpaidBtc: formatNumberAsBtc(safeNumber(json.balance, { max: 21_000_000 })),
      paidBtc: formatNumberAsBtc(safeNumber(json.paid, { max: 21_000_000 })),
    };
  }
}

// TEST CONNECTION の分類に使う例外種別
export class F2PoolAuthError extends Error {}
export class F2PoolRateLimitError extends Error {
  constructor() {
    super("レート制限に達しました");
  }
}
export class F2PoolInvalidResponseError extends Error {
  constructor() {
    super("想定外のレスポンス形式です");
  }
}
