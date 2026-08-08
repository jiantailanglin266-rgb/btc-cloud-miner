/**
 * SandboxWalletProvider — 本番切替前の検証用ウォレットプロバイダー
 *
 * mock と live の中間段階。目的は「本番と同じ失敗モードをリハーサルする」こと。
 *
 * mock との違い:
 *   - testnet アドレスのみ受け付ける（mainnet アドレスを拒否 = 逆向きの安全弁。
 *     sandbox 環境から誤って本物のアドレスへ「送金した気になる」ことを防ぐ）
 *   - 意図的な失敗を再現する: 金額の末尾 satoshi が 9 の送金は失敗する
 *     （補償トランザクション＝残高返却の動作確認用）
 *   - 確認数の進み方が現実的（10 分に 1 確認）
 *
 * live への切替: WALLET_PROVIDER_MODE=live + カストディ実装（custody.ts）が必要。
 * このクラスも実際のブロックチェーンには一切触れない。
 */

import { createHash } from "node:crypto";
import type {
  WalletProvider,
  SendResult,
  TxStatus,
  ProviderBalance,
} from "../interface";
import { validateBitcoinAddress } from "../address";
import { toSat } from "@/lib/decimal";

const sent = new Map<string, SendResult>();
const broadcastedAt = new Map<string, number>();

export class SandboxWalletProvider implements WalletProvider {
  readonly name = "sandbox-custodian";
  /** 実送金は行わない（sandbox） */
  readonly isLive = false;

  async send(params: {
    toAddress: string;
    amountBtc: string;
    idempotencyKey: string;
    memo?: string;
  }): Promise<SendResult> {
    // 冪等: 同じキーは同じ結果
    const existing = sent.get(params.idempotencyKey);
    if (existing) return existing;

    // sandbox は testnet アドレスのみ（mainnet を渡されたら設定ミスとして失敗させる）
    const validation = validateBitcoinAddress(params.toAddress);
    if (!validation.valid) {
      throw new Error(`sandbox: アドレスが不正です（${validation.reason}）`);
    }
    if (validation.network === "mainnet") {
      throw new Error(
        "sandbox モードでは mainnet アドレスへ送金できません。" +
          "testnet アドレス（tb1... / m/n...）を使用するか、live モードへ切り替えてください。",
      );
    }

    // 意図的な失敗の再現: 末尾 satoshi が 9 → 失敗（補償トランザクションの検証用）
    if (toSat(params.amountBtc) % 10n === 9n) {
      throw new Error(
        "sandbox: 意図的な送金失敗を再現しました（金額の末尾 satoshi=9）。" +
          "ロック残高が返却されることを確認してください。",
      );
    }

    const digest = createHash("sha256")
      .update(`sandbox:${params.idempotencyKey}:${params.toAddress}:${params.amountBtc}`)
      .digest("hex");
    const result: SendResult = {
      txId: `sandbox-${digest}`,
      networkFeeBtc: "0.00002400",
      broadcastedAt: new Date().toISOString(),
    };
    sent.set(params.idempotencyKey, result);
    broadcastedAt.set(result.txId, Date.now());
    return result;
  }

  /** 現実的な確認速度（約 10 分に 1 確認）を再現する */
  async getTxStatus(txId: string): Promise<TxStatus> {
    const at = broadcastedAt.get(txId);
    if (!at) return { txId, confirmations: 0, confirmed: false, failed: false };
    const confirmations = Math.floor((Date.now() - at) / 600_000);
    return { txId, confirmations, confirmed: confirmations >= 3, failed: false };
  }

  async getBalance(): Promise<ProviderBalance> {
    return { totalBtc: "1.00000000", availableBtc: "1.00000000" };
  }

  async healthCheck(): Promise<{ ok: boolean; message: string | null }> {
    return {
      ok: true,
      message:
        "sandbox ウォレットプロバイダーです。testnet アドレスのみ受け付け、実送金は行いません。",
    };
  }
}
