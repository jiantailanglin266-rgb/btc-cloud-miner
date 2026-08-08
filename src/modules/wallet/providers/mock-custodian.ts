/**
 * MockWalletProvider — デモ用のウォレットプロバイダー
 *
 * ★★ 重要 ★★
 *   これは実際の Bitcoin 送金を一切行わない。
 *   秘密鍵も持たず、署名もせず、ブロックチェーンにも接続しない。
 *
 *   返す txId は「demo-」で始まる偽の識別子であり、
 *   ブロックエクスプローラーで検索しても存在しない。
 *   UI では必ず「デモ環境のため実際の送金は行われていません」と明示すること。
 *
 *   本番では WALLET_PROVIDER_MODE=custody に切り替え、
 *   カストディ事業者向けの実装（providers/custody.ts）を使う。
 */

import { createHash } from "node:crypto";
import type {
  WalletProvider,
  SendResult,
  TxStatus,
  ProviderBalance,
} from "../interface";

/** 冪等性のため、同じキーには同じ結果を返す */
const sent = new Map<string, SendResult>();
const broadcastedAt = new Map<string, number>();

export class MockWalletProvider implements WalletProvider {
  readonly name = "mock-custodian";
  /** ★ 実際の送金は行わない */
  readonly isLive = false;

  async send(params: {
    toAddress: string;
    amountBtc: string;
    idempotencyKey: string;
    memo?: string;
  }): Promise<SendResult> {
    // 冪等: 同じキーなら同じ結果を返す（二重送金しない）
    const existing = sent.get(params.idempotencyKey);
    if (existing) return existing;

    // 決定的な偽 txId。実在しないことが分かるよう "demo-" を前置する
    const digest = createHash("sha256")
      .update(`${params.idempotencyKey}:${params.toAddress}:${params.amountBtc}`)
      .digest("hex");

    const result: SendResult = {
      txId: `demo-${digest}`,
      networkFeeBtc: "0.00002400",
      broadcastedAt: new Date().toISOString(),
    };

    sent.set(params.idempotencyKey, result);
    broadcastedAt.set(result.txId, Date.now());
    return result;
  }

  /** 送信から 30 秒ごとに 1 確認が増えるものとして振る舞う（UI 確認用） */
  async getTxStatus(txId: string): Promise<TxStatus> {
    const at = broadcastedAt.get(txId);
    if (!at) {
      return { txId, confirmations: 0, confirmed: false, failed: false };
    }
    const confirmations = Math.floor((Date.now() - at) / 30_000);
    return {
      txId,
      confirmations,
      confirmed: confirmations >= 3,
      failed: false,
    };
  }

  async getBalance(): Promise<ProviderBalance> {
    return { totalBtc: "12.50000000", availableBtc: "8.20000000" };
  }

  async healthCheck(): Promise<{ ok: boolean; message: string | null }> {
    return {
      ok: true,
      message:
        "デモ用ウォレットプロバイダーです。実際の送金・署名は一切行われません。",
    };
  }
}
