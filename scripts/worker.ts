/**
 * Background Sync Worker（フェーズ6・12）
 *
 *   npm run worker
 *
 * scheduler 共通 Service（modules/scheduler）のジョブを推奨間隔で回す
 * ローカル常駐プロセス。cron / cloud scheduler へ移行する場合は、
 * 同じジョブを `npm run job -- <jobKind>` または HTTP で呼べばよい。
 *
 * 二重実行防止は store の同期ロックで担保されるため、多重起動しても安全。
 */

import { runJobForAllTenants, JOB_INTERVALS, type JobKind } from "@/modules/scheduler";

let stopping = false;
const timers: NodeJS.Timeout[] = [];

async function cycle(jobKind: JobKind) {
  if (stopping) return;
  try {
    const results = await runJobForAllTenants(jobKind);
    for (const r of results) {
      const mark = r.ok ? "OK " : "DEAD";
      console.info(
        `[worker] ${mark} ${jobKind} tenant=${r.tenantId} attempts=${r.attempts} ${r.summary}` +
          (r.deadLetterId ? ` deadLetter=${r.deadLetterId}` : ""),
      );
    }
  } catch (err) {
    console.error(`[worker] ${jobKind} 実行エラー:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  const jobs = Object.entries(JOB_INTERVALS) as Array<[JobKind, number]>;
  console.info(
    `[worker] 起動しました: ${jobs.map(([k, ms]) => `${k}@${ms / 1000}s`).join(" / ")}`,
  );

  // 起動直後に主要ジョブを 1 回実行
  await cycle("sync-workers");
  await cycle("sync-payouts");
  await cycle("tx-verification");

  for (const [jobKind, intervalMs] of jobs) {
    timers.push(setInterval(() => cycle(jobKind), intervalMs));
  }

  const shutdown = () => {
    stopping = true;
    for (const t of timers) clearInterval(t);
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
