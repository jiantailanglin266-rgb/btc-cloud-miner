import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { canViewAudit } from "@/modules/auth/rbac";
import { redirect } from "next/navigation";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "監査ログ" };
export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const ctx = await requireSession();
  if (!canViewAudit(ctx.user)) redirect("/admin");

  const store = await getStore();
  const logs = await store.listAuditLogs(ctx.tenant.id, { limit: 200 });

  return (
    <>
      <PageHeader
        title="監査ログ"
        description="金銭・権限・認証に関わる全操作の追記専用記録（直近200件）"
      />
      <Card>
        <CardTitle hint="このログは追記専用で、削除・変更はできません。機微情報はマスクされています。">
          操作履歴
        </CardTitle>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>日時</th>
                <th>操作</th>
                <th>実行者</th>
                <th>対象</th>
                <th>結果</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(l.createdAt)}
                  </td>
                  <td>
                    <code className="text-xs text-accent">{l.action}</code>
                  </td>
                  <td>
                    <div className="text-xs">{l.actorEmail || "システム"}</div>
                    <div className="text-[10px] text-ink-dim">{l.actorRole}</div>
                  </td>
                  <td className="text-xs text-ink-muted">
                    {l.targetType}
                    {l.targetId && (
                      <span className="text-ink-dim"> / {l.targetId.slice(0, 12)}</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={l.result === "SUCCESS" ? "online" : "offline"}>
                      {l.result}
                    </Badge>
                  </td>
                  <td className="text-[11px] text-ink-dim">{l.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
