import Link from "next/link";
import { requireSession } from "@/modules/auth/session";
import { buildDashboardSummary, buildSeries, getWorkersForUser } from "@/modules/mining/aggregate";
import { analyzeWorkers, analyzePortfolio, sortInsights } from "@/modules/ai/optimizer";
import { isMockData, nextHalving } from "@/modules/bitcoin/service";
import {
  Badge,
  Card,
  CardTitle,
  DemoNotice,
  EstimateChip,
  KeyValue,
  PageHeader,
  Stat,
  StaleNotice,
  statusTone,
} from "@/components/ui";
import { LineChart, BreakdownBar } from "@/components/charts/LineChart";
import { RangeSwitch } from "./RangeSwitch";
import { LiveTicker } from "./LiveTicker";
import {
  formatHashrate,
  formatUsd,
  formatPercent,
  formatCompact,
  formatRelative,
  statusLabel,
} from "@/lib/format";
import type { SeriesRange } from "@/types";

export const metadata = { title: "ダッシュボード" };
export const dynamic = "force-dynamic";

export default async function DashboardPage(props: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await props.searchParams;
  const range: SeriesRange = (
    ["1h", "24h", "7d", "30d", "90d", "1y"] as const
  ).includes(rawRange as SeriesRange)
    ? (rawRange as SeriesRange)
    : "24h";

  const ctx = await requireSession();
  const tenantId = ctx.tenant.id;
  const userId = ctx.user.id;

  // Server Component から lib/store・modules を直接呼ぶ（自分の API を fetch しない）
  const [summary, series, entries] = await Promise.all([
    buildDashboardSummary(tenantId, userId),
    buildSeries(tenantId, userId, "hashrate", range),
    getWorkersForUser(tenantId, userId),
  ]);

  const insights = sortInsights([
    ...analyzeWorkers(tenantId, entries, new Map()),
    ...analyzePortfolio(tenantId, summary),
  ]).slice(0, 4);

  const rev = summary.revenue;
  const halving = nextHalving(summary.network);
  const demoData = isMockData(summary.network.freshness) || series.synthesized;

  return (
    <>
      <PageHeader
        title="ダッシュボード"
        description="契約中のハッシュレートの稼働状況と推定収益"
        action={<RangeSwitch current={range} />}
      />

      {demoData && (
        <div className="mb-4">
          <DemoNotice>
            表示中のマイニング統計は動作確認用の擬似データです（実際の ASIC 設備には接続していません）。
            {series.synthesized &&
              "グラフの履歴は、蓄積データが不足しているため決定的な生成関数から合成しています。"}
          </DemoNotice>
        </div>
      )}

      {summary.network.freshness.stale && (
        <div className="mb-4">
          <StaleNotice
            ageSec={summary.network.freshness.ageSec}
            source={summary.network.freshness.source}
          />
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Current Hashrate"
          value={formatHashrate(summary.currentHashrateThs)}
          sub={
            summary.purchasedHashrateThs > 0
              ? `契約量の ${formatPercent(summary.currentHashrateThs / summary.purchasedHashrateThs)}`
              : "契約なし"
          }
          tone="brand"
        />
        <Stat
          label="Average Hashrate (24h)"
          value={formatHashrate(summary.averageHashrateThs)}
          sub={`稼働率 ${formatPercent(summary.uptimeRate)}`}
        />
        <Stat
          label="Purchased / Allocated"
          value={formatHashrate(summary.purchasedHashrateThs, 0)}
          sub={`割当 ${formatHashrate(summary.allocatedHashrateThs, 0)}`}
        />
        <Stat
          label="Active / Offline Miners"
          value={`${summary.activeMiners} / ${summary.offlineMiners}`}
          sub={`全 ${summary.totalMiners} 台`}
          tone={summary.offlineMiners > 0 ? "neg" : "pos"}
        />
      </div>

      {/* グラフ + ネットワーク */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle hint={`期間: ${range}`}>ハッシュレート推移</CardTitle>
          <LineChart
            points={series.points}
            unit="TH/s"
            caption={`直近 ${range} のハッシュレート推移（TH/s）`}
            height={220}
            formatValue={(v) => `${v.toFixed(2)} TH/s`}
          />
        </Card>

        <Card>
          <CardTitle hint={`取得元: ${summary.network.freshness.source}`}>
            Bitcoin ネットワーク
          </CardTitle>
          <div className="divide-y divide-line">
            <KeyValue label="Difficulty" value={formatCompact(summary.network.difficulty)} />
            <KeyValue
              label="Network Hashrate"
              value={formatHashrate(summary.network.networkHashrateThs, 1)}
            />
            <KeyValue
              label="Block Height"
              value={summary.network.blockHeight.toLocaleString()}
            />
            <KeyValue
              label="Block Reward"
              value={`${summary.network.blockRewardBtc} BTC`}
            />
            <KeyValue
              label="次回難易度調整"
              value={`${summary.network.blocksUntilAdjustment.toLocaleString()} ブロック後（${formatPercent(summary.network.estimatedAdjustmentRate, 2)}）`}
            />
            <KeyValue
              label="BTC Price"
              value={formatUsd(summary.price.usd, 0)}
              tone={summary.price.change24hRate >= 0 ? "pos" : "neg"}
            />
            <KeyValue
              label="次回半減期"
              value={`${halving.blocksRemaining.toLocaleString()} ブロック後 → ${halving.nextRewardBtc} BTC`}
              tone="muted"
            />
          </div>
        </Card>
      </div>

      {/* 収益 */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle
            hint="ネットワーク難易度・BTC価格・稼働率から算出した推定値です。収益を保証するものではありません。"
            action={<EstimateChip />}
          >
            推定収益（1日あたり）
          </CardTitle>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniFigure
              label="Est. BTC / Day"
              value={rev.estimatedBtcPerDay.toFixed(8)}
              sub={formatUsd(rev.grossRevenueUsdPerDay)}
            />
            <MiniFigure
              label="Est. BTC / Month"
              value={rev.estimatedBtcPerMonth.toFixed(8)}
              sub={formatUsd(rev.grossRevenueUsdPerDay * 30)}
            />
            <MiniFigure
              label="Net Revenue / Day"
              value={formatUsd(rev.netRevenueUsdPerDay)}
              sub={`利益率 ${formatPercent(rev.profitMargin)}`}
              tone={rev.netRevenueUsdPerDay >= 0 ? "pos" : "neg"}
            />
            <MiniFigure
              label="Mining Efficiency"
              value={`${summary.efficiencyJPerTh.toFixed(1)} J/TH`}
              sub={`${rev.powerConsumptionKw.toFixed(2)} kW`}
            />
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <BreakdownBar
              segments={[
                {
                  label: `純収益 ${formatUsd(Math.max(0, rev.netRevenueUsdPerDay))}`,
                  value: Math.max(0, rev.netRevenueUsdPerDay),
                  color: "var(--pos)",
                },
                {
                  label: `電力 ${formatUsd(rev.electricityCostUsdPerDay)}`,
                  value: rev.electricityCostUsdPerDay,
                  color: "var(--warn)",
                },
                {
                  label: `プール手数料 ${formatUsd(rev.poolFeeUsdPerDay)}`,
                  value: rev.poolFeeUsdPerDay,
                  color: "var(--brand-accent)",
                },
                {
                  label: `プラットフォーム手数料 ${formatUsd(rev.platformFeeUsdPerDay)}`,
                  value: rev.platformFeeUsdPerDay,
                  color: "var(--ink-dim)",
                },
              ]}
            />
          </div>

          <div className="mt-4 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
            <KeyValue
              label="損益分岐 BTC 価格"
              value={formatUsd(rev.breakEvenBtcPriceUsd, 0)}
              tone={summary.price.usd > rev.breakEvenBtcPriceUsd ? "pos" : "neg"}
            />
            <KeyValue
              label="損益分岐 電力単価"
              value={`$${rev.breakEvenElectricityPriceKwh.toFixed(4)} / kWh`}
            />
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">{rev.disclaimer}</p>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardTitle>設備の稼働状況</CardTitle>
            <div className="space-y-2">
              {summary.providerStatuses.map((p) => (
                <div key={p.providerId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{p.name}</div>
                    <div className="text-[11px] text-ink-dim">
                      {p.lastOkAt ? `最終取得 ${formatRelative(p.lastOkAt)}` : "未取得"}
                      {p.latencyMs !== null && ` · ${p.latencyMs}ms`}
                    </div>
                  </div>
                  <Badge tone={statusTone(p.status)} dot>
                    {statusLabel(p.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle hint="accepted / rejected">Shares</CardTitle>
            <KeyValue label="Accepted" value={summary.acceptedShares.toLocaleString()} />
            <KeyValue label="Rejected" value={summary.rejectedShares.toLocaleString()} />
            <KeyValue
              label="Reject Rate"
              value={formatPercent(summary.rejectRate, 2)}
              tone={summary.rejectRate > 0.03 ? "neg" : "pos"}
            />
          </Card>

          <LiveTicker initialHashrateThs={summary.currentHashrateThs} />
        </div>
      </div>

      {/* AI インサイト */}
      {insights.length > 0 && (
        <Card className="mt-4">
          <CardTitle
            hint="ルールベースの異常検知。判断根拠の数値を併記しています"
            action={
              <Link href="/mining/workers" className="text-xs text-accent hover:underline">
                ワーカー一覧 →
              </Link>
            }
          >
            AI インサイト
          </CardTitle>
          <div className="space-y-2">
            {insights.map((i) => (
              <div
                key={i.id}
                className={`rounded-xl border px-3 py-2.5 ${
                  i.severity === "CRITICAL"
                    ? "border-neg/40 bg-neg/10"
                    : i.severity === "WARNING"
                      ? "border-warn/40 bg-warn/10"
                      : "border-line bg-white/2"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      i.severity === "CRITICAL"
                        ? "offline"
                        : i.severity === "WARNING"
                          ? "degraded"
                          : "neutral"
                    }
                  >
                    {i.severity}
                  </Badge>
                  <span className="text-sm font-medium">{i.title}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{i.detail}</p>
                <p className="mt-1 text-xs leading-relaxed text-accent">→ {i.recommendation}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function MiniFigure({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
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
      <div className="text-[11px] text-ink-muted">{sub}</div>
    </div>
  );
}
