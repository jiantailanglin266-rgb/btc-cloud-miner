/**
 * 単発ジョブ実行（cron / cloud scheduler エントリポイント）
 *
 *   npm run job -- sync-workers
 *   npm run job -- sync-payouts
 *   npm run job -- reconciliation
 *   npm run job -- ledger-verification
 *   npm run job -- tx-verification
 *   npm run job -- provider-health
 *
 * crontab 例（DEPLOYMENT.md 参照）:
 *   「5分ごと」 cd /app && npx tsx scripts/run-job.ts sync-workers
 *   「毎日3時」 cd /app && npx tsx scripts/run-job.ts ledger-verification
 *
 * 失敗（Dead Letter 化）で exit 1 を返すため、cron の失敗通知に載る。
 */

import { runJobForAllTenants, JOB_INTERVALS, type JobKind } from "@/modules/scheduler";

async function main() {
  const jobKind = process.argv[2] as JobKind | undefined;
  const valid = Object.keys(JOB_INTERVALS) as JobKind[];

  if (!jobKind || !valid.includes(jobKind)) {
    console.error(`使い方: npm run job -- <jobKind>\n  jobKind: ${valid.join(" | ")}`);
    process.exit(2);
  }

  const results = await runJobForAllTenants(jobKind);
  let failed = 0;
  for (const r of results) {
    console.log(
      `${r.ok ? "OK  " : "DEAD"} ${r.jobKind} tenant=${r.tenantId} attempts=${r.attempts} ${r.summary}`,
    );
    if (!r.ok) failed++;
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("run-job 実行エラー:", err);
  process.exit(1);
});
