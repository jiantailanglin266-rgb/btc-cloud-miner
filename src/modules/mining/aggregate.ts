/**
 * マイニング統計の集約。
 * ダッシュボードが必要とする値を、プロバイダー・契約・BTC情報・収益エンジンから組み立てる。
 */

import type {
  DashboardSummary,
  MetricSeries,
  ProviderWorkerReading,
  SeriesRange,
  Worker,
  WorkerSnapshot,
} from "@/types";
import { getStore } from "@/lib/store";
import { fetchAllProviders, getProviderHealth } from "@/modules/provider/registry";
import { MockMiningProviderAdapter, mockHashrateAt } from "@/modules/provider/adapters/mock";
import { getNetworkAndPrice } from "@/modules/bitcoin/service";
import { calculateRevenue } from "@/modules/revenue/engine";

export type WorkerWithReading = {
  worker: Worker;
  reading: ProviderWorkerReading | null;
};

/** 期間指定 → 開始時刻・データ点数 */
export const RANGE_SPEC: Record<SeriesRange, { ms: number; points: number; label: string }> = {
  "1h": { ms: 3_600_000, points: 60, label: "1時間" },
  "24h": { ms: 86_400_000, points: 96, label: "24時間" },
  "7d": { ms: 7 * 86_400_000, points: 84, label: "7日" },
  "30d": { ms: 30 * 86_400_000, points: 90, label: "30日" },
  "90d": { ms: 90 * 86_400_000, points: 90, label: "90日" },
  "1y": { ms: 365 * 86_400_000, points: 73, label: "1年" },
};

/**
 * ユーザーに割り当てられたワーカーと、その最新の読み取り値を返す。
 * 一般ユーザーは自分の契約に紐づくワーカーのみ。管理者は全件。
 */
export async function getWorkersForUser(
  tenantId: string,
  userId: string | null,
): Promise<WorkerWithReading[]> {
  const store = await getStore();
  const allWorkers = await store.listWorkers(tenantId);

  let workers = allWorkers;
  if (userId) {
    const contracts = await store.listContracts(tenantId, userId);
    const contractIds = new Set(contracts.map((c) => c.id));
    const allocations = await store.listAllocations(tenantId);
    const allowedWorkerIds = new Set(
      allocations
        .filter((a) => contractIds.has(a.contractId) && a.workerId)
        .map((a) => a.workerId as string),
    );
    workers = allWorkers.filter((w) => allowedWorkerIds.has(w.id));
  }

  // プロバイダーから最新値を取得する（失敗しても例外は出ない）
  const outcomes = await fetchAllProviders(tenantId);
  const readingByKey = new Map<string, ProviderWorkerReading>();
  for (const outcome of outcomes) {
    for (const r of outcome.readings) {
      readingByKey.set(`${outcome.provider.id}:${r.externalWorkerId}`, r);
    }
  }

  return workers.map((worker) => ({
    worker,
    reading: readingByKey.get(`${worker.providerId}:${worker.externalWorkerId}`) ?? null,
  }));
}

/**
 * 取得した読み取り値を DB へ同期する。
 *   fetchWorkers → normalize → upsert Worker → WorkerSnapshot 保存
 * 実プロバイダーで初めて見るワーカーは自動で作成する（provider API がワーカー台帳の真実）。
 * プロバイダーの lastSyncAt / lastLatencyMs も更新する。
 */
export async function persistSnapshots(tenantId: string): Promise<number> {
  const store = await getStore();
  const existing = await store.listWorkers(tenantId);
  const byKey = new Map(
    existing.map((w) => [`${w.providerId}:${w.externalWorkerId}`, w]),
  );
  const outcomes = await fetchAllProviders(tenantId);

  // 5 分境界に丸める（重複取り込みを upsert で潰せるようにする）
  const bucketAt = new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString();
  const nowIso = new Date().toISOString();
  const snapshots: WorkerSnapshot[] = [];

  for (const outcome of outcomes) {
    const source = outcome.adapter.isLive
      ? outcome.provider.name
      : `mock:${outcome.provider.name}`;

    // 未登録ワーカーを upsert（ワーカー台帳を provider に追随させる）
    const toUpsert: Worker[] = [];
    for (const r of outcome.readings) {
      const key = `${outcome.provider.id}:${r.externalWorkerId}`;
      const found = byKey.get(key);
      const worker: Worker = found
        ? {
            ...found,
            model: r.model || found.model,
            ratedHashrateThs: r.ratedHashrateThs || found.ratedHashrateThs,
            ratedEfficiencyJPerTh:
              r.ratedEfficiencyJPerTh || found.ratedEfficiencyJPerTh,
            status: r.workerStatus,
            lastSeenAt: nowIso,
          }
        : {
            id: `wk-${outcome.provider.id}-${r.externalWorkerId}`.replace(
              /[^a-zA-Z0-9_-]/g,
              "_",
            ),
            tenantId,
            providerId: outcome.provider.id,
            externalWorkerId: r.externalWorkerId,
            minerId: r.minerId,
            model: r.model,
            ratedHashrateThs: r.ratedHashrateThs,
            ratedEfficiencyJPerTh: r.ratedEfficiencyJPerTh,
            status: r.workerStatus,
            lastSeenAt: nowIso,
          };
      toUpsert.push(worker);
      byKey.set(key, worker);

      snapshots.push({
        workerId: worker.id,
        tenantId,
        bucketAt,
        hashrateThs: r.hashrateThs,
        hashrate1hThs: r.hashrate1hThs,
        acceptedShares: r.acceptedShares,
        rejectedShares: r.rejectedShares,
        temperatureC: r.temperatureC,
        powerW: r.powerW,
        uptimeSec: r.uptimeSec,
        poolStatus: r.poolStatus,
        workerStatus: r.workerStatus,
        lastShareAt: r.lastShareAt,
        source,
        estimatedEarningsBtc: r.estimatedEarningsBtc,
      });
    }

    if (toUpsert.length > 0) await store.upsertWorkers(tenantId, toUpsert);

    // プロバイダーの同期メタを更新（Dashboard の Last Sync / Latency 表示に使う）
    await store.updateProvider(tenantId, outcome.provider.id, {
      lastLatencyMs: outcome.latencyMs,
      lastSyncAt: nowIso,
    });
  }

  if (snapshots.length > 0) await store.saveSnapshots(tenantId, snapshots);
  return snapshots.length;
}

/**
 * ダッシュボードの全数値を組み立てる。
 * ★ 外部が全滅していても例外を投げない（値が 0 や stale になるだけ）。
 */
export async function buildDashboardSummary(
  tenantId: string,
  userId: string | null,
): Promise<DashboardSummary> {
  const store = await getStore();
  const [{ network, price }, settings, providerStatuses, entries] = await Promise.all([
    getNetworkAndPrice(),
    store.getTenantSettings(tenantId),
    getProviderHealth(tenantId),
    getWorkersForUser(tenantId, userId),
  ]);

  const contracts = userId
    ? await store.listContracts(tenantId, userId)
    : await store.listContracts(tenantId);
  const activeContracts = contracts.filter((c) => c.status === "ACTIVE");
  const purchasedHashrateThs = activeContracts.reduce((s, c) => s + c.hashrateThs, 0);
  const allocatedHashrateThs = entries.reduce((s, e) => s + e.worker.ratedHashrateThs, 0);

  let currentHashrateThs = 0;
  let activeMiners = 0;
  let offlineMiners = 0;
  let acceptedShares = 0;
  let rejectedShares = 0;
  let totalPowerW = 0;
  let uptimeSum = 0;

  for (const { worker, reading } of entries) {
    if (!reading) {
      // 読み取れなかったワーカーは「不明」として扱う。0 とみなして稼働率を下げない
      offlineMiners += worker.status === "OFFLINE" ? 1 : 0;
      continue;
    }
    currentHashrateThs += reading.hashrateThs;
    acceptedShares += reading.acceptedShares;
    rejectedShares += reading.rejectedShares;
    totalPowerW += reading.powerW ?? 0;
    if (reading.workerStatus === "ACTIVE") {
      activeMiners++;
      // 実効ハッシュレート ÷ 定格 を稼働率の近似とする
      uptimeSum += Math.min(1, reading.hashrateThs / Math.max(1, worker.ratedHashrateThs));
    } else {
      offlineMiners++;
    }
  }

  const totalMiners = entries.length;
  const uptimeRate = totalMiners > 0 ? uptimeSum / totalMiners : 0;
  const efficiencyJPerTh =
    currentHashrateThs > 0
      ? totalPowerW / currentHashrateThs
      : weightedRatedEfficiency(entries.map((e) => e.worker));

  // 平均ハッシュレート: 保存済みスナップショットから直近24時間を平均する
  const since = Date.now() - 86_400_000;
  const recent = await store.listSnapshots(tenantId, { fromMs: since, limit: 5000 });
  const allowedIds = new Set(entries.map((e) => e.worker.id));
  const mine = recent.filter((s) => allowedIds.has(s.workerId));
  const averageHashrateThs =
    mine.length > 0 ? sumByBucketAverage(mine) : currentHashrateThs;

  const revenue = calculateRevenue({
    hashrateThs: currentHashrateThs,
    networkHashrateThs: network.networkHashrateThs,
    difficulty: network.difficulty,
    blockRewardBtc: network.blockRewardBtc,
    btcPriceUsd: price.usd,
    electricityPriceKwh: settings.electricityPriceKwh,
    efficiencyJPerTh: efficiencyJPerTh || 17.5,
    poolFeeRate: settings.poolFeeRate,
    platformFeeRate: settings.platformFeeRate,
    // 稼働率は currentHashrate に既に織り込まれているため、二重適用しない
    uptimeRate: 1,
    upfrontCostUsd: activeContracts.reduce((s, c) => s + c.upfrontCostUsd, 0),
  });

  return {
    currentHashrateThs,
    averageHashrateThs,
    purchasedHashrateThs,
    allocatedHashrateThs,
    activeMiners,
    offlineMiners,
    totalMiners,
    uptimeRate,
    efficiencyJPerTh,
    acceptedShares,
    rejectedShares,
    rejectRate:
      acceptedShares + rejectedShares > 0
        ? rejectedShares / (acceptedShares + rejectedShares)
        : 0,
    network,
    price,
    revenue,
    providerStatuses,
    generatedAt: new Date().toISOString(),
  };
}

function weightedRatedEfficiency(workers: Worker[]): number {
  const totalThs = workers.reduce((s, w) => s + w.ratedHashrateThs, 0);
  if (totalThs === 0) return 0;
  const weighted = workers.reduce(
    (s, w) => s + w.ratedEfficiencyJPerTh * w.ratedHashrateThs,
    0,
  );
  return weighted / totalThs;
}

/** 同一 bucket のワーカー合計を出してから、bucket 間で平均する */
function sumByBucketAverage(snapshots: WorkerSnapshot[]): number {
  const byBucket = new Map<string, number>();
  for (const s of snapshots) {
    byBucket.set(s.bucketAt, (byBucket.get(s.bucketAt) ?? 0) + s.hashrateThs);
  }
  if (byBucket.size === 0) return 0;
  let total = 0;
  for (const v of byBucket.values()) total += v;
  return total / byBucket.size;
}

/**
 * 時系列グラフ用のデータ。
 *
 * 保存済みスナップショットがその期間を十分に覆っていればそれを使う。
 * デモ環境では履歴が無いため、Mock アダプタの決定的な生成関数から合成する。
 * ★ 合成した場合は `synthesized: true` を返し、UI で明示する。
 */
export async function buildSeries(
  tenantId: string,
  userId: string | null,
  metric: "hashrate" | "revenue" | "uptime",
  range: SeriesRange,
): Promise<MetricSeries & { synthesized: boolean }> {
  const spec = RANGE_SPEC[range];
  const now = Date.now();
  const from = now - spec.ms;

  const store = await getStore();
  const entries = await getWorkersForUser(tenantId, userId);
  const allowedIds = new Set(entries.map((e) => e.worker.id));

  const stored = (await store.listSnapshots(tenantId, { fromMs: from, limit: 20000 })).filter(
    (s) => allowedIds.has(s.workerId),
  );

  // 期間の半分以上をスナップショットが覆っていれば実データを使う
  const buckets = new Set(stored.map((s) => s.bucketAt));
  const useStored = buckets.size >= spec.points / 2;

  let points: Array<{ t: string; v: number }>;
  let synthesized = false;

  if (useStored) {
    points = aggregateStored(stored, from, now, spec.points, metric, entries);
  } else {
    synthesized = true;
    points = synthesizeFromMock(entries, from, now, spec.points, metric);
  }

  return {
    metric,
    unit: metric === "hashrate" ? "TH/s" : metric === "uptime" ? "%" : "BTC",
    range,
    points,
    synthesized,
  };
}

function aggregateStored(
  snapshots: WorkerSnapshot[],
  from: number,
  to: number,
  points: number,
  metric: "hashrate" | "revenue" | "uptime",
  entries: WorkerWithReading[],
): Array<{ t: string; v: number }> {
  const step = (to - from) / points;
  const buckets: Array<{ sum: number; count: number }> = Array.from({ length: points }, () => ({
    sum: 0,
    count: 0,
  }));
  const ratedTotal = entries.reduce((s, e) => s + e.worker.ratedHashrateThs, 0) || 1;

  for (const s of snapshots) {
    const t = new Date(s.bucketAt).getTime();
    const idx = Math.min(points - 1, Math.max(0, Math.floor((t - from) / step)));
    buckets[idx].sum += s.hashrateThs;
    buckets[idx].count++;
  }

  return buckets.map((b, i) => {
    const hashrate = b.sum;
    const v =
      metric === "uptime"
        ? Math.min(100, (hashrate / ratedTotal) * 100)
        : metric === "revenue"
          ? hashrate // 呼び出し側で収益に変換する
          : hashrate;
    return { t: new Date(from + step * i).toISOString(), v: round2(v) };
  });
}

/**
 * デモ環境用: Mock アダプタの決定的関数から時系列を合成する。
 * ★ 実測データではない。UI では `synthesized` バッジを出すこと。
 */
function synthesizeFromMock(
  entries: WorkerWithReading[],
  from: number,
  to: number,
  points: number,
  metric: "hashrate" | "revenue" | "uptime",
): Array<{ t: string; v: number }> {
  const specs = entries.map((e) => ({
    id: e.worker.id,
    externalWorkerId: e.worker.externalWorkerId,
    minerId: e.worker.minerId,
    model: e.worker.model,
    ratedHashrateThs: e.worker.ratedHashrateThs,
    ratedEfficiencyJPerTh: e.worker.ratedEfficiencyJPerTh,
    forcedOffline: e.worker.status === "OFFLINE",
  }));
  const ratedTotal = specs.reduce((s, w) => s + w.ratedHashrateThs, 0) || 1;

  const step = (to - from) / Math.max(1, points - 1);
  const out: Array<{ t: string; v: number }> = [];

  for (let i = 0; i < points; i++) {
    const t = from + step * i;
    let hashrate = 0;
    for (const spec of specs) {
      hashrate += mockHashrateAt(spec, t);
    }
    const v =
      metric === "uptime" ? Math.min(100, (hashrate / ratedTotal) * 100) : hashrate;
    out.push({ t: new Date(t).toISOString(), v: round2(v) });
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { MockMiningProviderAdapter };
