"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { PoolPayout } from "@/types";

export function AllocationPanel({
  payouts,
  providerNames,
  readOnly,
}: {
  payouts: PoolPayout[];
  providerNames: Record<string, string>;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const pending = payouts.filter((p) => p.allocationStatus === "UNALLOCATED");

  async function run(label: string, action: Record<string, unknown>, success: (r: unknown) => string) {
    setError(null);
    setNotice(null);
    setBusy(label);
    try {
      const result = await apiFetch<unknown>("/api/admin", { json: action });
      setNotice(success(result));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "処理に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}
      {notice && (
        <div className="rounded-xl border border-pos/40 bg-pos/10 px-4 py-3 text-sm text-pos">
          {notice}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              run("sync", { action: "sync-payouts" }, (r) => {
                const x = r as { saved: number; skippedDuplicates: number; capableProviders: number };
                return `payout を同期しました（新規 ${x.saved} 件 / 重複スキップ ${x.skippedDuplicates} 件 / 対応プロバイダー ${x.capableProviders}）`;
              })
            }
          >
            {busy === "sync" ? "同期中…" : "payout を同期"}
          </Button>
          <Button
            disabled={busy !== null || pending.length === 0}
            onClick={() =>
              run("allocate", { action: "allocate-payout" }, (r) => {
                const x = r as { allocated: number; failed: Array<{ reason: string }> };
                return `${x.allocated} 件を配賦しました${x.failed.length > 0 ? `（失敗 ${x.failed.length} 件: ${x.failed[0].reason}）` : ""}`;
              })
            }
          >
            {busy === "allocate" ? "配賦中…" : `未配賦をすべて配賦（${pending.length} 件）`}
          </Button>
        </div>
      )}

      <Card>
        <CardTitle hint="UNIQUE(providerId, externalPayoutId) により同じ payout は二度取り込まれません">
          Pool Payouts
        </CardTitle>
        {payouts.length === 0 ? (
          <EmptyState
            title="payout がありません"
            description="「payout を同期」を実行すると、プロバイダーの払い出し履歴が取り込まれます。"
          />
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>払い出し日時</th>
                  <th>プロバイダー</th>
                  <th>外部ID</th>
                  <th>金額</th>
                  <th>取得元</th>
                  <th>状態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap text-ink-muted">
                      {formatDateTime(p.paidAt)}
                    </td>
                    <td>{providerNames[p.providerId] ?? p.providerId}</td>
                    <td>
                      <code className="text-[11px] text-ink-dim">
                        {p.externalPayoutId.slice(0, 24)}
                      </code>
                    </td>
                    <td className="text-brand">{Number(p.amountBtc).toFixed(8)} BTC</td>
                    <td>
                      <Badge tone={p.source.startsWith("mock") ? "demo" : "online"}>
                        {p.source.startsWith("mock") ? "MOCK" : "LIVE"}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={p.allocationStatus === "ALLOCATED" ? "online" : "degraded"}>
                        {p.allocationStatus === "ALLOCATED" ? "配賦済み" : "未配賦"}
                      </Badge>
                    </td>
                    <td>
                      {!readOnly && p.allocationStatus === "UNALLOCATED" && (
                        <button
                          className="text-xs text-accent hover:underline"
                          disabled={busy !== null}
                          onClick={() =>
                            run(p.id, { action: "allocate-payout", payoutId: p.id }, () =>
                              "配賦しました",
                            )
                          }
                        >
                          配賦
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
