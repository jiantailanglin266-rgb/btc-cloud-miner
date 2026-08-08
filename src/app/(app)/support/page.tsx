import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { Badge, Card, CardTitle, EmptyState, PageHeader, statusTone } from "@/components/ui";
import { formatDateTime, statusLabel } from "@/lib/format";

export const metadata = { title: "サポート" };
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const tickets = await store.listTickets(ctx.tenant.id, ctx.user.id);

  return (
    <>
      <PageHeader title="サポート" description="お問い合わせの履歴" />

      <Card>
        <CardTitle>お問い合わせ</CardTitle>
        {tickets.length === 0 ? (
          <EmptyState
            title="お問い合わせはありません"
            description="ご不明な点があればお気軽にお問い合わせください。"
          />
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => (
              <div key={t.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge>
                  <span className="text-sm font-medium">{t.subject}</span>
                  <span className="text-[11px] text-ink-dim">{t.category}</span>
                  <span className="ml-auto text-[11px] text-ink-dim">
                    {formatDateTime(t.updatedAt)}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {t.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                        m.isStaff
                          ? "border border-accent/30 bg-accent/5"
                          : "border border-line bg-white/2"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-dim">
                        <span className={m.isStaff ? "text-accent" : ""}>
                          {m.authorName}
                          {m.isStaff && "（サポート）"}
                        </span>
                        <span>{formatDateTime(m.createdAt)}</span>
                      </div>
                      {m.body}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 rounded-lg border border-line bg-white/2 p-3 text-[11px] leading-relaxed text-ink-dim">
          MVP ではチケットの閲覧のみを実装しています。
          新規作成・返信の投稿 API（POST /api/support/tickets）は設計済みで、
          商用版でメール通知と併せて有効化します。
        </p>
      </Card>
    </>
  );
}
