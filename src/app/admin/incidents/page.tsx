import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { Badge, Card, CardTitle, EmptyState, PageHeader, statusTone } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/format";

export const metadata = { title: "障害情報" };
export const dynamic = "force-dynamic";

export default async function AdminIncidentsPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const incidents = await store.listIncidents(ctx.tenant.id);

  return (
    <>
      <PageHeader
        title="障害情報"
        description="ユーザーへ公開される障害・メンテナンス情報の管理"
      />
      {incidents.length === 0 ? (
        <Card>
          <EmptyState title="障害情報はありません" description="障害が発生した場合、ここで管理します。" />
        </Card>
      ) : (
        <div className="space-y-3">
          {incidents.map((i) => (
            <Card key={i.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={i.severity === "SEV1" || i.severity === "SEV2" ? "offline" : "degraded"}>
                  {i.severity}
                </Badge>
                <Badge tone={statusTone(i.status === "RESOLVED" ? "CONFIRMED" : "PENDING")}>
                  {i.status}
                </Badge>
                <span className="text-sm font-medium">{i.title}</span>
                <span className="ml-auto text-[11px] text-ink-dim">
                  発生 {formatRelative(i.startedAt)}
                  {i.resolvedAt && ` · 解決 ${formatDateTime(i.resolvedAt)}`}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">{i.body}</p>
              {i.affectedComponents.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {i.affectedComponents.map((c) => (
                    <code key={c} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-ink-dim">
                      {c}
                    </code>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
