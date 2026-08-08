import Link from "next/link";
import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { Badge, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import { MarkAllRead } from "./MarkAllRead";

export const metadata = { title: "通知" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const notifications = await store.listNotifications(ctx.tenant.id, ctx.user.id);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="通知"
        description={unread > 0 ? `未読 ${unread} 件` : "すべて既読です"}
        action={unread > 0 ? <MarkAllRead /> : undefined}
      />

      <Card>
        <CardTitle>すべての通知</CardTitle>
        {notifications.length === 0 ? (
          <EmptyState title="通知はありません" description="重要な出来事があるとここに表示されます。" />
        ) : (
          <ul className="space-y-2">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`rounded-xl border px-3 py-2.5 ${
                  n.readAt
                    ? "border-line"
                    : n.level === "CRITICAL"
                      ? "border-neg/40 bg-neg/10"
                      : n.level === "WARNING"
                        ? "border-warn/40 bg-warn/10"
                        : "border-accent/30 bg-accent/5"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      n.level === "CRITICAL"
                        ? "offline"
                        : n.level === "WARNING"
                          ? "degraded"
                          : "accent"
                    }
                  >
                    {n.level}
                  </Badge>
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="ml-auto text-[11px] text-ink-dim">
                    {formatRelative(n.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{n.body}</p>
                {n.href && (
                  <Link href={n.href} className="mt-1.5 inline-block text-xs text-accent hover:underline">
                    詳細を見る →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
