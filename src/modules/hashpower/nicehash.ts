/**
 * NiceHashHashpowerProvider（フェーズ2・3・4）
 *
 * ★ API 仕様の出典（推測ではない）:
 *   - 署名・ヘッダ・注文系エンドポイントは公式デモ実装
 *     github.com/nicehash/rest-clients-demo（javascript/api.js, hashpower.js）を
 *     2026-08-14 に取得して確認した:
 *       GET  /api/v2/time
 *       GET  /main/api/v2/mining/algorithms
 *       POST /main/api/v2/hashpower/order
 *       POST /main/api/v2/hashpower/order/{id}/updatePriceAndLimit
 *       DELETE /main/api/v2/hashpower/order/{id}
 *   - orderbook / myOrders / stats / accounts は docs.nicehash.com 記載のパスを使用:
 *       GET /main/api/v2/hashpower/orderBook?algorithm=...
 *       GET /main/api/v2/hashpower/myOrders?...
 *       GET /main/api/v2/hashpower/order/{id}/stats
 *       GET /main/api/v2/accounting/accounts2
 *   レスポンス形は防御的にパースし、想定外なら INVALID_RESPONSE として失敗させる
 *   （でっち上げた数値を返さない）。
 *
 * モード:
 *   mock  … ネットワーク接続なし。決定的な擬似 orderbook（デモ・テスト）
 *   paper … 市場データは実 API（read-only）。注文メソッドは全て拒否
 *   live  … 実注文。FEATURE_NICEHASH_TRADING_ENABLED=true が別途必須
 *
 * ★ 対象アルゴリズムは SHA256ASICBOOST（NiceHash 上の Bitcoin SHA-256 市場）。
 * ★ Withdrawal 系 API は実装しない（権限も付与しない）。
 */

import type {
  BtcAmount,
  HashpowerAlgoSettings,
  HashpowerMarket,
  HashpowerMode,
  HashpowerOrderbook,
  OrderbookLevel,
} from "@/types";
import type {
  CreateOrderParams,
  HashpowerMarketplaceInterface,
  MarketplaceOrder,
  MarketplaceOrderStats,
} from "./interface";
import { MarketplaceDisabledError } from "./interface";
import { buildAuthHeaders, createNonce, type NicehashCredentials } from "./signing";
import { formatNumberAsBtc } from "@/lib/decimal";
import { config } from "@/lib/config";

export const SHA256_ALGORITHM = "SHA256ASICBOOST";
const API_BASE = "https://api2.nicehash.com";
const TIMEOUT_MS = 10_000;

export class NicehashInvalidResponseError extends Error {
  constructor(detail: string) {
    super(`NiceHash API のレスポンスが想定外です: ${detail}`);
  }
}
export class NicehashAuthError extends Error {}

function num(v: unknown, name: string, min = 0, max = 1e30): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new NicehashInvalidResponseError(`${name}=${String(v)}`);
  }
  return n;
}

export class NiceHashAdapter implements HashpowerMarketplaceInterface {
  readonly name = "nicehash";
  readonly mode: HashpowerMode;

  private readonly base: string;
  private readonly creds: NicehashCredentials | null;
  private timeDiffMs: number | null = null;
  private algoCache: { at: number; list: HashpowerAlgoSettings[] } | null = null;
  private bookCache: { at: number; book: HashpowerOrderbook } | null = null;

  constructor(opts?: { mode?: HashpowerMode; baseUrl?: string }) {
    this.mode = opts?.mode ?? (config.nicehash.mode as HashpowerMode);
    this.base = (opts?.baseUrl ?? config.nicehash.apiBase ?? API_BASE).replace(/\/$/, "");
    const { apiKey, apiSecret, organizationId } = config.nicehash;
    this.creds =
      apiKey && apiSecret && organizationId
        ? { apiKey, apiSecret, organizationId }
        : null;
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async publicGet(pathWithQuery: string): Promise<unknown> {
    const res = await fetch(`${this.base}${pathWithQuery}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) throw new Error("NiceHash レート制限（429）");
    if (!res.ok) throw new Error(`NiceHash API エラー: ${res.status}`);
    return res.json();
  }

  private async serverTimeMs(): Promise<number> {
    if (this.timeDiffMs === null) {
      const json = (await this.publicGet("/api/v2/time")) as { serverTime?: unknown };
      const serverTime = num(json.serverTime, "serverTime", 1);
      this.timeDiffMs = serverTime - Date.now();
    }
    return Date.now() + this.timeDiffMs;
  }

  /** 認証付きリクエスト。★ apiSecret をログ・例外に出さない */
  private async signedCall(
    method: string,
    path: string,
    query: string,
    body: object | null,
  ): Promise<unknown> {
    if (!this.creds) {
      throw new NicehashAuthError(
        "NiceHash 資格情報が未設定です（NICEHASH_API_KEY / NICEHASH_API_SECRET / NICEHASH_ORG_ID）",
      );
    }
    const timeMs = await this.serverTimeMs();
    const nonce = createNonce();
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers: Record<string, string> = {
      ...buildAuthHeaders(this.creds, { method, path, query, body: bodyStr, timeMs, nonce }),
    };
    if (bodyStr) headers["Content-Type"] = "application/json";

    const url = `${this.base}${path}${query ? `?${query}` : ""}`;
    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr ?? undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      throw new NicehashAuthError(`NiceHash 認証失敗（${res.status}）`);
    }
    if (res.status === 429) throw new Error("NiceHash レート制限（429）");
    if (!res.ok) {
      // レスポンス本文にエラー詳細があるが、秘密情報が混ざらないよう先頭のみ
      const text = (await res.text()).slice(0, 200);
      throw new Error(`NiceHash API エラー ${res.status}: ${text}`);
    }
    return res.json();
  }

  // -------------------------------------------------------------------------
  // 市場データ
  // -------------------------------------------------------------------------

  async getAlgorithms(): Promise<HashpowerAlgoSettings[]> {
    if (this.mode === "mock") return [mockAlgoSettings()];
    if (this.algoCache && Date.now() - this.algoCache.at < 3600_000) {
      return this.algoCache.list;
    }
    const json = (await this.publicGet("/main/api/v2/mining/algorithms")) as {
      miningAlgorithms?: unknown[];
    };
    if (!Array.isArray(json.miningAlgorithms)) {
      throw new NicehashInvalidResponseError("miningAlgorithms がありません");
    }
    const list: HashpowerAlgoSettings[] = json.miningAlgorithms.map((raw) => {
      const a = raw as Record<string, unknown>;
      return {
        algorithm: String(a.algorithm ?? a.name ?? ""),
        marketFactor: num(a.marketFactor, "marketFactor", 1),
        displayMarketFactor: String(a.displayMarketFactor ?? ""),
        minSpeedLimit: num(a.minSpeedLimit ?? 0, "minSpeedLimit", 0),
        minPriceBtc: num(a.minimalOrderAmount ?? a.minPrice ?? 0, "minPrice", 0, 1000),
        orderFeeBtc: config.nicehash.orderFeeBtc,
        marketFeeRate: config.nicehash.marketFeeRate,
        source: "nicehash",
        fetchedAt: new Date().toISOString(),
      };
    });
    this.algoCache = { at: Date.now(), list };
    return list;
  }

  async getAlgoSettings(algorithm: string): Promise<HashpowerAlgoSettings> {
    const list = await this.getAlgorithms();
    const found = list.find((a) => a.algorithm === algorithm);
    if (!found) {
      throw new NicehashInvalidResponseError(`algorithm ${algorithm} が見つかりません`);
    }
    return found;
  }

  async getOrderBook(algorithm: string): Promise<HashpowerOrderbook> {
    if (this.mode === "mock") return mockOrderbook(algorithm);

    if (this.bookCache && Date.now() - this.bookCache.at < config.nicehash.scanIntervalSec * 500) {
      return this.bookCache.book;
    }
    const settings = await this.getAlgoSettings(algorithm);
    const json = (await this.publicGet(
      `/main/api/v2/hashpower/orderBook?algorithm=${encodeURIComponent(algorithm)}&size=100`,
    )) as { stats?: Record<string, unknown> };
    if (!json.stats || typeof json.stats !== "object") {
      throw new NicehashInvalidResponseError("orderBook.stats がありません");
    }

    const levels: OrderbookLevel[] = [];
    for (const [marketKey, marketRaw] of Object.entries(json.stats)) {
      const market = marketKey as HashpowerMarket;
      const m = marketRaw as Record<string, unknown>;
      const orders = Array.isArray(m.orders) ? m.orders : [];
      for (const raw of orders) {
        const o = raw as Record<string, unknown>;
        // 価格が無い行は捨てる。速度は payingSpeed / acceptedSpeed / speedLimit の順で採用
        const price = Number(o.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const speed = Number(
          o.payingSpeed ?? o.acceptedCurrentSpeed ?? o.acceptedSpeed ?? o.speedLimit ?? 0,
        );
        levels.push({
          priceBtcPerFactorDay: price,
          speedFactor: Number.isFinite(speed) && speed > 0 ? speed : 0,
          market,
        });
      }
    }
    levels.sort((a, b) => a.priceBtcPerFactorDay - b.priceBtcPerFactorDay);

    // 実効価格 = ハッシュレートが実際に付いている最安値
    const active = levels.find((l) => l.speedFactor > 0);
    const book: HashpowerOrderbook = {
      algorithm,
      levels,
      currentPriceBtcPerFactorDay: active?.priceBtcPerFactorDay ?? null,
      totalAvailableSpeedFactor: levels.reduce((s, l) => s + l.speedFactor, 0),
      marketFactor: settings.marketFactor,
      source: "nicehash",
      sourceMode: "LIVE_API",
      fetchedAt: new Date().toISOString(),
    };
    this.bookCache = { at: Date.now(), book };
    return book;
  }

  async getCurrentHashpowerPrice(algorithm: string): Promise<number | null> {
    const book = await this.getOrderBook(algorithm);
    return book.currentPriceBtcPerFactorDay;
  }

  async getFees(algorithm: string): Promise<{ marketFeeRate: number; orderFeeBtc: number }> {
    const settings = await this.getAlgoSettings(algorithm);
    return { marketFeeRate: settings.marketFeeRate, orderFeeBtc: settings.orderFeeBtc };
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; message: string | null }> {
    if (this.mode === "mock") return { ok: true, latencyMs: 5, message: "mock" };
    const started = Date.now();
    try {
      await this.publicGet("/api/v2/time");
      return { ok: true, latencyMs: Date.now() - started, message: null };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : "接続できません",
      };
    }
  }

  // -------------------------------------------------------------------------
  // アカウント
  // -------------------------------------------------------------------------

  async getAccountBalance(): Promise<{ availableBtc: BtcAmount; pendingBtc: BtcAmount }> {
    if (this.mode === "mock") {
      return { availableBtc: "0.05000000", pendingBtc: "0.00000000" };
    }
    const json = (await this.signedCall(
      "GET",
      "/main/api/v2/accounting/accounts2",
      "fiatSymbol=USD",
      null,
    )) as { currencies?: unknown[] };
    const btc = (json.currencies ?? []).find(
      (c) => (c as Record<string, unknown>).currency === "BTC",
    ) as Record<string, unknown> | undefined;
    if (!btc) return { availableBtc: "0.00000000", pendingBtc: "0.00000000" };
    return {
      availableBtc: formatNumberAsBtc(num(btc.available ?? 0, "available", 0, 21e6)),
      pendingBtc: formatNumberAsBtc(num(btc.pending ?? 0, "pending", 0, 21e6)),
    };
  }

  async getMyOrders(algorithm?: string): Promise<MarketplaceOrder[]> {
    if (this.mode === "mock") return [];
    const query =
      `algorithm=${encodeURIComponent(algorithm ?? SHA256_ALGORITHM)}` +
      `&status=ACTIVE&op=GT&ts=0&limit=100`;
    const json = (await this.signedCall(
      "GET",
      "/main/api/v2/hashpower/myOrders",
      query,
      null,
    )) as { list?: unknown[] };
    return (json.list ?? []).map((raw) => parseOrder(raw as Record<string, unknown>));
  }

  async getOrder(externalOrderId: string): Promise<MarketplaceOrder | null> {
    if (this.mode === "mock") return null;
    try {
      const json = await this.signedCall(
        "GET",
        `/main/api/v2/hashpower/order/${encodeURIComponent(externalOrderId)}`,
        "",
        null,
      );
      return parseOrder(json as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async getOrderStats(externalOrderId: string): Promise<MarketplaceOrderStats | null> {
    if (this.mode === "mock") return null;
    try {
      const json = (await this.signedCall(
        "GET",
        `/main/api/v2/hashpower/order/${encodeURIComponent(externalOrderId)}/stats`,
        "",
        null,
      )) as Record<string, unknown>;
      return {
        externalOrderId,
        deliveredSpeedFactor: num(json.accepted_speed ?? json.acceptedSpeed ?? 0, "speed", 0),
        acceptedSpeedFactor: num(json.accepted_speed ?? json.acceptedSpeed ?? 0, "speed", 0),
        rejectedSpeedFactor: num(json.rejected_speed ?? json.rejectedSpeed ?? 0, "rej", 0),
        spentAmountBtc: formatNumberAsBtc(num(json.payed_amount ?? json.paidAmount ?? 0, "spent", 0, 21e6)),
        at: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // 注文（live + Kill Switch のみ）
  // -------------------------------------------------------------------------

  /** 全注文メソッドの共通ゲート。live 以外・Kill Switch OFF では絶対に実 API を呼ばない */
  private assertTradingAllowed(): void {
    if (this.mode !== "live") {
      throw new MarketplaceDisabledError(
        `mode=${this.mode}（実注文は NICEHASH_MODE=live のみ。paper では仮想注文を使う）`,
      );
    }
    if (!config.nicehash.tradingEnabled) {
      throw new MarketplaceDisabledError("FEATURE_NICEHASH_TRADING_ENABLED=false（Kill Switch）");
    }
  }

  async createOrder(params: CreateOrderParams): Promise<MarketplaceOrder> {
    this.assertTradingAllowed();
    const settings = await this.getAlgoSettings(params.algorithm);
    const body = {
      algorithm: params.algorithm,
      market: params.market,
      poolId: params.poolId,
      type: params.type,
      price: params.priceBtcPerFactorDay.toFixed(8),
      limit: params.limitFactor.toFixed(4),
      amount: params.amountBtc,
      marketFactor: settings.marketFactor,
      displayMarketFactor: settings.displayMarketFactor,
    };
    const json = await this.signedCall("POST", "/main/api/v2/hashpower/order", "", body);
    return parseOrder(json as Record<string, unknown>);
  }

  async updateOrderPrice(
    externalOrderId: string,
    priceBtcPerFactorDay: number,
    limitFactor: number,
  ): Promise<MarketplaceOrder> {
    this.assertTradingAllowed();
    const settings = await this.getAlgoSettings(SHA256_ALGORITHM);
    const body = {
      price: priceBtcPerFactorDay.toFixed(8),
      limit: limitFactor.toFixed(4),
      marketFactor: settings.marketFactor,
      displayMarketFactor: settings.displayMarketFactor,
    };
    const json = await this.signedCall(
      "POST",
      `/main/api/v2/hashpower/order/${encodeURIComponent(externalOrderId)}/updatePriceAndLimit`,
      "",
      body,
    );
    return parseOrder(json as Record<string, unknown>);
  }

  async updateOrderLimit(externalOrderId: string, limitFactor: number): Promise<MarketplaceOrder> {
    const current = await this.getOrder(externalOrderId);
    if (!current) throw new Error("注文が見つかりません");
    return this.updateOrderPrice(externalOrderId, current.priceBtcPerFactorDay, limitFactor);
  }

  async cancelOrder(externalOrderId: string): Promise<void> {
    this.assertTradingAllowed();
    await this.signedCall(
      "DELETE",
      `/main/api/v2/hashpower/order/${encodeURIComponent(externalOrderId)}`,
      "",
      null,
    );
  }
}

// ---------------------------------------------------------------------------
// パース・Mock
// ---------------------------------------------------------------------------

function parseOrder(o: Record<string, unknown>): MarketplaceOrder {
  return {
    externalOrderId: String(o.id ?? ""),
    algorithm: String(
      (o.algorithm as Record<string, unknown> | undefined)?.algorithm ?? o.algorithm ?? "",
    ),
    market: (o.market as HashpowerMarket) ?? "EU",
    status: String(
      (o.status as Record<string, unknown> | undefined)?.code ?? o.status ?? "ACTIVE",
    ).toUpperCase() as MarketplaceOrder["status"],
    priceBtcPerFactorDay: num(o.price, "price", 0, 1000),
    limitFactor: num(o.limit ?? 0, "limit", 0),
    availableAmountBtc: formatNumberAsBtc(num(o.availableAmount ?? o.amount ?? 0, "amount", 0, 21e6)),
    spentAmountBtc: formatNumberAsBtc(num(o.payedAmount ?? o.spentAmount ?? 0, "spent", 0, 21e6)),
    deliveredSpeedFactor:
      o.acceptedCurrentSpeed !== undefined ? num(o.acceptedCurrentSpeed, "speed", 0) : null,
    poolId: o.pool ? String((o.pool as Record<string, unknown>).id ?? "") : null,
    updatedAt: new Date().toISOString(),
  };
}

/** SHA256ASICBOOST 相当の Mock 設定（marketFactor=PH）。★実データではない */
export function mockAlgoSettings(): HashpowerAlgoSettings {
  return {
    algorithm: SHA256_ALGORITHM,
    marketFactor: 1e15, // PH
    displayMarketFactor: "PH",
    minSpeedLimit: 0.01,
    minPriceBtc: 0.0001,
    orderFeeBtc: config.nicehash.orderFeeBtc,
    marketFeeRate: config.nicehash.marketFeeRate,
    source: "mock:nicehash",
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 決定的な Mock orderbook。★実データではない
 * 基準価格は「難易度 126.4T・報酬 3.175 BTC 環境での理論採掘収益 ≈ 0.000505 BTC/PH/day」
 * に揃え、±30% の周期変動で BUY ↔ WAIT の遷移がデモで観察できるようにしてある。
 */
export function mockOrderbook(algorithm: string, atMs = Date.now()): HashpowerOrderbook {
  const hours = atMs / 3600_000;
  const base = 0.000505; // BTC/PH/day（理論収益密度と同スケール）
  const wave = 0.82 + 0.28 * Math.sin(hours / 2) + 0.05 * Math.sin(hours * 1.7);
  const current = Math.round(base * wave * 1e9) / 1e9;
  const levels: OrderbookLevel[] = [0, 1, 2, 3, 4].map((i) => ({
    priceBtcPerFactorDay: Math.round((current + i * 0.00001) * 1e9) / 1e9,
    speedFactor: 5 + i * 3,
    market: (i % 2 === 0 ? "EU" : "USA") as HashpowerMarket,
  }));
  return {
    algorithm,
    levels,
    currentPriceBtcPerFactorDay: current,
    totalAvailableSpeedFactor: levels.reduce((s, l) => s + l.speedFactor, 0),
    marketFactor: 1e15,
    source: "mock:nicehash",
    sourceMode: "MOCK",
    fetchedAt: new Date(atMs).toISOString(),
  };
}
