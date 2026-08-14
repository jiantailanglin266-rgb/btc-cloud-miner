/**
 * Operational Metrics（フェーズ17）
 *
 * プロセス内カウンタ/ゲージ。Prometheus 互換のエクスポートに載せ替えられる形にしておく。
 * （本番では OpenTelemetry / prom-client へ差し替え。ここではインメモリで集計する）
 *
 * HMR/多重 import でも 1 インスタンスになるよう globalThis に保持する。
 */

export type MetricName =
  | "provider_api_latency_ms"
  | "provider_api_errors_total"
  | "provider_sync_duration_ms"
  | "workers_online"
  | "workers_offline"
  | "hashrate_total_ths"
  | "payout_sync_total"
  | "payout_sync_errors"
  | "allocation_total"
  | "allocation_errors"
  | "ledger_imbalance"
  | "withdrawal_pending";

type MetricEntry = {
  /** 累積合計（counter） */
  total: number;
  /** 直近値（gauge） */
  last: number;
  count: number;
  updatedAt: number;
  labels: Record<string, string> | null;
};

const g = globalThis as unknown as { __btcMetrics?: Map<string, MetricEntry> };
const store = g.__btcMetrics ?? new Map<string, MetricEntry>();
g.__btcMetrics = store;

function keyOf(name: MetricName, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const l = Object.entries(labels)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${name}{${l}}`;
}

/** counter を加算 / gauge を更新（1関数で両対応。last は常に直近値） */
export function recordMetric(
  name: MetricName,
  value: number,
  labels?: Record<string, string>,
): void {
  if (!Number.isFinite(value)) return;
  const key = keyOf(name, labels);
  const cur = store.get(key);
  if (cur) {
    cur.total += value;
    cur.last = value;
    cur.count++;
    cur.updatedAt = Date.now();
  } else {
    store.set(key, {
      total: value,
      last: value,
      count: 1,
      updatedAt: Date.now(),
      labels: labels ?? null,
    });
  }
}

/** gauge を絶対値でセット（累積しない） */
export function setGauge(
  name: MetricName,
  value: number,
  labels?: Record<string, string>,
): void {
  if (!Number.isFinite(value)) return;
  const key = keyOf(name, labels);
  store.set(key, {
    total: value,
    last: value,
    count: 1,
    updatedAt: Date.now(),
    labels: labels ?? null,
  });
}

export type MetricSnapshot = {
  name: string;
  total: number;
  last: number;
  count: number;
  updatedAt: string;
};

export function snapshotMetrics(): MetricSnapshot[] {
  return [...store.entries()].map(([name, e]) => ({
    name,
    total: Math.round(e.total * 1000) / 1000,
    last: Math.round(e.last * 1000) / 1000,
    count: e.count,
    updatedAt: new Date(e.updatedAt).toISOString(),
  }));
}

/** Prometheus テキスト形式（/api/admin/metrics などで公開する場合に使う） */
export function toPrometheus(): string {
  const lines: string[] = [];
  for (const [key, e] of store.entries()) {
    lines.push(`# key ${key}`);
    lines.push(`${key.replace(/[{},=]/g, "_")} ${e.last}`);
  }
  return lines.join("\n");
}
