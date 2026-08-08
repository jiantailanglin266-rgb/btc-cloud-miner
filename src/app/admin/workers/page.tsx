import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { getWorkersForUser } from "@/modules/mining/aggregate";
import { Badge, Card, CardTitle, PageHeader, statusTone } from "@/components/ui";
import { formatRelative, statusLabel, formatPercent } from "@/lib/format";

export const metadata = { title: "ワーカー管理" };
export const dynamic = "force-dynamic";

export default async function AdminWorkersPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const [entries, providers] = await Promise.all([
    // 管理者は全ワーカーを見る（userId を渡さない）
    getWorkersForUser(ctx.tenant.id, null),
    store.listProviders(ctx.tenant.id),
  ]);
  const providerName = new Map(providers.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader
        title="ワーカー管理"
        description={`全プロバイダーの ASIC ワーカー ${entries.length} 台`}
      />
      <Card>
        <CardTitle>全ワーカー</CardTitle>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Worker</th>
                <th>プロバイダー</th>
                <th>機種</th>
                <th>定格</th>
                <th>実効</th>
                <th>温度</th>
                <th>Reject 率</th>
                <th>状態</th>
                <th>最終確認</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ worker, reading }) => {
                const total =
                  (reading?.acceptedShares ?? 0) + (reading?.rejectedShares ?? 0);
                const rejectRate = total > 0 ? (reading!.rejectedShares ?? 0) / total : 0;
                return (
                  <tr key={worker.id}>
                    <td>{worker.externalWorkerId}</td>
                    <td className="text-ink-muted">
                      {providerName.get(worker.providerId) ?? worker.providerId}
                    </td>
                    <td className="text-ink-muted">{worker.model}</td>
                    <td>{worker.ratedHashrateThs.toFixed(1)} TH/s</td>
                    <td>{reading ? `${reading.hashrateThs.toFixed(1)} TH/s` : "—"}</td>
                    <td className="text-ink-muted">
                      {reading?.temperatureC != null ? `${reading.temperatureC}℃` : "—"}
                    </td>
                    <td className={rejectRate > 0.03 ? "text-neg" : "text-ink-muted"}>
                      {reading ? formatPercent(rejectRate, 2) : "—"}
                    </td>
                    <td>
                      <Badge tone={statusTone(reading?.workerStatus ?? worker.status)} dot>
                        {statusLabel(reading?.workerStatus ?? worker.status)}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-ink-dim">
                      {worker.lastSeenAt ? formatRelative(worker.lastSeenAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
