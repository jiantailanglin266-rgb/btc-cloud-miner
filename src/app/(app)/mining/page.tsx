import Link from "next/link";
import { requireSession } from "@/modules/auth/session";
import { getProviderHealth } from "@/modules/provider/registry";
import { getStore } from "@/lib/store";
import { getWorkersForUser } from "@/modules/mining/aggregate";
import { Badge, Card, CardTitle, KeyValue, PageHeader, statusTone } from "@/components/ui";
import { formatHashrate, formatRelative, statusLabel } from "@/lib/format";

export const metadata = { title: "マイニング" };
export const dynamic = "force-dynamic";

const STATUS_HELP: Record<string, string> = {
  ONLINE: "正常に統計を取得できています。",
  DEGRADED:
    "応答が遅い、または一部の取得に失敗しています。採掘自体は継続している可能性があります。",
  OFFLINE:
    "連続した失敗により一時的に呼び出しを停止しています（circuit breaker 作動中）。表示中の値は最終取得値です。",
  MAINTENANCE: "計画停止中、または管理者によって無効化されています。",
};

export default async function MiningPage() {
  const ctx = await requireSession();
  const store = await getStore();

  const [providers, health, entries, contracts, allocations, incidents] = await Promise.all([
    store.listProviders(ctx.tenant.id),
    getProviderHealth(ctx.tenant.id),
    getWorkersForUser(ctx.tenant.id, ctx.user.id),
    store.listContracts(ctx.tenant.id, ctx.user.id),
    store.listAllocations(ctx.tenant.id),
    store.listIncidents(ctx.tenant.id),
  ]);

  const healthById = new Map(health.map((h) => [h.providerId, h]));
  const myContractIds = new Set(contracts.map((c) => c.id));
  const myAllocations = allocations.filter((a) => myContractIds.has(a.contractId));
  const openIncidents = incidents.filter((i) => i.status !== "RESOLVED");

  const byProvider = new Map<string, { count: number; rated: number; current: number }>();
  for (const { worker, reading } of entries) {
    const acc = byProvider.get(worker.providerId) ?? { count: 0, rated: 0, current: 0 };
    acc.count++;
    acc.rated += worker.ratedHashrateThs;
    acc.current += reading?.hashrateThs ?? 0;
    byProvider.set(worker.providerId, acc);
  }

  return (
    <>
      <PageHeader
        title="マイニング"
        description="接続中のプロバイダー・プールの状態と、割り当てられているハッシュレート"
        action={
          <Link
            href="/mining/workers"
            className="rounded-xl border border-line-strong bg-white/5 px-4 py-2 text-sm"
          >
            ワーカー一覧 →
          </Link>
        }
      />

      {openIncidents.length > 0 && (
        <Card className="mb-4 border-warn/40 bg-warn/5">
          <CardTitle>障害情報</CardTitle>
          <div className="space-y-2">
            {openIncidents.map((i) => (
              <div key={i.id}>
                <div className="flex items-center gap-2">
                  <Badge tone="degraded">{i.severity}</Badge>
                  <span className="text-sm font-medium">{i.title}</span>
                  <span className="text-[11px] text-ink-dim">
                    {formatRelative(i.startedAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">{i.body}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {providers.map((p) => {
          const h = healthById.get(p.id);
          const stats = byProvider.get(p.id);
          const status = h?.status ?? p.status;
          return (
            <Card key={p.id}>
              <CardTitle
                hint={`${p.region} · プール: ${p.poolName || "—"} · 支払方式: ${p.payoutScheme}`}
                action={
                  <Badge tone={statusTone(status)} dot>
                    {statusLabel(status)}
                  </Badge>
                }
              >
                {p.name}
              </CardTitle>

              <div className="divide-y divide-line">
                <KeyValue label="種別" value={p.kind} />
                <KeyValue
                  label="割当ワーカー"
                  value={stats ? `${stats.count} 台` : "0 台"}
                />
                <KeyValue
                  label="定格 / 実効"
                  value={
                    stats
                      ? `${formatHashrate(stats.rated, 1)} / ${formatHashrate(stats.current, 1)}`
                      : "—"
                  }
                />
                <KeyValue
                  label="最終取得"
                  value={p.lastOkAt ? formatRelative(p.lastOkAt) : "未取得"}
                />
                {h?.latencyMs !== null && h?.latencyMs !== undefined && (
                  <KeyValue label="応答時間" value={`${h.latencyMs} ms`} />
                )}
                {p.consecutiveFailures > 0 && (
                  <KeyValue
                    label="連続失敗"
                    value={`${p.consecutiveFailures} 回`}
                    tone="neg"
                  />
                )}
              </div>

              <p className="mt-3 rounded-lg border border-line bg-white/2 p-2 text-[11px] leading-relaxed text-ink-muted">
                {STATUS_HELP[status]}
                {h?.message && <span className="block mt-1 text-ink-dim">{h.message}</span>}
              </p>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardTitle hint="契約したハッシュレートが、どの設備に割り当てられているか">
          ハッシュレートの割当
        </CardTitle>
        {myAllocations.length === 0 ? (
          <p className="text-xs text-ink-muted">割当がありません。</p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>契約</th>
                  <th>プロバイダー</th>
                  <th>ワーカー</th>
                  <th>割当量</th>
                </tr>
              </thead>
              <tbody>
                {myAllocations.slice(0, 50).map((a) => (
                  <tr key={a.id}>
                    <td className="text-ink-muted">
                      {contracts.find((c) => c.id === a.contractId)?.planName ?? a.contractId}
                    </td>
                    <td>{providers.find((p) => p.id === a.providerId)?.name ?? a.providerId}</td>
                    <td>
                      {a.workerId ? (
                        <Link
                          href={`/mining/workers/${a.workerId}`}
                          className="text-accent hover:underline"
                        >
                          {entries.find((e) => e.worker.id === a.workerId)?.worker
                            .externalWorkerId ?? a.workerId}
                        </Link>
                      ) : (
                        <span className="text-ink-dim">—</span>
                      )}
                    </td>
                    <td>{a.hashrateThs.toFixed(1)} TH/s</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {myAllocations.length > 50 && (
              <p className="mt-2 text-[11px] text-ink-dim">
                {myAllocations.length} 件中 50 件を表示しています。
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
