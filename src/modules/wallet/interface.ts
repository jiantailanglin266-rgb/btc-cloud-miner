/**
 * WalletProviderInterface — BTC の保管・送金を抽象化する契約
 *
 * ★★ 最重要のセキュリティ設計 ★★
 *
 *   本システムは秘密鍵を一切保持しない。
 *   秘密鍵をアプリケーションの DB や環境変数に置くことは、
 *   「金庫の鍵を金庫の扉に貼っておく」のと同じで、絶対にやってはいけない。
 *
 *   署名（＝資産を動かす行為）は、必ず以下のいずれかの外部に委譲する:
 *
 *     - 外部カストディ事業者（BitGo / Fireblocks 等）
 *         → 鍵の管理・保険・運用を専門事業者に任せる。導入が最も速い
 *     - HSM（AWS CloudHSM 等）
 *         → 鍵がハードウェアから出ない。エクスポート不可
 *     - KMS（Cloud KMS 等の署名専用鍵）
 *         → 鍵をエクスポートできない状態で署名だけ行わせる
 *     - MPC（鍵を複数に分割）
 *         → 単一障害点が無くなる
 *
 *   本システムが保持してよいのは「出金指示」と「トランザクション ID」だけ。
 *
 * 実装を追加する手順:
 *   1. providers/ に WalletProvider を実装したファイルを作る
 *   2. index.ts の getWalletProvider() に分岐を追加する
 *   3. WALLET_PROVIDER_MODE 環境変数で切り替える
 */

export type SendResult = {
  txId: string;
  /** 実際に差し引かれたネットワーク手数料 */
  networkFeeBtc: string;
  broadcastedAt: string;
};

export type TxStatus = {
  txId: string;
  confirmations: number;
  confirmed: boolean;
  failed: boolean;
};

export type ProviderBalance = {
  /** カストディ側で保持している総残高（ホットウォレット） */
  totalBtc: string;
  availableBtc: string;
};

export interface WalletProvider {
  readonly name: string;
  /**
   * 実際にブロックチェーンへ送金するか。
   * false のものが本番で使われていたら起動時に警告する。
   */
  readonly isLive: boolean;

  /**
   * 送金を実行する。
   * ★ 冪等性が必須 ★
   *   同じ idempotencyKey で 2 回呼ばれても、送金は 1 回だけ行われること。
   *   ネットワーク切断による再試行で二重送金が起きると、直接的な金銭損失になる。
   */
  send(params: {
    toAddress: string;
    amountBtc: string;
    idempotencyKey: string;
    memo?: string;
  }): Promise<SendResult>;

  /** 送金の確認状況を取得する */
  getTxStatus(txId: string): Promise<TxStatus>;

  /** カストディ側の残高（自社の資金繰り確認用） */
  getBalance(): Promise<ProviderBalance>;

  /** 疎通確認 */
  healthCheck(): Promise<{ ok: boolean; message: string | null }>;
}
