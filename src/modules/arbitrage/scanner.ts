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
import { priceFactorDayToBtcPerThDay, speedFactorToThs } from "@/modules/hashpower/units";
import { effectivePriceForHashrate, depthBelowPrice } from "@/modules/hashpower/orderbook";
import {
  calculateProfitability,
  type ProfitabilityInput,
  type ProfitabilityResult,
} from "./engine";
import { decide, adaptiveSafetyMargin, type Decision } from "./decision";
import { sizePosition, checkRiskLimits } from "./position";
import { measurePoolPerformance, measureVolatility } from "./measured";
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
  outputs: DecisionSnapshot["outputs"];
};

/** 平均ブロック手数料の近似: 推奨fee(sat/vB) × 標準ブロック 1,000,000 vB */
function estimateAvgTxFeesBtcPerBlock(recommendedFeeSatPerVb: number): number {
  const sats = Math.max(0, recommendedFeeSatPerVb) * 1_000_000;
  return Math.min(5, sats / 1e8); // 上限5BTC（異常値ガード）
}

/**
 * 難易度リターゲットを考慮した実効難易度（精密化v3 #2）。
 *
 * 収益 ∝ 1/難易度 なので、注文期間が現在難易度 d0 の区間と調整後 d1 の区間に
 * またがる場合の期待収益は時間加重の調和平均難易度で表せる:
 *   d_eff = 1 / (w0/d0 + w1/d1)
 * リターゲットが期間外・変化率不明(0)なら d0 をそのまま返す。
 */
export function effectiveDifficultyOverRuntime(input: {
  difficulty: number;
  blocksUntilAdjustment: number;
  estimatedAdjustmentRate: number;
  runtimeSec: number;
}): { effectiveDifficulty: number; retargetWeight: number } {
  const { difficulty, blocksUntilAdjustment, estimatedAdjustmentRate, runtimeSec } = input;
  // 残ブロック × 平均 600 秒でリターゲット到達時刻を近似
  const retargetInSec = blocksUntilAdjustment * 600;
  if (
    estimatedAdjustmentRate === 0 ||
    runtimeSec <= 0 ||
    retargetInSec >= runtimeSec ||
    difficulty <= 0
  ) {
    return { effectiveDifficulty: difficulty, retargetWeight: 0 };
  }
  const projected = difficulty * (1 + estimatedAdjustmentRate);
  if (projected <= 0) return { effectiveDifficulty: difficulty, retargetWeight: 0 };
  const w1 = Math.min(1, Math.max(0, (runtimeSec - retargetInSec) / runtimeSec));
  const w0 = 1 - w1;
  return {
    effectiveDifficulty: 1 / (w0 / difficulty + w1 / projected),
    retargetWeight: w1,
  };
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

  // --- 実測パラメータ（精密化 #2・#3。不足時は既定値へフォールバック） -----
  const [poolPerf, vol] = await Promise.all([
    measurePoolPerformance(tenantId),
    measureVolatility(),
  ]);

  // --- 精密化v3 #1: ブロック手数料は実測（直近ブロックのトリム平均）を優先 -----
  const avgTxFeesSource: "MEASURED_BLOCKS" | "FEE_PROXY" =
    network.avgBlockFeesBtc !== null ? "MEASURED_BLOCKS" : "FEE_PROXY";
  const avgTxFeesBtcPerBlock =
    network.avgBlockFeesBtc ?? estimateAvgTxFeesBtcPerBlock(network.recommendedFeeSatPerVb);

  // --- 精密化v3 #2: 注文期間内の難易度リターゲットを時間加重で織り込む --------
  const diffAdj = effectiveDifficultyOverRuntime({
    difficulty: network.difficulty,
    blocksUntilAdjustment: network.blocksUntilAdjustment,
    estimatedAdjustmentRate: network.estimatedAdjustmentRate,
    runtimeSec: state.maxRuntimeSec,
  });

  const baseInput: Omit<ProfitabilityInput, "nicehashPriceBtcPerFactorDay"> = {
    btcPriceUsd: price.usd,
    usdJpy,
    difficulty: diffAdj.effectiveDifficulty,
    networkHashrateThs: network.networkHashrateThs,
    blockSubsidyBtc: network.blockRewardBtc,
    avgTxFeesBtcPerBlock,
    poolFeeRate: config.fees.poolFeeRate,
    expectedPoolEfficiency: poolPerf.efficiency,
    expectedRejectRate: poolPerf.rejectRate,
    nicehashMarketFeeRate: fees.marketFeeRate,
    nicehashOrderFeeBtc: fees.orderFeeBtc,
    marketFactor,
    safetyMarginRate: state.safetyMarginRate,
    // 固定注文手数料は 1 注文予算（上限）に対する率として評価する
    plannedSpendBtc: Number(state.maxOrderBtc),
  };

  // --- 二段階評価（精密化 #1: スリッページ） --------------------------------
  // Pass 1: 板の最良価格で概算し、暫定の発注量を求める
  const pass1 = calculateProfitability({
    ...baseInput,
    nicehashPriceBtcPerFactorDay: orderbook?.currentPriceBtcPerFactorDay ?? null,
  });
  const roughThs =
    pass1.costBtcPerThDay !== null
      ? Math.min(
          state.maxHashrateThs,
          Number(state.maxOrderBtc) /
            (pass1.costBtcPerThDay * (state.maxRuntimeSec / 86_400)),
        )
      : 0;

  // Pass 2: その量を板から実際に集めた場合の VWAP で再評価（これが最終判定に使われる）
  const walk =
    orderbook && roughThs > 0
      ? effectivePriceForHashrate(orderbook, roughThs)
      : null;
  const effectivePrice =
    walk?.vwapPriceBtcPerFactorDay ??
    orderbook?.currentPriceBtcPerFactorDay ??
    null;
  const profitability = calculateProfitability({
    ...baseInput,
    nicehashPriceBtcPerFactorDay: effectivePrice,
  });
  // maxBid 以下の板の深さ（発注可否の判定材料）
  const fillableThsAtMaxBid = orderbook
    ? depthBelowPrice(orderbook, profitability.maxBidPriceBtcPerFactorDay)
    : 0;

  // --- 精密化v3 #3: 板の単位整合性監査 --------------------------------------
  // 板の総供給量（TH/s 換算）がネットワーク全体のハッシュレートを超えることは
  // 物理的にあり得ない。超えていれば marketFactor と速度の単位不整合を疑い、
  // その板を使った発注を止める（実測: SHA256ASICBOOST は 23EH vs 網914EH で正常）。
  const orderbookTotalThs = orderbook
    ? speedFactorToThs(orderbook.totalAvailableSpeedFactor, marketFactor)
    : null;
  const orderbookUnitsSane =
    orderbookTotalThs === null || orderbookTotalThs <= network.networkHashrateThs;
  if (!orderbookUnitsSane) {
    await raiseAlert(tenantId, {
      kind: "HASHRATE_DATA_ANOMALY",
      severity: "CRITICAL",
      message: `orderbook の総供給量がネットワークハッシュレートを超えています（単位不整合の疑い）: ${orderbookTotalThs?.toExponential(3)} TH/s > ${network.networkHashrateThs.toExponential(3)} TH/s`,
      evidence: { orderbookTotalThs, marketFactor, networkHashrateThs: network.networkHashrateThs },
      targetType: "hashpower",
      targetId: SHA256_ALGORITHM,
    }).catch(() => undefined);
  }

  // --- 3. リスク状態 → Decision --------------------------------------------
  // プール接続は「実際に hashpower を配信する」live の前提条件。
  // paper/mock は実プールへ配信しない（仮想注文のみ）ため、プール未登録でも
  // BUY シミュレーションを止めない。live では従来どおり必須。
  const poolReachable = providerHealth.some(
    (h) => h.status === "ONLINE" || h.status === "DEGRADED",
  );
  const poolOnline = config.nicehash.mode === "live" ? poolReachable : true;
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
    dataMode,
    // 深さ判定: 暫定量の9割以上を maxBid 以下で調達できること
    // ＋単位監査（精密化v3 #3）: 単位不整合の疑いがある板では発注しない
    depthSufficient:
      orderbookUnitsSane && (roughThs <= 0 || fillableThsAtMaxBid >= roughThs * 0.9),
  });
  if (!orderbookUnitsSane) {
    decision.reasons.push(
      "orderbook の単位整合性検査に失敗（総供給量がネットワークハッシュレート超）。単位不整合の疑いがあるため発注しない",
    );
  }
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
      volatility: vol.volatility, // 実測 CoV（不足時は既定値・出所は snapshot に記録）
      recentPnlBtc: state.dayPnlBtc,
      drawdownRate,
      costBtcPerThDay: profitability.costBtcPerThDay,
      maxRuntimeSec: state.maxRuntimeSec,
    });
    // 1注文上限・ハッシュレート上限・板の深さ（maxBid以下の実在量）でクランプ
    const spendSat = toSat(sized.maxSpendBtc);
    const capSat = toSat(state.maxOrderBtc);
    maxSpendBtc = fromSat(spendSat > capSat ? capSat : spendSat);
    recommendedThs = Math.min(
      sized.recommendedThs,
      state.maxHashrateThs,
      Math.floor(fillableThsAtMaxBid),
    );
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
      avgTxFeesBtcPerBlock: baseInput.avgTxFeesBtcPerBlock,
      avgTxFeesSource,
      effectiveDifficulty: diffAdj.effectiveDifficulty,
      difficultyAdjustmentRate: network.estimatedAdjustmentRate,
      retargetWeight: diffAdj.retargetWeight,
      poolFeeRate: baseInput.poolFeeRate,
      expectedPoolEfficiency: baseInput.expectedPoolEfficiency,
      expectedRejectRate: baseInput.expectedRejectRate,
      nicehashPriceBtcPerFactorDay: effectivePrice,
      nicehashMarketFeeRate: baseInput.nicehashMarketFeeRate,
      nicehashOrderFeeBtc: baseInput.nicehashOrderFeeBtc,
      marketFactor,
      safetyMarginRate: state.safetyMarginRate,
      dataMode,
      volatility: vol.volatility,
      volatilitySource: vol.source,
      poolPerformanceSource: poolPerf.source,
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
      effectivePriceBtcPerFactorDay: walk?.vwapPriceBtcPerFactorDay ?? null,
      slippageRate: walk?.slippageRate ?? null,
      fillableThsAtMaxBid,
      orderbookTotalThs,
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
      avgTxFeesBtcPerBlock: baseInput.avgTxFeesBtcPerBlock,
      nicehashPriceBtcPerFactorDay: orderbook.currentPriceBtcPerFactorDay,
      nicehashAvailableFactor: orderbook.totalAvailableSpeedFactor,
      poolEfficiency: baseInput.expectedPoolEfficiency,
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
    outputs: snapshot.outputs,
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
    if (order.mode !== "live") {
      await accruePaperOrder(
        tenantId,
        order,
        profitability,
        state.safetyMarginRate,
        ctx.orderbookPrice,
      );
    }
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
    marketFactor: ctx.marketFactor, // 価格の単位（コスト換算に必須。精密化v3 #4）
    requestedThs: ctx.recommendedThs,
    deliveredThs: ctx.recommendedThs, // paper は要求どおり配信された仮定（保守側: コスト満額）
    amountBtc: ctx.maxSpendBtc,
    spentBtc: fromSat(toSat(config.nicehash.orderFeeBtc.toFixed(8))), // 注文固定手数料を初期コストに計上
    minedBtc: "0.00000000",
    // 発注時点の期待採掘量（クローズ時に実績と比較して予測誤差を学習する）
    expectedBtc: (
      profitability.expectedRevenueBtcPerThDay *
      ctx.recommendedThs *
      (state.maxRuntimeSec / 86_400)
    ).toFixed(8),
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

/**
 * paper 注文のコスト・期待採掘の積み上げ（経過時間按分）。
 * ★「採掘量」は安全マージン控除前の物理期待値で記録する。
 *   安全マージンは判断バッファであり物理現象ではないため、
 *   これを含めたままだと expected vs actual の誤差測定が歪む。
 * ★ 精密化v3 #5: NiceHash は指値が実勢を下回ると hashrate が配信されない
 *   （undercut = 飢餓状態）。その間はコストも採掘もゼロにして正直に再現する。
 */
async function accruePaperOrder(
  tenantId: string,
  order: HashpowerOrder,
  profitability: ProfitabilityResult,
  safetyMarginRate: number,
  currentMarketPrice: number | null,
): Promise<void> {
  const store = await getStore();
  const lastMs = new Date(order.updatedAt).getTime();
  const dtDays = Math.max(0, (Date.now() - lastMs) / 86_400_000);
  if (dtDays <= 0) return;

  // 飢餓判定: 実勢（アクティブ最安値）より低い指値では配信されない。
  // updatedAt だけ進め、価格回復時に飢餓期間ぶんを遡って精算しないようにする
  if (currentMarketPrice !== null && order.priceBtcPerFactorDay < currentMarketPrice) {
    await store.upsertHashpowerOrder({
      ...order,
      reason: order.reason.includes("[starved]") ? order.reason : `${order.reason} [starved]`,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const ths = order.deliveredThs ?? order.requestedThs;
  // ★ marketFactor は注文に保存した値を使う（実 SHA256ASICBOOST は 1e18=EH。
  //   1e15 を仮定すると実市場でコストが 1000 倍ずれる）
  const costDensity = priceFactorDayToBtcPerThDay(order.priceBtcPerFactorDay, order.marketFactor);
  const cost = costDensity * ths * dtDays * (1 + config.nicehash.marketFeeRate);
  // 安全マージン控除を戻した物理期待値
  const physicalDensity =
    profitability.expectedRevenueBtcPerThDay / Math.max(0.5, 1 - safetyMarginRate);
  const mined = physicalDensity * ths * dtDays;

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

/**
 * 注文のクローズ。
 *   - PnL を日次・累積カウンタへ計上（精密化 #6: 累積からドローダウンを厳密算出）
 *   - expected vs actual の予測誤差で forecastErrorEma を更新（精密化 #5: 学習）
 *     → 次回以降の Adaptive Safety Margin・信頼度に反映される
 */
async function closeOrder(
  tenantId: string,
  staleOrder: HashpowerOrder,
  reason: string,
  state: ArbitrageState,
): Promise<void> {
  const store = await getStore();
  // ★ 同一スキャン内で直前に accruePaperOrder が upsert している可能性があるため
  //   必ず最新を読み直す（古いオブジェクトで上書きすると最終精算分の PnL が消える）
  const order = (await store.getHashpowerOrder(tenantId, staleOrder.id)) ?? staleOrder;

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

  // 予測誤差の学習: |expected − actual| / expected を EMA（α=0.2）で更新
  const expected = Number(order.expectedBtc);
  let forecastErrorEma = state.forecastErrorEma;
  if (expected > 0) {
    const err = Math.min(1, Math.abs(Number(order.minedBtc) - expected) / expected);
    forecastErrorEma = Math.round((state.forecastErrorEma * 0.8 + err * 0.2) * 10_000) / 10_000;
  }

  await store.updateArbitrageState(tenantId, {
    dayPnlBtc: addBtc(state.dayPnlBtc, pnl),
    cumulativePnlBtc: addBtc(state.cumulativePnlBtc, pnl),
    forecastErrorEma,
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

/**
 * ドローダウン率（0〜1）を累積実現 PnL から厳密に算出する（精密化 #6）。
 *   equity_peak = max(HWM, 累積PnL)  /  DD = (peak − 累積PnL) / max(peak, ε)
 * HWM がまだゼロ（利益未達）の場合は、累積損失を maxDailyLoss×10 を分母に正規化する。
 */
function computeDrawdown(state: ArbitrageState): number {
  const cumulative = Number(state.cumulativePnlBtc);
  const peak = Math.max(Number(state.highWaterMarkBtc), cumulative);
  if (peak > 0) {
    return Math.max(0, Math.min(1, (peak - cumulative) / peak));
  }
  if (cumulative >= 0) return 0;
  const denom = Math.max(1e-8, Number(state.maxDailyLossBtc) * 10);
  return Math.min(1, -cumulative / denom);
}
