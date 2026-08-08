import Link from "next/link";
import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { getProviderHealth, detectMockUsage } from "@/modules/provider/registry";
import { buildDashboardSummary } from "@/modules/mining/aggregate";
import { getWalletProvider } from "@/modules/wallet";
import { Badge, Card, CardTitle, PageHeader, Stat, statusTone } from "@/components/ui";
import { formatHashrate, formatUsd, formatRelative, statusLabel } from "@/lib/format";
import { assertProductionConfig, isDemoMode } from "@/lib/config";

export const metadata = { title: "管理ダッシュボード" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const ctx = await requireSession();
  const store = await getStore();

  const [users, withdrawals, providers, health, summary, incidents, audits, mockWarnings] =
    await Promise.all([
      store.listUsers(ctx.tenant.id),
      store.listWithdrawals(ctx.tenant.id),
      store.listProviders(ctx.tenant.id),
      getProviderHealth(ctx.tenant.id),
      // 管理者は userId を渡さず、テナント全体を集約する
      buildDashboardSummary(ctx.tenant.id, null),
      store.listIncidents(ctx.tenant.id),
      store.listAuditLogs(ctx.tenant.id, { limit: 8 }),
      detectMockUsage(ctx.tenant.id),
    ]);

  const pending = withdrawals.filter(
    (w) => w.status === "PENDING_REVIEW" || w.status === "FLAGGED",
  );
  const flagged = withdrawals.filter((w) => w.status === "FLAGGED");
  const kycPending = users.filter((u) => u.kycStatus === "PENDING");
  const openIncidents = incidents.filter((i) => i.status !== "RESOLVED");
  const walletProvider = getWalletProvider();
  const configWarnings = assertProductionConfig();

  return (
    <>
      <PageHeader title="管理ダッシュボード" description="全体の状況とアクションが必要な項目" />

      {(isDemoMode() || !walletProvider.isLive || mockWarnings.length > 0) && (
        <Card className="mb-4 border-purple-400/40 bg-purple-400/5">
          <CardTitle>デモ構成の確認</CardTitle>
          <ul className="space-y-1 text-xs leading-relaxed text-purple-200">
            {mockWarnings.map((w) => (
              <li key={w}>・{w}</li>
            ))}
            {!walletProvider.isLive && (
              <li>
                ・ウォレットプロバイダーが <code>{walletProvider.name}</code>{" "}
                です。実際の送金・署名は行われません。
              </li>
            )}
          </ul>
        </Card>
      )}

      {configWarnings.length > 0 && (
        <Card className="mb-4 border-neg/40 bg-neg/5">
          <CardTitle>本番構成の警告</CardTitle>
          <ul className="space-y-1 text-xs leading-relaxed text-neg">
            {configWarnings.map((w) => (
              <li key={w}>・{w}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ユーザー数" value={users.length.toLocaleString()} sub={`KYC審査待ち ${kycPending.length} 件`} />
        <Stat
          label="承認待ち出金"
          value={pending.length.toLocaleString()}
          sub={`要確認（FLAGGED） ${flagged.length} 件`}
          tone={pending.length > 0 ? "neg" : "pos"}
        />
        <Stat
          label="総ハッシュレート"
          value={formatHashrate(summary.currentHashrateThs, 1)}
          sub={`稼働 ${summary.activeMiners} / 停止 ${summary.offlineMiners}`}
          tone="brand"
        />
        <Stat
          label="推定純収益 / 日"
          value={formatUsd(summary.revenue.netRevenueUsdPerDay)}
          sub="テナント全体"
          estimate
          tone={summary.revenue.netRevenueUsdPerDay >= 0 ? "pos" : "neg"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle
            action={
              <Link href="/admin/withdrawals" className="text-xs text-accent hover:underline">
                すべて見る →
              </Link>
            }
          >
            対応が必要な出金
          </CardTitle>
          {pending.length === 0 ? (
            <p className="text-xs text-ink-muted">承認待ちの出金はありません。</p>
          ) : (
            <ul className="space-y-2">
              {pending.slice(0, 5).map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">{w.userEmail}</div>
                    <div className="text-[11px] text-ink-dim">
                      {Number(w.amountBtc).toFixed(8)} BTC · {formatRelative(w.createdAt)}
                    </div>
                  </div>
                  <Badge tone={statusTone(w.status)}>
                    {statusLabel(w.status)}
                    {w.riskScore >= 50 && ` (${w.riskScore})`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle
            action={
              <Link href="/admin/health" className="text-xs text-accent hover:underline">
                詳細 →
              </Link>
            }
          >
            プロバイダーの状態
          </CardTitle>
          <ul className="space-y-2">
            {health.map((h) => (
              <li key={h.providerId} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">{h.name}</div>
                  <div className="text-[11px] text-ink-dim">
                    {h.kind} · {h.lastOkAt ? formatRelative(h.lastOkAt) : "未取得"}
                  </div>
                </div>
                <Badge tone={statusTone(h.status)} dot>
                  {statusLabel(h.status)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle
            action={
              <Link href="/admin/incidents" className="text-xs text-accent hover:underline">
                すべて見る →
              </Link>
            }
          >
            進行中の障害
          </CardTitle>
          {openIncidents.length === 0 ? (
            <p className="text-xs text-ink-muted">進行中の障害はありません。</p>
          ) : (
            <ul className="space-y-2">
              {openIncidents.map((i) => (
                <li key={i.id} className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="degraded">{i.severity}</Badge>
                    <span className="text-sm">{i.title}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-ink-dim">
                    {i.status} · {formatRelative(i.startedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle
            action={
              <Link href="/admin/audit" className="text-xs text-accent hover:underline">
                すべて見る →
              </Link>
            }
          >
            最近の監査ログ
          </CardTitle>
          <ul className="space-y-1.5">
            {audits.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-xs">
                <code className="shrink-0 text-accent">{a.action}</code>
                <span className="min-w-0 flex-1 truncate text-ink-muted">
                  {a.actorEmail}
                </span>
                <span className="shrink-0 text-[11px] text-ink-dim">
                  {formatRelative(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>接続中のプロバイダー</CardTitle>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>種別</th>
                <th>リージョン</th>
                <th>プール</th>
                <th>優先度</th>
                <th>連続失敗</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="text-ink-muted">{p.kind}</td>
                  <td className="text-ink-muted">{p.region || "—"}</td>
                  <td className="text-ink-muted">{p.poolName || "—"}</td>
                  <td>{p.priority}</td>
                  <td className={p.consecutiveFailures > 0 ? "text-neg" : "text-ink-muted"}>
                    {p.consecutiveFailures}
                  </td>
                  <td>
                    <Badge tone={statusTone(p.status)} dot>
                      {statusLabel(p.status)}
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
