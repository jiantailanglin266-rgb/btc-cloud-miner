/**
 * MiningProviderInterface — マイニング設備との接続を抽象化する契約
 *
 * ★ 設計意図 ★
 *   クラウドマイニング業界は事業者の入れ替わりが激しい。
 *   特定プロバイダーの API に直接依存すると、乗り換えのたびにアプリ全体を書き直すことになる。
 *   そこで「本システムが必要とするデータの形」をここで先に決め、
 *   各プロバイダーはそれに合わせるアダプタとして実装する。
 *
 *   新しいプロバイダーを追加する手順:
 *     1. adapters/ に MiningProviderAdapter を実装したファイルを作る
 *     2. registry.ts の ADAPTER_FACTORIES に登録する
 *     3. 管理画面からプロバイダーを登録する
 *   アプリの他の部分は一切変更しなくてよい。
 */

import type {
  BtcAmount,
  MiningProvider,
  PoolBalance,
  PoolPayout,
  ProviderStatus,
  ProviderWorkerReading,
  SourcedValue,
  WorkerStatus,
} from "@/types";
import { toSat as toSatCompat, fromSat as fromSatCompat } from "@/lib/decimal";

export type ProviderFetchResult = {
  readings: ProviderWorkerReading[];
  /** プロバイダー側が申告する総ハッシュレート（検算用。無ければ null） */
  reportedTotalHashrateThs: number | null;
  fetchedAt: string;
};

export type ProviderHealthResult = {
  status: ProviderStatus;
  latencyMs: number;
  message: string | null;
};

/** getPayoutHistory が返す、まだ DB に保存されていない生の payout */
export type RawPayout = {
  externalPayoutId: string;
  amountBtc: BtcAmount;
  paidAt: string;
  txId: string | null;
};

export interface MiningProviderAdapter {
  /** 一意な識別子（DB の provider.id と一致させる） */
  readonly id: string;
  readonly name: string;
  readonly kind: MiningProvider["kind"];

  /**
   * ワーカー統計を取得する。
   * ★ 例外を握りつぶさないこと。呼び出し側（registry）が circuit breaker で扱う。
   */
  fetchWorkers(): Promise<ProviderFetchResult>;

  /**
   * 疎通確認。fetchWorkers より軽い処理にする。
   * 例外を投げず、status で表現する（ヘルスチェックが落ちてはいけない）。
   */
  healthCheck(): Promise<ProviderHealthResult>;

  /**
   * 実データに接続しているか。
   * false のものが本番で使われていたら警告を出す（Mock を本番と誤認させない）。
   */
  readonly isLive: boolean;

  // --- 任意のライフサイクル（Stratum 等の常時接続型のみ実装する） ----------
  connect?(): Promise<void> | void;
  disconnect?(): Promise<void> | void;

  // --- 任意の収益系ケイパビリティ（対応プールのみ実装する） ----------------
  /** プール側残高（unpaid / paid）。取れないプロバイダーは実装しない */
  getPoolBalance?(): Promise<PoolBalance>;
  /** 実払い出し履歴（Actual Revenue の源泉）。取れないプロバイダーは実装しない */
  getPayoutHistory?(sinceMs?: number): Promise<RawPayout[]>;
  /** プールが申告する推定日次収益。参考値であり本システムの推定とは別 */
  getEstimatedRevenue?(): Promise<SourcedValue<BtcAmount> | null>;
}

/**
 * ProviderFacade — フェーズ2で要求される統一 12 メソッドの提供層
 *
 * 各アダプタは「fetchWorkers + healthCheck +（可能なら）payout 系」だけ実装すればよく、
 * getHashrate / getAcceptedShares 等の派生値はこの Facade が fetchWorkers の結果から導出する。
 * これにより既存アダプタを一切変更せずに新インターフェースを満たす（後方互換）。
 *
 * fetchWorkers の結果は短時間キャッシュする（getHashrate → getAcceptedShares のような
 * 連続呼び出しで外部 API を連打しないため）。
 */
export class ProviderFacade {
  private cached: { at: number; result: ProviderFetchResult } | null = null;
  private static readonly CACHE_MS = 15_000;

  constructor(readonly adapter: MiningProviderAdapter) {}

  get id(): string {
    return this.adapter.id;
  }
  get isLive(): boolean {
    return this.adapter.isLive;
  }

  private sourced<T>(value: T, fetchedAt: string, isEstimate = false): SourcedValue<T> {
    return {
      value,
      source: this.adapter.isLive ? this.adapter.name : `mock:${this.adapter.name}`,
      fetchedAt,
      isEstimate,
      // Facade 経由の値は取得直後なので stale ではない。stale 判定は cache 層が行う
      isStale: false,
    };
  }

  async connect(): Promise<void> {
    await this.adapter.connect?.();
  }

  async disconnect(): Promise<void> {
    await this.adapter.disconnect?.();
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    return this.adapter.healthCheck();
  }

  private async fetch(): Promise<ProviderFetchResult> {
    if (this.cached && Date.now() - this.cached.at < ProviderFacade.CACHE_MS) {
      return this.cached.result;
    }
    const result = await this.adapter.fetchWorkers();
    this.cached = { at: Date.now(), result };
    return result;
  }

  async getWorkers(): Promise<SourcedValue<ProviderWorkerReading[]>> {
    const r = await this.fetch();
    return this.sourced(r.readings, r.fetchedAt);
  }

  async getHashrate(): Promise<SourcedValue<number>> {
    const r = await this.fetch();
    const total =
      r.reportedTotalHashrateThs ??
      r.readings.reduce((s, w) => s + w.hashrateThs, 0);
    return this.sourced(total, r.fetchedAt);
  }

  async getWorkerStatus(): Promise<SourcedValue<Record<string, WorkerStatus>>> {
    const r = await this.fetch();
    const map: Record<string, WorkerStatus> = {};
    for (const w of r.readings) map[w.externalWorkerId] = w.workerStatus;
    return this.sourced(map, r.fetchedAt);
  }

  async getAcceptedShares(): Promise<SourcedValue<number>> {
    const r = await this.fetch();
    return this.sourced(
      r.readings.reduce((s, w) => s + w.acceptedShares, 0),
      r.fetchedAt,
    );
  }

  async getRejectedShares(): Promise<SourcedValue<number>> {
    const r = await this.fetch();
    return this.sourced(
      r.readings.reduce((s, w) => s + w.rejectedShares, 0),
      r.fetchedAt,
    );
  }

  /** プール申告の推定収益。未対応プロバイダーは null */
  async getEstimatedRevenue(): Promise<SourcedValue<BtcAmount> | null> {
    if (!this.adapter.getEstimatedRevenue) return null;
    return this.adapter.getEstimatedRevenue();
  }

  /**
   * 実収益（払い出し済み合計）。
   * ★ 推定と絶対に混同しない: 対応していないプロバイダーは 0 を「装わず」null を返す。
   */
  async getActualRevenue(sinceMs?: number): Promise<SourcedValue<BtcAmount> | null> {
    if (!this.adapter.getPayoutHistory) return null;
    const payouts = await this.adapter.getPayoutHistory(sinceMs);
    let sat = 0n;
    for (const p of payouts) sat += toSatCompat(p.amountBtc);
    return {
      value: fromSatCompat(sat),
      source: this.adapter.name,
      fetchedAt: new Date().toISOString(),
      isEstimate: false,
      isStale: false,
    };
  }

  async getPayoutHistory(sinceMs?: number): Promise<RawPayout[] | null> {
    if (!this.adapter.getPayoutHistory) return null;
    return this.adapter.getPayoutHistory(sinceMs);
  }

  async getPoolBalance(): Promise<PoolBalance | null> {
    if (!this.adapter.getPoolBalance) return null;
    return this.adapter.getPoolBalance();
  }
}

/**
 * アダプタを作るファクトリ。
 * 認証情報は credentialsRef（Secrets Manager のキー名）から解決する。
 * ★ 認証情報の実値を DB や引数に直接持ち回らない。
 */
export type AdapterFactory = (provider: MiningProvider) => MiningProviderAdapter;

/** プロバイダー側の文字列を本システムの WorkerStatus に正規化する */
export function normalizeWorkerStatus(
  raw: string | undefined | null,
): ProviderWorkerReading["workerStatus"] {
  if (!raw) return "UNKNOWN";
  const s = raw.toLowerCase();
  if (["active", "online", "ok", "running", "up", "mining"].includes(s)) return "ACTIVE";
  if (["offline", "down", "dead", "disconnected", "inactive"].includes(s)) return "OFFLINE";
  if (["maintenance", "maint", "paused", "repair"].includes(s)) return "MAINTENANCE";
  return "UNKNOWN";
}

/**
 * 外部から来た数値を安全に取り込む。
 * NaN・Infinity・負数・異常に大きい値を弾く（外部 API を信用しない）。
 */
export function safeNumber(
  value: unknown,
  opts: { min?: number; max?: number; fallback?: number } = {},
): number {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = opts;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

export function safeNullableNumber(
  value: unknown,
  opts: { min?: number; max?: number } = {},
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = opts;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}
