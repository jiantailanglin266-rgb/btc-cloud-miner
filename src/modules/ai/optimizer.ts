/**
 * AI Mining Optimizer — 運用最適化・監視・予測分析
 *
 * ★ 誤解を避けるための明記 ★
 *   ここでいう「AI」は、Bitcoin のマイニングアルゴリズムを置き換えるものではない。
 *   PoW の計算量を減らす方法は存在しない。
 *   このモジュールがやるのは「集めた運用データから異常と改善余地を見つけること」だけ。
 *
 * ★ なぜ MVP はルールベースなのか ★
 *   1. 説明可能性: 「なぜこの警告が出たか」を数値で示せる（顧客対応・監査で必須）
 *   2. データ量: 学習に足るデータは運用開始後にしか集まらない
 *   3. 誤検知コスト: 金銭に関わる領域では、根拠のない警告は信頼を損なう
 *
 *   十分な運用データが貯まった段階で、ML モデルを「補助」として追加する。
 *   その際も、本モジュールの出力形式（evidence 付き）は変えない。
 */

import type { AiInsight, WorkerSnapshot, DashboardSummary, Worker } from "@/types";
import type { WorkerWithReading } from "@/modules/mining/aggregate";
import { newId } from "@/lib/crypto";

/** 判定に使う閾値。すべて根拠を明記し、運用しながら調整する */
export const THRESHOLDS = {
  /** ワーカーが停止とみなす最終応答からの経過分数 */
  workerOfflineMinutes: 15,
  /** reject 率がこれを超えたら異常（通常は 0.5〜1%） */
  rejectRateWarning: 0.03,
  rejectRateCritical: 0.06,
  /** 温度（ASIC の一般的な上限は 80〜85℃） */
  temperatureWarning: 75,
  temperatureCritical: 85,
  /** 実効ハッシュレートが定格のこれを下回ったら劣化とみなす */
  hashrateDegradation: 0.85,
  /** Z スコアがこれを超えたら統計的な異常 */
  anomalyZScore: 2.5,
  /** 利益率がこれを下回ったら収益性警告 */
  profitMarginWarning: 0.15,
} as const;

// ---------------------------------------------------------------------------
// 統計ヘルパー
// ---------------------------------------------------------------------------

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Z スコア = (値 − 平均) / 標準偏差。「平均から何σ離れているか」 */
export function zScore(value: number, values: number[]): number {
  const sd = stdDev(values);
  if (sd === 0) return 0;
  return (value - mean(values)) / sd;
}

/** 最小二乗法による傾き（劣化トレンドの検出） */
export function linearTrend(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// ---------------------------------------------------------------------------
// 検知ルール
// ---------------------------------------------------------------------------

function insight(
  tenantId: string,
  kind: AiInsight["kind"],
  severity: AiInsight["severity"],
  title: string,
  detail: string,
  recommendation: string,
  target: { type: AiInsight["targetType"]; id: string },
  evidence: Record<string, number | string>,
): AiInsight {
  return {
    id: newId(),
    tenantId,
    kind,
    severity,
    title,
    detail,
    recommendation,
    targetType: target.type,
    targetId: target.id,
    evidence,
    createdAt: new Date().toISOString(),
  };
}

/** ワーカー単位の検知 */
export function analyzeWorkers(
  tenantId: string,
  entries: WorkerWithReading[],
  history: Map<string, WorkerSnapshot[]>,
  now = Date.now(),
): AiInsight[] {
  const out: AiInsight[] = [];

  for (const { worker, reading } of entries) {
    // --- 1. 停止検知 -------------------------------------------------------
    const lastSeenMs = worker.lastSeenAt ? new Date(worker.lastSeenAt).getTime() : 0;
    const offlineMinutes = (now - lastSeenMs) / 60_000;
    if (
      worker.status === "OFFLINE" ||
      (reading?.workerStatus === "OFFLINE") ||
      offlineMinutes > THRESHOLDS.workerOfflineMinutes
    ) {
      out.push(
        insight(
          tenantId,
          "WORKER_OFFLINE",
          "CRITICAL",
          `${worker.externalWorkerId} が停止しています`,
          `${worker.model}（定格 ${worker.ratedHashrateThs} TH/s）が ${Math.floor(offlineMinutes)} 分間応答していません。` +
            `この間の採掘収益は発生していません。`,
          "プロバイダーへ状況を確認し、復旧の見込みを問い合わせてください。SLA の稼働率保証がある場合は補償対象になる可能性があります。",
          { type: "worker", id: worker.id },
          {
            offlineMinutes: Math.floor(offlineMinutes),
            lostHashrateThs: worker.ratedHashrateThs,
          },
        ),
      );
      continue; // 停止中は他の指標を評価しない
    }

    if (!reading) continue;

    // --- 2. reject 率 ------------------------------------------------------
    const total = reading.acceptedShares + reading.rejectedShares;
    if (total > 1000) {
      const rejectRate = reading.rejectedShares / total;
      if (rejectRate >= THRESHOLDS.rejectRateWarning) {
        const critical = rejectRate >= THRESHOLDS.rejectRateCritical;
        out.push(
          insight(
            tenantId,
            "REJECT_RATE_HIGH",
            critical ? "CRITICAL" : "WARNING",
            `${worker.externalWorkerId} の reject 率が高い状態です`,
            `拒否された share の割合が ${(rejectRate * 100).toFixed(2)}% です（通常は 0.5〜1%）。` +
              `拒否された分は収益になりません。`,
            "ネットワーク遅延・プールとの接続品質・機器のオーバークロック設定を確認してください。別のプールへの切り替えも検討に値します。",
            { type: "worker", id: worker.id },
            {
              rejectRate: Number((rejectRate * 100).toFixed(2)),
              acceptedShares: reading.acceptedShares,
              rejectedShares: reading.rejectedShares,
            },
          ),
        );
      }
    }

    // --- 3. 温度 -----------------------------------------------------------
    if (reading.temperatureC !== null) {
      if (reading.temperatureC >= THRESHOLDS.temperatureWarning) {
        const critical = reading.temperatureC >= THRESHOLDS.temperatureCritical;
        out.push(
          insight(
            tenantId,
            "THERMAL_RISK",
            critical ? "CRITICAL" : "WARNING",
            `${worker.externalWorkerId} の温度が高い状態です`,
            `温度 ${reading.temperatureC}℃。高温が続くとサーマルスロットリングでハッシュレートが低下し、` +
              `長期的にはチップの寿命が縮みます。`,
            "冷却状況の確認をプロバイダーへ依頼してください。ハッシュレートが低下している場合は SLA の対象になり得ます。",
            { type: "worker", id: worker.id },
            { temperatureC: reading.temperatureC },
          ),
        );
      }
    }

    // --- 4. 定格からの乖離（性能劣化） -------------------------------------
    const ratio = reading.hashrateThs / Math.max(1, worker.ratedHashrateThs);
    if (ratio < THRESHOLDS.hashrateDegradation) {
      out.push(
        insight(
          tenantId,
          "EFFICIENCY_DEGRADATION",
          "WARNING",
          `${worker.externalWorkerId} の実効ハッシュレートが低下しています`,
          `定格 ${worker.ratedHashrateThs} TH/s に対して現在 ${reading.hashrateThs.toFixed(1)} TH/s（${(ratio * 100).toFixed(1)}%）です。`,
          "一時的な変動か継続的な劣化かを24時間の推移で確認してください。継続する場合は機器交換をプロバイダーへ要求できる可能性があります。",
          { type: "worker", id: worker.id },
          {
            ratedThs: worker.ratedHashrateThs,
            actualThs: Number(reading.hashrateThs.toFixed(2)),
            ratio: Number((ratio * 100).toFixed(1)),
          },
        ),
      );
    }

    // --- 5. 統計的異常（Z スコア） -----------------------------------------
    const past = history.get(worker.id);
    if (past && past.length >= 12) {
      const values = past.map((s) => s.hashrateThs);
      const z = zScore(reading.hashrateThs, values);
      if (Math.abs(z) >= THRESHOLDS.anomalyZScore) {
        out.push(
          insight(
            tenantId,
            "HASHRATE_ANOMALY",
            "WARNING",
            `${worker.externalWorkerId} のハッシュレートに統計的な異常があります`,
            `直近の実測値が、過去の分布から ${Math.abs(z).toFixed(1)}σ 離れています` +
              `（平均 ${mean(values).toFixed(1)} TH/s、標準偏差 ${stdDev(values).toFixed(2)}）。`,
            "機器の再起動・プール接続の切り替えが行われた可能性があります。プロバイダーの障害情報を確認してください。",
            { type: "worker", id: worker.id },
            {
              zScore: Number(z.toFixed(2)),
              meanThs: Number(mean(values).toFixed(2)),
              currentThs: Number(reading.hashrateThs.toFixed(2)),
            },
          ),
        );
      }

      // --- 6. メンテナンス予測（劣化トレンド） -----------------------------
      const slope = linearTrend(values);
      const perDay = slope * (values.length > 0 ? 288 : 0); // 5分足 288 点 = 1日
      if (perDay < -worker.ratedHashrateThs * 0.01) {
        out.push(
          insight(
            tenantId,
            "MAINTENANCE_FORECAST",
            "INFO",
            `${worker.externalWorkerId} に劣化傾向があります`,
            `直近の推移から、1日あたり約 ${Math.abs(perDay).toFixed(2)} TH/s のペースで低下しています。` +
              `このまま推移すると約 ${Math.ceil((reading.hashrateThs - worker.ratedHashrateThs * 0.85) / Math.abs(perDay))} 日で` +
              `定格の 85% を下回ります。`,
            "早めにプロバイダーへメンテナンスを依頼することで、収益低下を最小限に抑えられます。",
            { type: "worker", id: worker.id },
            { declinePerDayThs: Number(Math.abs(perDay).toFixed(3)) },
          ),
        );
      }
    }
  }

  return out;
}

/** ポートフォリオ全体の検知 */
export function analyzePortfolio(
  tenantId: string,
  summary: DashboardSummary,
): AiInsight[] {
  const out: AiInsight[] = [];

  // --- 収益性 --------------------------------------------------------------
  if (summary.revenue.profitMargin < THRESHOLDS.profitMarginWarning) {
    const negative = summary.revenue.netRevenueUsdPerDay < 0;
    out.push(
      insight(
        tenantId,
        "PROFITABILITY_WARNING",
        negative ? "CRITICAL" : "WARNING",
        negative ? "現在の条件では赤字です" : "利益率が低下しています",
        `推定利益率は ${(summary.revenue.profitMargin * 100).toFixed(1)}% です。` +
          `損益分岐となる BTC 価格は $${Math.round(summary.revenue.breakEvenBtcPriceUsd).toLocaleString()}、` +
          `電力単価は $${summary.revenue.breakEvenElectricityPriceKwh.toFixed(4)}/kWh です。`,
        negative
          ? "契約条件（電力単価・手数料）の見直し、またはより効率の高い機種への切り替えをプロバイダーと協議してください。"
          : "BTC 価格または難易度がさらに悪化すると赤字に転じます。損益分岐点を注視してください。",
        { type: "portfolio", id: "portfolio" },
        {
          profitMargin: Number((summary.revenue.profitMargin * 100).toFixed(1)),
          breakEvenBtcPrice: Math.round(summary.revenue.breakEvenBtcPriceUsd),
          currentBtcPrice: Math.round(summary.price.usd),
        },
      ),
    );
  }

  // --- 難易度トレンド ------------------------------------------------------
  if (Math.abs(summary.network.estimatedAdjustmentRate) >= 0.02) {
    const up = summary.network.estimatedAdjustmentRate > 0;
    out.push(
      insight(
        tenantId,
        "DIFFICULTY_TREND",
        up ? "WARNING" : "INFO",
        `次回の難易度調整は ${up ? "上昇" : "下降"}の見込みです`,
        `推定変化率 ${(summary.network.estimatedAdjustmentRate * 100).toFixed(1)}%、` +
          `残り ${summary.network.blocksUntilAdjustment} ブロック（約 ${Math.ceil((summary.network.blocksUntilAdjustment * 10) / 60)} 時間）です。` +
          `難易度が上がると、同じハッシュレートでの採掘量は反比例して減少します。`,
        up
          ? "推定収益が約 " +
            (summary.network.estimatedAdjustmentRate * 100).toFixed(1) +
            "% 減少する見込みです。シミュレーターで調整後の収益を確認してください。"
          : "推定収益はわずかに改善する見込みです。",
        { type: "portfolio", id: "portfolio" },
        {
          adjustmentRate: Number((summary.network.estimatedAdjustmentRate * 100).toFixed(2)),
          blocksRemaining: summary.network.blocksUntilAdjustment,
        },
      ),
    );
  }

  // --- 稼働率 --------------------------------------------------------------
  if (summary.totalMiners > 0 && summary.offlineMiners / summary.totalMiners > 0.05) {
    out.push(
      insight(
        tenantId,
        "WORKER_OFFLINE",
        "WARNING",
        `${summary.offlineMiners} 台のワーカーが停止しています`,
        `全 ${summary.totalMiners} 台中 ${summary.offlineMiners} 台（${((summary.offlineMiners / summary.totalMiners) * 100).toFixed(1)}%）が停止しています。` +
          `契約ハッシュレート ${summary.purchasedHashrateThs} TH/s に対し、実効値は ${summary.currentHashrateThs.toFixed(1)} TH/s です。`,
        "SLA の稼働率保証を確認し、下回っている場合はプロバイダーへ補償を請求してください。",
        { type: "portfolio", id: "portfolio" },
        {
          offlineMiners: summary.offlineMiners,
          totalMiners: summary.totalMiners,
          contractedThs: summary.purchasedHashrateThs,
          actualThs: Number(summary.currentHashrateThs.toFixed(2)),
        },
      ),
    );
  }

  // --- プロバイダー障害 ----------------------------------------------------
  for (const p of summary.providerStatuses) {
    if (p.status === "OFFLINE" || p.status === "DEGRADED") {
      out.push(
        insight(
          tenantId,
          "HASHRATE_ANOMALY",
          p.status === "OFFLINE" ? "CRITICAL" : "WARNING",
          `プロバイダー「${p.name}」が ${p.status} です`,
          p.message ?? "統計の取得に問題が発生しています。",
          "この間の統計は最終取得値のままです。採掘自体は継続している可能性がありますが、状況をプロバイダーへ確認してください。",
          { type: "provider", id: p.providerId },
          { consecutiveFailures: p.consecutiveFailures, status: p.status },
        ),
      );
    }
  }

  return out;
}

/** 重要度順に並べる（画面表示用） */
export function sortInsights(insights: AiInsight[]): AiInsight[] {
  const order: Record<AiInsight["severity"], number> = {
    CRITICAL: 0,
    WARNING: 1,
    INFO: 2,
  };
  return [...insights].sort(
    (a, b) => order[a.severity] - order[b.severity] || b.createdAt.localeCompare(a.createdAt),
  );
}

export type { Worker };
