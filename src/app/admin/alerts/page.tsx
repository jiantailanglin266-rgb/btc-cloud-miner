import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { buildDashboardSummary, getWorkersForUser } from "@/modules/mining/aggregate";
import { scanAndRaiseAlerts, ALERT_LABEL_JA } from "@/modules/monitoring/alerts";
import { isReadOnly } from "@/modules/auth/rbac";
import { AlertList } from "./AlertList";
import { Card, CardTitle, PageHeader } from "@/components/ui";

export const metadata = { title: "リスクアラート" };
export const dynamic = "force-dynamic";

export default async function AdminAlertsPage() {
  const ctx = await requireSession();
  const store = await getStore();

  // ページ表示時にスキャンを実行し、検知結果を永続化する
  const [summary, entries] = await Promise.all([
    buildDashboardSummary(ctx.tenant.id, null),
    getWorkersForUser(ctx.tenant.id, null),
  ]);
  await scanAndRaiseAlerts(ctx.tenant.id, summary, entries);
  const alerts = await store.listAlerts(ctx.tenant.id, { limit: 200 });

  return (
    <>
      <PageHeader
        title="リスクアラート"
        description="監視ルールが検知した異常。CRITICAL は即時対応が必要"
      />

      <Card className="mb-4">
        <CardTitle>検知ルール</CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(ALERT_LABEL_JA).map(([k, label]) => (
            <code key={k} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-ink-dim">
              {label}
            </code>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          同種・同対象の未確認アラートは重複して作成されません。
          LEDGER_IMBALANCE（元帳不整合）が出た場合は、まず FEATURE_WITHDRAWAL_ENABLED=false
          で出金を停止してから調査してください（OPERATIONS.md R4）。
        </p>
      </Card>

      <AlertList alerts={alerts} readOnly={isReadOnly(ctx.user)} />
    </>
  );
}
