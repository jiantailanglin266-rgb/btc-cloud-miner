/**
 * Revenue Allocation — 実 Pool 報酬のユーザー別配賦
 *
 * パイプライン（フェーズ7仕様）:
 *   Pool Actual Reward (100%)
 *     → ユーザーごとの実績 Hashrate 比率で按分
 *     → Pool Fee 控除（※下記の重要な注意を参照）
 *     → Platform Fee 控除
 *     → Revenue Share 控除
 *     → Hosting Fee 控除（該当契約のみ）
 *     → User Net Revenue → 内部 Ledger へ Credit
 *
 * ★★ Pool Fee に関する重要な会計上の事実 ★★
 *   実在のマイニングプールは、手数料を差し引いた「後」の金額を払い出す。
 *   したがって実 payout に poolFeeRate を再度掛けると二重控除になる。
 *   既定では payoutIsNetOfPoolFee = true とし、Pool Fee 控除をスキップする。
 *   プールが gross で払い出す特殊な契約の場合のみ false にする。
 *
 * ★★ 冪等性（同じ payout を二重計上しない）3 層防御 ★★
 *   1. PoolPayout の UNIQUE(providerId, externalPayoutId) — 取り込みの重複防止
 *   2. payout.allocationStatus = ALLOCATED チェック — 配賦の再実行防止
 *   3. Ledger の UNIQUE(tenantId, idempotencyKey) — 万一 1,2 を突破しても
 *      `payout:{payoutId}:{userId}:gross` キー衝突で書き込み自体が失敗する
 *
 * ★★ satoshi 保存則 ★★
 *   按分は satoshi 整数で行い、端数（余り satoshi）は「最大ハッシュレートのユーザー」へ
 *   決定的に割り当てる。合計は必ず元の payout 金額と一致する（テストで固定）。
 */

import type { Contract, Earning, LedgerEntry, PoolPayout } from "@/types";
import { getStore } from "@/lib/store";
import { toSat, fromSat } from "@/lib/decimal";
import { newId } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { raiseAlert } from "@/modules/monitoring/alerts";
import { isProviderCertified } from "@/modules/provider/certification";
import { verifyInvariants } from "@/modules/wallet/ledger";

// ---------------------------------------------------------------------------
// 純関数部（テスト対象の中核）
// ---------------------------------------------------------------------------

export type AllocationShare = {
  userId: string;
  contractId: string;
  /** 按分の重み。実測ハッシュレート（取得できない場合は契約ハッシュレート） */
  weightThs: number;
  poolFeeRate: number;
  platformFeeRate: number;
  revenueShareRate: number;
  hostingFeeRate: number;
};

export type UserAllocation = {
  userId: string;
  contractId: string;
  weightThs: number;
  grossBtc: string;
  poolFeeBtc: string;
  platformFeeBtc: string;
  revenueShareBtc: string;
  hostingFeeBtc: string;
  netBtc: string;
};

export class AllocationError extends Error {}

/** rate(0〜1) × satoshi の切り捨て乗算（ユーザーから過大に取らない方向） */
function feeSat(grossSat: bigint, rate: number): bigint {
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    throw new AllocationError(`不正な料率です: ${rate}`);
  }
  const scaled = BigInt(Math.round(rate * 1e12));
  return (grossSat * scaled) / 1_000_000_000_000n;
}

/**
 * 実 payout をユーザーへ按分する純関数。
 * 事前条件: shares は空でなく、weightThs 合計 > 0。
 * 事後条件: Σ grossBtc === payoutAmountBtc（satoshi 単位で厳密一致）。
 */
export function allocatePayout(
  payoutAmountBtc: string,
  shares: AllocationShare[],
  opts: { payoutIsNetOfPoolFee?: boolean } = {},
): UserAllocation[] {
  const payoutIsNetOfPoolFee = opts.payoutIsNetOfPoolFee ?? true;

  if (shares.length === 0) {
    throw new AllocationError("配賦先の契約がありません");
  }
  const totalWeight = shares.reduce((s, x) => s + x.weightThs, 0);
  if (!(totalWeight > 0)) {
    throw new AllocationError("按分の重み（ハッシュレート）の合計がゼロです");
  }

  const totalSat = toSat(payoutAmountBtc);
  if (totalSat <= 0n) {
    throw new AllocationError(`payout 金額が不正です: ${payoutAmountBtc}`);
  }

  // 重みを 1e6 スケールの整数にして bigint 按分する（浮動小数点の誤差を持ち込まない）
  const weightsScaled = shares.map((s) => BigInt(Math.round(s.weightThs * 1e6)));
  const totalWeightScaled = weightsScaled.reduce((a, b) => a + b, 0n);
  if (totalWeightScaled <= 0n) {
    throw new AllocationError("按分の重みが小さすぎます");
  }

  // 切り捨て按分 → 余り satoshi を集計
  const grossSats = weightsScaled.map((w) => (totalSat * w) / totalWeightScaled);
  let remainder = totalSat - grossSats.reduce((a, b) => a + b, 0n);

  // 余りは「最大重みのユーザー」へ決定的に割り当てる（実行のたびに結果が変わらない）
  if (remainder > 0n) {
    let maxIdx = 0;
    for (let i = 1; i < shares.length; i++) {
      if (weightsScaled[i] > weightsScaled[maxIdx]) maxIdx = i;
    }
    grossSats[maxIdx] += remainder;
    remainder = 0n;
  }

  const out: UserAllocation[] = shares.map((share, i) => {
    const gross = grossSats[i];
    const poolFee = payoutIsNetOfPoolFee ? 0n : feeSat(gross, share.poolFeeRate);
    const platformFee = feeSat(gross, share.platformFeeRate);
    const revenueShare = feeSat(gross, share.revenueShareRate);
    const hostingFee = feeSat(gross, share.hostingFeeRate);
    const net = gross - poolFee - platformFee - revenueShare - hostingFee;
    if (net < 0n) {
      throw new AllocationError(
        `手数料の合計が配賦額を超えています（userId=${share.userId}）`,
      );
    }
    return {
      userId: share.userId,
      contractId: share.contractId,
      weightThs: share.weightThs,
      grossBtc: fromSat(gross),
      poolFeeBtc: fromSat(poolFee),
      platformFeeBtc: fromSat(platformFee),
      revenueShareBtc: fromSat(revenueShare),
      hostingFeeBtc: fromSat(hostingFee),
      netBtc: fromSat(net),
    };
  });

  // 事後条件の自己検証（保存則が破れていたら即座に失敗させる）
  const check = out.reduce((a, x) => a + toSat(x.grossBtc), 0n);
  if (check !== totalSat) {
    throw new AllocationError(
      `内部エラー: 按分合計が payout と一致しません（${fromSat(check)} != ${payoutAmountBtc}）`,
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// オーケストレーション（DB との接続部）
// ---------------------------------------------------------------------------

export type AllocationResult = {
  payoutId: string;
  allocations: UserAllocation[];
  /** 冪等キー衝突でスキップされたユーザー（= 既に配賦済みだった） */
  skippedUsers: string[];
};

/**
 * 契約ごとの按分重みを求める。
 * 実測ハッシュレート（payout 期間中のスナップショット平均）を優先し、
 * 実測が無い場合は契約ハッシュレートへフォールバックする。
 */
async function buildShares(
  tenantId: string,
  payout: PoolPayout,
  contracts: Contract[],
): Promise<AllocationShare[]> {
  const store = await getStore();
  const paidAtMs = new Date(payout.paidAt).getTime();
  // payout は前日分の想定 → paidAt から遡って 24 時間を計測窓にする
  const windowStart = paidAtMs - 24 * 3600_000;

  const allocations = await store.listAllocations(tenantId);
  const snapshots = await store.listSnapshots(tenantId, {
    fromMs: windowStart,
    limit: 20000,
  });
  const windowSnapshots = snapshots.filter(
    (s) => new Date(s.bucketAt).getTime() <= paidAtMs,
  );

  return contracts.map((c) => {
    // この契約に割り当てられたワーカーの実測平均を求める
    const workerIds = new Set(
      allocations
        .filter((a) => a.contractId === c.id && a.workerId)
        .map((a) => a.workerId as string),
    );
    const mine = windowSnapshots.filter((s) => workerIds.has(s.workerId));

    let weightThs = c.hashrateThs; // フォールバック: 契約値
    if (mine.length > 0) {
      const byBucket = new Map<string, number>();
      for (const s of mine) {
        byBucket.set(s.bucketAt, (byBucket.get(s.bucketAt) ?? 0) + s.hashrateThs);
      }
      let sum = 0;
      for (const v of byBucket.values()) sum += v;
      weightThs = sum / byBucket.size;
    }

    return {
      userId: c.userId,
      contractId: c.id,
      weightThs,
      poolFeeRate: c.poolFeeRate,
      platformFeeRate: c.platformFeeRate,
      revenueShareRate: c.revenueShareRate,
      hostingFeeRate:
        c.electricityCostTreatment === "PASS_THROUGH" ? c.hostingFeeRate : 0,
    };
  });
}

/**
 * Allocation Safety Gate（フェーズ9）
 *
 * 実 payout を自動配賦する前に満たすべき条件。1 つでも欠ければ
 * PENDING_REVIEW にして人間の確認に回す（無条件自動配賦の禁止）。
 *
 *   1. Provider certified   … 直近7日以内に実疎通の証明がある（Mock は対象外）
 *   2. Payout unique        … UNIQUE 制約 + 状態フラグ（既存の冪等 1・2 層）
 *   3. Amount valid         … 金額が正・現実的範囲
 *   4. Worker snapshot      … payout 期間に実測スナップショットがある
 *                             （無ければ契約値按分になるため、LIVE payout では確認必須）
 *   5. Allocation invariant … satoshi 保存則（allocatePayout 内の自己検証）
 *   6. Ledger balanced      … 対象ユーザーの元帳が不変条件を満たしている
 */
export type GateCheck = { name: string; ok: boolean; detail: string };

async function runSafetyGate(
  tenantId: string,
  payout: PoolPayout,
  contracts: Contract[],
): Promise<{ passed: boolean; checks: GateCheck[] }> {
  const store = await getStore();
  const checks: GateCheck[] = [];
  const isLivePayout = !payout.source.startsWith("mock");

  // 1. Provider certified
  const provider = await store.getProvider(tenantId, payout.providerId);
  if (!provider) {
    checks.push({ name: "provider_certified", ok: false, detail: "プロバイダーが存在しません" });
  } else {
    const certified = await isProviderCertified(tenantId, provider);
    checks.push({
      name: "provider_certified",
      ok: certified,
      detail: certified
        ? "疎通証明あり"
        : "直近7日の CONNECTED certification がありません（TEST CONNECTION を実行してください）",
    });
  }

  // 2. Payout unique（状態で担保。二重は上位層が防ぐ）
  checks.push({
    name: "payout_unique",
    ok: payout.allocationStatus !== "ALLOCATED",
    detail: payout.allocationStatus,
  });

  // 3. Amount valid
  const amountOk = toSat(payout.amountBtc) > 0n && Number(payout.amountBtc) <= 100;
  checks.push({
    name: "amount_valid",
    ok: amountOk,
    detail: `${payout.amountBtc} BTC`,
  });

  // 4. Worker snapshot available（LIVE payout のみ必須。Mock はデモ用に緩和）
  const paidAtMs = new Date(payout.paidAt).getTime();
  const snapshots = await store.listSnapshots(tenantId, {
    fromMs: paidAtMs - 24 * 3600_000,
    limit: 1000,
  });
  const inWindow = snapshots.filter((s) => new Date(s.bucketAt).getTime() <= paidAtMs);
  const snapshotOk = !isLivePayout || inWindow.length > 0;
  checks.push({
    name: "worker_snapshot_available",
    ok: snapshotOk,
    detail:
      inWindow.length > 0
        ? `期間内スナップショット ${inWindow.length} 件`
        : "payout 期間の実測スナップショットがありません（契約値按分になるため要確認）",
  });

  // 6. Ledger balanced（配賦先ユーザーの元帳を事前検査）
  let ledgerOk = true;
  const ledgerIssues: string[] = [];
  for (const c of contracts) {
    const account = await store.getWalletAccount(tenantId, c.userId);
    const entries = await store.listLedgerEntries(tenantId, account.id);
    if (entries.length === 0) continue;
    const inv = verifyInvariants(entries);
    if (!inv.ok) {
      ledgerOk = false;
      ledgerIssues.push(`${c.userId}: ${inv.violations[0]}`);
    }
  }
  checks.push({
    name: "ledger_balanced",
    ok: ledgerOk,
    detail: ledgerOk ? "不変条件 OK" : ledgerIssues.join(" / ").slice(0, 200),
  });

  return { passed: checks.every((c) => c.ok), checks };
}

/**
 * 1 件の payout をユーザーへ配賦し、Ledger と Earning に記帳する。
 * 冪等: 同じ payout に対して何度呼んでも二重計上されない。
 * Safety Gate 不通過は PENDING_REVIEW にして配賦しない。
 */
export async function allocatePayoutToUsers(
  tenantId: string,
  payoutId: string,
  actor: { userId: string | null; email: string; role: string },
  opts: { bypassGate?: boolean } = {},
): Promise<AllocationResult> {
  const store = await getStore();

  const payout = await store.getPayout(tenantId, payoutId);
  if (!payout) throw new AllocationError("payout が見つかりません");

  // 冪等第 2 層: 既に配賦済みなら何もしない
  if (payout.allocationStatus === "ALLOCATED") {
    return { payoutId, allocations: [], skippedUsers: [] };
  }

  // 配賦対象: この payout のプロバイダーに紐づく ACTIVE 契約
  const allContracts = await store.listContracts(tenantId);
  const paidAtMs = new Date(payout.paidAt).getTime();
  const contracts = allContracts.filter(
    (c) =>
      c.status === "ACTIVE" &&
      (c.providerId === payout.providerId || c.providerId === null) &&
      new Date(c.startsAt).getTime() <= paidAtMs &&
      new Date(c.endsAt).getTime() >= paidAtMs,
  );
  if (contracts.length === 0) {
    throw new AllocationError(
      `payout 期間に有効な契約がありません（provider=${payout.providerId}）。` +
        `配賦せずに保留します。`,
    );
  }

  // ★ Allocation Safety Gate（フェーズ9）: 不通過なら PENDING_REVIEW にして配賦しない。
  //   bypassGate は管理者の明示操作（レビュー済み payout の手動配賦）でのみ true になる
  if (!opts.bypassGate) {
    const gate = await runSafetyGate(tenantId, payout, contracts);
    if (!gate.passed) {
      const failed = gate.checks.filter((c) => !c.ok);
      const reason = failed.map((c) => `${c.name}: ${c.detail}`).join(" / ");
      await store.updatePayout(tenantId, payout.id, {
        allocationStatus: "PENDING_REVIEW",
        reviewReason: reason.slice(0, 500),
      });
      await raiseAlert(tenantId, {
        kind: "ALLOCATION_GATE_BLOCKED",
        severity: "WARNING",
        message: `payout ${payout.externalPayoutId} は Safety Gate 不通過のため保留にしました`,
        evidence: { payoutId: payout.id, reason: reason.slice(0, 300) },
        targetType: "payout",
        targetId: payout.id,
      });
      throw new AllocationError(`Safety Gate 不通過（PENDING_REVIEW に変更）: ${reason}`);
    }
  }

  const shares = await buildShares(tenantId, payout, contracts);
  const allocations = allocatePayout(payout.amountBtc, shares);

  const skippedUsers: string[] = [];
  const now = new Date().toISOString();

  for (const alloc of allocations) {
    const account = await store.getWalletAccount(tenantId, alloc.userId);
    const keyBase = `payout:${payout.id}:${alloc.userId}`;

    const entries: LedgerEntry[] = [
      ledgerEntry(tenantId, account.id, "MINING_REWARD", alloc.grossBtc, payout, `${keyBase}:gross`,
        `実採掘報酬の配賦（payout ${payout.externalPayoutId}）`),
    ];
    // ゼロ額の手数料エントリは書かない（元帳を汚さない）
    if (toSat(alloc.poolFeeBtc) > 0n) {
      entries.push(ledgerEntry(tenantId, account.id, "POOL_FEE", neg(alloc.poolFeeBtc), payout, `${keyBase}:poolfee`, "プール手数料"));
    }
    if (toSat(alloc.platformFeeBtc) > 0n) {
      entries.push(ledgerEntry(tenantId, account.id, "PLATFORM_FEE", neg(alloc.platformFeeBtc), payout, `${keyBase}:platformfee`, "プラットフォーム手数料"));
    }
    if (toSat(alloc.revenueShareBtc) > 0n) {
      entries.push(ledgerEntry(tenantId, account.id, "PLATFORM_FEE", neg(alloc.revenueShareBtc), payout, `${keyBase}:revshare`, "レベニューシェア"));
    }
    if (toSat(alloc.hostingFeeBtc) > 0n) {
      entries.push(ledgerEntry(tenantId, account.id, "HOSTING_FEE", neg(alloc.hostingFeeBtc), payout, `${keyBase}:hostingfee`, "ホスティング費"));
    }

    // 冪等第 3 層: 1 つでもキー衝突したらこのユーザー分は書かれない（appendLedger は全or無）
    const written = await store.appendLedger(tenantId, entries);
    if (!written) {
      skippedUsers.push(alloc.userId);
      await raiseAlert(tenantId, {
        kind: "DUPLICATE_PAYOUT",
        severity: "CRITICAL",
        message: `payout ${payout.externalPayoutId} のユーザー ${alloc.userId} への配賦が二重実行されかけました（元帳の冪等キーが阻止）`,
        evidence: { payoutId: payout.id, userId: alloc.userId },
        targetType: "payout",
        targetId: payout.id,
      });
      continue;
    }

    // Earning（ACTUAL）を記録する。推定値とは kind で厳密に区別される
    const earning: Earning = {
      id: `earn-${payout.id}-${alloc.userId}`.slice(0, 90),
      tenantId,
      userId: alloc.userId,
      contractId: alloc.contractId,
      earnedAt: payout.paidAt,
      grossBtc: alloc.grossBtc,
      poolFeeBtc: alloc.poolFeeBtc,
      platformFeeBtc: fromSat(
        toSat(alloc.platformFeeBtc) + toSat(alloc.revenueShareBtc),
      ),
      electricityFeeBtc: alloc.hostingFeeBtc,
      netBtc: alloc.netBtc,
      hashrateThs: alloc.weightThs,
      uptimeRate: 1,
      kind: "ACTUAL",
      payoutId: payout.id,
    };
    await store.createEarnings(tenantId, [earning]);
  }

  await store.updatePayout(tenantId, payout.id, {
    allocationStatus: "ALLOCATED",
    allocatedAt: now,
  });

  await audit({
    tenantId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "revenue.allocate",
    targetType: "payout",
    targetId: payout.id,
    detail: {
      externalPayoutId: payout.externalPayoutId,
      amountBtc: payout.amountBtc,
      users: allocations.length,
      skipped: skippedUsers.length,
    },
  });

  return { payoutId, allocations, skippedUsers };
}

/** 未配賦 payout をまとめて配賦する（定期ジョブ / 管理画面から呼ぶ） */
export async function allocateAllPending(
  tenantId: string,
  actor: { userId: string | null; email: string; role: string },
): Promise<{ allocated: number; failed: Array<{ payoutId: string; reason: string }> }> {
  const store = await getStore();
  const pending = await store.listPayouts(tenantId, { allocationStatus: "UNALLOCATED" });

  let allocated = 0;
  const failed: Array<{ payoutId: string; reason: string }> = [];
  for (const payout of pending) {
    try {
      await allocatePayoutToUsers(tenantId, payout.id, actor);
      allocated++;
    } catch (err) {
      failed.push({
        payoutId: payout.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { allocated, failed };
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function neg(btc: string): string {
  return fromSat(-toSat(btc));
}

function ledgerEntry(
  tenantId: string,
  accountId: string,
  entryType: LedgerEntry["entryType"],
  amountBtc: string,
  payout: PoolPayout,
  idempotencyKey: string,
  memo: string,
): LedgerEntry {
  return {
    id: newId(),
    tenantId,
    accountId,
    entryType,
    bucket: "AVAILABLE",
    amountBtc,
    refType: "payout",
    refId: payout.id,
    idempotencyKey,
    memo,
    createdAt: new Date().toISOString(),
  };
}
