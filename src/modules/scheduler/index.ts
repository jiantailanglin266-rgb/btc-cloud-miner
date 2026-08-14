/**
 * Production Scheduler（フェーズ12・13）
 *
 * すべての定期処理を「名前付きジョブ」として登録し、
 *   - local worker（scripts/worker.ts のループ）
 *   - cron（`tsx scripts/run-job.ts <jobKind>` 等）
 *   - cloud scheduler（HTTP: POST /api/admin action=run-job）
 * のどこからでも同じ実装を呼べるようにする共通 Service。
 *
 * Retry / Dead Letter（フェーズ13）:
 *   失敗したジョブは指数バックオフで最大 MAX_ATTEMPTS 回まで再試行し、
 *   それでも失敗したら DeadLetterJob として記録する（無限 retry 禁止）。
 *   Dead Letter は Admin から再実行できる。
 */

import { getStore } from "@/lib/store";
import { runWorkerSync, runPayoutSync } from "@/modules/mining/sync";
import { getProviderHealth } from "@/modules/provider/registry";
import { reconcile } from "@/modules/revenue/reconciliation";
import { verifyPendingPayouts } from "@/modules/bitcoin/tx-verify";
import { verifyInvariants } from "@/modules/wallet/ledger";
import { newId } from "@/lib/crypto";
import { raiseAlert } from "@/modules/monitoring/alerts";

export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 2_000, 8_000]; // 試行間の待機（指数バックオフ）

export type JobKind =
  | "sync-workers"
  | "sync-balance"
  | "sync-payouts"
  | "provider-health"
  | "reconciliation"
  | "ledger-verification"
  | "tx-verification";

/** 各ジョブの推奨実行間隔（scheduler 設定の指針） */
export const JOB_INTERVALS: Record<JobKind, number> = {
  "sync-workers": 60_000, // 1分
  "sync-balance": 5 * 60_000, // 5分
  "sync-payouts": 10 * 60_000, // 10分
  "provider-health": 60_000, // 1分
  reconciliation: 30 * 60_000, // 30分
  "ledger-verification": 24 * 3600_000, // 日次
  "tx-verification": 15 * 60_000, // 15分
};

export type JobResult = {
  jobKind: JobKind;
  tenantId: string;
  ok: boolean;
  attempts: number;
  summary: string;
  deadLetterId: string | null;
};

/** ジョブ本体の実装（1テナント分）。新しいジョブはここに足す */
async function executeJob(jobKind: JobKind, tenantId: string): Promise<string> {
  const store = await getStore();
  switch (jobKind) {
    case "sync-workers": {
      const r = await runWorkerSync(tenantId);
      return r.locked
        ? `snapshots=${r.snapshots} raw=${r.rawRecorded} errors=${r.providerErrors}`
        : "skipped(locked)";
    }
    case "sync-balance": {
      // 残高は fetchWorkers と同経路（Facade キャッシュ）で取得されるため、
      // ここでは provider health 経由の軽い同期に留める
      const health = await getProviderHealth(tenantId);
      return `providers=${health.length}`;
    }
    case "sync-payouts": {
      const r = await runPayoutSync(tenantId);
      return r.locked
        ? `saved=${r.saved} allocated=${r.allocated} errors=${r.allocationErrors}`
        : "skipped(locked)";
    }
    case "provider-health": {
      const health = await getProviderHealth(tenantId);
      const offline = health.filter((h) => h.status === "OFFLINE").length;
      return `online=${health.length - offline} offline=${offline}`;
    }
    case "reconciliation": {
      const r = await reconcile(tenantId);
      if (r.mismatchCount > 0) {
        throw new Error(`reconciliation 不一致 ${r.mismatchCount} 件`);
      }
      return `rows=${r.rows.length} mismatch=0`;
    }
    case "ledger-verification": {
      const users = await store.listUsers(tenantId);
      let violations = 0;
      for (const user of users) {
        const account = await store.getWalletAccount(tenantId, user.id);
        const entries = await store.listLedgerEntries(tenantId, account.id);
        if (entries.length === 0) continue;
        const inv = verifyInvariants(entries);
        if (!inv.ok) {
          violations++;
          await raiseAlert(tenantId, {
            kind: "LEDGER_IMBALANCE",
            severity: "CRITICAL",
            message: `${user.email} の元帳に不変条件違反: ${inv.violations[0]}`,
            evidence: { userId: user.id },
            targetType: "user",
            targetId: user.id,
          });
        }
      }
      if (violations > 0) throw new Error(`元帳違反 ${violations} 件`);
      return `users=${users.length} violations=0`;
    }
    case "tx-verification": {
      const r = await verifyPendingPayouts(tenantId);
      return `verified=${r.verified} mismatched=${r.mismatched} pending=${r.pending}`;
    }
    default: {
      const never: never = jobKind;
      throw new Error(`未知のジョブ: ${String(never)}`);
    }
  }
}

/**
 * リトライ + Dead Letter 付きのジョブ実行。
 * どのエントリポイント（worker/cron/HTTP）もこれを呼ぶ。
 */
export async function runJob(jobKind: JobKind, tenantId: string): Promise<JobResult> {
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 8_000));
    }
    try {
      const summary = await executeJob(jobKind, tenantId);
      return { jobKind, tenantId, ok: true, attempts: attempt, summary, deadLetterId: null };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // ★ 最大試行後も失敗 → Dead Letter として記録（無限 retry しない）
  const store = await getStore();
  const deadLetterId = newId();
  await store.insertDeadLetter({
    id: deadLetterId,
    tenantId,
    jobKind,
    payload: { tenantId },
    attempts: MAX_ATTEMPTS,
    lastError: lastError.slice(0, 500),
    createdAt: new Date().toISOString(),
    retriedAt: null,
    retriedBy: null,
    status: "DEAD",
  });

  return {
    jobKind,
    tenantId,
    ok: false,
    attempts: MAX_ATTEMPTS,
    summary: `FAILED: ${lastError.slice(0, 200)}`,
    deadLetterId,
  };
}

/** Dead Letter の再実行（Admin 操作）。成功したら RESOLVED にする */
export async function retryDeadLetter(
  tenantId: string,
  deadLetterId: string,
  adminUserId: string,
): Promise<JobResult> {
  const store = await getStore();
  const jobs = await store.listDeadLetters(tenantId);
  const job = jobs.find((j) => j.id === deadLetterId);
  if (!job) throw new Error("Dead Letter Job が見つかりません");

  const result = await runJob(job.jobKind as JobKind, tenantId);
  await store.updateDeadLetter(tenantId, deadLetterId, {
    retriedAt: new Date().toISOString(),
    retriedBy: adminUserId,
    status: result.ok ? "RESOLVED" : "RETRIED",
    lastError: result.ok ? job.lastError : result.summary.slice(0, 500),
  });
  return result;
}

/** 全テナントに対して 1 ジョブを実行（cron エントリポイント用） */
export async function runJobForAllTenants(jobKind: JobKind): Promise<JobResult[]> {
  const store = await getStore();
  const tenants = await store.listTenants();
  const results: JobResult[] = [];
  for (const t of tenants) {
    results.push(await runJob(jobKind, t.id));
  }
  return results;
}
