import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { getNetworkAndPrice } from "@/modules/bitcoin/service";
import { calculateRevenue } from "@/modules/revenue/engine";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  EstimateChip,
  KeyValue,
  PageHeader,
  statusTone,
} from "@/components/ui";
import { formatHashrate, formatUsd, formatDate, statusLabel } from "@/lib/format";

export const metadata = { title: "契約・プラン" };
export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const [contracts, plans, { network, price }] = await Promise.all([
    store.listContracts(ctx.tenant.id, ctx.user.id),
    store.listPlans(ctx.tenant.id),
    getNetworkAndPrice(),
  ]);

  return (
    <>
      <PageHeader title="契約・プラン" description="現在の契約内容と、利用可能なプラン" />

      <Card className="mb-4">
        <CardTitle>現在の契約</CardTitle>
        {contracts.length === 0 ? (
          <EmptyState
            title="契約がありません"
            description="下のプランから契約すると、ハッシュレートが割り当てられます。"
          />
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>プラン</th>
                  <th>ハッシュレート</th>
                  <th>開始</th>
                  <th>終了</th>
                  <th>初期費用</th>
                  <th>自動更新</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.planName}</td>
                    <td>{formatHashrate(c.hashrateThs, 0)}</td>
                    <td className="text-ink-muted">{formatDate(c.startsAt)}</td>
                    <td className="text-ink-muted">{formatDate(c.endsAt)}</td>
                    <td>{formatUsd(c.upfrontCostUsd, 0)}</td>
                    <td className="text-ink-muted">{c.autoRenew ? "有効" : "無効"}</td>
                    <td>
                      <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <h2 className="mb-3 text-sm font-medium text-ink-muted">
        利用可能なプラン
        <span className="ml-2 text-xs text-ink-dim">
          （下の収益はすべて現在の条件での推定値です）
        </span>
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const rev = calculateRevenue({
            hashrateThs: plan.hashrateThs,
            networkHashrateThs: network.networkHashrateThs,
            difficulty: network.difficulty,
            blockRewardBtc: network.blockRewardBtc,
            btcPriceUsd: price.usd,
            electricityPriceKwh: plan.electricityPriceKwh,
            efficiencyJPerTh: 17.5,
            poolFeeRate: plan.poolFeeRate,
            platformFeeRate: plan.platformFeeRate,
            uptimeRate: 0.985,
            upfrontCostUsd: plan.priceUsd,
          });
          const roiOk = rev.roiDays !== null && rev.roiDays <= plan.termDays;

          return (
            <Card key={plan.id}>
              <CardTitle action={<EstimateChip />}>{plan.name}</CardTitle>
              <div className="text-2xl font-semibold text-brand">
                {formatHashrate(plan.hashrateThs, 0)}
              </div>
              <div className="mt-0.5 text-xs text-ink-dim">
                {plan.termDays} 日間 / {formatUsd(plan.priceUsd, 0)} · {plan.payoutScheme}
              </div>
              <div className="mt-3 divide-y divide-line border-t border-line pt-1">
                <KeyValue
                  label="推定 BTC / 月"
                  value={rev.estimatedBtcPerMonth.toFixed(8)}
                />
                <KeyValue
                  label="推定 純収益 / 日"
                  value={formatUsd(rev.netRevenueUsdPerDay)}
                  tone={rev.netRevenueUsdPerDay >= 0 ? "pos" : "neg"}
                />
                <KeyValue
                  label="契約期間の推定純収益"
                  value={formatUsd(rev.netRevenueUsdPerDay * plan.termDays)}
                  tone={rev.netRevenueUsdPerDay >= 0 ? "pos" : "neg"}
                />
                <KeyValue
                  label="ROI 到達"
                  value={
                    rev.roiDays === null
                      ? "回収不能"
                      : `${Math.ceil(rev.roiDays).toLocaleString()} 日`
                  }
                  tone={roiOk ? "pos" : "neg"}
                />
              </div>

              {!roiOk && (
                <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn">
                  現在の条件では、初期費用を契約期間内に回収できない見込みです。
                </p>
              )}

              <p className="mt-3 text-[10px] leading-relaxed text-ink-dim">
                MVP では決済を実装していないため、契約の申込は管理者による手動処理となります。
              </p>
            </Card>
          );
        })}
      </div>
    </>
  );
}
