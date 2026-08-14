/**
 * Background Sync Worker（フェーズ6）
 *
 *   npm run worker
 *
 * ブラウザアクセスに依存せず、定期的に:
 *   - worker 統計   （既定 60s）
 *   - pool payout + 配賦（既定 600s）
 *   - provider health（worker 同期に含む）
 * を同期する。全テナントを対象にする。
 *
 * 二重実行防止は store の同期ロックで担保されるため、複数プロセスを起動しても安全。
 * 将来は Cron / Queue / Cloud Scheduler がこのループの代わりに runWorkerSync を呼べばよい。
 *
 * ★ tsx で実行（tsconfig の @ エイリアスを解決）。
 */

import { getStore } from "@/lib/store";
import { runWorkerSync, runPayoutSync } from "@/modules/mining/sync";
import { config } from "@/lib/config";

const WORKER_INTERVAL_MS = config.mining.syncIntervalSec * 1000;
const PAYOUT_INTERVAL_MS = 10 * 60_000;

let stopping = false;

async function tenantIds(): Promise<string[]> {
  const store = await getStore();
  const tenants = await store.listTenants();
  return tenants.map((t) => t.id);
}

async function workerCycle() {
  if (stopping) return;
  try {
    for (const tenantId of await tenantIds()) {
      const r = await runWorkerSync(tenantId);
      if (r.locked) {
        console.info(
          `[worker] ${tenantId} 同期: snapshots=${r.snapshots} raw=${r.rawRecorded} errors=${r.providerErrors} ${r.durationMs}ms`,
        );
      } else {
        console.info(`[worker] ${tenantId} 同期スキップ（他プロセスが実行中）`);
      }
    }
  } catch (err) {
    console.error("[worker] 統計同期でエラー:", err instanceof Error ? err.message : err);
  }
}

async function payoutCycle() {
  if (stopping) return;
  try {
    for (const tenantId of await tenantIds()) {
      const r = await runPayoutSync(tenantId);
      if (r.locked) {
        console.info(
          `[worker] ${tenantId} payout: saved=${r.saved} dup=${r.skippedDuplicates} allocated=${r.allocated} errors=${r.allocationErrors}`,
        );
      }
    }
  } catch (err) {
    console.error("[worker] payout 同期でエラー:", err instanceof Error ? err.message : err);
  }
}

async function main() {
  console.info(
    `[worker] 起動しました（worker=${WORKER_INTERVAL_MS / 1000}s / payout=${PAYOUT_INTERVAL_MS / 1000}s）`,
  );

  // 起動直後に 1 回実行
  await workerCycle();
  await payoutCycle();

  const workerTimer = setInterval(workerCycle, WORKER_INTERVAL_MS);
  const payoutTimer = setInterval(payoutCycle, PAYOUT_INTERVAL_MS);

  const shutdown = () => {
    stopping = true;
    clearInterval(workerTimer);
    clearInterval(payoutTimer);
    console.info("[worker] 停止しました");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] 致命的エラー:", err);
  process.exit(1);
});
