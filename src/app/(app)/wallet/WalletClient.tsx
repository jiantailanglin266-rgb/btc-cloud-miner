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
import { formatBtc, formatUsd, formatDateTime, formatRelative, truncateMiddle, statusLabel } from "@/lib/format";
import type { WalletAddress, WalletBalance, Withdrawal } from "@/types";

type Props = {
  initial: {
    balance: WalletBalance;
    addresses: WalletAddress[];
    withdrawals: Withdrawal[];
  };
  settings: {
    minWithdrawalBtc: string;
    withdrawalFeeBtc: string;
    addressCooldownHours: number;
    twoApproverThresholdBtc: string;
  };
  twoFactorEnabled: boolean;
  kycStatus: string;
  withdrawalEnabled: boolean;
  btcPriceUsd: number;
};

export function WalletClient({
  initial,
  settings,
  twoFactorEnabled,
  kycStatus,
  withdrawalEnabled,
  btcPriceUsd,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // アドレス登録フォーム
  const [newAddress, setNewAddress] = useState({ address: "", label: "", code: "" });
  const [showAddForm, setShowAddForm] = useState(false);

  // 出金フォーム
  const [wd, setWd] = useState({ addressId: "", amountBtc: "", code: "" });

  const usableAddresses = state.addresses.filter(
    (a) => new Date(a.usableAt).getTime() <= Date.now(),
  );

  const feeBtc = Number(settings.withdrawalFeeBtc);
  const amount = Number(wd.amountBtc) || 0;
  const netBtc = Math.max(0, amount - feeBtc);
  const needsTwoApprovers = amount > Number(settings.twoApproverThresholdBtc);

  const blockers: string[] = [];
  if (!withdrawalEnabled) blockers.push("出金機能が一時停止されています");
  if (kycStatus !== "APPROVED") blockers.push("本人確認（KYC）が完了していません");
  if (!twoFactorEnabled) blockers.push("2段階認証が未設定です（設定画面から有効にしてください）");
  if (usableAddresses.length === 0)
    blockers.push("利用可能な出金先アドレスがありません（登録後のクールダウン中の可能性があります）");

  async function refresh() {
    const data = await apiFetch<Props["initial"]>("/api/wallet");
    setState(data);
    router.refresh();
  }

  async function run(fn: () => Promise<void>, successMessage: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      await refresh();
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "処理に失敗しました");
    } finally {
      setBusy(false);
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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 出金先アドレス */}
        <Card>
          <CardTitle
            hint={`登録から ${settings.addressCooldownHours} 時間はクールダウン期間です`}
            action={
              <Button variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
                {showAddForm ? "閉じる" : "+ 追加"}
              </Button>
            }
          >
            出金先アドレス
          </CardTitle>

          {state.addresses.length === 0 ? (
            <EmptyState
              title="出金先アドレスがありません"
              description="出金するには、まず Bitcoin アドレスを登録してください。"
              action={
                <Button onClick={() => setShowAddForm(true)}>アドレスを追加</Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {state.addresses.map((a) => {
                const usable = new Date(a.usableAt).getTime() <= Date.now();
                return (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{a.label}</div>
                      <code className="text-[11px] text-ink-dim">
                        {truncateMiddle(a.address, 12, 8)}
                      </code>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {usable ? (
                        <Badge tone="online">利用可能</Badge>
                      ) : (
                        <Badge tone="degraded">
                          {Math.ceil(
                            (new Date(a.usableAt).getTime() - Date.now()) / 3_600_000,
                          )}
                          時間後
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {showAddForm && (
            <form
              className="mt-3 space-y-3 border-t border-line pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await apiFetch("/api/wallet", {
                    json: { action: "create-address", ...newAddress },
                  });
                  setNewAddress({ address: "", label: "", code: "" });
                  setShowAddForm(false);
                }, "アドレスを登録しました。クールダウン期間の経過後に利用できます。");
              }}
            >
              <div>
                <label className="mb-1.5 block text-xs text-ink-muted">
                  Bitcoin アドレス
                </label>
                <input
                  value={newAddress.address}
                  onChange={(e) =>
                    setNewAddress({ ...newAddress, address: e.target.value.trim() })
                  }
                  placeholder="bc1..."
                  required
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[10px] text-ink-dim">
                  チェックサムまで検証します。1文字でも誤っていると資産が永久に失われるため、
                  必ずコピー＆ペーストで入力してください。
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-ink-muted">ラベル</label>
                <input
                  value={newAddress.label}
                  onChange={(e) => setNewAddress({ ...newAddress, label: e.target.value })}
                  placeholder="メインウォレット"
                  required
                  maxLength={50}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-ink-muted">
                  2段階認証コード
                </label>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={newAddress.code}
                  onChange={(e) =>
                    setNewAddress({ ...newAddress, code: e.target.value.replace(/\D/g, "") })
                  }
                  className="text-center tracking-[0.3em]"
                  required
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                登録する
              </Button>
            </form>
          )}
        </Card>

        {/* 出金申請 */}
        <Card>
          <CardTitle
            hint={`最低出金額 ${settings.minWithdrawalBtc} BTC / 手数料 ${settings.withdrawalFeeBtc} BTC`}
          >
            出金申請
          </CardTitle>

          {blockers.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
              {blockers.map((b) => (
                <li key={b}>・{b}</li>
              ))}
            </ul>
          )}

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                async () => {
                  await apiFetch("/api/wallet", {
                    json: { action: "withdraw", ...wd },
                    headers: {
                      // ネットワーク再送で二重申請にならないようにする
                      "Idempotency-Key": `${wd.addressId}:${wd.amountBtc}:${Date.now()}`,
                    },
                  });
                  setWd({ addressId: "", amountBtc: "", code: "" });
                },
                "出金申請を受け付けました。管理者の承認後に送金されます。",
              );
            }}
          >
            <div>
              <label className="mb-1.5 block text-xs text-ink-muted">金額（BTC）</label>
              <input
                inputMode="decimal"
                value={wd.amountBtc}
                onChange={(e) =>
                  setWd({ ...wd, amountBtc: e.target.value.replace(/[^\d.]/g, "") })
                }
                placeholder={settings.minWithdrawalBtc}
                disabled={blockers.length > 0}
                required
              />
              <div className="mt-1 flex justify-between text-[11px] text-ink-dim">
                <span>利用可能: {formatBtc(state.balance.availableBtc)}</span>
                <span>≈ {formatUsd(amount * btcPriceUsd)}</span>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-ink-muted">出金先</label>
              <select
                value={wd.addressId}
                onChange={(e) => setWd({ ...wd, addressId: e.target.value })}
                disabled={blockers.length > 0}
                required
              >
                <option value="">選択してください</option>
                {usableAddresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} — {truncateMiddle(a.address, 10, 6)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-ink-muted">
                2段階認証コード
              </label>
              <input
                inputMode="numeric"
                maxLength={6}
                value={wd.code}
                onChange={(e) => setWd({ ...wd, code: e.target.value.replace(/\D/g, "") })}
                className="text-center tracking-[0.3em]"
                disabled={blockers.length > 0}
                required
              />
            </div>

            {amount > 0 && (
              <div className="rounded-xl border border-line bg-white/2 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-ink-dim">出金額</span>
                  <span>{amount.toFixed(8)} BTC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">手数料</span>
                  <span className="text-neg">-{feeBtc.toFixed(8)} BTC</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-line pt-1 font-medium">
                  <span>実受取額</span>
                  <span className="text-brand">{netBtc.toFixed(8)} BTC</span>
                </div>
                {needsTwoApprovers && (
                  <p className="mt-2 text-warn">
                    {settings.twoApproverThresholdBtc} BTC
                    を超えるため、管理者2名の承認が必要です。
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={busy || blockers.length > 0 || amount <= feeBtc}
              className="w-full"
            >
              出金を申請する
            </Button>
          </form>
        </Card>
      </div>

      {/* 出金履歴 */}
      <Card>
        <CardTitle>出金履歴</CardTitle>
        {state.withdrawals.length === 0 ? (
          <EmptyState
            title="出金履歴がありません"
            description="出金を申請すると、ここに処理状況が表示されます。"
          />
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>申請日時</th>
                  <th>金額</th>
                  <th>実受取</th>
                  <th>宛先</th>
                  <th>状態</th>
                  <th>リスク</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td className="whitespace-nowrap text-ink-muted">
                      {formatDateTime(w.createdAt)}
                    </td>
                    <td>{Number(w.amountBtc).toFixed(8)}</td>
                    <td className="text-brand">{Number(w.netBtc).toFixed(8)}</td>
                    <td>
                      <code className="text-[11px] text-ink-dim">
                        {truncateMiddle(w.address, 10, 6)}
                      </code>
                    </td>
                    <td>
                      <Badge tone={statusTone(w.status)}>{statusLabel(w.status)}</Badge>
                      {w.approvals.length > 0 && (
                        <span className="ml-1.5 text-[10px] text-ink-dim">
                          {w.approvals.filter((a) => a.decision === "APPROVE").length}/
                          {w.requiredApprovals}
                        </span>
                      )}
                    </td>
                    <td>
                      {w.riskScore >= 50 ? (
                        <span className="text-neg" title={w.riskReasons.join(" / ")}>
                          {w.riskScore}
                        </span>
                      ) : (
                        <span className="text-ink-dim">{w.riskScore}</span>
                      )}
                    </td>
                    <td>
                      {(w.status === "PENDING_REVIEW" || w.status === "FLAGGED") && (
                        <button
                          onClick={() =>
                            run(
                              () =>
                                apiFetch("/api/wallet", {
                                  json: { action: "cancel", withdrawalId: w.id },
                                }).then(() => undefined),
                              "出金申請を取り消しました。残高に戻しました。",
                            )
                          }
                          disabled={busy}
                          className="text-xs text-neg hover:underline"
                        >
                          取消
                        </button>
                      )}
                      {w.txId && (
                        <span
                          className="text-[10px] text-ink-dim"
                          title={w.txId}
                        >
                          {w.txId.startsWith("demo-") ? "（デモ送金）" : `${w.confirmations} 確認`}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.withdrawals.some((w) => w.status === "FLAGGED") && (
          <p className="mt-3 text-[11px] leading-relaxed text-warn">
            一部の出金に異常検知のフラグが立っています。管理者が内容を確認したうえで承認・却下します
            （検知理由はリスクスコアにカーソルを合わせると表示されます）。
          </p>
        )}
        <p className="mt-3 text-[11px] text-ink-dim">
          最終更新: {formatRelative(new Date().toISOString())}
        </p>
      </Card>
    </div>
  );
}
