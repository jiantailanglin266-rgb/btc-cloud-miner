import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { Badge, Card, CardTitle, KeyValue, PageHeader } from "@/components/ui";
import { TwoFactorPanel } from "./TwoFactorPanel";
import { formatDateTime, formatRelative, statusLabel } from "@/lib/format";
import { ROLE_LABEL_JA } from "@/modules/auth/rbac";

export const metadata = { title: "設定" };
export const dynamic = "force-dynamic";

const KYC_HELP: Record<string, string> = {
  NOT_SUBMITTED: "出金するには本人確認が必要です。",
  PENDING: "本人確認を審査中です。完了までお待ちください。",
  APPROVED: "本人確認が完了しています。",
  REJECTED: "本人確認が承認されませんでした。サポートへお問い合わせください。",
  EXPIRED: "本人確認の有効期限が切れました。再提出が必要です。",
};

export default async function SettingsPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const sessions = await store.listSessionsByUser(ctx.user.id);

  return (
    <>
      <PageHeader title="設定" description="アカウント・セキュリティの設定" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>プロフィール</CardTitle>
          <div className="divide-y divide-line">
            <KeyValue label="お名前" value={ctx.user.name} />
            <KeyValue label="メールアドレス" value={ctx.user.email} />
            <KeyValue label="権限" value={ROLE_LABEL_JA[ctx.user.role]} />
            <KeyValue label="登録日" value={formatDateTime(ctx.user.createdAt)} />
            <KeyValue
              label="最終ログイン"
              value={
                ctx.user.lastLoginAt
                  ? `${formatRelative(ctx.user.lastLoginAt)}（${ctx.user.lastLoginIp ?? "IP不明"}）`
                  : "—"
              }
            />
          </div>
        </Card>

        <Card>
          <CardTitle
            action={
              <Badge
                tone={
                  ctx.user.kycStatus === "APPROVED"
                    ? "online"
                    : ctx.user.kycStatus === "PENDING"
                      ? "degraded"
                      : "offline"
                }
              >
                {statusLabel(ctx.user.kycStatus)}
              </Badge>
            }
          >
            本人確認（KYC）
          </CardTitle>
          <p className="text-xs leading-relaxed text-ink-muted">
            {KYC_HELP[ctx.user.kycStatus]}
          </p>
          <p className="mt-3 rounded-lg border border-line bg-white/2 p-2 text-[11px] leading-relaxed text-ink-dim">
            MVP では本人確認のステータス管理のみを実装しています。
            商用運用では外部の eKYC ベンダーと連携し、本人確認書類は当システムで保持しない設計を推奨します。
          </p>
        </Card>

        <TwoFactorPanel enabled={ctx.user.twoFactorEnabled} />

        <Card>
          <CardTitle hint="他の端末からのログインを確認できます">
            ログインセッション
          </CardTitle>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-line px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink">{s.ip ?? "IP不明"}</span>
                  {s.id === ctx.session.id && <Badge tone="online">現在の端末</Badge>}
                </div>
                <div className="mt-1 truncate text-[11px] text-ink-dim">
                  {s.userAgent ?? "不明なブラウザ"}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-dim">
                  最終アクセス {formatRelative(s.lastSeenAt)} · 有効期限{" "}
                  {formatDateTime(s.expiresAt)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
