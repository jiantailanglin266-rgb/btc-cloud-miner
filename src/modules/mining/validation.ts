/**
 * 実データ検証（フェーズ5・6・7）
 *
 *   - Worker 同期の整合性検証（API vs DB）→ WORKER_SYNC_MISMATCH
 *   - Hashrate の妥当性検証 → HASHRATE_DATA_ANOMALY（異常値は Ledger・収益計算に使わない）
 *   - Payout の取り込み前検証（txid 形式・金額・日時）
 *
 * すべて純関数 + 発報の薄いラッパー。テスト可能な形を保つ。
 */

import type { ProviderWorkerReading, Worker } from "@/types";
import type { RawPayout } from "@/modules/provider/interface";
import { raiseAlert, type AlertDraft } from "@/modules/monitoring/alerts";

// ---------------------------------------------------------------------------
// フェーズ5: Worker 同期の整合性
// ---------------------------------------------------------------------------

export type WorkerSyncValidation = {
  ok: boolean;
  apiCount: number;
  dbCount: number;
  duplicateIds: string[];
  issues: string[];
};

/**
 * API 上の Worker と DB 上の Worker を比較する。
 *   - 件数差異（削除されたワーカーが DB に残る、同期漏れ等）
 *   - externalWorkerId の重複
 * 削除済みワーカーの扱い: API に現れないものは lastSeenAt が古くなり
 * OFFLINE 表示になる（物理削除しない＝履歴・収益記録の整合性を守る）。
 */
export function validateWorkerSync(
  providerId: string,
  apiReadings: ProviderWorkerReading[],
  dbWorkers: Worker[],
): WorkerSyncValidation {
  const issues: string[] = [];

  // API 側の重複 externalWorkerId（プールの異常応答検知）
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const r of apiReadings) {
    if (seen.has(r.externalWorkerId)) duplicateIds.push(r.externalWorkerId);
    seen.add(r.externalWorkerId);
  }
  if (duplicateIds.length > 0) {
    issues.push(`API 応答に重複ワーカー名: ${duplicateIds.slice(0, 5).join(", ")}`);
  }

  const dbForProvider = dbWorkers.filter((w) => w.providerId === providerId);
  const apiCount = seen.size;
  const dbCount = dbForProvider.length;

  // DB 側の重複（UNIQUE 制約があるはずだが二重で検査）
  const dbSeen = new Set<string>();
  for (const w of dbForProvider) {
    if (dbSeen.has(w.externalWorkerId)) {
      issues.push(`DB に重複ワーカー: ${w.externalWorkerId}`);
    }
    dbSeen.add(w.externalWorkerId);
  }

  // 件数差異: API に無いワーカーが DB にあるのは正常（過去に存在→削除/リネーム）。
  // 逆に API にあるのに DB に無いのは同期漏れ（upsert 失敗）
  const missingInDb = [...seen].filter((id) => !dbSeen.has(id));
  if (missingInDb.length > 0) {
    issues.push(`DB に未同期のワーカー: ${missingInDb.slice(0, 5).join(", ")}`);
  }

  return { ok: issues.length === 0, apiCount, dbCount, duplicateIds, issues };
}

export async function raiseWorkerSyncMismatch(
  tenantId: string,
  providerId: string,
  providerName: string,
  v: WorkerSyncValidation,
): Promise<void> {
  if (v.ok) return;
  await raiseAlert(tenantId, {
    kind: "WORKER_SYNC_MISMATCH",
    severity: "WARNING",
    message: `${providerName} のワーカー同期に差異があります（API ${v.apiCount} 台 / DB ${v.dbCount} 台）`,
    evidence: {
      providerId,
      apiCount: v.apiCount,
      dbCount: v.dbCount,
      issues: v.issues.join(" / ").slice(0, 300),
    },
    targetType: "provider",
    targetId: providerId,
  });
}

// ---------------------------------------------------------------------------
// フェーズ6: Hashrate Sanity Check
// ---------------------------------------------------------------------------

/** 1 ワーカーの物理的上限（現行最速 ASIC の数倍を許容上限とする） */
export const MAX_WORKER_THS = 5_000;
/** 1h と 24h の乖離がこの倍率を超えたら異常 */
export const MAX_H1_H24_RATIO = 20;
/** 前回比のこの割合以上の急落を異常として記録（値は使うが警告する） */
export const SUDDEN_DROP_RATIO = 0.9;

export type HashrateSanity = {
  /** false の場合、この reading を Ledger・収益計算・スナップショットに使ってはならない */
  usable: boolean;
  anomalies: string[];
};

export function checkHashrateSanity(
  reading: ProviderWorkerReading,
  previousThs: number | null,
): HashrateSanity {
  const anomalies: string[] = [];
  let usable = true;

  const values: Array<[string, number | null]> = [
    ["realtime", reading.hashrateThs],
    ["1h", reading.hashrate1hThs],
    ["24h", reading.ratedHashrateThs],
  ];

  for (const [label, v] of values) {
    if (v === null) continue;
    if (Number.isNaN(v)) {
      anomalies.push(`${label} が NaN`);
      usable = false;
    } else if (!Number.isFinite(v)) {
      anomalies.push(`${label} が Infinity`);
      usable = false;
    } else if (v < 0) {
      anomalies.push(`${label} が負値 (${v})`);
      usable = false;
    } else if (v > MAX_WORKER_THS) {
      anomalies.push(`${label} が上限超過 (${v.toFixed(0)} TH/s > ${MAX_WORKER_THS})`);
      usable = false;
    }
  }

  // 1h と 24h の極端な乖離（単位取り違え・プールの異常応答の兆候）
  if (
    usable &&
    reading.hashrate1hThs !== null &&
    reading.hashrate1hThs > 0 &&
    reading.ratedHashrateThs > 0
  ) {
    const ratio =
      Math.max(reading.hashrate1hThs, reading.ratedHashrateThs) /
      Math.min(reading.hashrate1hThs, reading.ratedHashrateThs);
    if (ratio > MAX_H1_H24_RATIO) {
      anomalies.push(`1h/24h の乖離が ${ratio.toFixed(1)} 倍`);
      usable = false;
    }
  }

  // 前回比 90% 以上の急落（値自体は物理的にあり得るため usable のまま・警告のみ）
  if (usable && previousThs !== null && previousThs > 0 && reading.hashrateThs >= 0) {
    const drop = 1 - reading.hashrateThs / previousThs;
    if (drop >= SUDDEN_DROP_RATIO) {
      anomalies.push(`前回比 ${(drop * 100).toFixed(0)}% 急落 (${previousThs.toFixed(1)} → ${reading.hashrateThs.toFixed(1)} TH/s)`);
    }
  }

  return { usable, anomalies };
}

export function hashrateAnomalyAlert(
  workerId: string,
  workerName: string,
  sanity: HashrateSanity,
): AlertDraft {
  return {
    kind: "HASHRATE_DATA_ANOMALY",
    severity: sanity.usable ? "WARNING" : "CRITICAL",
    message: `${workerName} のハッシュレートに異常値: ${sanity.anomalies.join(" / ")}`,
    evidence: { workerId, anomalies: sanity.anomalies.join(" / "), usable: String(sanity.usable) },
    targetType: "worker",
    targetId: workerId,
  };
}

// ---------------------------------------------------------------------------
// フェーズ7: Payout 取り込み前検証
// ---------------------------------------------------------------------------

/** Bitcoin txid は 64 桁 hex */
const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;
/** paidAt の未来許容（時計ずれ分） */
const FUTURE_TOLERANCE_MS = 10 * 60_000;

export type PayoutValidation = { valid: boolean; reasons: string[] };

export function validatePayout(p: RawPayout, nowMs = Date.now()): PayoutValidation {
  const reasons: string[] = [];

  // amount > 0（satoshi 換算でも 0 でない）
  const amount = Number(p.amountBtc);
  if (!Number.isFinite(amount) || amount <= 0) {
    reasons.push(`金額が不正: ${p.amountBtc}`);
  }
  if (amount > 100) {
    // 1 payout で 100 BTC 超は現実的でない（プール応答の異常検知）
    reasons.push(`金額が非現実的: ${p.amountBtc} BTC`);
  }

  // paidAt が未来日時でない
  const paidAtMs = Date.parse(p.paidAt);
  if (!Number.isFinite(paidAtMs)) {
    reasons.push(`日時が不正: ${p.paidAt}`);
  } else if (paidAtMs > nowMs + FUTURE_TOLERANCE_MS) {
    reasons.push(`未来日時: ${p.paidAt}`);
  }

  // txid があれば形式検証（無い payout は許容＝プールが txid を公開しない場合がある）
  if (p.txId !== null && !TXID_PATTERN.test(p.txId)) {
    reasons.push(`txid 形式不正: ${p.txId.slice(0, 20)}…`);
  }

  if (!p.externalPayoutId || p.externalPayoutId.length > 200) {
    reasons.push("externalPayoutId が不正");
  }

  return { valid: reasons.length === 0, reasons };
}

export function isValidTxid(txId: string | null): boolean {
  return txId !== null && TXID_PATTERN.test(txId);
}
