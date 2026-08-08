import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/modules/auth/session";
import { isAdmin, ROLE_LABEL_JA, isReadOnly } from "@/modules/auth/rbac";
import { Header, Sidebar, ADMIN_NAV } from "@/components/layout/Shell";
import { isDemoMode } from "@/lib/config";
import { Badge } from "@/components/ui";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // ★ 管理コンソールの認可はここで必ず行う（proxy のリダイレクトに依存しない）
  if (!isAdmin(ctx.user)) redirect("/dashboard");

  return (
    <div className="min-h-dvh">
      <Header
        brandName={`${ctx.settings.brandName} 管理`}
        logoText={ctx.settings.logoText}
        userName={ctx.user.name}
        userRole={ROLE_LABEL_JA[ctx.user.role]}
        unreadCount={0}
        isAdmin
        demo={isDemoMode()}
        networkStatus="ONLINE"
      />
      <div className="flex">
        <Sidebar items={ADMIN_NAV} />
        <main className="min-w-0 flex-1 px-4 pb-16 pt-5 sm:px-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="brand">管理コンソール</Badge>
            {isReadOnly(ctx.user) && (
              <Badge tone="degraded">
                読み取り専用の権限です（承認・変更操作はできません）
              </Badge>
            )}
            <Link
              href="/dashboard"
              className="ml-auto text-xs text-ink-muted hover:text-ink"
            >
              ← ユーザー画面へ
            </Link>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
