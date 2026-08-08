import Link from "next/link";
import { requireSession } from "@/modules/auth/session";
import { getWorkersForUser } from "@/modules/mining/aggregate";
import { analyzeWorkers, sortInsights } from "@/modules/ai/optimizer";
import { Badge, Card, CardTitle, EmptyState, PageHeader, statusTone } from "@/components/ui";
import { formatHashrate, formatRelative, statusLabel, formatPercent } from "@/lib/format";

export const metadata = { title: "ワーカー一覧" };
export const dynamic = "force-dynamic";

export default async function WorkersPage() {
  const ctx = await requireSession();
  const entries = await getWorkersForUser(ctx.tenant.id, ctx.user.id);
  const insights = sortInsights(analyzeWorkers(ctx.tenant.id, entries, new Map()));
  const insightByWorker = new Map(insights.map((i) => [i.targetId, i]));

  const totalRated = entries.reduce((s, e) => s + e.worker.ratedHashrateThs, 0);
  const totalCurrent = entries.reduce((s, e) => s + (e.reading?.hashrateThs ?? 0), 0);

  return (
    <>
      <PageHeader
        title="ワーカー一覧"
        description={`契約に割り当てられている ASIC マイナー ${entries.length} 台`}
      />

      {entries.length === 0 ? (
        <Card>
          <EmptyState
            title="割り当てられたワーカーがありません"
            description="契約を作成すると、プロバイダーの ASIC マイナーが割り当てられます。"
            action={
              <Link
                href="/contracts"
                className="rounded-xl bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] px-4 py-2 text-sm font-medium text-black"
              >
                プランを見る
              </Link>
            }
          />
        </Card>
      ) : (
        <Card>
          <CardTitle
            hint={`定格合計 ${formatHashrate(totalRated, 1)} / 実効合計 ${formatHashrate(totalCurrent, 1)}（${formatPercent(totalCurrent / (totalRated || 1))}）`}
          >
            ワーカー
          </CardTitle>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>機種</th>
                  <th>定格</th>
                  <th>実効</th>
                  <th>効率</th>
                  <th>温度</th>
                  <th>Accepted</th>
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
                  const insight = insightByWorker.get(worker.id);
                  const ratio = reading
                    ? reading.hashrateThs / (worker.ratedHashrateThs || 1)
                    : 0;

                  return (
                    <tr key={worker.id}>
                      <td>
                        <Link
                          href={`/mining/workers/${worker.id}`}
                          className="text-accent hover:underline"
                        >
                          {worker.externalWorkerId}
                        </Link>
                        {insight && (
                          <span
                            className="ml-1.5 text-[10px] text-warn"
                            title={insight.detail}
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="text-ink-muted">{worker.model}</td>
                      <td>{worker.ratedHashrateThs.toFixed(1)} TH/s</td>
                      <td className={ratio < 0.85 ? "text-warn" : ""}>
                        {reading ? `${reading.hashrateThs.toFixed(1)} TH/s` : "—"}
                      </td>
                      <td className="text-ink-muted">
                        {worker.ratedEfficiencyJPerTh.toFixed(1)} J/TH
                      </td>
                      <td
                        className={
                          (reading?.temperatureC ?? 0) >= 75 ? "text-warn" : "text-ink-muted"
                        }
                      >
                        {reading?.temperatureC !== null && reading?.temperatureC !== undefined
                          ? `${reading.temperatureC}℃`
                          : "—"}
                      </td>
                      <td className="text-ink-muted">
                        {reading ? reading.acceptedShares.toLocaleString() : "—"}
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
      )}

      {insights.length > 0 && (
        <Card className="mt-4">
          <CardTitle hint="ルールベースの検知。判断根拠の数値を併記しています">
            検知された問題（{insights.length} 件）
          </CardTitle>
          <div className="space-y-2">
            {insights.slice(0, 10).map((i) => (
              <div key={i.id} className="rounded-xl border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
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
                <p className="mt-1 text-xs text-accent">→ {i.recommendation}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-dim">
                  {Object.entries(i.evidence).map(([k, v]) => (
                    <span key={k}>
                      {k}: {String(v)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
