"use client";

/**
 * 収益シミュレーター（クライアント側）
 *
 * ★ サーバーと同じ計算エンジン（modules/revenue/engine.ts）を import している。
 *   engine.ts は純関数で外部依存が無いため、ブラウザでもそのまま動く。
 *   これにより「画面の数値とサーバーの数値がずれる」事故が構造的に起きない。
 */

import { useMemo, useState } from "react";
import {
  calculateRevenue,
  calculateSensitivity,
  projectRevenueOverTime,
} from "@/modules/revenue/engine";
import type { RevenueInput } from "@/types";
import { Card, CardTitle, EstimateChip, KeyValue } from "@/components/ui";
import { LineChart } from "@/components/charts/LineChart";
import { formatUsd, formatPercent, formatHashrate, formatCompact } from "@/lib/format";

type Defaults = RevenueInput & { upfrontCostUsd: number };

export function SimulatorClient({
  defaults,
  networkSource,
}: {
  defaults: Defaults;
  networkSource: string;
}) {
  const [input, setInput] = useState<Defaults>(defaults);

  const patch = (p: Partial<Defaults>) => setInput((prev) => ({ ...prev, ...p }));

  const result = useMemo(() => calculateRevenue(input), [input]);
  const sensitivity = useMemo(() => calculateSensitivity(input), [input]);
  const projection = useMemo(
    () => projectRevenueOverTime(input, 365, 0.015),
    [input],
  );

  const projectionPoints = projection
    .filter((_, i) => i % 7 === 0)
    .map((p) => ({
      t: new Date(Date.now() + p.day * 86_400_000).toISOString(),
      v: Math.round(p.cumulativeNetUsd),
    }));

  const profitable = result.netRevenueUsdPerDay > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
      {/* 入力 */}
      <Card>
        <CardTitle hint={`ネットワーク値の取得元: ${networkSource}`}>条件</CardTitle>

        <div className="space-y-4">
          <Slider
            label="Hashrate"
            value={input.hashrateThs}
            min={1}
            max={20000}
            step={1}
            display={formatHashrate(input.hashrateThs, 0)}
            onChange={(v) => patch({ hashrateThs: v })}
          />
          <Slider
            label="ASIC 効率"
            value={input.efficiencyJPerTh}
            min={10}
            max={60}
            step={0.5}
            display={`${input.efficiencyJPerTh.toFixed(1)} J/TH`}
            hint="値が小さいほど省電力。最新の水冷 ASIC で 15〜17 J/TH 程度"
            onChange={(v) => patch({ efficiencyJPerTh: v })}
          />
          <Slider
            label="電力単価"
            value={input.electricityPriceKwh}
            min={0}
            max={0.3}
            step={0.005}
            display={`$${input.electricityPriceKwh.toFixed(3)} / kWh`}
            onChange={(v) => patch({ electricityPriceKwh: v })}
          />
          <Slider
            label="BTC 価格"
            value={input.btcPriceUsd}
            min={5000}
            max={300000}
            step={1000}
            display={formatUsd(input.btcPriceUsd, 0)}
            onChange={(v) => patch({ btcPriceUsd: v })}
          />
          <Slider
            label="ネットワーク難易度"
            value={input.difficulty}
            min={defaults.difficulty * 0.5}
            max={defaults.difficulty * 3}
            step={defaults.difficulty * 0.01}
            display={formatCompact(input.difficulty)}
            hint="難易度が上がると、同じハッシュレートでの採掘量は反比例して減る"
            onChange={(v) =>
              patch({
                difficulty: v,
                networkHashrateThs: (v * 2 ** 32) / 600 / 1e12,
              })
            }
          />
          <Slider
            label="プール手数料"
            value={input.poolFeeRate}
            min={0}
            max={0.1}
            step={0.001}
            display={formatPercent(input.poolFeeRate, 2)}
            onChange={(v) => patch({ poolFeeRate: v })}
          />
          <Slider
            label="プラットフォーム手数料"
            value={input.platformFeeRate}
            min={0}
            max={0.1}
            step={0.001}
            display={formatPercent(input.platformFeeRate, 2)}
            onChange={(v) => patch({ platformFeeRate: v })}
          />
          <Slider
            label="稼働率"
            value={input.uptimeRate}
            min={0.5}
            max={1}
            step={0.005}
            display={formatPercent(input.uptimeRate, 1)}
            onChange={(v) => patch({ uptimeRate: v })}
          />

          <div>
            <label className="mb-1.5 block text-xs text-ink-muted">
              初期費用（契約金額）
            </label>
            <input
              type="number"
              min={0}
              max={100000000}
              value={input.upfrontCostUsd}
              onChange={(e) =>
                patch({ upfrontCostUsd: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </div>

          <button
            type="button"
            onClick={() => setInput(defaults)}
            className="w-full rounded-xl border border-line-strong bg-white/5 px-4 py-2 text-xs text-ink-muted hover:text-ink"
          >
            初期値に戻す
          </button>
        </div>
      </Card>

      {/* 結果 */}
      <div className="space-y-4">
        <Card>
          <CardTitle action={<EstimateChip />}>推定結果</CardTitle>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label="Est. BTC / Day" value={result.estimatedBtcPerDay.toFixed(8)} />
            <Figure label="Est. BTC / Month" value={result.estimatedBtcPerMonth.toFixed(8)} />
            <Figure label="Est. BTC / Year" value={result.estimatedBtcPerYear.toFixed(8)} />
          </div>

          <div className="mt-4 divide-y divide-line border-t border-line pt-2">
            <KeyValue
              label="Gross Revenue / 日"
              value={formatUsd(result.grossRevenueUsdPerDay)}
            />
            <KeyValue
              label="− 電力コスト"
              value={`-${formatUsd(result.electricityCostUsdPerDay)}`}
              tone="neg"
            />
            <KeyValue
              label={`− プール手数料 (${formatPercent(input.poolFeeRate, 1)})`}
              value={`-${formatUsd(result.poolFeeUsdPerDay)}`}
              tone="neg"
            />
            <KeyValue
              label={`− プラットフォーム手数料 (${formatPercent(input.platformFeeRate, 1)})`}
              value={`-${formatUsd(result.platformFeeUsdPerDay)}`}
              tone="neg"
            />
            <KeyValue
              label="= Net Revenue / 日"
              value={formatUsd(result.netRevenueUsdPerDay)}
              tone={profitable ? "pos" : "neg"}
            />
            <KeyValue
              label="Net Revenue / 月"
              value={formatUsd(result.netRevenueUsdPerMonth)}
              tone={profitable ? "pos" : "neg"}
            />
            <KeyValue label="利益率" value={formatPercent(result.profitMargin)} />
            <KeyValue
              label="消費電力"
              value={`${result.powerConsumptionKw.toFixed(2)} kW（${(result.powerConsumptionKw * 24).toFixed(1)} kWh/日）`}
            />
          </div>

          <div className="mt-4 grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
            <Figure
              label="損益分岐 BTC 価格"
              value={formatUsd(result.breakEvenBtcPriceUsd, 0)}
              tone={input.btcPriceUsd > result.breakEvenBtcPriceUsd ? "pos" : "neg"}
            />
            <Figure
              label="損益分岐 電力単価"
              value={`$${result.breakEvenElectricityPriceKwh.toFixed(4)}`}
              tone={
                input.electricityPriceKwh < result.breakEvenElectricityPriceKwh
                  ? "pos"
                  : "neg"
              }
            />
            <Figure
              label="初期費用の回収"
              value={
                result.roiDays === null
                  ? "回収不能"
                  : `${Math.ceil(result.roiDays).toLocaleString()} 日`
              }
              tone={result.roiDays !== null && result.roiDays <= 365 ? "pos" : "neg"}
            />
          </div>

          {!profitable && (
            <div className="mt-3 rounded-xl border border-neg/40 bg-neg/10 p-3 text-xs leading-relaxed text-neg">
              現在の条件では<strong>赤字</strong>です。電力コストと手数料の合計が、採掘できる BTC
              の価値を上回っています。
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
            {result.disclaimer}
          </p>
        </Card>

        {/* 感度分析 */}
        <Card>
          <CardTitle hint="条件が悪化した場合にどうなるかを必ず確認してください">
            感度分析
          </CardTitle>
          <div className="grid gap-4 sm:grid-cols-3">
            <SensitivityTable title="BTC 価格" points={sensitivity.btcPrice} />
            <SensitivityTable title="ネットワーク難易度" points={sensitivity.difficulty} />
            <SensitivityTable title="電力単価" points={sensitivity.electricityPrice} />
          </div>
        </Card>

        {/* 累積推移 */}
        <Card>
          <CardTitle hint="難易度が 2 週間ごとに +1.5% 上昇すると仮定した場合の累積純収益（推定）">
            1年間の累積純収益（推定）
          </CardTitle>
          <LineChart
            points={projectionPoints}
            unit="USD"
            color={profitable ? "pos" : "brand"}
            caption="1年間の累積純収益の推定推移（USD）"
            height={200}
            formatValue={(v) => formatUsd(v, 0)}
          />
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
            <span>
              1年後の累積: {formatUsd(projection[projection.length - 1]?.cumulativeNetUsd ?? 0, 0)}
            </span>
            <span>
              初期費用: {formatUsd(input.upfrontCostUsd, 0)}
            </span>
            <span
              className={
                (projection[projection.length - 1]?.cumulativeNetUsd ?? 0) >
                input.upfrontCostUsd
                  ? "text-pos"
                  : "text-neg"
              }
            >
              差引:{" "}
              {formatUsd(
                (projection[projection.length - 1]?.cumulativeNetUsd ?? 0) -
                  input.upfrontCostUsd,
                0,
              )}
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-xs text-ink-muted">{label}</label>
        <span className="text-xs font-medium text-ink">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      {hint && <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">{hint}</p>}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div>
      <div className="text-[11px] text-ink-dim">{label}</div>
      <div
        className={`mt-0.5 text-base font-medium ${
          tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SensitivityTable({
  title,
  points,
}: {
  title: string;
  points: Array<{ label: string; netRevenueUsdPerDay: number; profitMargin: number }>;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs text-ink-muted">{title}</h3>
      <div className="space-y-1">
        {points.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-ink-dim">{p.label}</span>
            <span className={p.netRevenueUsdPerDay >= 0 ? "text-pos" : "text-neg"}>
              {formatUsd(p.netRevenueUsdPerDay)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
