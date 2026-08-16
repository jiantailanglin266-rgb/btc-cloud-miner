/**
 * Hashpower Marketplace Interface（フェーズ2）
 *
 * ★ 役割の分離 ★
 *   MiningPoolProviderInterface     … 採掘の「出口」。shares/payout を読む（既存の
 *                                     MiningProviderAdapter がこれに当たる。別名を輸出）
 *   HashpowerMarketplaceInterface   … 計算力の「入口」。ハッシュレートを購入する（本 IF）
 *
 * 実装は NiceHash（nicehash.ts）。将来 MiningRigRentals 等を追加する場合も
 * この IF に合わせる（アプリ本体はマーケット固有仕様を知らない）。
 */

import type {
  BtcAmount,
  HashpowerAlgoSettings,
  HashpowerMarket,
  HashpowerMode,
  HashpowerOrderbook,
  HashpowerOrderStatus,
} from "@/types";
import type { MiningProviderAdapter } from "@/modules/provider/interface";

/** 既存プールアダプタの役割別名（フェーズ2の命名要件） */
export type MiningPoolProviderInterface = MiningProviderAdapter;

export type MarketplaceOrder = {
  externalOrderId: string;
  algorithm: string;
  market: HashpowerMarket;
  status: HashpowerOrderStatus;
  priceBtcPerFactorDay: number;
  limitFactor: number;
  availableAmountBtc: BtcAmount;
  spentAmountBtc: BtcAmount;
  deliveredSpeedFactor: number | null;
  poolId: string | null;
  updatedAt: string;
};

export type MarketplaceOrderStats = {
  externalOrderId: string;
  deliveredSpeedFactor: number;
  acceptedSpeedFactor: number;
  rejectedSpeedFactor: number;
  spentAmountBtc: BtcAmount;
  at: string;
};

export type CreateOrderParams = {
  algorithm: string;
  market: HashpowerMarket;
  poolId: string;
  priceBtcPerFactorDay: number;
  limitFactor: number;
  amountBtc: BtcAmount;
  /** STANDARD（成行追随しない指値）のみ許可する */
  type: "STANDARD";
};

export interface HashpowerMarketplaceInterface {
  readonly name: string;
  readonly mode: HashpowerMode;

  // --- 市場データ（read-only・全モードで利用可） --------------------------
  getAlgorithms(): Promise<HashpowerAlgoSettings[]>;
  getAlgoSettings(algorithm: string): Promise<HashpowerAlgoSettings>;
  getOrderBook(algorithm: string): Promise<HashpowerOrderbook>;
  /** 現在の実効価格（BTC/factor/day）。orderbook から導出 */
  getCurrentHashpowerPrice(algorithm: string): Promise<number | null>;
  getFees(algorithm: string): Promise<{ marketFeeRate: number; orderFeeBtc: number }>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; message: string | null }>;

  // --- アカウント（認証必要。mock/paper では仮想値） -----------------------
  getAccountBalance(): Promise<{ availableBtc: BtcAmount; pendingBtc: BtcAmount }>;
  getMyOrders(algorithm?: string): Promise<MarketplaceOrder[]>;
  getOrder(externalOrderId: string): Promise<MarketplaceOrder | null>;
  getOrderStats(externalOrderId: string): Promise<MarketplaceOrderStats | null>;

  // --- 注文（★ live モード + Kill Switch 有効時のみ実 API を呼ぶ） --------
  createOrder(params: CreateOrderParams): Promise<MarketplaceOrder>;
  updateOrderPrice(
    externalOrderId: string,
    priceBtcPerFactorDay: number,
    limitFactor: number,
  ): Promise<MarketplaceOrder>;
  updateOrderLimit(externalOrderId: string, limitFactor: number): Promise<MarketplaceOrder>;
  cancelOrder(externalOrderId: string): Promise<void>;
}

export class MarketplaceDisabledError extends Error {
  constructor(reason: string) {
    super(`Hashpower 注文は無効化されています: ${reason}`);
    this.name = "MarketplaceDisabledError";
  }
}
