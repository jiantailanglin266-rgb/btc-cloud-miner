"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import { Badge, Button, Card, CardTitle, ErrorState } from "@/components/ui";
import type { TestConnectionResult } from "@/types";

const KINDS = [
  { value: "F2POOL", label: "F2Pool（アカウント名で接続）" },
  { value: "BRAIINS", label: "Braiins Pool（read-only トークン）" },
  { value: "POOL_REST", label: "汎用 REST プール" },
  { value: "FARM_GENERIC", label: "提携マイニングファーム" },
  { value: "CUSTOMER_OWNED", label: "顧客保有 ASIC（プール委譲）" },
  { value: "MOCK", label: "Mock（デモ）" },
];

const CODE_TONE: Record<string, "online" | "degraded" | "offline"> = {
  CONNECTED: "online",
  RATE_LIMITED: "degraded",
  AUTHENTICATION_FAILED: "offline",
  TIMEOUT: "offline",
  INVALID_RESPONSE: "offline",
  PROVIDER_OFFLINE: "offline",
};

export function AddProvider() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    kind: "F2POOL",
    name: "",
    region: "",
    endpoint: "",
    secret: "",
    workerPrefix: "",
    poolName: "",
  });
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [mask, setMask] = useState<string | null>(null);
  const [test, setTest] = useState<TestConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await apiFetch<{ providerId: string; credentialMask: string | null }>(
        "/api/admin",
        { json: { action: "create-provider", ...form } },
      );
      setCreatedId(r.providerId);
      setMask(r.credentialMask);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function runTest(providerId: string) {
    setError(null);
    setBusy(true);
    setTest(null);
    try {
      const r = await apiFetch<TestConnectionResult>("/api/admin", {
        json: { action: "test-connection", providerId },
      });
      setTest(r);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "接続テストに失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + プロバイダーを追加
      </Button>
    );
  }

  return (
    <Card className="mb-4">
      <CardTitle
        hint="API トークン/アカウント名は AES-256-GCM で暗号化して保存されます（平文は保持しません）"
        action={
          <button onClick={() => setOpen(false)} className="text-xs text-ink-muted hover:text-ink">
            閉じる
          </button>
        }
      >
        プロバイダーを追加
      </CardTitle>

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {!createdId ? (
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          <Field label="種別">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="表示名">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="My F2Pool"
            />
          </Field>
          <Field label="API トークン / アカウント名">
            <input
              type="password"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder={form.kind === "F2POOL" ? "f2pool のアカウント名" : "read-only トークン"}
              autoComplete="off"
            />
          </Field>
          <Field label="Pool URL（任意）">
            <input
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder="既定を使う場合は空欄"
            />
          </Field>
          <Field label="Worker Prefix（任意）">
            <input
              value={form.workerPrefix}
              onChange={(e) => setForm({ ...form, workerPrefix: e.target.value })}
              placeholder="acme."
            />
          </Field>
          <Field label="リージョン（任意）">
            <input
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy || !form.name}>
              {busy ? "登録中…" : "登録する"}
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
              read-only（統計閲覧のみ）の資格情報を使用してください。出金権限を持つ API キーは登録しないでください。
            </p>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-pos/40 bg-pos/10 px-3 py-2 text-sm text-pos">
            登録しました（ID: {createdId}）
            {mask && <span className="ml-2 text-ink-muted">資格情報: {mask}</span>}
          </div>

          <Button disabled={busy} onClick={() => runTest(createdId)}>
            {busy ? "接続中…" : "TEST CONNECTION"}
          </Button>

          {test && (
            <div className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2">
                <Badge tone={CODE_TONE[test.code]} dot>
                  {test.code}
                </Badge>
                <span className="text-sm">{test.message}</span>
                {test.latencyMs !== null && (
                  <span className="ml-auto text-[11px] text-ink-dim">{test.latencyMs} ms</span>
                )}
              </div>
              {test.info && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-ink-muted sm:grid-cols-3">
                  <span>Provider: {test.info.provider}</span>
                  {test.info.account && <span>Account: {test.info.account}</span>}
                  <span>Workers: {test.info.workerCount ?? "—"}</span>
                  <span>
                    Hashrate:{" "}
                    {test.info.currentHashrateThs !== null
                      ? `${test.info.currentHashrateThs.toFixed(2)} TH/s`
                      : "—"}
                  </span>
                  <span>Unpaid: {test.info.unpaidBtc ?? "—"} BTC</span>
                  <span>Paid: {test.info.paidBtc ?? "—"} BTC</span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => {
              setOpen(false);
              setCreatedId(null);
              setTest(null);
              setForm({ ...form, name: "", secret: "" });
            }}
            className="text-xs text-ink-muted hover:text-ink"
          >
            完了
          </button>
        </div>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-ink-muted">{label}</label>
      {children}
    </div>
  );
}
