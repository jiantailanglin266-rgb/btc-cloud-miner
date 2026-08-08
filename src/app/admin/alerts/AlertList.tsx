"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import { Badge, Card, EmptyState, ErrorState } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import type { Alert } from "@/types";

export function AlertList({ alerts, readOnly }: { alerts: Alert[]; readOnly: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAcked, setShowAcked] = useState(false);

  const visible = alerts.filter((a) => showAcked || !a.acknowledgedAt);

  async function acknowledge(id: string) {
    setError(null);
    setBusy(id);
    try {
      await apiFetch("/api/admin", { json: { action: "acknowledge-alert", alertId: id } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "処理に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorState message={error} />}

      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={showAcked}
          onChange={(e) => setShowAcked(e.target.checked)}
          className="w-auto"
        />
        確認済みも表示する
      </label>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="✓"
            title="未確認のアラートはありません"
            description="監視ルールに引っかかった異常はすべて対応済みです。"
          />
        </Card>
      ) : (
        visible.map((a) => (
          <Card
            key={a.id}
            className={
              a.acknowledgedAt
                ? "opacity-60"
                : a.severity === "CRITICAL"
                  ? "border-neg/50"
                  : "border-warn/40"
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={a.severity === "CRITICAL" ? "offline" : "degraded"} dot>
                {a.severity}
              </Badge>
              <Badge tone="neutral">{a.kind}</Badge>
              <span className="text-sm font-medium">{a.message}</span>
              <span className="ml-auto text-[11px] text-ink-dim">
                {formatRelative(a.createdAt)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-dim">
              {Object.entries(a.evidence).map(([k, v]) => (
                <span key={k}>
                  {k} = {String(v)}
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3 border-t border-line pt-2">
              {a.acknowledgedAt ? (
                <span className="text-[11px] text-ink-dim">
                  確認済み（{formatRelative(a.acknowledgedAt)}）
                </span>
              ) : (
                !readOnly && (
                  <button
                    onClick={() => acknowledge(a.id)}
                    disabled={busy === a.id}
                    className="text-xs text-accent hover:underline"
                  >
                    確認済みにする
                  </button>
                )
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
