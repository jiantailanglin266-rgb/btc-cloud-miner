/**
 * Blockchain Tx Verification（フェーズ8）
 *
 * payout の txid を Bitcoin 公開 API で read-only 検証する:
 *   - transaction exists
 *   - confirmations
 *   - output total（payout 額以上の出力があるか）
 *
 * ★ API 障害時は payout 処理自体を壊さず VERIFICATION_PENDING のままにする。
 * ★ 書き込みは一切しない（GET のみ）。
 *
 * データソース: mempool.space 互換 API（BITCOIN_SOURCE_PRIMARY 等で設定）。
 * 未設定（デモ）の場合は検証をスキップし PENDING のまま。
 */

import type { PoolPayout } from "@/types";
import { getStore } from "@/lib/store";
import { config } from "@/lib/config";
import { toSat } from "@/lib/decimal";
import { isValidTxid } from "@/modules/mining/validation";
import { safeNumber } from "@/modules/provider/interface";

export type TxVerifyResult = {
  status: PoolPayout["verificationStatus"];
  confirmations: number | null;
  detail: string;
};

/** mempool.space 互換 API で 1 tx を検証する */
export async function verifyTxOnChain(
  txId: string,
  expectedAmountBtc: string,
): Promise<TxVerifyResult> {
  const bases = config.bitcoin.sources.filter((s) => !s.includes("blockchain.info"));
  if (bases.length === 0) {
    return {
      status: "VERIFICATION_PENDING",
      confirmations: null,
      detail: "Bitcoin API 未設定のため検証保留（BITCOIN_SOURCE_PRIMARY を設定してください）",
    };
  }

  for (const base of bases) {
    try {
      const b = base.replace(/\/$/, "");
      const res = await fetch(`${b}/tx/${txId}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) {
        return { status: "MISMATCH", confirmations: null, detail: "tx がチェーン上に存在しません" };
      }
      if (!res.ok) continue; // 次ソースへ

      const tx = (await res.json()) as Record<string, unknown>;

      // confirmations = 現在高 − ブロック高 + 1（未承認は 0）
      let confirmations = 0;
      const txStatus = tx.status as Record<string, unknown> | undefined;
      if (txStatus?.confirmed === true && typeof txStatus.block_height === "number") {
        const tipRes = await fetch(`${b}/blocks/tip/height`, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (tipRes.ok) {
          const tip = Number((await tipRes.text()).trim());
          if (Number.isFinite(tip)) confirmations = tip - txStatus.block_height + 1;
        }
      }

      // output total（satoshi）が payout 額以上か
      const vout = Array.isArray(tx.vout) ? (tx.vout as Array<Record<string, unknown>>) : [];
      const outputTotalSat = vout.reduce(
        (s, o) => s + BigInt(Math.floor(safeNumber(o.value, { max: 21e14 }))),
        0n,
      );
      const expectedSat = toSat(expectedAmountBtc);
      if (outputTotalSat < expectedSat) {
        return {
          status: "MISMATCH",
          confirmations,
          detail: `tx 出力合計(${outputTotalSat} sat)が payout 額(${expectedSat} sat)未満です`,
        };
      }

      return {
        status: "VERIFIED",
        confirmations,
        detail: `確認数 ${confirmations} / 出力合計 ${outputTotalSat} sat`,
      };
    } catch {
      continue; // タイムアウト等 → 次ソース
    }
  }

  // 全ソース失敗 → 破壊せず保留
  return {
    status: "VERIFICATION_PENDING",
    confirmations: null,
    detail: "Bitcoin API へ到達できないため検証保留（payout 処理は継続）",
  };
}

/**
 * 未検証 payout をまとめて検証する（scheduler から呼ぶ）。
 * txid の無い payout（Mock 等）は NOT_APPLICABLE のまま触らない。
 */
export async function verifyPendingPayouts(
  tenantId: string,
  limit = 20,
): Promise<{ verified: number; mismatched: number; pending: number }> {
  const store = await getStore();
  const payouts = await store.listPayouts(tenantId, { limit: 200 });
  const targets = payouts
    .filter((p) => p.verificationStatus === "VERIFICATION_PENDING" && isValidTxid(p.txId))
    .slice(0, limit);

  let verified = 0;
  let mismatched = 0;
  let pending = 0;

  for (const p of targets) {
    const result = await verifyTxOnChain(p.txId!, p.amountBtc);
    if (result.status === "VERIFICATION_PENDING") {
      pending++;
      continue; // 状態は変えない（次回再試行）
    }
    await store.updatePayout(tenantId, p.id, {
      verificationStatus: result.status,
      confirmations: result.confirmations,
      verifiedAt: new Date().toISOString(),
    });
    if (result.status === "VERIFIED") verified++;
    else mismatched++;
  }

  return { verified, mismatched, pending };
}
