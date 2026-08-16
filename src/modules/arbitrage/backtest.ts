/**
 * Backtesting（フェーズ21・22・34）
 *
 * 戦略:
 *   A. BTC Buy & Hold        … 開始時に全額 BTC 化して保有
 *   B. NiceHash Always-On    … 常時ハッシュパワー購入
 *   C. Threshold Strategy    … マージン閾値 + Hysteresis で ON/OFF
 *   D. Dynamic Optimized     … C + マージン比例のポジションサイジング + adaptive margin
 *
 * データ:
 *   store の MarketSample を時系列で使用する。実サンプルが不足している場合は
 *   決定的な FIXTURE データ（sourceMode=FIXTURE）を生成して補う。
 *   ★ FIXTURE は合成データであり実市場ではない。結果画面に必ず明示する。
 *
 * ★ これは分析であり会計ではない（float 使用可・Ledger に触れない・利益保証ではない）。
 */

import type { MarketSample } from "@/types";
import { getStore } from "@/lib/store";
import { grossBtcPerThDay } from "./engine";
import { adaptiveSafetyMargin } from "./decision";
import { priceFactorDayToBtcPerThDay } from "@/modules/hashpower/units";
import { config } from "@/lib/config";

export type StrategyKey = "buyHold" | "alwaysOn" | "threshold" | "dynamic";

export type EquityPoint = { t: string; equityJpy: number };

export type StrategyResult = {
  strategy: StrategyKey;
  capitalJpy: number;
  finalEquityJpy: number;
  netProfitJpy: number;
  roiRate: number;
  btcMined: number;
  nicehashCostBtc: number;
  maxDrawdownRate: number;
  winRate: number;
  profitableHoursRate: number;
  orders: number;
  averageMarginRate: number;
  equityCurve: EquityPoint[];
};

export type BacktestReport = {
  fromIso: string;
  toIso: string;
  samples: number;
  /** FIXTURE を含むか（合成データ注記の表示用） */
  containsFixture: boolean;
  capitalScenariosJpy: number[];
  results: StrategyResult[];
  generatedAt: string;
};

const MARKET_FACTOR = 1e15; // SHA256ASICBOOST は PH 基準

// ---------------------------------------------------------------------------
// FIXTURE データ生成（決定的・実データではない）
// ---------------------------------------------------------------------------

function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 1時間刻みの合成サンプル。BTC価格はランダムウォーク・難易度は上昇ドリフト */
export function generateFixtureSamples(fromMs: number, toMs: number): MarketSample[] {
  const out: MarketSample[] = [];
  let price = 85_000;
  let difficulty = 110e12;
  const stepMs = 3600_000;

  for (let t = fromMs, i = 0; t <= toMs; t += stepMs, i++) {
    // 価格: 平均回帰つきランダムウォーク（±1.2%/h）
    const shock = (hash01(`px:${i}`) - 0.5) * 0.024;
    const meanRevert = (90_000 - price) / 90_000 * 0.002;
    price = Math.max(20_000, price * (1 + shock + meanRevert));

    // 難易度: 2週間ごとに +1.2%（決定的）
    if (i > 0 && i % (14 * 24) === 0) difficulty *= 1.012;

    // NiceHash 価格: 「その時点の理論収益密度」の 70%〜118% を周期変動
    //（低い期間に閾値戦略が ON になり、高い期間に OFF になる）
    const revPerThDay =
      grossBtcPerThDay(difficulty, 3.125, 0.06) * 0.97 * (1 - 0.02);
    const cycle =
      0.70 + 0.45 * (0.5 + 0.5 * Math.sin(i / 37)) + (hash01(`nh:${i}`) - 0.5) * 0.06;
    const nhPricePerFactorDay = revPerThDay * cycle * (MARKET_FACTOR / 1e12);

    out.push({
      id: `fx-${new Date(t).toISOString().slice(0, 13)}`,
      at: new Date(t).toISOString(),
      btcPriceUsd: Math.round(price),
      usdJpy: 150 + 8 * Math.sin(i / 200),
      difficulty,
      networkHashrateThs: (difficulty * 2 ** 32) / 600 / 1e12,
      blockSubsidyBtc: 3.125,
      avgTxFeesBtcPerBlock: 0.04 + 0.04 * hash01(`fee:${i}`),
      nicehashPriceBtcPerFactorDay: nhPricePerFactorDay,
      nicehashAvailableFactor: 20 + 10 * hash01(`avail:${i}`),
      poolEfficiency: 0.97,
      sourceMode: "FIXTURE",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// バックテスト本体
// ---------------------------------------------------------------------------

type SimState = {
  cashBtc: number;
  minedBtc: number;
  spentBtc: number;
  wins: number;
  losses: number;
  profitableHours: number;
  totalHours: number;
  orders: number;
  inPosition: boolean;
  marginSum: number;
  marginCount: number;
  peakEquityJpy: number;
  maxDrawdown: number;
  forecastErrorEma: number;
};

function newSim(capitalBtc: number): SimState {
  return {
    cashBtc: capitalBtc, minedBtc: 0, spentBtc: 0, wins: 0, losses: 0,
    profitableHours: 0, totalHours: 0, orders: 0, inPosition: false,
    marginSum: 0, marginCount: 0, peakEquityJpy: 0, maxDrawdown: 0,
    forecastErrorEma: 0.1,
  };
}

export async function runBacktest(params: {
  fromMs: number;
  toMs: number;
  capitalScenariosJpy?: number[];
}): Promise<BacktestReport> {
  const store = await getStore();
  const capitalScenarios = params.capitalScenariosJpy ?? [1_000_000, 5_000_000, 10_000_000];

  // 実サンプルを取得し、期間の 8 割を覆っていなければ FIXTURE で置き換える
  let samples = await store.listMarketSamples(params.fromMs);
  samples = samples.filter((s) => new Date(s.at).getTime() <= params.toMs);
  const expectedHours = Math.floor((params.toMs - params.fromMs) / 3600_000);
  let containsFixture = false;
  if (samples.length < expectedHours * 0.8) {
    samples = generateFixtureSamples(params.fromMs, params.toMs);
    containsFixture = true;
  } else {
    containsFixture = samples.some((s) => s.sourceMode !== "LIVE_API");
  }

  const results: StrategyResult[] = [];
  const strategies: StrategyKey[] = ["buyHold", "alwaysOn", "threshold", "dynamic"];

  for (const capitalJpy of capitalScenarios) {
    for (const strategy of strategies) {
      results.push(simulate(strategy, capitalJpy, samples));
    }
  }

  return {
    fromIso: new Date(params.fromMs).toISOString(),
    toIso: new Date(params.toMs).toISOString(),
    samples: samples.length,
    containsFixture,
    capitalScenariosJpy: capitalScenarios,
    results,
    generatedAt: new Date().toISOString(),
  };
}

function simulate(
  strategy: StrategyKey,
  capitalJpy: number,
  samples: MarketSample[],
): StrategyResult {
  if (samples.length === 0) {
    return emptyResult(strategy, capitalJpy);
  }
  const first = samples[0];
  const jpyPerBtc0 = first.btcPriceUsd * first.usdJpy;
  const capitalBtc = capitalJpy / jpyPerBtc0;

  const sim = newSim(capitalBtc);
  const curve: EquityPoint[] = [];
  const sampleEvery = Math.max(1, Math.floor(samples.length / 200));

  // 資金の 1/720 を1時間の支出上限とする（30日で資金一巡＝全資金一括投入の禁止）
  const hourlyBudgetBtc = capitalBtc / 720;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sim.totalHours++;

    if (strategy !== "buyHold") {
      const safety =
        strategy === "dynamic" ? adaptiveSafetyMargin(sim.forecastErrorEma) : 0.10;
      const revPerThDay =
        grossBtcPerThDay(s.difficulty, s.blockSubsidyBtc, s.avgTxFeesBtcPerBlock) *
        s.poolEfficiency *
        (1 - config.fees.poolFeeRate) *
        (1 - 0.01) *
        (1 - safety);
      const costPerThDay =
        priceFactorDayToBtcPerThDay(s.nicehashPriceBtcPerFactorDay, MARKET_FACTOR) *
        (1 + config.nicehash.marketFeeRate);
      const margin = costPerThDay > 0 ? (revPerThDay - costPerThDay) / costPerThDay : -1;
      sim.marginSum += margin;
      sim.marginCount++;

      // ON/OFF 判定
      let active: boolean;
      let sizeFraction = 1;
      switch (strategy) {
        case "alwaysOn":
          active = true;
          break;
        case "threshold":
          active = sim.inPosition ? margin > 0.03 : margin >= 0.08; // Hysteresis
          break;
        case "dynamic":
          active = sim.inPosition ? margin > 0.03 : margin >= 0.08;
          // マージン比例サイズ（8%→0.5x、20%以上→1.0x）
          sizeFraction = Math.max(0.5, Math.min(1, 0.5 + (margin - 0.08) / 0.24));
          break;
        default:
          active = false;
      }
      if (active && !sim.inPosition) sim.orders++;
      sim.inPosition = active;

      if (active && sim.cashBtc > 0) {
        const spend = Math.min(hourlyBudgetBtc * sizeFraction, sim.cashBtc);
        const ths = spend / (costPerThDay / 24); // この支出で1時間買えるTH/s
        // 実採掘は「素の期待値」（安全マージンは判定にのみ使い、実現値には使わない）
        const minedRaw =
          (grossBtcPerThDay(s.difficulty, s.blockSubsidyBtc, s.avgTxFeesBtcPerBlock) *
            s.poolEfficiency *
            (1 - config.fees.poolFeeRate) *
            (1 - 0.01) *
            ths) /
          24;
        sim.cashBtc -= spend;
        sim.spentBtc += spend;
        sim.cashBtc += minedRaw;
        sim.minedBtc += minedRaw;

        const hourPnl = minedRaw - spend;
        if (hourPnl > 0) {
          sim.wins++;
          sim.profitableHours++;
        } else {
          sim.losses++;
        }
        // 予測誤差 EMA 更新（期待(マージン込) vs 実現の乖離）
        const expected = (revPerThDay * ths) / 24;
        const err = expected > 0 ? Math.abs(minedRaw - expected) / expected : 0;
        sim.forecastErrorEma = sim.forecastErrorEma * 0.95 + Math.min(1, err) * 0.05;
      }
    }

    // Equity 評価（JPY）
    const jpyPerBtc = s.btcPriceUsd * s.usdJpy;
    const equityJpy = sim.cashBtc * jpyPerBtc + (strategy === "buyHold" ? 0 : 0);
    const equity = strategy === "buyHold" ? capitalBtc * jpyPerBtc : equityJpy;
    sim.peakEquityJpy = Math.max(sim.peakEquityJpy, equity);
    if (sim.peakEquityJpy > 0) {
      sim.maxDrawdown = Math.max(
        sim.maxDrawdown,
        (sim.peakEquityJpy - equity) / sim.peakEquityJpy,
      );
    }
    if (i % sampleEvery === 0 || i === samples.length - 1) {
      curve.push({ t: s.at, equityJpy: Math.round(equity) });
    }
  }

  const last = samples[samples.length - 1];
  const finalJpyPerBtc = last.btcPriceUsd * last.usdJpy;
  const finalEquityJpy =
    strategy === "buyHold" ? capitalBtc * finalJpyPerBtc : sim.cashBtc * finalJpyPerBtc;

  const decided = sim.wins + sim.losses;
  return {
    strategy,
    capitalJpy,
    finalEquityJpy: Math.round(finalEquityJpy),
    netProfitJpy: Math.round(finalEquityJpy - capitalJpy),
    roiRate: capitalJpy > 0 ? (finalEquityJpy - capitalJpy) / capitalJpy : 0,
    btcMined: round8(sim.minedBtc),
    nicehashCostBtc: round8(sim.spentBtc),
    maxDrawdownRate: Math.round(sim.maxDrawdown * 1000) / 1000,
    winRate: decided > 0 ? Math.round((sim.wins / decided) * 1000) / 1000 : 0,
    profitableHoursRate:
      sim.totalHours > 0 ? Math.round((sim.profitableHours / sim.totalHours) * 1000) / 1000 : 0,
    orders: sim.orders,
    averageMarginRate:
      sim.marginCount > 0 ? Math.round((sim.marginSum / sim.marginCount) * 1000) / 1000 : 0,
    equityCurve: curve,
  };
}

function emptyResult(strategy: StrategyKey, capitalJpy: number): StrategyResult {
  return {
    strategy, capitalJpy, finalEquityJpy: capitalJpy, netProfitJpy: 0, roiRate: 0,
    btcMined: 0, nicehashCostBtc: 0, maxDrawdownRate: 0, winRate: 0,
    profitableHoursRate: 0, orders: 0, averageMarginRate: 0, equityCurve: [],
  };
}

function round8(v: number): number {
  return Math.round(v * 1e8) / 1e8;
}
