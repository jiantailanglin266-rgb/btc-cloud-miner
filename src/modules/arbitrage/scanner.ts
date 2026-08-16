/**
 * Opportunity Scanner + Paper Trading（フェーズ19・20・29・30）
 *
 * 定期実行（既定60s）で:
 *   1. 市場コンテキスト収集（BTC/難易度/手数料/NiceHash板）
 *   2. Profitability Engine → Decision Engine
 *   3. DecisionSnapshot を必ず保存（「なぜ注文した/しなかった」の完全記録）
 *   4. モード別の注文管理:
 *        mock/paper … 仮想注文（実 API 注文は一切作らない）。仮想損益を記録
 *        live       … Kill Switch + enabled のときのみ実注文（上限価格は maxBid）
 *
 * ★ Paper の損益は「仮想」。Ledger には絶対に入れない（ArbitrageState にのみ記録）。
 * ★ PILOT_MODE でも scanner は動作する（出金と無関係のため）。
 */

import type {
  ArbitrageState,
  DecisionSnapshot,
  HashpowerOrder,
  SourceMode,
} from "@/types";
import { getStore } from "@/lib/store";
import { config } from "@/lib/config";
import { newId } from "@/lib/crypto";
import { addBtc, fromSat, toSat } from "@/lib/decimal";
import { getNetworkAndPrice } from "@/modules/bitcoin/service";
import { getProviderHealth } from "@/modules/provider/registry";
import { NiceHashAdapter, SHA256_ALGORITHM } from "@/modules/hashpower/nicehash";
import { priceFactorDayToBtcPerThDay } from "@/modules/hashpower/units";
import {
  calculateProfitability,
  type ProfitabilityInput,
  type ProfitabilityResult,
} from "./engine";
import { decide, adaptiveSafetyMargin, type Decision } from "./decision";
import { sizePosition, checkRiskLimits } from "./position";
import { raiseAlert } from "@/modules/monitoring/alerts";

export type ScanResult = {
  at: string;
  dataMode: SourceMode;
  profitability: ProfitabilityResult;
  decision: Decision;
  snapshotId: string;
  recommendedThs: number;
  maxSpendBtc: string;
  activeOrders: number;
  paperAction: string | null;
  inputs: DecisionSnapshot["inputs"];
};

/** 平均ブロック手数料の近似: 推奨fee(sat/vB) × 標準ブロック 1,000,000 vB */
function estimateAvgTxFeesBtcPerBlock(recommendedFeeSatPerVb: number): number {
  const sats = Math.max(0, recommendedFeeSatPerVb) * 1_000_000;
  return Math.min(5, sats / 1e8); // 上限5BTC（異常値ガード）
}

export async function runOpportunityScan(tenantId: string): Promise<ScanResult> {
  const store = await getStore();
  const nicehash = new NiceHashAdapter();

  // --- 1. 市場コンテキスト --------------------------------------------------
  const [{ network, price }, providerHealth, nhHealth] = await Promise.all([
    getNetworkAndPrice(),
    getProviderHealth(tenantId),
    nicehash.healthCheck(),
  ]);
  const orderbook = await nicehash.getOrderBook(SHA256_ALGORITHM).catch(() => null);
  const fees = await nicehash.getFees(SHA256_ALGORITHM).catch(() => ({
    marketFeeRate: config.nicehash.marketFeeRate,
    orderFeeBtc: config.nicehash.orderFeeBtc,
  }));

  const usdJpy =
    price.usd > 0 && price.jpy > 0 ? price.jpy / price.usd : config.arbitrage.usdJpyFallback;

  const dataMode: SourceMode =
    orderbook?.sourceMode === "MOCK" || network.freshness.source.startsWith("mock")
      ? "MOCK"
      : network.freshness.stale
        ? "STALE_LIVE"
        : (orderbook?.sourceMode ?? "LIVE_API");

  const marketDataAgeSec = Math.max(
    network.freshness.ageSec,
    orderbook ? Math.floor((Date.now() - new Date(orderbook.fetchedAt).getTime()) / 1000) : 9999,
  );

  // --- 2. 状態・adaptive margin --------------------------------------------
  let state = await store.getArbitrageState(tenantId);
  state = await rollDay(store, state);
  const adaptive = adaptiveSafetyMargin(state.forecastErrorEma);
  if (Math.abs(adaptive - state.safetyMarginRate) > 0.001) {
    state = await store.updateArbitrageState(tenantId, { safetyMarginRate: adaptive });
  }

  const activeOrders = await store.listHashpowerOrders(tenantId, { activeOnly: true });
  const activeThs = activeOrders.reduce((s, o) => s + (o.deliveredThs ?? o.requestedThs), 0);

  const marketFactor = orderbook?.marketFactor ?? 1e15;
  const profitInput: ProfitabilityInput = {
    btcPriceUsd: price.usd,
    usdJpy,
    difficulty: network.difficulty,
    networkHashrateThs: network.networkHashrateThs,
    blockSubsidyBtc: network.blockRewardBtc,
    avgTxFeesBtcPerBlock: estimateAvgTxFeesBtcPerBlock(network.recommendedFeeSatPerVb),
    poolFeeRate: config.fees.poolFeeRate,
    expectedPoolEfficiency: 0.97,
    expectedRejectRate: 0.01,
    nicehashPriceBtcPerFactorDay: orderbook?.currentPriceBtcPerFactorDay ?? null,
    nicehashMarketFeeRate: fees.marketFeeRate,
    nicehashOrderFeeBtc: fees.orderFeeBtc,
    marketFactor,
    safetyMarginRate: state.safetyMarginRate,
    // 固定注文手数料は 1 注文予算（上限）に対する率として評価する
    plannedSpendBtc: Number(state.maxOrderBtc),
  };
  const profitability = calculateProfitability(profitInput);

  // --- 3. リスク状態 → Decision --------------------------------------------
  const poolOnline = providerHealth.some(
    (h) => h.status === "ONLINE" || h.status === "DEGRADED",
  );
  const cumulativePnl = state.dayPnlBtc; // 日次。累積は HWM とスナップショットで追跡
  const drawdownRate = computeDrawdown(state);

  const riskViolations = checkRiskLimits(
    {
      maxOrderBtc: state.maxOrderBtc,
      maxDailySpendBtc: state.maxDailySpendBtc,
      maxDailyLossBtc: state.maxDailyLossBtc,
      maxConcurrentOrders: state.maxConcurrentOrders,
      maxHashrateThs: state.maxHashrateThs,
      maxDrawdownRate: state.maxDrawdownRate,
    },
    {
      daySpentBtc: state.daySpentBtc,
      dayPnlBtc: state.dayPnlBtc,
      activeOrderCount: activeOrders.length,
      activeHashrateThs: activeThs,
      drawdownRate,
    },
    { spendBtc: "0.00000000", hashrateThs: 0 }, // 新規提案なしの健全性チェック
  );

  const oldest = activeOrders[activeOrders.length - 1];
  const decision = decide({
    profitability,
    startMarginRate: state.startMarginRate,
    stopMarginRate: state.stopMarginRate,
    minConfidence: config.arbitrage.minConfidence,
    marketDataAgeSec,
    maxDataAgeSec: config.arbitrage.maxDataAgeSec,
    poolOnline,
    nicehashOnline: nhHealth.ok,
    accountingHealthy: true, // reconciliation ジョブが CRITICAL を出すと下の alerts 連動で停止
    riskLimitOk: riskViolations.length === 0,
    killSwitchOn: !state.enabled,
    hasActiveOrder: activeOrders.length > 0,
    activeOrderRuntimeSec: oldest?.startedAt
      ? Math.floor((Date.now() - new Date(oldest.startedAt).getTime()) / 1000)
      : 0,
    minRuntimeSec: state.minRuntimeSec,
    maxRuntimeSec: state.maxRuntimeSec,
    forecastErrorEma: state.forecastErrorEma,
  });
  if (riskViolations.length > 0) decision.reasons.push(...riskViolations);

  // --- 4. Position sizing ----------------------------------------------------
  let recommendedThs = 0;
  let maxSpendBtc = "0.00000000";
  if (decision.action === "BUY" && profitability.costBtcPerThDay !== null) {
    const balance = await nicehash
      .getAccountBalance()
      .catch(() => ({ availableBtc: "0.00000000", pendingBtc: "0.00000000" }));
    const sized = sizePosition({
      availableBtc: balance.availableBtc,
      expectedMarginRate: profitability.expectedMarginRate ?? 0,
      confidence: decision.confidence,
      volatility: 0.3, // TODO(live): 直近サンプルの価格変動係数から算出
      recentPnlBtc: state.dayPnlBtc,
      drawdownRate,
      costBtcPerThDay: profitability.costBtcPerThDay,
      maxRuntimeSec: state.maxRuntimeSec,
    });
    // 1注文上限でクランプ
    const spendSat = toSat(sized.maxSpendBtc);
    const capSat = toSat(state.maxOrderBtc);
    maxSpendBtc = fromSat(spendSat > capSat ? capSat : spendSat);
    recommendedThs = Math.min(sized.recommendedThs, state.maxHashrateThs);
  }

  // --- 5. DecisionSnapshot（必ず保存） --------------------------------------
  const snapshot: DecisionSnapshot = {
    id: newId(),
    tenantId,
    at: new Date().toISOString(),
    inputs: {
      btcPriceUsd: price.usd,
      usdJpy,
      difficulty: network.difficulty,
      networkHashrateThs: network.networkHashrateThs,
      blockSubsidyBtc: network.blockRewardBtc,
      avgTxFeesBtcPerBlock: profitInput.avgTxFeesBtcPerBlock,
      poolFeeRate: profitInput.poolFeeRate,
      expectedPoolEfficiency: profitInput.expectedPoolEfficiency,
      expectedRejectRate: profitInput.expectedRejectRate,
      nicehashPriceBtcPerFactorDay: profitInput.nicehashPriceBtcPerFactorDay,
      nicehashMarketFeeRate: profitInput.nicehashMarketFeeRate,
      nicehashOrderFeeBtc: profitInput.nicehashOrderFeeBtc,
      marketFactor,
      safetyMarginRate: state.safetyMarginRate,
      dataMode,
    },
    outputs: {
      expectedRevenueBtcPerThDay: profitability.expectedRevenueBtcPerThDay,
      costBtcPerThDay: profitability.costBtcPerThDay,
      spreadBtcPerThDay: profitability.spreadBtcPerThDay,
      expectedMarginRate: profitability.expectedMarginRate,
      breakEvenPriceBtcPerFactorDay: profitability.breakEvenPriceBtcPerFactorDay,
      maxBidPriceBtcPerFactorDay: profitability.maxBidPriceBtcPerFactorDay,
      spreadUsdPerHourAt1Ph: profitability.spreadUsdPerHourAt1Ph,
      spreadJpyPerHourAt1Ph: profitability.spreadJpyPerHourAt1Ph,
    },
    action: decision.action,
    reasons: decision.reasons,
    confidence: decision.confidence,
    recommendedThs,
    maxSpendBtc,
  };
  await store.insertDecisionSnapshot(snapshot);

  // --- 6. 市場サンプル保存（バックテスト用の履歴蓄積） ----------------------
  if (orderbook?.currentPriceBtcPerFactorDay !== null && orderbook !== null) {
    const minuteKey = new Date().toISOString().slice(0, 16);
    await store.insertMarketSample({
      id: `ms-${minuteKey}`,
      at: new Date().toISOString(),
      btcPriceUsd: price.usd,
      usdJpy,
      difficulty: network.difficulty,
      networkHashrateThs: network.networkHashrateThs,
      blockSubsidyBtc: network.blockRewardBtc,
      avgTxFeesBtcPerBlock: profitInput.avgTxFeesBtcPerBlock,
      nicehashPriceBtcPerFactorDay: orderbook.currentPriceBtcPerFactorDay,
      nicehashAvailableFactor: orderbook.totalAvailableSpeedFactor,
      poolEfficiency: profitInput.expectedPoolEfficiency,
      sourceMode: dataMode,
    });
  }

  // --- 7. 注文管理（paper / live） ------------------------------------------
  const paperAction = await manageOrders(
    tenantId,
    state,
    decision,
    profitability,
    snapshot.id,
    { recommendedThs, maxSpendBtc, marketFactor, orderbookPrice: orderbook?.currentPriceBtcPerFactorDay ?? null },
  );

  return {
    at: snapshot.at,
    dataMode,
    profitability,
    decision,
    snapshotId: snapshot.id,
    recommendedThs,
    maxSpendBtc,
    activeOrders: activeOrders.length,
    paperAction,
    inputs: snapshot.inputs,
  };
}

// ---------------------------------------------------------------------------
// 注文管理
// ---------------------------------------------------------------------------

async function manageOrders(
  tenantId: string,
  state: ArbitrageState,
  decision: Decision,
  profitability: ProfitabilityResult,
  snapshotId: string,
  ctx: {
    recommendedThs: number;
    maxSpendBtc: string;
    marketFactor: number;
    orderbookPrice: number | null;
  },
): Promise<string | null> {
  const store = await getStore();
  const mode = config.nicehash.mode as HashpowerOrder["mode"];
  const active = await store.listHashpowerOrders(tenantId, { activeOnly: true });

  // 稼働中注文の paper 精算（経過時間ぶんのコスト・期待採掘を積む）
  for (const order of active) {
    if (order.mode !== "live") await accruePaperOrder(tenantId, order, profitability);
  }

  if (decision.action === "STOP" && active.length > 0) {
    for (const order of active) {
      await closeOrder(tenantId, order, decision.reasons.join(" / "), state);
    }
    return `closed ${active.length} order(s)`;
  }

  if (decision.action !== "BUY") return null;
  if (!state.enabled) return "state.enabled=false のため注文せずスキャンのみ";
  if (ctx.recommendedThs <= 0 || toSat(ctx.maxSpendBtc) <= 0n) {
    return "推奨サイズがゼロのため見送り";
  }
  if (ctx.orderbookPrice === null) return null;
  if (active.length > 0) return null; // 追加発注は maxConcurrent 管理下でも保守的に1つずつ

  // ★ maxBid を超える価格では絶対に発注しない（フェーズ15・41）
  const bidPrice = Math.min(ctx.orderbookPrice, profitability.maxBidPriceBtcPerFactorDay);
  if (bidPrice > profitability.breakEvenPriceBtcPerFactorDay) {
    return "break-even 超の Bid になるため発注中止";
  }

  const now = new Date().toISOString();
  const order: HashpowerOrder = {
    id: `hpo-${newId().slice(0, 12)}`,
    tenantId,
    mode: mode === "live" && config.nicehash.tradingEnabled ? "live" : mode === "mock" ? "mock" : "paper",
    externalOrderId: null,
    algorithm: SHA256_ALGORITHM,
    market: "EU",
    poolId: null,
    status: "ACTIVE",
    priceBtcPerFactorDay: bidPrice,
    requestedThs: ctx.recommendedThs,
    deliveredThs: ctx.recommendedThs, // paper は要求どおり配信された仮定（保守側: コスト満額）
    amountBtc: ctx.maxSpendBtc,
    spentBtc: fromSat(toSat(config.nicehash.orderFeeBtc.toFixed(8))), // 注文固定手数料を初期コストに計上
    minedBtc: "0.00000000",
    startedAt: now,
    stoppedAt: null,
    decisionSnapshotId: snapshotId,
    reason: decision.reasons.join(" / "),
    createdAt: now,
    updatedAt: now,
  };

  if (order.mode === "live") {
    // 実注文（Kill Switch + live モードのときのみ到達）
    try {
      const nicehash = new NiceHashAdapter();
      const external = await nicehash.createOrder({
        algorithm: SHA256_ALGORITHM,
        market: "EU",
        poolId: "", // TODO(live): 事前に登録したプール ID を設定
        priceBtcPerFactorDay: bidPrice,
        limitFactor: ctx.recommendedThs / (ctx.marketFactor / 1e12),
        amountBtc: ctx.maxSpendBtc,
        type: "STANDARD",
      });
      order.externalOrderId = external.externalOrderId;
      order.status = "SUBMITTED";
    } catch (err) {
      order.status = "FAILED";
      order.reason = `発注失敗: ${err instanceof Error ? err.message : String(err)}`;
      await raiseAlert(tenantId, {
        kind: "POOL_API_UNAVAILABLE",
        severity: "CRITICAL",
        message: `NiceHash 発注に失敗しました: ${order.reason}`,
        evidence: { snapshotId },
        targetType: "hashpower",
        targetId: order.id,
      });
    }
  }

  await store.upsertHashpowerOrder(order);
  // 日次支出カウンタ更新
  await store.updateArbitrageState(tenantId, {
    daySpentBtc: addBtc(state.daySpentBtc, order.spentBtc),
  });
  return `${order.mode} order created: ${ctx.recommendedThs} TH/s @ ${bidPrice.toFixed(6)}`;
}

/** paper 注文のコスト・期待採掘の積み上げ（経過時間按分） */
async function accruePaperOrder(
  tenantId: string,
  order: HashpowerOrder,
  profitability: ProfitabilityResult,
): Promise<void> {
  const store = await getStore();
  const lastMs = new Date(order.updatedAt).getTime();
  const dtDays = Math.max(0, (Date.now() - lastMs) / 86_400_000);
  if (dtDays <= 0) return;

  const ths = order.deliveredThs ?? order.requestedThs;
  const costDensity = priceFactorDayToBtcPerThDay(order.priceBtcPerFactorDay, 1e15);
  const cost = costDensity * ths * dtDays * (1 + config.nicehash.marketFeeRate);
  // paper の「採掘量」は期待値ベース（安全マージン控除前の素の期待で記録し、乖離を観察する）
  const mined =
    (profitability.expectedRevenueBtcPerThDay /
      Math.max(0.0001, 1 - 0 /* margin は既に控除済みの値を使う */)) *
    ths *
    dtDays;

  const spentBtc = addBtc(order.spentBtc, cost.toFixed(8));
  const minedBtc = addBtc(order.minedBtc, mined.toFixed(8));

  // 予算超過したら注文完了扱い
  const exhausted = toSat(spentBtc) >= toSat(order.amountBtc);
  await store.upsertHashpowerOrder({
    ...order,
    spentBtc,
    minedBtc,
    status: exhausted ? "COMPLETED" : order.status,
    stoppedAt: exhausted ? new Date().toISOString() : order.stoppedAt,
    updatedAt: new Date().toISOString(),
  });
}

/** 注文のクローズと仮想 PnL の日次計上 */
async function closeOrder(
  tenantId: string,
  order: HashpowerOrder,
  reason: string,
  state: ArbitrageState,
): Promise<void> {
  const store = await getStore();

  if (order.mode === "live" && order.externalOrderId) {
    // Emergency Cancellation（フェーズ39）: リトライは scheduler の Dead Letter に委ねる
    try {
      const nicehash = new NiceHashAdapter();
      await nicehash.cancelOrder(order.externalOrderId);
    } catch (err) {
      await raiseAlert(tenantId, {
        kind: "POOL_API_UNAVAILABLE",
        severity: "CRITICAL",
        message: `NiceHash 注文のキャンセルに失敗（手動介入が必要）: ${order.externalOrderId}`,
        evidence: { orderId: order.id, error: err instanceof Error ? err.message : String(err) },
        targetType: "hashpower",
        targetId: order.id,
      });
      await store.upsertHashpowerOrder({
        ...order,
        status: "STOPPING",
        reason: `キャンセル再試行中: ${reason}`,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
  }

  const pnl = fromSat(toSat(order.minedBtc) - toSat(order.spentBtc));
  await store.upsertHashpowerOrder({
    ...order,
    status: "COMPLETED",
    stoppedAt: new Date().toISOString(),
    reason,
    updatedAt: new Date().toISOString(),
  });
  await store.updateArbitrageState(tenantId, {
    dayPnlBtc: addBtc(state.dayPnlBtc, pnl),
  });
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** 日付が変わったら日次カウンタをリセットする */
async function rollDay(
  store: Awaited<ReturnType<typeof getStore>>,
  state: ArbitrageState,
): Promise<ArbitrageState> {
  const today = new Date().toISOString().slice(0, 10);
  if (state.dayKey === today) return state;
  return store.updateArbitrageState(state.tenantId, {
    dayKey: today,
    daySpentBtc: "0.00000000",
    dayPnlBtc: "0.00000000",
  });
}

/** HWM に対する現在の下振れ率（0〜1）。累積 PnL は HWM + 日次で近似 */
function computeDrawdown(state: ArbitrageState): number {
  const hwm = Number(state.highWaterMarkBtc);
  const current = hwm + Number(state.dayPnlBtc);
  if (hwm <= 0) return current < 0 ? Math.min(1, -current / 0.01) : 0;
  return Math.max(0, Math.min(1, (hwm - current) / hwm));
}
