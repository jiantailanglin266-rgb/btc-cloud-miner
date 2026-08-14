/**
 * DB 主要テーブル存在確認（フェーズ16）
 *
 *   npm run db:verify
 *
 * DATABASE_URL 未設定（インメモリ）の場合は WARN で正常終了する。
 */

import { getStore } from "@/lib/store";
import { config } from "@/lib/config";

async function main() {
  console.log("\n  Database Verification\n");

  if (!config.databaseUrl) {
    console.log("  ! WARN  DATABASE_URL 未設定 — インメモリストアで動作中（テーブル検証はスキップ）");
    console.log("          本番では PostgreSQL + `npx prisma migrate deploy` が必須です。\n");
    process.exit(0);
  }

  const store = await getStore();
  if (store.kind !== "prisma") {
    console.log("  ✗ FAIL  DATABASE_URL は設定されているが接続に失敗（インメモリへフォールバック中）\n");
    process.exit(1);
  }

  // 主要テーブルへ実際にクエリして存在確認する（マイグレーション漏れの検出）
  const tenant = await store.getDefaultTenant();
  const checks: Array<[string, () => Promise<unknown>]> = [
    ["tenants", () => store.listTenants()],
    ["users", () => store.listUsers(tenant.id)],
    ["mining_providers", () => store.listProviders(tenant.id)],
    ["workers", () => store.listWorkers(tenant.id)],
    ["worker_snapshots", () => store.listSnapshots(tenant.id, { limit: 1 })],
    ["pool_payouts", () => store.listPayouts(tenant.id, { limit: 1 })],
    ["ledger_entries", () => store.getWalletAccount(tenant.id, "db-verify-probe").then(() => true)],
    ["withdrawals", () => store.listWithdrawals(tenant.id)],
    ["alerts", () => store.listAlerts(tenant.id, { limit: 1 })],
    ["audit_logs", () => store.listAuditLogs(tenant.id, { limit: 1 })],
    ["provider_certifications", () => store.listCertifications(tenant.id, undefined, 1)],
    ["dead_letter_jobs", () => store.listDeadLetters(tenant.id, { limit: 1 })],
    ["raw_provider_snapshots", () => store.listRawSnapshots(tenant.id, undefined, 1)],
  ];

  let fails = 0;
  for (const [table, fn] of checks) {
    try {
      await fn();
      console.log(`  ✓ PASS  ${table}`);
    } catch (err) {
      fails++;
      console.log(
        `  ✗ FAIL  ${table} — ${err instanceof Error ? err.message.slice(0, 100) : err}`,
      );
    }
  }

  console.log(`\n  結果: ${checks.length - fails}/${checks.length} テーブル OK\n`);
  if (fails > 0) {
    console.log("  マイグレーション未適用の可能性: npx prisma migrate deploy を実行してください\n");
  }
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("db:verify 実行エラー:", err);
  process.exit(1);
});
