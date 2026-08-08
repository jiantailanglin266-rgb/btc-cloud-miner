import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { buildDashboardSummary } from "@/modules/mining/aggregate";
import {
  Card,
  CardTitle,
  EmptyState,
  EstimateChip,
  KeyValue,
  PageHeader,
  Stat,
} from "@/components/ui";
import { LineChart } from "@/components/charts/LineChart";
import { formatUsd, formatPercent, formatDate } from "@/lib/format";
import { addBtc } from "@/lib/decimal";

export const metadata = { title: "収益" };
export const dynamic = "force-dynamic";

export default async function RevenuePage() {
  const ctx = await requireSession();
  const store = await getStore();

  const [summary, earnings] = await Promise.all([
    buildDashboardSummary(ctx.tenant.id, ctx.user.id),
    store.listEarnings(ctx.tenant.id, ctx.user.id, Date.now() - 90 * 86_400_000),
  ]);

  const rev = summary.revenue;
  const sorted = [...earnings].sort((a, b) => a.earnedAt.localeCompare(b.earnedAt));

  const totalNet = sorted.reduce((acc, e) => addBtc(acc, e.netBtc), "0.00000000");
  const totalGross = sorted.reduce((acc, e) => addBtc(acc, e.grossBtc), "0.00000000");
  const totalFees = sorted.reduce(
    (acc, e) => addBtc(acc, addBtc(e.poolFeeBtc, e.platformFeeBtc)),
    "0.00000000",
  );

  const points = sorted.map((e) => ({ t: e.earnedAt, v: Number(e.netBtc) }));

  return (
    <>
      <PageHeader
        title="収益"
        description="確定した採掘報酬の履歴と、現在の条件での推定収益"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="確定収益（90日）"
          value={`${Number(totalNet).toFixed(8)} BTC`}
          sub={formatUsd(Number(totalNet) * summary.price.usd)}
          tone="pos"
        />
        <Stat
          label="総収益（90日）"
          value={`${Number(totalGross).toFixed(8)} BTC`}
          sub={formatUsd(Number(totalGross) * summary.price.usd)}
        />
        <Stat
          label="手数料合計（90日）"
          value={`${Number(totalFees).toFixed(8)} BTC`}
          sub={formatUsd(Number(totalFees) * summary.price.usd)}
          tone="neg"
        />
        <Stat
          label="推定 純収益 / 日"
          value={formatUsd(rev.netRevenueUsdPerDay)}
          sub={`利益率 ${formatPercent(rev.profitMargin)}`}
          estimate
          tone={rev.netRevenueUsdPerDay >= 0 ? "pos" : "neg"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle hint="確定した日次報酬（純額）">日次報酬の推移</CardTitle>
          {points.length === 0 ? (
            <EmptyState
              title="報酬履歴がありません"
              description="契約が有効になり採掘が始まると、日次の報酬がここに記録されます。"
            />
          ) : (
            <LineChart
              points={points}
              unit="BTC"
              color="pos"
              caption="日次の確定報酬（BTC・純額）"
              height={220}
              formatValue={(v) => `${v.toFixed(8)} BTC`}
            />
          )}
        </Card>

        <Card>
          <CardTitle action={<EstimateChip />} hint="現在の条件での試算">
            推定収益の内訳（1日）
          </CardTitle>
          <div className="divide-y divide-line">
            <KeyValue label="Gross Revenue" value={formatUsd(rev.grossRevenueUsdPerDay)} />
            <KeyValue
              label="− 電力コスト"
              value={`-${formatUsd(rev.electricityCostUsdPerDay)}`}
              tone="neg"
            />
            <KeyValue
              label="− プール手数料"
              value={`-${formatUsd(rev.poolFeeUsdPerDay)}`}
              tone="neg"
            />
            <KeyValue
              label="− プラットフォーム手数料"
              value={`-${formatUsd(rev.platformFeeUsdPerDay)}`}
              tone="neg"
            />
            <KeyValue
              label="= Net Revenue"
              value={formatUsd(rev.netRevenueUsdPerDay)}
              tone={rev.netRevenueUsdPerDay >= 0 ? "pos" : "neg"}
            />
            <KeyValue
              label="損益分岐 BTC 価格"
              value={formatUsd(rev.breakEvenBtcPriceUsd, 0)}
            />
            <KeyValue
              label="ROI 到達"
              value={
                rev.roiDays === null
                  ? "回収不能"
                  : `${Math.ceil(rev.roiDays).toLocaleString()} 日`
              }
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">{rev.disclaimer}</p>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle
          action={
            <a
              href="/api/wallet/earnings/export.csv"
              className="text-xs text-accent hover:underline"
            >
              CSV をダウンロード
            </a>
          }
        >
          報酬履歴
        </CardTitle>
        {sorted.length === 0 ? (
          <EmptyState
            title="履歴がありません"
            description="採掘が開始されると、日次の報酬がここに表示されます。"
          />
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>ハッシュレート</th>
                  <th>稼働率</th>
                  <th>総収益</th>
                  <th>プール手数料</th>
                  <th>プラットフォーム手数料</th>
                  <th>純収益</th>
                </tr>
              </thead>
              <tbody>
                {[...sorted].reverse().slice(0, 90).map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{formatDate(e.earnedAt)}</td>
                    <td className="text-ink-muted">{e.hashrateThs.toFixed(1)} TH/s</td>
                    <td className="text-ink-muted">{formatPercent(e.uptimeRate)}</td>
                    <td>{Number(e.grossBtc).toFixed(8)}</td>
                    <td className="text-neg">-{Number(e.poolFeeBtc).toFixed(8)}</td>
                    <td className="text-neg">-{Number(e.platformFeeBtc).toFixed(8)}</td>
                    <td className="text-pos">{Number(e.netBtc).toFixed(8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
