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
  MiningProvider,
  ProviderStatus,
  ProviderWorkerReading,
} from "@/types";

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
