import { requireSession } from "@/modules/auth/session";
import { getProviderHealth } from "@/modules/provider/registry";
import { getNetworkAndPrice } from "@/modules/bitcoin/service";
import { getWalletProvider } from "@/modules/wallet";
import { getStore } from "@/lib/store";
import { cache } from "@/lib/cache";
import { allBreakers } from "@/lib/circuit-breaker";
import { Badge, Card, CardTitle, KeyValue, PageHeader, statusTone } from "@/components/ui";
import { formatRelative, statusLabel } from "@/lib/format";

export const metadata = { title: "システム稼働状況" };
export const dynamic = "force-dynamic";

export default async function AdminHealthPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const [providers, { network, price }, walletHealth] = await Promise.all([
    getProviderHealth(ctx.tenant.id),
    getNetworkAndPrice(),
    getWalletProvider().healthCheck(),
  ]);
  const breakers = allBreakers();

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
    </>
  );
}
