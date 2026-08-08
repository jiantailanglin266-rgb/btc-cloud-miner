import { requireSession } from "@/modules/auth/session";
import { getWorkersForUser, buildDashboardSummary } from "@/modules/mining/aggregate";
import { analyzeWorkers, analyzePortfolio, sortInsights } from "@/modules/ai/optimizer";
import { Badge, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "AI インサイト" };
export const dynamic = "force-dynamic";

export default async function AdminAiPage() {
  const ctx = await requireSession();
  const [entries, summary] = await Promise.all([
    getWorkersForUser(ctx.tenant.id, null),
    buildDashboardSummary(ctx.tenant.id, null),
  ]);

  const insights = sortInsights([
    ...analyzeWorkers(ctx.tenant.id, entries, new Map()),
    ...analyzePortfolio(ctx.tenant.id, summary),
  ]);

  return (
    <>
      <PageHeader
        title="AI インサイト"
        description="運用データからの異常検知・推奨アクション（テナント全体）"
      />

      <Card className="mb-4">
        <CardTitle>この機能について</CardTitle>
        <p className="text-xs leading-relaxed text-ink-muted">
          AI Mining Optimizer は、Bitcoin
          のマイニングアルゴリズムそのものには関与しません（PoW の計算量を減らす方法は存在しません）。
          ここで行うのは、収集した運用データからの<strong className="text-ink">異常検知・監視・予測分析</strong>です。
          MVP はルールベース＋統計（Z スコア・回帰トレンド）で実装しており、
          すべての検知に「判断根拠の数値」を添えています。
          運用データが蓄積された段階で、機械学習モデルを補助として追加できます。
        </p>
      </Card>

      {insights.length === 0 ? (
        <Card>
          <EmptyState
            icon="✦"
            title="検知された問題はありません"
            description="ワーカー・ポートフォリオの状態は正常範囲内です。"
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {insights.map((i) => (
            <Card
              key={i.id}
              className={
                i.severity === "CRITICAL"
                  ? "border-neg/40"
                  : i.severity === "WARNING"
                    ? "border-warn/40"
                    : ""
              }
            >
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
                <Badge tone="neutral">{i.kind}</Badge>
                <span className="text-sm font-medium">{i.title}</span>
                <span className="ml-auto text-[11px] text-ink-dim">
                  {formatRelative(i.createdAt)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">{i.detail}</p>
              <p className="mt-1 text-xs leading-relaxed text-accent">
                推奨: {i.recommendation}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-[10px] text-ink-dim">
                <span className="text-ink-muted">根拠:</span>
                {Object.entries(i.evidence).map(([k, v]) => (
                  <span key={k}>
                    {k} = {String(v)}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
