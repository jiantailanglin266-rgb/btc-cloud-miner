"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  statusTone,
} from "@/components/ui";
import { formatDateTime, formatRelative, truncateMiddle, statusLabel } from "@/lib/format";
import type { Withdrawal } from "@/types";

const TABS = [
  { key: "pending", label: "要対応" },
  { key: "approved", label: "承認済み" },
  { key: "done", label: "完了・却下" },
] as const;

export function WithdrawalQueue({
  initial,
  canApprove,
  currentUserId,
}: {
  initial: Withdrawal[];
  canApprove: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const filtered = initial.filter((w) => {
    if (tab === "pending") return w.status === "PENDING_REVIEW" || w.status === "FLAGGED";
    if (tab === "approved")
      return ["APPROVED", "BROADCASTING", "BROADCASTED"].includes(w.status);
    return ["CONFIRMED", "REJECTED", "FAILED", "CANCELLED"].includes(w.status);
  });

  async function act(w: Withdrawal, action: "approve" | "reject") {
    setError(null);
    setNotice(null);
    setBusyId(w.id);
    try {
      await apiFetch("/api/admin", {
        json: {
          action: action === "approve" ? "approve-withdrawal" : "reject-withdrawal",
          withdrawalId: w.id,
          note: notes[w.id] ?? (action === "reject" ? "" : ""),
          code: codes[w.id] ?? "",
        },
      });
      setNotice(
        action === "approve"
          ? "承認しました。必要な承認数に達すると送金処理が実行されます。"
          : "却下しました。保留されていた残高をユーザーへ戻しました。",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "処理に失敗しました");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-hidden rounded-xl border border-line-strong">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 text-xs transition ${
              tab === t.key ? "bg-white/10 text-ink" : "text-ink-muted hover:bg-white/5"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorState message={error} />}
      {notice && (
        <div className="rounded-xl border border-pos/40 bg-pos/10 px-4 py-3 text-sm text-pos">
          {notice}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="該当する出金はありません"
            description="新しい申請があるとここに表示されます。"
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((w) => {
            const approvedCount = w.approvals.filter((a) => a.decision === "APPROVE").length;
            const isSelfRequest = w.userId === currentUserId;
            const alreadyApproved = w.approvals.some((a) => a.approverId === currentUserId);
            const actionable =
              (w.status === "PENDING_REVIEW" || w.status === "FLAGGED") &&
              canApprove &&
              !isSelfRequest &&
              !alreadyApproved;

            return (
              <Card key={w.id} className={w.status === "FLAGGED" ? "border-neg/40" : ""}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(w.status)} dot>
                        {statusLabel(w.status)}
                      </Badge>
                      <span className="text-sm font-medium">
                        {Number(w.amountBtc).toFixed(8)} BTC
                      </span>
                      <span className="text-xs text-ink-muted">{w.userEmail}</span>
                      <span
                        className={`text-xs ${w.riskScore >= 50 ? "text-neg" : "text-ink-dim"}`}
                      >
                        risk {w.riskScore}
                      </span>
                    </div>
                    <div className="mt-1.5 space-y-0.5 text-[11px] text-ink-dim">
                      <div>
                        宛先 <code>{truncateMiddle(w.address, 14, 10)}</code>
                      </div>
                      <div>
                        申請 {formatDateTime(w.createdAt)}（{formatRelative(w.createdAt)}）
                        {w.requestedIp && ` · IP ${w.requestedIp}`}
                      </div>
                      <div>
                        手数料 {Number(w.feeBtc).toFixed(8)} BTC → 実送金{" "}
                        {Number(w.netBtc).toFixed(8)} BTC
                      </div>
                      <div>
                        承認 {approvedCount} / {w.requiredApprovals}
                      </div>
                    </div>
                  </div>
                </div>

                {w.riskReasons.length > 0 && (
                  <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-2.5">
                    <div className="text-[11px] font-medium text-warn">異常検知の理由</div>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
                      {w.riskReasons.map((r) => (
                        <li key={r}>・{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {w.approvals.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-line pt-2 text-[11px] text-ink-muted">
                    {w.approvals.map((a) => (
                      <div key={`${a.approverId}-${a.decidedAt}`}>
                        {a.decision === "APPROVE" ? "承認" : "却下"} — {a.approverEmail}（
                        {formatDateTime(a.decidedAt)}）
                        {a.note && ` / ${a.note}`}
                      </div>
                    ))}
                  </div>
                )}

                {w.txId && (
                  <div className="mt-3 break-all border-t border-line pt-2 text-[11px] text-ink-dim">
                    tx: <code>{w.txId}</code>
                    {w.txId.startsWith("demo-") && (
                      <span className="ml-2 text-purple-300">
                        （デモ環境のため実在しません）
                      </span>
                    )}
                  </div>
                )}

                {actionable && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                      <input
                        placeholder="メモ（却下時は理由を必須で入力）"
                        value={notes[w.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [w.id]: e.target.value })}
                        maxLength={500}
                      />
                      <input
                        placeholder="2FA コード"
                        inputMode="numeric"
                        maxLength={6}
                        value={codes[w.id] ?? ""}
                        onChange={(e) =>
                          setCodes({ ...codes, [w.id]: e.target.value.replace(/\D/g, "") })
                        }
                        className="text-center tracking-[0.2em]"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        disabled={busyId === w.id}
                        onClick={() => act(w, "approve")}
                      >
                        承認する
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busyId === w.id || !(notes[w.id] ?? "").trim()}
                        onClick={() => act(w, "reject")}
                      >
                        却下する
                      </Button>
                    </div>
                  </div>
                )}

                {(w.status === "PENDING_REVIEW" || w.status === "FLAGGED") && !actionable && (
                  <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink-dim">
                    {isSelfRequest
                      ? "自分が申請した出金は承認できません（4-eyes 原則）。"
                      : alreadyApproved
                        ? "既にあなたの承認は記録されています。他の管理者の承認をお待ちください。"
                        : "承認権限がありません。"}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
