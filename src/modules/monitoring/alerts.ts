/**
 * 監視アラート（フェーズ14）
 *
 * 検知対象:
 *   HASHRATE_SUDDEN_DROP   実効ハッシュレートの急落（24h 平均比）
 *   WORKER_OFFLINE         ワーカー停止
 *   REJECT_RATE_SPIKE      reject 率の急上昇
 *   POOL_API_UNAVAILABLE   プール/プロバイダー API 停止
 *   STRATUM_DISCONNECT     Stratum 切断
 *   REVENUE_ANOMALY        実収益と推定の大幅乖離
 *   UNEXPECTED_PAYOUT      規模に見合わない payout（過大）
 *   WITHDRAWAL_ANOMALY     高リスク出金
 *   DUPLICATE_PAYOUT       payout の二重配賦の試行（allocation.ts が発報）
 *   LEDGER_IMBALANCE       元帳の不変条件違反（最重大）
 *   LIVE_CONNECTION_FAILED live モードで実プロバイダーに接続できない
 *
 * 方針:
 *   - 検知ルールは純関数（テスト可能）。発報は raiseAlert() に集約
 *   - 同種・同対象の未確認アラートは重複させない（store.insertAlert が判定）
 *   - すべてのアラートに evidence（根拠数値）を必ず添付する
 */

import type { Alert, AlertKind, DashboardSummary, Withdrawal } from "@/types";
import type { WorkerWithReading } from "@/modules/mining/aggregate";
import { getStore } from "@/lib/store";
import { newId } from "@/lib/crypto";
import { toSat } from "@/lib/decimal";
import { verifyInvariants } from "@/modules/wallet/ledger";

export const ALERT_THRESHOLDS = {
  /** 実効が 24h 平均のこの割合を下回ったら急落とみなす */
  hashrateDropRatio: 0.6,
  rejectRateSpike: 0.05,
  /** 実収益が推定のこの倍率を超えたら過大 payout（想定外入金） */
  unexpectedPayoutFactor: 3,
  /** 実収益が推定と ±この率以上乖離したら anomaly */
  revenueDeviationRate: 0.5,
  withdrawalRiskScore: 50,
} as const;

export type AlertDraft = Omit<
  Alert,
  "id" | "tenantId" | "createdAt" | "acknowledgedAt" | "acknowledgedBy"
>;

/** アラートを永続化する（重複は store 側で抑止）。失敗しても業務は止めない */
export async function raiseAlert(tenantId: string, draft: AlertDraft): Promise<boolean> {
  try {
    const store = await getStore();
    return await store.insertAlert({
      ...draft,
      id: newId(),
      tenantId,
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      acknowledgedBy: null,
    });
  } catch (err) {
    console.error("[alerts] アラートの記録に失敗しました", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 検知ルール（純関数）
// ---------------------------------------------------------------------------

export function detectHashrateDrop(
  currentThs: number,
  avg24hThs: number,
): AlertDraft | null {
  if (avg24hThs <= 0) return null;
  const ratio = currentThs / avg24hThs;
  if (ratio >= ALERT_THRESHOLDS.hashrateDropRatio) return null;
  return {
    kind: "HASHRATE_SUDDEN_DROP",
    severity: ratio < 0.3 ? "CRITICAL" : "WARNING",
    message: `実効ハッシュレートが 24 時間平均の ${(ratio * 100).toFixed(0)}% まで急落しています`,
    evidence: {
      currentThs: Number(currentThs.toFixed(2)),
      avg24hThs: Number(avg24hThs.toFixed(2)),
      ratio: Number(ratio.toFixed(3)),
    },
    targetType: "portfolio",
    targetId: "portfolio",
  };
}

export function detectRejectSpike(
  accepted: number,
  rejected: number,
): AlertDraft | null {
  const total = accepted + rejected;
  if (total < 1000) return null;
  const rate = rejected / total;
  if (rate < ALERT_THRESHOLDS.rejectRateSpike) return null;
  return {
    kind: "REJECT_RATE_SPIKE",
    severity: rate >= 0.1 ? "CRITICAL" : "WARNING",
    message: `reject 率が ${(rate * 100).toFixed(2)}% に上昇しています（通常 0.5〜1%）`,
    evidence: { accepted, rejected, rate: Number(rate.toFixed(4)) },
    targetType: "portfolio",
    targetId: "portfolio",
  };
}

/**
 * 実収益 vs 推定の乖離。
 * 実収益が推定より大幅に多い = UNEXPECTED_PAYOUT（設定ミス・誤配賦・想定外入金の疑い）
 * 大幅に少ない = REVENUE_ANOMALY（設備停止・プール未計上の疑い）
 */
export function detectRevenueAnomaly(
  actualBtc: string,
  estimatedBtc: number,
): AlertDraft | null {
  const actual = Number(actualBtc);
  if (!(estimatedBtc > 0) || !Number.isFinite(actual) || actual <= 0) return null;
  const ratio = actual / estimatedBtc;
  if (ratio > ALERT_THRESHOLDS.unexpectedPayoutFactor) {
    return {
      kind: "UNEXPECTED_PAYOUT",
      severity: "CRITICAL",
      message: `実払い出しが推定の ${ratio.toFixed(1)} 倍です。プール設定・配賦対象の契約を確認してください`,
      evidence: { actualBtc, estimatedBtc: estimatedBtc.toFixed(8), ratio: Number(ratio.toFixed(2)) },
      targetType: "portfolio",
      targetId: "portfolio",
    };
  }
  if (ratio < 1 - ALERT_THRESHOLDS.revenueDeviationRate) {
    return {
      kind: "REVENUE_ANOMALY",
      severity: "WARNING",
      message: `実払い出しが推定の ${(ratio * 100).toFixed(0)}% しかありません。設備停止・プールの未計上がないか確認してください`,
      evidence: { actualBtc, estimatedBtc: estimatedBtc.toFixed(8), ratio: Number(ratio.toFixed(2)) },
      targetType: "portfolio",
      targetId: "portfolio",
    };
  }
  return null;
}

export function detectWithdrawalAnomaly(w: Withdrawal): AlertDraft | null {
  if (w.riskScore < ALERT_THRESHOLDS.withdrawalRiskScore) return null;
  return {
    kind: "WITHDRAWAL_ANOMALY",
    severity: w.riskScore >= 75 ? "CRITICAL" : "WARNING",
    message: `高リスク出金（score ${w.riskScore}）: ${w.amountBtc} BTC → ${w.address.slice(0, 16)}…`,
    evidence: {
      withdrawalId: w.id,
      riskScore: w.riskScore,
      amountBtc: w.amountBtc,
      reasons: w.riskReasons.join(" / "),
    },
    targetType: "withdrawal",
    targetId: w.id,
  };
}

// ---------------------------------------------------------------------------
// スキャン（サマリー・元帳・プロバイダー状態から一括検知）
// ---------------------------------------------------------------------------

/**
 * テナント全体をスキャンし、検知したアラートを永続化して返す。
 * 管理画面表示時・定期ジョブから呼ぶ。
 */
export async function scanAndRaiseAlerts(
  tenantId: string,
  summary: DashboardSummary,
  entries: WorkerWithReading[],
): Promise<Alert[]> {
  const store = await getStore();
  const drafts: AlertDraft[] = [];

  // 1. ハッシュレート急落
  const drop = detectHashrateDrop(summary.currentHashrateThs, summary.averageHashrateThs);
  if (drop) drafts.push(drop);

  // 2. reject 率
  const spike = detectRejectSpike(summary.acceptedShares, summary.rejectedShares);
  if (spike) drafts.push(spike);

  // 3. ワーカー停止
  for (const { worker, reading } of entries) {
    if (worker.status === "OFFLINE" || reading?.workerStatus === "OFFLINE") {
      drafts.push({
        kind: "WORKER_OFFLINE",
        severity: "WARNING",
        message: `ワーカー ${worker.externalWorkerId}（${worker.ratedHashrateThs} TH/s）が停止しています`,
        evidence: {
          workerId: worker.id,
          ratedThs: worker.ratedHashrateThs,
          lastSeenAt: worker.lastSeenAt ?? "不明",
        },
        targetType: "worker",
        targetId: worker.id,
      });
    }
  }

  // 4. プロバイダー API 停止 / Stratum 切断
  for (const p of summary.providerStatuses) {
    if (p.status === "OFFLINE") {
      drafts.push({
        kind: p.kind === "STRATUM" ? "STRATUM_DISCONNECT" : "POOL_API_UNAVAILABLE",
        severity: "CRITICAL",
        message: `${p.name} に接続できません（連続失敗 ${p.consecutiveFailures} 回）`,
        evidence: {
          providerId: p.providerId,
          consecutiveFailures: p.consecutiveFailures,
          message: p.message ?? "",
        },
        targetType: "provider",
        targetId: p.providerId,
      });
    }
  }

  // 5. 元帳の不変条件（最重大）
  const users = await store.listUsers(tenantId);
  for (const user of users) {
    const account = await store.getWalletAccount(tenantId, user.id);
    const ledger = await store.listLedgerEntries(tenantId, account.id);
    if (ledger.length === 0) continue;
    const check = verifyInvariants(ledger);
    if (!check.ok) {
      drafts.push({
        kind: "LEDGER_IMBALANCE",
        severity: "CRITICAL",
        message: `ユーザー ${user.email} の元帳に不変条件違反があります。出金を停止して調査してください`,
        evidence: { userId: user.id, violations: check.violations.join(" / ") },
        targetType: "user",
        targetId: user.id,
      });
    }
  }

  // 6. 実収益 vs 推定（直近7日）
  const weekAgo = Date.now() - 7 * 86_400_000;
  const payouts = await store.listPayouts(tenantId);
  const actualWeek = payouts
    .filter((p) => new Date(p.paidAt).getTime() >= weekAgo)
    .reduce((s, p) => s + toSat(p.amountBtc), 0n);
  if (actualWeek > 0n) {
    const estimatedWeek = summary.revenue.estimatedBtcPerDay * 7;
    const anomaly = detectRevenueAnomaly(
      (Number(actualWeek) / 1e8).toFixed(8),
      estimatedWeek,
    );
    if (anomaly) drafts.push(anomaly);
  }

  // 永続化（重複は store が抑止）して未確認一覧を返す
  for (const d of drafts) await raiseAlert(tenantId, d);
  return store.listAlerts(tenantId, { unacknowledgedOnly: true, limit: 100 });
}

export const ALERT_LABEL_JA: Record<AlertKind, string> = {
  HASHRATE_SUDDEN_DROP: "ハッシュレート急落",
  WORKER_OFFLINE: "ワーカー停止",
  REJECT_RATE_SPIKE: "Reject率急上昇",
  POOL_API_UNAVAILABLE: "プールAPI停止",
  STRATUM_DISCONNECT: "Stratum切断",
  REVENUE_ANOMALY: "収益異常（過少）",
  UNEXPECTED_PAYOUT: "想定外の払い出し",
  WITHDRAWAL_ANOMALY: "出金異常",
  DUPLICATE_PAYOUT: "payout二重配賦の試行",
  LEDGER_IMBALANCE: "元帳不整合",
  LIVE_CONNECTION_FAILED: "LIVE接続失敗",
  WORKER_SYNC_MISMATCH: "ワーカー同期差異",
  HASHRATE_DATA_ANOMALY: "ハッシュレート異常値",
  PAYOUT_VALIDATION_FAILED: "payout検証失敗",
  ALLOCATION_GATE_BLOCKED: "配賦ゲート不通過",
};
