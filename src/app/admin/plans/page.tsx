import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { formatHashrate, formatUsd, formatPercent } from "@/lib/format";

export const metadata = { title: "プラン・料金" };
export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const [plans, contracts] = await Promise.all([
    store.listPlans(ctx.tenant.id),
    store.listContracts(ctx.tenant.id),
  ]);

  const contractCount = new Map<string, number>();
  for (const c of contracts) {
    contractCount.set(c.planId, (contractCount.get(c.planId) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader title="プラン・料金" description="販売中のプランと契約状況" />
      <Card>
        <CardTitle hint="プランの追加・編集 API（upsertPlan）は実装済みです。編集 UI は商用版で追加します。">
          プラン一覧
        </CardTitle>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>プラン</th>
                <th>ハッシュレート</th>
                <th>期間</th>
                <th>価格</th>
                <th>プール手数料</th>
                <th>PF 手数料</th>
                <th>電力単価</th>
                <th>支払方式</th>
                <th>契約数</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{formatHashrate(p.hashrateThs, 0)}</td>
                  <td className="text-ink-muted">{p.termDays} 日</td>
                  <td>{formatUsd(p.priceUsd, 0)}</td>
                  <td className="text-ink-muted">{formatPercent(p.poolFeeRate)}</td>
                  <td className="text-ink-muted">{formatPercent(p.platformFeeRate)}</td>
                  <td className="text-ink-muted">${p.electricityPriceKwh}/kWh</td>
                  <td className="text-ink-muted">{p.payoutScheme}</td>
                  <td>{contractCount.get(p.id) ?? 0}</td>
                  <td>
                    <Badge tone={p.active ? "online" : "neutral"}>
                      {p.active ? "販売中" : "停止"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
