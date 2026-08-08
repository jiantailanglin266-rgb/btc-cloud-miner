"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { Badge } from "@/components/ui";

export type NavItem = { href: string; label: string; icon: string };

export const USER_NAV: NavItem[] = [
  { href: "/dashboard", label: "ダッシュボード", icon: "⌂" },
  { href: "/mining", label: "マイニング", icon: "⛏" },
  { href: "/mining/workers", label: "ワーカー", icon: "▤" },
  { href: "/revenue", label: "収益", icon: "¥" },
  { href: "/simulator", label: "シミュレーター", icon: "◫" },
  { href: "/wallet", label: "ウォレット", icon: "⬢" },
  { href: "/contracts", label: "契約・プラン", icon: "▦" },
  { href: "/network", label: "ネットワーク", icon: "⌗" },
  { href: "/notifications", label: "通知", icon: "✉" },
  { href: "/support", label: "サポート", icon: "☏" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "概要", icon: "⌂" },
  { href: "/admin/users", label: "ユーザー", icon: "☰" },
  { href: "/admin/withdrawals", label: "出金承認", icon: "⬢" },
  { href: "/admin/providers", label: "プロバイダー", icon: "⛏" },
  { href: "/admin/workers", label: "ワーカー", icon: "▤" },
  { href: "/admin/plans", label: "プラン・料金", icon: "▦" },
  { href: "/admin/tenant", label: "テナント設定", icon: "◈" },
  { href: "/admin/incidents", label: "障害情報", icon: "⚠" },
  { href: "/admin/ai", label: "AI インサイト", icon: "✦" },
  { href: "/admin/audit", label: "監査ログ", icon: "▣" },
  { href: "/admin/health", label: "稼働状況", icon: "◉" },
];

/** モバイル下部タブ（主要 4 つのみ） */
const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "ダッシュ", icon: "⌂" },
  { href: "/mining/workers", label: "採掘", icon: "⛏" },
  { href: "/wallet", label: "資産", icon: "⬢" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-line px-2 py-4 lg:flex">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/dashboard" &&
            item.href !== "/admin" &&
            pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
              active
                ? "bg-white/8 text-ink"
                : "text-ink-muted hover:bg-white/5 hover:text-ink"
            }`}
          >
            <span className="w-4 text-center text-xs opacity-70">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur lg:hidden">
      {MOBILE_TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] ${
              active ? "text-brand" : "text-ink-muted"
            }`}
          >
            <span className="text-base">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Header({
  brandName,
  logoText,
  userName,
  userRole,
  unreadCount,
  isAdmin,
  demo,
  networkStatus,
}: {
  brandName: string;
  logoText: string;
  userName: string;
  userRole: string;
  unreadCount: number;
  isAdmin: boolean;
  demo: boolean;
  networkStatus: "ONLINE" | "DEGRADED" | "OFFLINE";
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await apiFetch("/api/auth/logout", { json: {} }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] text-sm font-bold text-black">
            {logoText}
          </span>
          <span className="hidden text-sm font-semibold sm:block">{brandName}</span>
        </Link>

        {demo && <Badge tone="demo">DEMO</Badge>}
        <Badge
          tone={
            networkStatus === "ONLINE"
              ? "online"
              : networkStatus === "DEGRADED"
                ? "degraded"
                : "offline"
          }
          dot
        >
          <span className="hidden sm:inline">設備 </span>
          {networkStatus}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/notifications"
            className="relative rounded-lg px-2 py-1.5 text-sm text-ink-muted hover:text-ink"
            aria-label={`通知${unreadCount > 0 ? `（未読 ${unreadCount} 件）` : ""}`}
          >
            ✉
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-neg text-[9px] font-medium text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-white/5 px-2.5 py-1.5 text-xs"
            >
              <span className="max-w-[8rem] truncate">{userName}</span>
              <span className="text-ink-dim">▾</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-line-strong bg-card p-1 shadow-xl">
                <div className="px-3 py-2 text-[11px] text-ink-dim">{userRole}</div>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-white/5 hover:text-ink"
                >
                  設定
                </Link>
                {isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-white/5 hover:text-ink"
                  >
                    管理コンソール
                  </Link>
                )}
                <button
                  onClick={logout}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neg hover:bg-neg/10"
                >
                  ログアウト
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
