import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { getProviderHealth } from "@/modules/provider/registry";
import { isAdmin, ROLE_LABEL_JA } from "@/modules/auth/rbac";
import { Header, Sidebar, MobileTabBar, USER_NAV } from "@/components/layout/Shell";
import { isDemoMode } from "@/lib/config";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // ★ proxy.ts のリダイレクトは UX のためのもの。本当の認可はここで行う
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const store = await getStore();
  const [notifications, providers] = await Promise.all([
    store.listNotifications(ctx.tenant.id, ctx.user.id),
    getProviderHealth(ctx.tenant.id),
  ]);

  const unread = notifications.filter((n) => !n.readAt).length;
  const active = providers.filter((p) => p.status !== "MAINTENANCE");
  const networkStatus = active.some((p) => p.status === "OFFLINE")
    ? "OFFLINE"
    : active.some((p) => p.status === "DEGRADED")
      ? "DEGRADED"
      : "ONLINE";

  return (
    <div className="min-h-dvh">
      <Header
        brandName={ctx.settings.brandName}
        logoText={ctx.settings.logoText}
        userName={ctx.user.name}
        userRole={ROLE_LABEL_JA[ctx.user.role]}
        unreadCount={unread}
        isAdmin={isAdmin(ctx.user)}
        demo={isDemoMode()}
        networkStatus={networkStatus}
      />
      <div className="flex">
        <Sidebar items={USER_NAV} />
        <main className="min-w-0 flex-1 px-4 pb-24 pt-5 sm:px-6 lg:pb-10">{children}</main>
      </div>
      <MobileTabBar />
    </div>
  );
}
