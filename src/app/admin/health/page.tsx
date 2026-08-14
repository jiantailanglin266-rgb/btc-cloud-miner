import { requireSession } from "@/modules/auth/session";
import { getProviderHealth } from "@/modules/provider/registry";
import { getNetworkAndPrice } from "@/modules/bitcoin/service";
import { getWalletProvider } from "@/modules/wallet";
import { getStore } from "@/lib/store";
import { cache } from "@/lib/cache";
import { allBreakers } from "@/lib/circuit-breaker";
import { snapshotMetrics } from "@/modules/monitoring/metrics";
import { Badge, Card, CardTitle, KeyValue, PageHeader, statusTone } from "@/components/ui";
import { formatRelative, statusLabel } from "@/lib/format";

export const metadata = { title: "システム稼働状況" };
export const dynamic = "force-dynamic";

export default async function AdminHealthPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const [providers, { network, price }, walletHealth, allProviders] = await Promise.all([
    getProviderHealth(ctx.tenant.id),
    getNetworkAndPrice(),
    getWalletProvider().healthCheck(),
    store.listProviders(ctx.tenant.id),
  ]);
  const breakers = allBreakers();
  const metrics = snapshotMetrics();

  // 背景 worker の同期状況（最も新しい lastSyncAt を代表値にする）
  const lastSyncAt = allProviders
    .map((p) => p.lastSyncAt)
    .filter((s): s is string => Boolean(s))
    .sort()
    .at(-1);
  const workerFresh = lastSyncAt
    ? Date.now() - new Date(lastSyncAt).getTime() < 10 * 60_000
    : false;

  return (
    <>
      <PageHeader
        title="システム稼働状況"
        description="外部依存の状態と circuit breaker の状況"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>コア</CardTitle>
          <div className="divide-y divide-line">
            <KeyValue
              label="データストア"
              value={
                store.kind === "prisma"
                  ? "PostgreSQL (Prisma)"
                  : "インメモリ（デモ・再起動で消えます）"
              }
              tone={store.kind === "prisma" ? "pos" : undefined}
            />
            <KeyValue label="キャッシュ" value={cache.kind() === "REDIS" ? "Redis" : "インメモリ LRU"} />
            <KeyValue
              label="ウォレットプロバイダー"
              value={`${getWalletProvider().name}${getWalletProvider().isLive ? "" : "（Mock・実送金なし）"}`}
              tone={getWalletProvider().isLive ? "pos" : undefined}
            />
            <KeyValue label="ウォレット疎通" value={walletHealth.message ?? "OK"} />
            <KeyValue
              label="Background Worker"
              value={
                lastSyncAt ? `最終同期 ${formatRelative(lastSyncAt)}` : "未同期（npm run worker）"
              }
              tone={workerFresh ? "pos" : lastSyncAt ? "neg" : "muted"}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Bitcoin データソース</CardTitle>
          <div className="divide-y divide-line">
            <KeyValue
              label="ネットワーク情報"
              value={`${network.freshness.source}${network.freshness.stale ? `（${network.freshness.ageSec} 秒前の値）` : ""}`}
              tone={network.freshness.stale ? "neg" : "pos"}
            />
            <KeyValue
              label="価格情報"
              value={`${price.freshness.source}${price.freshness.stale ? `（${price.freshness.ageSec} 秒前の値）` : ""}`}
              tone={price.freshness.stale ? "neg" : "pos"}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>マイニングプロバイダー</CardTitle>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>種別</th>
                <th>状態</th>
                <th>応答</th>
                <th>連続失敗</th>
                <th>最終成功</th>
                <th>メッセージ</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((h) => (
                <tr key={h.providerId}>
                  <td>{h.name}</td>
                  <td className="text-ink-muted">{h.kind}</td>
                  <td>
                    <Badge tone={statusTone(h.status)} dot>
                      {statusLabel(h.status)}
                    </Badge>
                  </td>
                  <td className="text-ink-muted">
                    {h.latencyMs !== null ? `${h.latencyMs} ms` : "—"}
                  </td>
                  <td className={h.consecutiveFailures > 0 ? "text-neg" : "text-ink-muted"}>
                    {h.consecutiveFailures}
                  </td>
                  <td className="text-ink-dim">
                    {h.lastOkAt ? formatRelative(h.lastOkAt) : "—"}
                  </td>
                  <td className="max-w-[16rem] truncate text-[11px] text-ink-dim">
                    {h.message ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle hint="連続失敗が閾値を超えると OPEN になり、一定時間そのソースを呼ばなくなります">
          Circuit Breaker
        </CardTitle>
        {breakers.length === 0 ? (
          <p className="text-xs text-ink-muted">
            まだ外部呼び出しが発生していません。
          </p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>名前</th>
                  <th>状態</th>
                  <th>連続失敗</th>
                  <th>直近のエラー</th>
                </tr>
              </thead>
              <tbody>
                {breakers.map((b) => {
                  const stats = b.getStats();
                  return (
                    <tr key={b.name}>
                      <td>
                        <code className="text-xs">{b.name}</code>
                      </td>
                      <td>
                        <Badge
                          tone={
                            stats.state === "CLOSED"
                              ? "online"
                              : stats.state === "HALF_OPEN"
                                ? "degraded"
                                : "offline"
                          }
                        >
                          {stats.state}
                        </Badge>
                      </td>
                      <td className={stats.consecutiveFailures > 0 ? "text-neg" : "text-ink-muted"}>
                        {stats.consecutiveFailures}
                      </td>
                      <td className="max-w-[20rem] truncate text-[11px] text-ink-dim">
                        {stats.lastError ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle hint="プロセス内カウンタ/ゲージ（本番は OpenTelemetry / Prometheus へ）">
          Operational Metrics
        </CardTitle>
        {metrics.length === 0 ? (
          <p className="text-xs text-ink-muted">
            まだメトリクスが記録されていません（同期を実行すると蓄積されます）。
          </p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>メトリクス</th>
                  <th>直近値</th>
                  <th>累計</th>
                  <th>回数</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <code className="text-[11px]">{m.name}</code>
                    </td>
                    <td>{m.last}</td>
                    <td className="text-ink-muted">{m.total}</td>
                    <td className="text-ink-dim">{m.count}</td>
                    <td className="text-[11px] text-ink-dim">{formatRelative(m.updatedAt)}</td>
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
