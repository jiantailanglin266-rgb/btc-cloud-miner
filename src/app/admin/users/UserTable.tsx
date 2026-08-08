"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import { Badge, Card, CardTitle, ErrorState, statusTone } from "@/components/ui";
import { formatRelative, statusLabel } from "@/lib/format";
import type { User, KycStatus, UserStatus } from "@/types";

const KYC_OPTIONS: KycStatus[] = [
  "NOT_SUBMITTED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
];
const STATUS_OPTIONS: UserStatus[] = ["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"];

export function UserTable({ initial, readOnly }: { initial: User[]; readOnly: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = initial.filter(
    (u) =>
      !q ||
      u.email.toLowerCase().includes(q.toLowerCase()) ||
      u.name.toLowerCase().includes(q.toLowerCase()),
  );

  async function update(userId: string, patch: Record<string, string>) {
    setError(null);
    setBusyId(userId);
    try {
      await apiFetch("/api/admin", { json: { action: "update-user", userId, ...patch } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新に失敗しました");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardTitle
        action={
          <input
            placeholder="メール・名前で検索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-56 text-xs"
          />
        }
      >
        ユーザー一覧
      </CardTitle>

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>ユーザー</th>
              <th>権限</th>
              <th>2FA</th>
              <th>KYC</th>
              <th>状態</th>
              <th>最終ログイン</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="text-sm">{u.name}</div>
                  <div className="text-[11px] text-ink-dim">{u.email}</div>
                </td>
                <td>
                  <Badge tone={u.role === "USER" ? "neutral" : "brand"}>{u.role}</Badge>
                </td>
                <td>
                  {u.twoFactorEnabled ? (
                    <Badge tone="online">有効</Badge>
                  ) : (
                    <Badge tone="neutral">未設定</Badge>
                  )}
                </td>
                <td>
                  {readOnly ? (
                    <Badge tone={statusTone(u.kycStatus)}>{statusLabel(u.kycStatus)}</Badge>
                  ) : (
                    <select
                      value={u.kycStatus}
                      disabled={busyId === u.id}
                      onChange={(e) => update(u.id, { kycStatus: e.target.value })}
                      className="w-32 text-xs"
                    >
                      {KYC_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  {readOnly ? (
                    <Badge tone={statusTone(u.status)}>{statusLabel(u.status)}</Badge>
                  ) : (
                    <select
                      value={u.status}
                      disabled={busyId === u.id}
                      onChange={(e) => update(u.id, { status: e.target.value })}
                      className="w-28 text-xs"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="whitespace-nowrap text-[11px] text-ink-dim">
                  {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "—"}
                  {u.lastLoginIp && <div>{u.lastLoginIp}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {readOnly && (
        <p className="mt-3 text-[11px] text-ink-dim">
          読み取り専用の権限のため、変更操作はできません。
        </p>
      )}
    </Card>
  );
}
