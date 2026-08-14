"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/client";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState, Stat } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ReconciliationReport } from "@/modules/revenue/reconciliation";

export function ReconciliationView({ initial }: { initial: ReconciliationReport }) {
  const [report, setReport] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError(null);
    setBusy(true);
    try {
      const r = await apiFetch<ReconciliationReport>("/api/admin", { json: { action: "reconcile" } });
      setReport(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "照合に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pool Payout 合計" value={`${report.totalPoolPayoutBtc} BTC`} />
        <Stat label="配賦 gross 合計" value={`${report.totalAllocatedBtc} BTC`} tone="brand" />
        <Stat label="ユーザー Net 合計" value={`${report.totalUserNetBtc} BTC`} tone="pos" />
        <Stat
          label="不一致"
          value={String(report.mismatchCount)}
          tone={report.mismatchCount > 0 ? "neg" : "pos"}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-dim">
          最終照合: {formatDateTime(report.generatedAt)}
        </span>
        <Button variant="secondary" disabled={busy} onClick={refresh}>
          {busy ? "照合中…" : "再照合する"}
        </Button>
      </div>

      <Card>
        <CardTitle
          hint={
            report.mismatchCount === 0
              ? "すべての配賦済み payout が Ledger と一致しています"
              : "不一致があります。LEDGER_IMBALANCE アラートを確認してください"
          }
        >
          Payout 別 照合
        </CardTitle>
        {report.rows.length === 0 ? (
          <EmptyState
            title="payout がありません"
            description="payout を同期・配賦すると照合対象になります。"
          />
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>払い出し日時</th>
                  <th>外部ID</th>
                  <th>Pool Payout</th>
                  <th>配賦 gross</th>
                  <th>Platform Fee</th>
                  <th>User Net</th>
                  <th>差分(sat)</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.payoutId}>
                    <td className="whitespace-nowrap text-ink-muted">{formatDateTime(r.paidAt)}</td>
                    <td>
                      <code className="text-[11px] text-ink-dim">
                        {r.externalPayoutId.slice(0, 20)}
                      </code>
                    </td>
                    <td>{r.poolPayoutBtc}</td>
                    <td>{r.allocatedGrossBtc}</td>
                    <td className="text-ink-muted">{r.platformFeeBtc}</td>
                    <td className="text-pos">{r.userNetBtc}</td>
                    <td className={r.differenceSat !== "0" ? "text-neg" : "text-ink-dim"}>
                      {r.differenceSat}
                    </td>
                    <td>
                      <Badge
                        tone={
                          r.status === "OK"
                            ? "online"
                            : r.status === "UNALLOCATED"
                              ? "degraded"
                              : "offline"
                        }
                      >
                        {r.status === "OK" ? "一致" : r.status === "UNALLOCATED" ? "未配賦" : "不一致"}
                      </Badge>
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
