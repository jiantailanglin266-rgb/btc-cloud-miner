"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import { Badge, Button, Card, CardTitle, ErrorState, KeyValue, statusTone } from "@/components/ui";
import { formatRelative, statusLabel } from "@/lib/format";
import type { MiningProvider, ProviderHealth } from "@/types";

export function ProviderPanel({
  providers,
  health,
  readOnly,
}: {
  providers: MiningProvider[];
  health: ProviderHealth[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const healthById = new Map(health.map((h) => [h.providerId, h]));

  async function update(providerId: string, patch: Record<string, unknown>) {
    setError(null);
    setBusy(providerId);
    try {
      await apiFetch("/api/admin", {
        json: { action: "update-provider", providerId, ...patch },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function syncAll() {
    setError(null);
    setBusy("sync");
    try {
      const result = await apiFetch<{ snapshots: number }>("/api/admin", {
        json: { action: "sync-providers" },
      });
      alert(`同期しました（${result.snapshots} 件のスナップショットを保存）`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "同期に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}

      {!readOnly && (
        <div className="flex justify-end">
          <Button variant="secondary" disabled={busy === "sync"} onClick={syncAll}>
            {busy === "sync" ? "同期中…" : "今すぐ統計を同期する"}
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {providers.map((p) => {
          const h = healthById.get(p.id);
          return (
            <Card key={p.id}>
              <CardTitle
                hint={`${p.kind} · ${p.region || "リージョン未設定"} · 優先度 ${p.priority}`}
                action={
                  <Badge tone={statusTone(h?.status ?? p.status)} dot>
                    {statusLabel(h?.status ?? p.status)}
                  </Badge>
                }
              >
                {p.name}
              </CardTitle>

              <div className="divide-y divide-line">
                <KeyValue label="エンドポイント" value={p.endpoint ?? "—"} />
                <KeyValue
                  label="認証情報の参照名"
                  value={p.credentialsRef ?? "—（不要）"}
                />
                <KeyValue label="プール" value={p.poolName || "—"} />
                <KeyValue label="支払方式" value={p.payoutScheme} />
                <KeyValue
                  label="最終成功"
                  value={p.lastOkAt ? formatRelative(p.lastOkAt) : "未取得"}
                />
                {p.lastError && (
                  <KeyValue label="直近のエラー" value={p.lastError} tone="neg" />
                )}
                {h?.message && <KeyValue label="ヘルス" value={h.message} tone="muted" />}
              </div>

              {!readOnly && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button
                    variant="secondary"
                    disabled={busy === p.id}
                    onClick={() => update(p.id, { enabled: !p.enabled })}
                  >
                    {p.enabled ? "無効にする" : "有効にする"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy === p.id}
                    onClick={() =>
                      update(p.id, {
                        status: p.status === "MAINTENANCE" ? "ONLINE" : "MAINTENANCE",
                      })
                    }
                  >
                    {p.status === "MAINTENANCE" ? "メンテナンス解除" : "メンテナンスにする"}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
