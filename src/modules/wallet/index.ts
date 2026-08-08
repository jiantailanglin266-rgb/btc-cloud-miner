/**
 * ウォレット・出金のユースケース層
 *
 * 出金は本システムで最も慎重に扱う経路。
 * ARCHITECTURE.md §4.3 のフローをそのまま実装している。
 */

import type {
  Withdrawal,
  WithdrawalApproval,
  User,
  TenantSettings,
} from "@/types";
import type { WalletProvider } from "./interface";
import { MockWalletProvider } from "./providers/mock-custodian";
import {
  getBalance,
  lockForWithdrawal,
  releaseWithdrawalLock,
  settleWithdrawal,
  InsufficientBalanceError,
} from "./ledger";
import { assessWithdrawalRisk, requiredApprovals } from "./risk";
import { validateBitcoinAddress } from "./address";
import { getStore } from "@/lib/store";
import { config } from "@/lib/config";
import { subBtc, cmpBtc } from "@/lib/decimal";
import { newId } from "@/lib/crypto";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { assertNotSelfApproval, assertNotDuplicateApproval } from "@/modules/auth/rbac";

export class WithdrawalError extends Error {}

let providerInstance: WalletProvider | null = null;

export function getWalletProvider(): WalletProvider {
  if (providerInstance) return providerInstance;

  switch (config.wallet.providerMode) {
    case "custody":
      // 実装時はここで CustodyWalletProvider を返す。
      // 未実装の状態で本番に出ないよう、明示的に失敗させる。
      throw new WithdrawalError(
        "WALLET_PROVIDER_MODE=custody が指定されていますが、カストディ実装がありません。" +
          "src/modules/wallet/providers/custody.ts を実装し、ここで返してください。",
      );
    case "mock":
    default:
      providerInstance = new MockWalletProvider();
      return providerInstance;
  }
}

// ---------------------------------------------------------------------------
// 出金申請
// ---------------------------------------------------------------------------

export async function requestWithdrawal(params: {
  user: User;
  settings: TenantSettings;
  addressId: string;
  amountBtc: string;
  idempotencyKey: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<Withdrawal> {
  const { user, settings } = params;
  const store = await getStore();

  // ① キルスイッチ（インシデント時に環境変数だけで即座に止められる）
  if (!config.wallet.withdrawalEnabled) {
    throw new WithdrawalError("現在、出金機能を一時停止しています");
  }

  // ② 冪等: 同じキーの申請が既にあればそれを返す（二重申請しない）
  const existing = await store.getWithdrawalByIdempotencyKey(
    user.tenantId,
    params.idempotencyKey,
  );
  if (existing) return existing;

  // ③ KYC
  if (user.kycStatus !== "APPROVED") {
    throw new WithdrawalError("出金には本人確認（KYC）の完了が必要です");
  }

  // ④ アドレスの所有確認（他人のアドレス ID を指定されても弾く）
  const address = await store.getAddress(user.tenantId, params.addressId);
  if (!address || address.userId !== user.id) {
    throw new WithdrawalError("指定された出金先アドレスが見つかりません");
  }

  // ⑤ アドレスのチェックサム再検証（登録後に DB が改ざんされた場合の保険）
  const validation = validateBitcoinAddress(address.address);
  if (!validation.valid) {
    throw new WithdrawalError(validation.reason ?? "出金先アドレスが不正です");
  }
  if (config.isProduction && validation.network !== "mainnet") {
    throw new WithdrawalError("テストネットのアドレスには送金できません");
  }

  // ⑥ クールダウン（アドレス乗っ取り直後の即時持ち出しを防ぐ）
  if (Date.now() < new Date(address.usableAt).getTime()) {
    const hours = Math.ceil(
      (new Date(address.usableAt).getTime() - Date.now()) / 3_600_000,
    );
    throw new WithdrawalError(
      `このアドレスは登録から ${settings.addressCooldownHours} 時間が経過するまで利用できません（あと約 ${hours} 時間）`,
    );
  }

  // ⑦ 最低出金額・手数料
  if (cmpBtc(params.amountBtc, settings.minWithdrawalBtc) < 0) {
    throw new WithdrawalError(
      `最低出金額は ${settings.minWithdrawalBtc} BTC です`,
    );
  }
  const feeBtc = settings.withdrawalFeeBtc;
  if (cmpBtc(params.amountBtc, feeBtc) <= 0) {
    throw new WithdrawalError("出金額が手数料以下です");
  }
  const netBtc = subBtc(params.amountBtc, feeBtc);

  // ⑧ 異常検知
  const balance = await getBalance(user.tenantId, user.id);
  const history = await store.listWithdrawals(user.tenantId, { userId: user.id });
  const sessions = await store.listSessionsByUser(user.id);
  const knownIps = [
    ...new Set(
      [
        user.lastLoginIp,
        ...sessions.map((s) => s.ip),
        ...history.map((h) => h.requestedIp),
      ].filter((ip): ip is string => Boolean(ip)),
    ),
  ];

  const risk = assessWithdrawalRisk({
    amountBtc: params.amountBtc,
    address,
    history,
    requestedIp: params.ip,
    knownIps,
    now: Date.now(),
    availableBtc: balance.availableBtc,
  });

  const withdrawalId = newId();

  // ⑨ 残高のロック（残高不足ならここで例外。レコードは作らない）
  try {
    await lockForWithdrawal({
      tenantId: user.tenantId,
      userId: user.id,
      withdrawalId,
      amountBtc: params.amountBtc,
      idempotencyKey: params.idempotencyKey,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      throw new WithdrawalError(err.message);
    }
    throw err;
  }

  const withdrawal: Withdrawal = {
    id: withdrawalId,
    tenantId: user.tenantId,
    userId: user.id,
    userEmail: user.email,
    addressId: address.id,
    address: address.address,
    amountBtc: params.amountBtc,
    feeBtc,
    netBtc,
    status: risk.flagged ? "FLAGGED" : "PENDING_REVIEW",
    riskScore: risk.score,
    riskReasons: risk.signals.map((s) => s.reason),
    requiredApprovals: requiredApprovals({
      amountBtc: params.amountBtc,
      thresholdBtc: settings.withdrawalTwoApproverThresholdBtc,
      riskScore: risk.score,
    }),
    approvals: [],
    requestedIp: params.ip,
    txId: null,
    confirmations: 0,
    idempotencyKey: params.idempotencyKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await store.createWithdrawal(withdrawal);

  await audit({
    tenantId: user.tenantId,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: AUDIT_ACTIONS.WITHDRAWAL_REQUEST,
    targetType: "withdrawal",
    targetId: withdrawal.id,
    detail: {
      amountBtc: params.amountBtc,
      riskScore: risk.score,
      riskSignals: risk.signals.map((s) => s.code),
    },
    ip: params.ip,
    userAgent: params.userAgent,
  });

  await store.createNotification({
    id: newId(),
    tenantId: user.tenantId,
    userId: user.id,
    level: "INFO",
    title: "出金申請を受け付けました",
    body: `${params.amountBtc} BTC の出金申請を受け付けました。管理者の承認後に送金されます。`,
    href: "/wallet/withdrawals",
    readAt: null,
    createdAt: new Date().toISOString(),
  });

  return withdrawal;
}

// ---------------------------------------------------------------------------
// 承認・却下
// ---------------------------------------------------------------------------

export async function approveWithdrawal(params: {
  approver: User;
  withdrawalId: string;
  note: string;
  ip: string | null;
}): Promise<Withdrawal> {
  const store = await getStore();
  const wd = await store.getWithdrawal(params.approver.tenantId, params.withdrawalId);
  if (!wd) throw new WithdrawalError("出金申請が見つかりません");

  if (wd.status !== "PENDING_REVIEW" && wd.status !== "FLAGGED") {
    throw new WithdrawalError(`この出金は承認できる状態ではありません（${wd.status}）`);
  }

  // ★ 4-eyes: 申請者本人は承認できない
  assertNotSelfApproval(params.approver.id, wd.userId);
  assertNotDuplicateApproval(
    params.approver.id,
    wd.approvals.map((a) => a.approverId),
  );

  const approval: WithdrawalApproval = {
    approverId: params.approver.id,
    approverEmail: params.approver.email,
    decidedAt: new Date().toISOString(),
    decision: "APPROVE",
    note: params.note,
  };
  const approvals = [...wd.approvals, approval];
  const approvedCount = approvals.filter((a) => a.decision === "APPROVE").length;
  const fullyApproved = approvedCount >= wd.requiredApprovals;

  const updated = await store.updateWithdrawal(params.approver.tenantId, wd.id, {
    approvals,
    status: fullyApproved ? "APPROVED" : wd.status,
    updatedAt: new Date().toISOString(),
  });

  await audit({
    tenantId: params.approver.tenantId,
    actorUserId: params.approver.id,
    actorEmail: params.approver.email,
    actorRole: params.approver.role,
    action: AUDIT_ACTIONS.WITHDRAWAL_APPROVE,
    targetType: "withdrawal",
    targetId: wd.id,
    detail: {
      approvedCount,
      requiredApprovals: wd.requiredApprovals,
      fullyApproved,
      note: params.note,
    },
    ip: params.ip,
  });

  // 承認が揃ったら送金処理へ
  if (fullyApproved) {
    return broadcastWithdrawal(wd.tenantId, wd.id);
  }
  return updated!;
}

export async function rejectWithdrawal(params: {
  approver: User;
  withdrawalId: string;
  note: string;
  ip: string | null;
}): Promise<Withdrawal> {
  const store = await getStore();
  const wd = await store.getWithdrawal(params.approver.tenantId, params.withdrawalId);
  if (!wd) throw new WithdrawalError("出金申請が見つかりません");
  if (wd.status !== "PENDING_REVIEW" && wd.status !== "FLAGGED") {
    throw new WithdrawalError(`この出金は却下できる状態ではありません（${wd.status}）`);
  }

  // ★ 却下時は必ずロックを解除する。ここを忘れると残高が消える
  await releaseWithdrawalLock({
    tenantId: wd.tenantId,
    userId: wd.userId,
    withdrawalId: wd.id,
    amountBtc: wd.amountBtc,
    reason: "管理者による却下",
  });

  const updated = await store.updateWithdrawal(wd.tenantId, wd.id, {
    status: "REJECTED",
    approvals: [
      ...wd.approvals,
      {
        approverId: params.approver.id,
        approverEmail: params.approver.email,
        decidedAt: new Date().toISOString(),
        decision: "REJECT",
        note: params.note,
      },
    ],
    updatedAt: new Date().toISOString(),
  });

  await audit({
    tenantId: wd.tenantId,
    actorUserId: params.approver.id,
    actorEmail: params.approver.email,
    actorRole: params.approver.role,
    action: AUDIT_ACTIONS.WITHDRAWAL_REJECT,
    targetType: "withdrawal",
    targetId: wd.id,
    detail: { note: params.note, amountBtc: wd.amountBtc },
    ip: params.ip,
  });

  await store.createNotification({
    id: newId(),
    tenantId: wd.tenantId,
    userId: wd.userId,
    level: "WARNING",
    title: "出金申請が却下されました",
    body: `${wd.amountBtc} BTC の出金申請が却下され、残高に戻されました。理由: ${params.note}`,
    href: "/wallet/withdrawals",
    readAt: null,
    createdAt: new Date().toISOString(),
  });

  return updated!;
}

// ---------------------------------------------------------------------------
// 送金
// ---------------------------------------------------------------------------

/**
 * 承認済み出金をブロードキャストする。
 * 本番ではキュー経由のワーカーが実行する（失敗時に再試行できるように）。
 */
export async function broadcastWithdrawal(
  tenantId: string,
  withdrawalId: string,
): Promise<Withdrawal> {
  const store = await getStore();
  const wd = await store.getWithdrawal(tenantId, withdrawalId);
  if (!wd) throw new WithdrawalError("出金申請が見つかりません");
  if (wd.status !== "APPROVED") {
    throw new WithdrawalError("承認済みの出金のみ送金できます");
  }

  await store.updateWithdrawal(tenantId, wd.id, { status: "BROADCASTING" });

  try {
    const provider = getWalletProvider();
    const result = await provider.send({
      toAddress: wd.address,
      amountBtc: wd.netBtc,
      // 冪等キーで二重送金を防ぐ
      idempotencyKey: `wd:${wd.id}`,
      memo: `withdrawal ${wd.id}`,
    });

    await settleWithdrawal({
      tenantId,
      userId: wd.userId,
      withdrawalId: wd.id,
      amountBtc: wd.amountBtc,
      txId: result.txId,
    });

    const updated = await store.updateWithdrawal(tenantId, wd.id, {
      status: "BROADCASTED",
      txId: result.txId,
      updatedAt: new Date().toISOString(),
    });

    await store.createNotification({
      id: newId(),
      tenantId,
      userId: wd.userId,
      level: "INFO",
      title: "出金の送金を開始しました",
      body: provider.isLive
        ? `${wd.netBtc} BTC を送金しました。`
        : `${wd.netBtc} BTC の送金処理を行いました（デモ環境のため、実際の送金は行われていません）。`,
      href: "/wallet/withdrawals",
      readAt: null,
      createdAt: new Date().toISOString(),
    });

    return updated!;
  } catch (err) {
    // ★ 送金に失敗したらロックを解除して残高に戻す（補償トランザクション）
    await releaseWithdrawalLock({
      tenantId,
      userId: wd.userId,
      withdrawalId: wd.id,
      amountBtc: wd.amountBtc,
      reason: "送金処理の失敗",
    });
    await store.updateWithdrawal(tenantId, wd.id, {
      status: "FAILED",
      updatedAt: new Date().toISOString(),
    });
    throw err;
  }
}

/** ユーザーによる取消（承認前のみ） */
export async function cancelWithdrawal(params: {
  user: User;
  withdrawalId: string;
}): Promise<Withdrawal> {
  const store = await getStore();
  const wd = await store.getWithdrawal(params.user.tenantId, params.withdrawalId);
  if (!wd || wd.userId !== params.user.id) {
    throw new WithdrawalError("出金申請が見つかりません");
  }
  if (wd.status !== "PENDING_REVIEW" && wd.status !== "FLAGGED") {
    throw new WithdrawalError("承認前の出金のみ取り消せます");
  }

  await releaseWithdrawalLock({
    tenantId: wd.tenantId,
    userId: wd.userId,
    withdrawalId: wd.id,
    amountBtc: wd.amountBtc,
    reason: "ユーザーによる取消",
  });

  const updated = await store.updateWithdrawal(wd.tenantId, wd.id, {
    status: "CANCELLED",
    updatedAt: new Date().toISOString(),
  });

  await audit({
    tenantId: wd.tenantId,
    actorUserId: params.user.id,
    actorEmail: params.user.email,
    actorRole: params.user.role,
    action: AUDIT_ACTIONS.WITHDRAWAL_CANCEL,
    targetType: "withdrawal",
    targetId: wd.id,
    detail: { amountBtc: wd.amountBtc },
  });

  return updated!;
}

/** 確認数の更新（本番では定期ジョブが実行する） */
export async function refreshConfirmations(
  tenantId: string,
  withdrawalId: string,
): Promise<Withdrawal | null> {
  const store = await getStore();
  const wd = await store.getWithdrawal(tenantId, withdrawalId);
  if (!wd || !wd.txId || wd.status === "CONFIRMED") return wd;

  const status = await getWalletProvider().getTxStatus(wd.txId);
  return store.updateWithdrawal(tenantId, wd.id, {
    confirmations: status.confirmations,
    status: status.confirmed ? "CONFIRMED" : wd.status,
    updatedAt: new Date().toISOString(),
  });
}

export { getBalance } from "./ledger";
