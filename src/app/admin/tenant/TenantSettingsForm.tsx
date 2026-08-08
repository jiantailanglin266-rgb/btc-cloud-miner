"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import { Button, Card, CardTitle, ErrorState } from "@/components/ui";
import type { TenantSettings } from "@/types";

export function TenantSettingsForm({
  initial,
  tenantName,
}: {
  initial: TenantSettings;
  tenantName: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    brandName: initial.brandName,
    logoText: initial.logoText,
    colorPrimary: initial.colorPrimary,
    colorAccent: initial.colorAccent,
    platformFeeRate: initial.platformFeeRate,
    poolFeeRate: initial.poolFeeRate,
    electricityPriceKwh: initial.electricityPriceKwh,
    minWithdrawalBtc: initial.minWithdrawalBtc,
    withdrawalFeeBtc: initial.withdrawalFeeBtc,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await apiFetch("/api/admin", {
        json: { action: "update-tenant-settings", ...form },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint={`テナント: ${tenantName}`}>ブランディング</CardTitle>
          <div className="space-y-3">
            <Field label="サービス表示名">
              <input
                value={form.brandName}
                onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                maxLength={60}
                required
              />
            </Field>
            <Field label="ロゴ文字（1〜4文字）">
              <input
                value={form.logoText}
                onChange={(e) => setForm({ ...form, logoText: e.target.value })}
                maxLength={4}
                required
                className="w-24 text-center"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="プライマリカラー">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.colorPrimary}
                    onChange={(e) => setForm({ ...form, colorPrimary: e.target.value })}
                    className="h-9 w-14 cursor-pointer p-1"
                  />
                  <code className="text-xs">{form.colorPrimary}</code>
                </div>
              </Field>
              <Field label="アクセントカラー">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.colorAccent}
                    onChange={(e) => setForm({ ...form, colorAccent: e.target.value })}
                    className="h-9 w-14 cursor-pointer p-1"
                  />
                  <code className="text-xs">{form.colorAccent}</code>
                </div>
              </Field>
            </div>
            <div
              className="rounded-xl border border-line p-3"
              style={
                {
                  "--brand-primary": form.colorPrimary,
                  "--brand-accent": form.colorAccent,
                } as React.CSSProperties
              }
            >
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] text-sm font-bold text-black">
                  {form.logoText || "?"}
                </span>
                <span className="text-sm font-semibold">{form.brandName || "…"}</span>
              </div>
              <p className="mt-2 text-[11px] text-ink-dim">プレビュー</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>手数料・出金ポリシー</CardTitle>
          <div className="space-y-3">
            <Field label={`プラットフォーム手数料率（${(form.platformFeeRate * 100).toFixed(2)}%）`}>
              <input
                type="number"
                step="0.001"
                min={0}
                max={0.5}
                value={form.platformFeeRate}
                onChange={(e) =>
                  setForm({ ...form, platformFeeRate: Number(e.target.value) })
                }
              />
            </Field>
            <Field label={`プール手数料率（${(form.poolFeeRate * 100).toFixed(2)}%）`}>
              <input
                type="number"
                step="0.001"
                min={0}
                max={0.5}
                value={form.poolFeeRate}
                onChange={(e) => setForm({ ...form, poolFeeRate: Number(e.target.value) })}
              />
            </Field>
            <Field label="電力単価（USD / kWh）">
              <input
                type="number"
                step="0.001"
                min={0}
                max={10}
                value={form.electricityPriceKwh}
                onChange={(e) =>
                  setForm({ ...form, electricityPriceKwh: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="最低出金額（BTC）">
              <input
                value={form.minWithdrawalBtc}
                onChange={(e) => setForm({ ...form, minWithdrawalBtc: e.target.value })}
                pattern="\d+(\.\d{1,8})?"
              />
            </Field>
            <Field label="出金手数料（BTC）">
              <input
                value={form.withdrawalFeeBtc}
                onChange={(e) => setForm({ ...form, withdrawalFeeBtc: e.target.value })}
                pattern="\d+(\.\d{1,8})?"
              />
            </Field>
          </div>
        </Card>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存する"}
        </Button>
        {saved && <span className="text-sm text-pos">保存しました</span>}
        {error && <ErrorState message={error} />}
      </div>
    </form>
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
