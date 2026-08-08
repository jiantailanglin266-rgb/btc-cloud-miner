/**
 * 異常出金検知
 *
 * ★ 純関数として実装する ★
 *   スコアリングのルールと閾値を、入出力だけでテストできる形にしておく。
 *   「なぜこの出金がフラグされたのか」を後から人間が検算できることが、
 *   AML 対応でも顧客対応でも必須になる。
 *
 * AI（機械学習）ではなくルールベースにしている理由:
 *   金融規制の文脈では「説明できない判断」は使いにくい。
 *   まずルールで運用し、十分なデータが貯まってから ML を「補助」として足すのが安全。
 */

import type { Withdrawal, WalletAddress } from "@/types";
import { toSat } from "@/lib/decimal";

export type RiskSignal = {
  code: string;
  reason: string;
  score: number;
};

export type RiskInput = {
  amountBtc: string;
  address: WalletAddress;
  /** 過去の出金（新しい順） */
  history: Pick<Withdrawal, "amountBtc" | "createdAt" | "address" | "requestedIp" | "status">[];
  requestedIp: string | null;
  /** 過去にログイン・出金で使われた IP の集合 */
  knownIps: string[];
  now: number;
  availableBtc: string;
};

export type RiskAssessment = {
  score: number;
  signals: RiskSignal[];
  /** true ならフラグを立てて管理者の目視確認を必須にする */
  flagged: boolean;
};

/** これ以上でフラグを立てる */
export const RISK_FLAG_THRESHOLD = 50;

export function assessWithdrawalRisk(input: RiskInput): RiskAssessment {
  const signals: RiskSignal[] = [];
  const amountSat = toSat(input.amountBtc);

  // --- 1. 新規登録アドレス --------------------------------------------------
  const addressAgeHours =
    (input.now - new Date(input.address.createdAt).getTime()) / 3_600_000;
  if (addressAgeHours < 24) {
    signals.push({
      code: "NEW_ADDRESS",
      reason: `新規登録アドレス（登録から ${Math.floor(addressAgeHours)} 時間）`,
      score: 30,
    });
  }

  // --- 2. 過去に使ったことのないアドレス ------------------------------------
  const usedBefore = input.history.some((h) => h.address === input.address.address);
  if (!usedBefore && input.history.length > 0) {
    signals.push({
      code: "UNUSED_ADDRESS",
      reason: "これまで送金実績のないアドレスです",
      score: 15,
    });
  }

  // --- 3. 平均額からの乖離 --------------------------------------------------
  const past = input.history.filter((h) => h.status === "CONFIRMED");
  if (past.length >= 3) {
    const avgSat =
      past.reduce((s, h) => s + toSat(h.amountBtc), 0n) / BigInt(past.length);
    if (avgSat > 0n) {
      const ratio = Number(amountSat) / Number(avgSat);
      if (ratio >= 5) {
        signals.push({
          code: "AMOUNT_SPIKE",
          reason: `平均出金額の ${ratio.toFixed(1)} 倍`,
          score: ratio >= 10 ? 30 : 20,
        });
      }
    }
  }

  // --- 4. 残高のほぼ全額 ----------------------------------------------------
  const availableSat = toSat(input.availableBtc);
  if (availableSat > 0n && Number(amountSat) / Number(availableSat) >= 0.95) {
    signals.push({
      code: "FULL_BALANCE",
      reason: "利用可能残高のほぼ全額です",
      score: 15,
    });
  }

  // --- 5. 短時間に連続した出金 ----------------------------------------------
  const last24h = input.history.filter(
    (h) => input.now - new Date(h.createdAt).getTime() < 86_400_000,
  );
  if (last24h.length >= 3) {
    signals.push({
      code: "HIGH_FREQUENCY",
      reason: `過去24時間に ${last24h.length} 件の出金申請`,
      score: 20,
    });
  }

  // --- 6. 見慣れない IP ------------------------------------------------------
  if (input.requestedIp && input.knownIps.length > 0) {
    if (!input.knownIps.includes(input.requestedIp)) {
      signals.push({
        code: "NEW_IP",
        reason: "普段と異なる IP アドレスからの申請です",
        score: 20,
      });
    }
  }

  // --- 7. 深夜帯（本人の通常行動から外れやすい時間帯） ----------------------
  const hour = new Date(input.now).getHours();
  if (hour >= 2 && hour < 5) {
    signals.push({ code: "ODD_HOUR", reason: "深夜帯（2〜5時）の申請です", score: 5 });
  }

  const score = Math.min(100, signals.reduce((s, sig) => s + sig.score, 0));

  return {
    score,
    signals,
    flagged: score >= RISK_FLAG_THRESHOLD,
  };
}

/**
 * 必要な承認者数を決める。
 * 金額が閾値を超える場合、またはリスクが高い場合は 2 名承認（4-eyes）。
 */
export function requiredApprovals(params: {
  amountBtc: string;
  thresholdBtc: string;
  riskScore: number;
}): number {
  if (toSat(params.amountBtc) > toSat(params.thresholdBtc)) return 2;
  if (params.riskScore >= RISK_FLAG_THRESHOLD) return 2;
  return 1;
}
