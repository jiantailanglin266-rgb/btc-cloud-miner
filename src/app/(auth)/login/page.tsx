import Link from "next/link";
import { Suspense } from "react";
import { resolveTenantSettings } from "@/modules/tenant/resolve";
import { LoginForm } from "./LoginForm";
import { isDemoMode } from "@/lib/config";
import { DEMO_ACCOUNTS } from "@/lib/store";

export const metadata = { title: "ログイン" };

export default async function LoginPage() {
  const { settings } = await resolveTenantSettings();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] text-lg font-bold text-black">
          {settings.logoText}
        </span>
        <span className="font-semibold">{settings.brandName}</span>
      </Link>

      <h1 className="text-xl font-semibold">ログイン</h1>
      <p className="mt-1 text-sm text-ink-muted">
        アカウントをお持ちでない場合は{" "}
        <Link href="/register" className="text-accent hover:underline">
          新規登録
        </Link>
      </p>

      {/* useSearchParams を使うため Suspense で包む（Next.js の要件） */}
      <div className="mt-6">
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <LoginForm />
        </Suspense>
      </div>

      {isDemoMode() && (
        <div className="mt-6 rounded-xl border border-purple-400/40 bg-purple-400/10 p-3 text-xs leading-relaxed text-purple-200">
          <p className="mb-1.5 font-medium">デモアカウント</p>
          <ul className="space-y-1">
            <li>
              一般ユーザー: <code>{DEMO_ACCOUNTS.user.email}</code> /{" "}
              <code>{DEMO_ACCOUNTS.user.password}</code>
            </li>
            <li>
              管理者: <code>{DEMO_ACCOUNTS.admin.email}</code> /{" "}
              <code>{DEMO_ACCOUNTS.admin.password}</code>
            </li>
            <li>
              サポート（読取のみ）: <code>{DEMO_ACCOUNTS.support.email}</code> /{" "}
              <code>{DEMO_ACCOUNTS.support.password}</code>
            </li>
          </ul>
        </div>
      )}
    </main>
  );
}
