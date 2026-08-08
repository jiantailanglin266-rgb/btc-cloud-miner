"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import { Button, ErrorState } from "@/components/ui";

type LoginResult = { twoFactorRequired: boolean; challengeId?: string };

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await apiFetch<LoginResult>("/api/auth/login", {
        json: { email, password },
      });
      if (result.twoFactorRequired && result.challengeId) {
        setChallengeId(result.challengeId);
      } else {
        router.push(next);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ログインに失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/auth/login/2fa", { json: { challengeId, code } });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "認証に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (challengeId) {
    return (
      <form onSubmit={submitTotp} className="space-y-4">
        <div>
          <label htmlFor="code" className="mb-1.5 block text-xs text-ink-muted">
            認証アプリの6桁コード
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="text-center text-lg tracking-[0.4em]"
            autoFocus
            required
          />
        </div>
        {error && <ErrorState message={error} />}
        <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
          {busy ? "確認中…" : "認証する"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setChallengeId(null);
            setCode("");
          }}
          className="w-full text-xs text-ink-muted hover:text-ink"
        >
          戻る
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs text-ink-muted">
          メールアドレス
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs text-ink-muted">
          パスワード
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && <ErrorState message={error} />}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "ログイン中…" : "ログイン"}
      </Button>
    </form>
  );
}
