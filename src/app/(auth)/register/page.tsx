import Link from "next/link";
import { resolveTenantSettings } from "@/modules/tenant/resolve";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "新規登録" };

export default async function RegisterPage() {
  const { settings } = await resolveTenantSettings();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] text-lg font-bold text-black">
          {settings.logoText}
        </span>
        <span className="font-semibold">{settings.brandName}</span>
      </Link>

      <h1 className="text-xl font-semibold">アカウントを作成</h1>
      <p className="mt-1 text-sm text-ink-muted">
        すでにアカウントをお持ちの場合は{" "}
        <Link href="/login" className="text-accent hover:underline">
          ログイン
        </Link>
      </p>

      <div className="mt-6">
        <RegisterForm />
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-ink-dim">
        登録することで
        <Link href="/legal/terms" className="text-accent hover:underline">
          利用規約
        </Link>
        ・
        <Link href="/legal/privacy" className="text-accent hover:underline">
          プライバシーポリシー
        </Link>
        ・
        <Link href="/legal/risk" className="text-accent hover:underline">
          リスク開示
        </Link>
        に同意したものとみなされます。マイニング収益は保証されず、条件によっては損失が生じる可能性があります。
      </p>
    </main>
  );
}
