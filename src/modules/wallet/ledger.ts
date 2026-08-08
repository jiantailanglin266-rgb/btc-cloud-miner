/**
 * 複式記帳の元帳
 *
 * ★ なぜ「残高カラム」を持たないのか ★
 *   残高を1つのカラムで持つと、更新の途中で落ちたり、二重に更新されたりしたときに
 *   「なぜその残高になったのか」を後から説明できなくなる。金銭を扱うシステムでは致命的。
 *
 *   代わりに「増減のイベント（仕訳）」だけを追記し、残高はその合計として導出する。
 *   これにより:
 *     - 残高が壊れても、元帳から必ず再構築できる
 *     - どの取引でいくら動いたかが完全に追跡できる（監査対応）
 *     - 冪等キーで二重計上を構造的に防げる
 *
 * 出金申請の仕訳（合計はゼロ = 資産が増減しない）:
 *   WITHDRAWAL_LOCK  AVAILABLE  -0.01
 *   WITHDRAWAL_LOCK  LOCKED     +0.01
 */

import type { LedgerEntry, LedgerEntryType, WalletBalance } from "@/types";
import { getStore } from "@/lib/store";
import { addBtc, cmpBtc, negateBtc, toSat, fromSat } from "@/lib/decimal";
import { newId } from "@/lib/crypto";

export class InsufficientBalanceError extends Error {
  constructor(available: string, requested: string) {
    super(`残高が不足しています（利用可能 ${available} BTC / 要求 ${requested} BTC）`);
    this.name = "InsufficientBalanceError";
  }
}

export class DuplicateOperationError extends Error {
  constructor() {
    super("同じ操作が既に処理されています");
    this.name = "DuplicateOperationError";
  }
}

/** 元帳から残高を導出する */
export function deriveBalance(entries: LedgerEntry[]): WalletBalance {
  let available = 0n;
  let locked = 0n;
  let earned = 0n;
  let withdrawn = 0n;

  for (const e of entries) {
    const sat = toSat(e.amountBtc);
    if (e.bucket === "AVAILABLE") available += sat;
    else locked += sat;

    if (e.entryType === "MINING_REWARD") earned += sat;
    if (e.entryType === "WITHDRAWAL_SETTLE" && e.bucket === "LOCKED") withdrawn -= sat;
  }

  return {
    availableBtc: fromSat(available),
    lockedBtc: fromSat(locked),
    lifetimeEarnedBtc: fromSat(earned),
    lifetimeWithdrawnBtc: fromSat(withdrawn),
  };
}

export async function getBalance(tenantId: string, userId: string): Promise<WalletBalance> {
  const store = await getStore();
  const account = await store.getWalletAccount(tenantId, userId);
  const entries = await store.listLedgerEntries(tenantId, account.id);
  return deriveBalance(entries);
}

function entry(
  tenantId: string,
  accountId: string,
  entryType: LedgerEntryType,
  bucket: LedgerEntry["bucket"],
  amountBtc: string,
  ref: { type: string; id: string },
  idempotencyKey: string | null,
  memo: string,
): LedgerEntry {
  return {
    id: newId(),
    tenantId,
    accountId,
    entryType,
    bucket,
    amountBtc,
    refType: ref.type,
    refId: ref.id,
    idempotencyKey,
    memo,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 出金申請: AVAILABLE → LOCKED へ原子的に移す。
 * 残高不足なら例外を投げ、何も書かない。
 */
export async function lockForWithdrawal(params: {
  tenantId: string;
  userId: string;
  withdrawalId: string;
  amountBtc: string;
  idempotencyKey: string;
}): Promise<void> {
  const store = await getStore();
  const account = await store.getWalletAccount(params.tenantId, params.userId);
  const entries = await store.listLedgerEntries(params.tenantId, account.id);
  const balance = deriveBalance(entries);

  if (cmpBtc(balance.availableBtc, params.amountBtc) < 0) {
    throw new InsufficientBalanceError(balance.availableBtc, params.amountBtc);
  }

  const ref = { type: "withdrawal", id: params.withdrawalId };
  const written = await store.appendLedger(params.tenantId, [
    entry(
      params.tenantId,
      account.id,
      "WITHDRAWAL_LOCK",
      "AVAILABLE",
      negateBtc(params.amountBtc),
      ref,
      `${params.idempotencyKey}:lock:available`,
      "出金申請による利用可能残高の減算",
    ),
    entry(
      params.tenantId,
      account.id,
      "WITHDRAWAL_LOCK",
      "LOCKED",
      params.amountBtc,
      ref,
      `${params.idempotencyKey}:lock:locked`,
      "出金申請による保留残高への移動",
    ),
  ]);

  if (!written) throw new DuplicateOperationError();
}

/**
 * 出金の却下・失敗・取消: LOCKED → AVAILABLE へ戻す（補償トランザクション）。
 * ★ ここを実装し忘れると「残高が消える」バグになる。必ずテストで固定する。
 */
export async function releaseWithdrawalLock(params: {
  tenantId: string;
  userId: string;
  withdrawalId: string;
  amountBtc: string;
  reason: string;
}): Promise<void> {
  const store = await getStore();
  const account = await store.getWalletAccount(params.tenantId, params.userId);
  const ref = { type: "withdrawal", id: params.withdrawalId };

  await store.appendLedger(params.tenantId, [
    entry(
      params.tenantId,
      account.id,
      "WITHDRAWAL_REVERSE",
      "LOCKED",
      negateBtc(params.amountBtc),
      ref,
      `wd:${params.withdrawalId}:reverse:locked`,
      `出金の取消による保留解除（${params.reason}）`,
    ),
    entry(
      params.tenantId,
      account.id,
      "WITHDRAWAL_REVERSE",
      "AVAILABLE",
      params.amountBtc,
      ref,
      `wd:${params.withdrawalId}:reverse:available`,
      `出金の取消による利用可能残高への返却（${params.reason}）`,
    ),
  ]);
}

/** 送金完了: LOCKED から確定的に引き落とす */
export async function settleWithdrawal(params: {
  tenantId: string;
  userId: string;
  withdrawalId: string;
  amountBtc: string;
  txId: string;
}): Promise<void> {
  const store = await getStore();
  const account = await store.getWalletAccount(params.tenantId, params.userId);

  await store.appendLedger(params.tenantId, [
    entry(
      params.tenantId,
      account.id,
      "WITHDRAWAL_SETTLE",
      "LOCKED",
      negateBtc(params.amountBtc),
      { type: "withdrawal", id: params.withdrawalId },
      `wd:${params.withdrawalId}:settle`,
      `送金完了（tx: ${params.txId.slice(0, 16)}…）`,
    ),
  ]);
}

/** マイニング報酬の計上 */
export async function creditMiningReward(params: {
  tenantId: string;
  userId: string;
  earningId: string;
  netBtc: string;
  memo: string;
}): Promise<boolean> {
  const store = await getStore();
  const account = await store.getWalletAccount(params.tenantId, params.userId);
  return store.appendLedger(params.tenantId, [
    entry(
      params.tenantId,
      account.id,
      "MINING_REWARD",
      "AVAILABLE",
      params.netBtc,
      { type: "earning", id: params.earningId },
      `earning:${params.earningId}`,
      params.memo,
    ),
  ]);
}

/**
 * 整合性検査。
 * 「AVAILABLE も LOCKED も負にならない」という不変条件を検証する。
 * 定期ジョブで全アカウントに対して実行し、違反があれば即座にアラートを上げる。
 */
export function verifyInvariants(entries: LedgerEntry[]): {
  ok: boolean;
  violations: string[];
} {
  const balance = deriveBalance(entries);
  const violations: string[] = [];

  if (toSat(balance.availableBtc) < 0n) {
    violations.push(`利用可能残高が負です: ${balance.availableBtc} BTC`);
  }
  if (toSat(balance.lockedBtc) < 0n) {
    violations.push(`保留残高が負です: ${balance.lockedBtc} BTC`);
  }

  // 同一冪等キーの重複（本来 DB の UNIQUE 制約で防がれるが、二重で検査する）
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.idempotencyKey) continue;
    if (seen.has(e.idempotencyKey)) {
      violations.push(`冪等キーが重複しています: ${e.idempotencyKey}`);
    }
    seen.add(e.idempotencyKey);
  }

  return { ok: violations.length === 0, violations };
}

export { addBtc };
