"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import { Button, ErrorState } from "@/components/ui";

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = form.password.length > 0 && form.password.length < 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/auth/register", { json: form });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1.5 block text-xs text-ink-muted">
          お名前
        </label>
        <input
          id="name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          maxLength={100}
        />
      </div>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs text-ink-muted">
          メールアドレス
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs text-ink-muted">
          パスワード（10文字以上）
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
          minLength={10}
        />
        {tooShort && (
          <p className="mt-1 text-[11px] text-warn">10文字以上にしてください</p>
        )}
      </div>
      {error && <ErrorState message={error} />}
      <Button type="submit" disabled={busy || tooShort} className="w-full">
        {busy ? "作成中…" : "アカウントを作成"}
      </Button>
    </form>
  );
}
