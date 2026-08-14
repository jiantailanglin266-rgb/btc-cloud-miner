/**
 * Ledger Integrity Daily Check（フェーズ11）
 *
 *   npm run ledger:verify
 *
 * 全テナント・全ユーザーの元帳について:
 *   - debits / credits の集計
 *   - balance（AVAILABLE / LOCKED が負でない）
 *   - orphan ledger entries（存在しない account / payout 参照）
 *   - duplicate idempotency keys
 * を検査し PASS / WARN / FAIL を出す。日次 cron から呼べる（FAIL で exit 1）。
 */

import { getStore } from "@/lib/store";
import { verifyInvariants, deriveBalance } from "@/modules/wallet/ledger";
import { toSat, fromSat } from "@/lib/decimal";

type Level = "PASS" | "WARN" | "FAIL";
const rows: Array<{ scope: string; level: Level; detail: string }> = [];
const put = (scope: string, level: Level, detail: string) =>
  rows.push({ scope, level, detail });

async function main() {
  const store = await getStore();
  const tenants = await store.listTenants();

  for (const tenant of tenants) {
    const users = await store.listUsers(tenant.id);
    let totalCredits = 0n;
    let totalDebits = 0n;
    let entriesCount = 0;
    const accountIds = new Set<string>();

    for (const user of users) {
      const account = await store.getWalletAccount(tenant.id, user.id);
      accountIds.add(account.id);
      const entries = await store.listLedgerEntries(tenant.id, account.id);
      if (entries.length === 0) continue;
      entriesCount += entries.length;

      // debits / credits
      for (const e of entries) {
        const sat = toSat(e.amountBtc);
        if (sat >= 0n) totalCredits += sat;
        else totalDebits += -sat;
      }

      // balance 不変条件 + 冪等キー重複
      const inv = verifyInvariants(entries);
      if (!inv.ok) {
        put(
          `${tenant.slug}/${user.email}`,
          "FAIL",
          inv.violations.join(" / ").slice(0, 200),
        );
      }

      // orphan: refType=payout の参照先が存在するか
      const payoutRefs = [
        ...new Set(
          entries
            .filter((e) => e.refType === "payout" && e.refId)
            .map((e) => e.refId as string),
        ),
      ];
      for (const refId of payoutRefs) {
        const payout = await store.getPayout(tenant.id, refId);
        if (!payout) {
          put(
            `${tenant.slug}/${user.email}`,
            "FAIL",
            `orphan entry: 存在しない payout を参照 (${refId.slice(0, 20)})`,
          );
        }
      }

      const balance = deriveBalance(entries);
      if (toSat(balance.availableBtc) < 0n || toSat(balance.lockedBtc) < 0n) {
        put(`${tenant.slug}/${user.email}`, "FAIL", "負残高");
      }
    }

    const tenantHasFail = rows.some((r) => r.scope.startsWith(tenant.slug) && r.level === "FAIL");
    put(
      `${tenant.slug}（全体）`,
      tenantHasFail ? "FAIL" : "PASS",
      `entries=${entriesCount} credits=${fromSat(totalCredits)} debits=${fromSat(totalDebits)} accounts=${accountIds.size}`,
    );
  }

  // --- 出力 ---
  const icon = { PASS: "✓", WARN: "!", FAIL: "✗" };
  const color = { PASS: "\x1b[32m", WARN: "\x1b[33m", FAIL: "\x1b[31m" };
  console.log("\n  Ledger Integrity Check\n");
  for (const r of rows) {
    console.log(`  ${color[r.level]}${icon[r.level]} ${r.level}\x1b[0m  [${r.scope}] ${r.detail}`);
  }
  const fails = rows.filter((r) => r.level === "FAIL").length;
  console.log(
    `\n  結果: PASS ${rows.filter((r) => r.level === "PASS").length} / WARN ${rows.filter((r) => r.level === "WARN").length} / FAIL ${fails}\n`,
  );
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ledger:verify 実行エラー:", err);
  process.exit(1);
});
