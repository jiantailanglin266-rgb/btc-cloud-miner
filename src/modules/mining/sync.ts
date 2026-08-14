/**
 * 同期オーケストレータ（フェーズ6・7・8）
 *
 * 定期実行される同期サイクルを、二重実行しないロック付きで束ねる:
 *   - worker 統計   → persistSnapshots
 *   - pool payout   → syncPayouts
 *   - revenue 配賦  → allocateAllPending
 *
 * ★ 同期ロック（store.acquireLock）で複数インスタンス/多重起動による
 *   二重登録・二重 payout・二重 Ledger を防ぐ。
 * ★ RawProviderSnapshot に正規化サマリー（機微情報なし）を記録する。
 */

import { getStore } from "@/lib/store";
import { fetchAllProviders } from "@/modules/provider/registry";
import { persistSnapshots } from "./aggregate";
import { syncPayouts } from "@/modules/provider/registry";
import { allocateAllPending } from "@/modules/revenue/allocation";
import { newId, sha256Hex } from "@/lib/crypto";
import { recordMetric } from "@/modules/monitoring/metrics";
import { raiseAlert } from "@/modules/monitoring/alerts";
import type { RawProviderSnapshot } from "@/types";

/** ロック保持者の識別子（プロセス単位）。多重起動を区別する */
const HOLDER =
  `worker-${process.pid ?? 0}-${Math.floor(Number(process.hrtime?.bigint?.() ?? 0n) % 1e6)}`;

export type WorkerSyncResult = {
  ranAt: string;
  locked: boolean;
  snapshots: number;
  rawRecorded: number;
  providerErrors: number;
  durationMs: number;
};

/**
 * ワーカー統計の同期 + Raw スナップショット記録。
 * ロックが取れなければ locked:false で即返す（他インスタンスが実行中）。
 */
export async function runWorkerSync(tenantId: string): Promise<WorkerSyncResult> {
  const store = await getStore();
  const started = Date.now();
  const lockKey = `provider-sync:${tenantId}`;

  const locked = await store.acquireLock(lockKey, HOLDER, 120_000);
  if (!locked) {
    return {
      ranAt: new Date().toISOString(),
      locked: false,
      snapshots: 0,
      rawRecorded: 0,
      providerErrors: 0,
      durationMs: 0,
    };
  }

  let rawRecorded = 0;
  let providerErrors = 0;

  try {
    // 生レスポンスのサニタイズ記録（デバッグ用）。プロバイダーごとに 1 件
    const outcomes = await fetchAllProviders(tenantId);
    for (const o of outcomes) {
      if (o.status === "OFFLINE" || o.status === "DEGRADED") providerErrors++;
      recordMetric("provider_api_latency_ms", o.latencyMs, { providerId: o.provider.id });
      if (o.error) recordMetric("provider_api_errors_total", 1, { providerId: o.provider.id });

      // ★ normalizedResult には機微情報を含めない（件数・合計のみ）
      const normalized = {
        workerCount: o.readings.length,
        totalHashrateThs: Math.round(
          o.readings.reduce((s, r) => s + r.hashrateThs, 0) * 100,
        ) / 100,
        status: o.status,
        error: o.error ? o.error.slice(0, 120) : null,
      };
      const snapshot: RawProviderSnapshot = {
        id: newId(),
        tenantId,
        providerId: o.provider.id,
        endpoint: o.provider.endpoint ?? o.provider.kind,
        statusCode: o.error ? 0 : 200,
        payloadHash: sha256Hex(JSON.stringify(normalized)),
        normalizedResult: normalized,
        fetchedAt: new Date().toISOString(),
      };
      await store.insertRawSnapshot(snapshot);
      rawRecorded++;
    }

    const snapshots = await persistSnapshots(tenantId);
    recordMetric("provider_sync_duration_ms", Date.now() - started);

    return {
      ranAt: new Date().toISOString(),
      locked: true,
      snapshots,
      rawRecorded,
      providerErrors,
      durationMs: Date.now() - started,
    };
  } finally {
    await store.releaseLock(lockKey, HOLDER);
  }
}

/**
 * payout 同期 + 配賦。ロックで二重 payout・二重 Ledger を防ぐ。
 */
export async function runPayoutSync(tenantId: string): Promise<{
  locked: boolean;
  saved: number;
  skippedDuplicates: number;
  allocated: number;
  allocationErrors: number;
}> {
  const store = await getStore();
  const lockKey = `payout-sync:${tenantId}`;
  const locked = await store.acquireLock(lockKey, HOLDER, 120_000);
  if (!locked) {
    return { locked: false, saved: 0, skippedDuplicates: 0, allocated: 0, allocationErrors: 0 };
  }

  try {
    const sync = await syncPayouts(tenantId);
    recordMetric("payout_sync_total", sync.saved);

    const actor = { userId: null, email: "system", role: "SYSTEM" };
    const alloc = await allocateAllPending(tenantId, actor);
    recordMetric("allocation_total", alloc.allocated);
    if (alloc.failed.length > 0) {
      recordMetric("allocation_errors", alloc.failed.length);
    }

    return {
      locked: true,
      saved: sync.saved,
      skippedDuplicates: sync.skippedDuplicates,
      allocated: alloc.allocated,
      allocationErrors: alloc.failed.length,
    };
  } catch (err) {
    recordMetric("payout_sync_errors", 1);
    await raiseAlert(tenantId, {
      kind: "REVENUE_ANOMALY",
      severity: "WARNING",
      message: `payout 同期でエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
      evidence: {},
      targetType: "system",
      targetId: "payout-sync",
    });
    throw err;
  } finally {
    await store.releaseLock(lockKey, HOLDER);
  }
}
