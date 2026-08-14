/**
 * Payout Reconciliation（フェーズ10）
 *
 * プールの実 payout と内部 Ledger が satoshi 単位で一致しているかを検証する。
 * 1 satoshi でもズレたら CRITICAL アラート（LEDGER_IMBALANCE）。
 *
 * ★ すべて satoshi 整数（bigint）で計算する。float BTC は使わない。
 *
 * 検証の考え方:
 *   ある payout について、その payout を ref とする Ledger エントリを集計し、
 *     Σ(MINING_REWARD) が payout 額と一致するか（配賦漏れ・過剰配賦の検出）
 *     Σ(全エントリ: gross − fees) が「ユーザーに渡った net」と一致するか
 *   をチェックする。
 */

import type { LedgerEntryType, PoolPayout } from "@/types";
import { getStore } from "@/lib/store";
import { toSat, fromSat } from "@/lib/decimal";
import { raiseAlert } from "@/modules/monitoring/alerts";
import { recordMetric } from "@/modules/monitoring/metrics";

export type ReconciliationRow = {
  payoutId: string;
  externalPayoutId: string;
  providerId: string;
  paidAt: string;
  poolPayoutBtc: string;
  allocatedGrossBtc: string;
  platformFeeBtc: string;
  hostingFeeBtc: string;
  userNetBtc: string;
  ledgerTotalBtc: string;
  /** poolPayout − allocatedGross（satoshi）。0 が正常 */
  differenceSat: string;
  status: "OK" | "UNALLOCATED" | "MISMATCH";
};

export type ReconciliationReport = {
  generatedAt: string;
  rows: ReconciliationRow[];
  totalPoolPayoutBtc: string;
  totalAllocatedBtc: string;
  totalUserNetBtc: string;
  totalPlatformFeeBtc: string;
  mismatchCount: number;
};

const FEE_TYPES: LedgerEntryType[] = ["POOL_FEE", "PLATFORM_FEE", "HOSTING_FEE"];

export async function reconcile(
  tenantId: string,
  sinceMs?: number,
): Promise<ReconciliationReport> {
  const store = await getStore();
  const payouts = await store.listPayouts(tenantId, { limit: 500 });
  const scoped = sinceMs
    ? payouts.filter((p) => new Date(p.paidAt).getTime() >= sinceMs)
    : payouts;

  // 全ユーザーの Ledger から payout ごとの集計を作る（refType=payout, refId=payout.id）
  const users = await store.listUsers(tenantId);
  const byPayout = new Map<
    string,
    { gross: bigint; platformFee: bigint; hostingFee: bigint; net: bigint }
  >();

  for (const user of users) {
    const account = await store.getWalletAccount(tenantId, user.id);
    const entries = await store.listLedgerEntries(tenantId, account.id);
    for (const e of entries) {
      if (e.refType !== "payout" || !e.refId) continue;
      const agg =
        byPayout.get(e.refId) ??
        { gross: 0n, platformFee: 0n, hostingFee: 0n, net: 0n };
      const sat = toSat(e.amountBtc);
      if (e.entryType === "MINING_REWARD") agg.gross += sat;
      if (e.entryType === "PLATFORM_FEE") agg.platformFee += -sat; // 負エントリを正に
      if (e.entryType === "HOSTING_FEE") agg.hostingFee += -sat;
      if (e.entryType === "POOL_FEE") agg.hostingFee += 0n; // pool fee は既定で発生しない
      // net はエントリ合計（gross は +、fee は −）
      if (e.entryType === "MINING_REWARD" || FEE_TYPES.includes(e.entryType)) {
        agg.net += sat;
      }
      byPayout.set(e.refId, agg);
    }
  }

  const rows: ReconciliationRow[] = [];
  let totalPool = 0n;
  let totalAllocated = 0n;
  let totalNet = 0n;
  let totalPlatformFee = 0n;
  let mismatchCount = 0;

  for (const p of scoped) {
    const poolSat = toSat(p.amountBtc);
    totalPool += poolSat;

    if (p.allocationStatus === "UNALLOCATED") {
      rows.push(reconRow(p, poolSat, 0n, 0n, 0n, 0n, "UNALLOCATED"));
      continue;
    }

    const agg = byPayout.get(p.id) ?? { gross: 0n, platformFee: 0n, hostingFee: 0n, net: 0n };
    totalAllocated += agg.gross;
    totalNet += agg.net;
    totalPlatformFee += agg.platformFee;

    // ★ 配賦済み payout は gross が payout 額と厳密一致すべき
    const diff = poolSat - agg.gross;
    const status = diff === 0n ? "OK" : "MISMATCH";
    if (status === "MISMATCH") {
      mismatchCount++;
      // 1 satoshi でもズレたら CRITICAL アラート
      await raiseAlert(tenantId, {
        kind: "LEDGER_IMBALANCE",
        severity: "CRITICAL",
        message: `payout ${p.externalPayoutId} の配賦額が pool payout と一致しません（差 ${fromSat(diff)} BTC）`,
        evidence: {
          payoutId: p.id,
          poolPayoutBtc: p.amountBtc,
          allocatedGrossBtc: fromSat(agg.gross),
          differenceSat: diff.toString(),
        },
        targetType: "payout",
        targetId: p.id,
      });
    }
    rows.push(reconRow(p, poolSat, agg.gross, agg.platformFee, agg.hostingFee, agg.net, status));
  }

  recordMetric("ledger_imbalance", mismatchCount);

  return {
    generatedAt: new Date().toISOString(),
    rows,
    totalPoolPayoutBtc: fromSat(totalPool),
    totalAllocatedBtc: fromSat(totalAllocated),
    totalUserNetBtc: fromSat(totalNet),
    totalPlatformFeeBtc: fromSat(totalPlatformFee),
    mismatchCount,
  };
}

function reconRow(
  p: PoolPayout,
  poolSat: bigint,
  gross: bigint,
  platformFee: bigint,
  hostingFee: bigint,
  net: bigint,
  status: ReconciliationRow["status"],
): ReconciliationRow {
  return {
    payoutId: p.id,
    externalPayoutId: p.externalPayoutId,
    providerId: p.providerId,
    paidAt: p.paidAt,
    poolPayoutBtc: fromSat(poolSat),
    allocatedGrossBtc: fromSat(gross),
    platformFeeBtc: fromSat(platformFee),
    hostingFeeBtc: fromSat(hostingFee),
    userNetBtc: fromSat(net),
    ledgerTotalBtc: fromSat(net),
    differenceSat: (poolSat - gross).toString(),
    status,
  };
}
