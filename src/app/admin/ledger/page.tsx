import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { deriveBalance, verifyInvariants } from "@/modules/wallet/ledger";
import { Badge, Card, CardTitle, EmptyState, KeyValue, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "元帳ビューア" };
export const dynamic = "force-dynamic";

const ENTRY_LABEL: Record<string, string> = {
  MINING_REWARD: "採掘報酬",
  POOL_FEE: "プール手数料",
  PLATFORM_FEE: "プラットフォーム手数料",
  HOSTING_FEE: "ホスティング費",
  FEE: "手数料（旧区分）",
  WITHDRAWAL_LOCK: "出金ロック",
  WITHDRAWAL_SETTLE: "出金確定",
  WITHDRAWAL_REVERSE: "出金取消（返却）",
  WITHDRAWAL_FEE: "出金手数料",
  ADJUSTMENT: "調整",
};

export default async function AdminLedgerPage(props: {
  searchParams: Promise<{ user?: string }>;
}) {
  const { user: selectedUserId } = await props.searchParams;
  const ctx = await requireSession();
  const store = await getStore();
  const users = await store.listUsers(ctx.tenant.id);

  const selected = selectedUserId
    ? users.find((u) => u.id === selectedUserId)
    : null;

  let entries: Awaited<ReturnType<typeof store.listLedgerEntries>> = [];
  let balance = null;
  let invariants = null;
  if (selected) {
    const account = await store.getWalletAccount(ctx.tenant.id, selected.id);
    entries = await store.listLedgerEntries(ctx.tenant.id, account.id);
    balance = deriveBalance(entries);
    invariants = verifyInvariants(entries);
  }

  return (
    <>
      <PageHeader
        title="元帳ビューア（Ledger Viewer）"
        description="複式元帳の全仕訳。残高はこの元帳の合計として導出される（残高カラムは存在しない）"
      />

      <Card className="mb-4">
        <CardTitle>ユーザーを選択</CardTitle>
        <div className="flex flex-wrap gap-2">
          {users.map((u) => (
            <Link
              key={u.id}
              href={`/admin/ledger?user=${u.id}`}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                selected?.id === u.id
                  ? "border-brand/50 bg-brand/10 text-brand"
                  : "border-line-strong text-ink-muted hover:text-ink"
              }`}
            >
              {u.email}
            </Link>
          ))}
        </div>
      </Card>

      {selected && balance && invariants && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Card>
              <div className="text-[11px] text-ink-dim">Available</div>
              <div className="mt-1 text-lg font-semibold text-brand">
                {balance.availableBtc} BTC
              </div>
            </Card>
            <Card>
              <div className="text-[11px] text-ink-dim">Locked</div>
              <div className="mt-1 text-lg font-semibold">{balance.lockedBtc} BTC</div>
            </Card>
            <Card>
              <div className="text-[11px] text-ink-dim">累計獲得</div>
              <div className="mt-1 text-lg font-semibold text-pos">
                {balance.lifetimeEarnedBtc} BTC
              </div>
            </Card>
            <Card>
              <div className="text-[11px] text-ink-dim">整合性</div>
              <div className="mt-1">
                {invariants.ok ? (
                  <Badge tone="online" dot>不変条件 OK</Badge>
                ) : (
                  <Badge tone="offline" dot>違反あり</Badge>
                )}
              </div>
              {!invariants.ok && (
                <p className="mt-1 text-[11px] text-neg">
                  {invariants.violations.join(" / ")}
                </p>
              )}
            </Card>
          </div>

          <Card>
            <CardTitle hint={`${entries.length} 仕訳（追記専用・削除不可）`}>
              {selected.email} の元帳
            </CardTitle>
            {entries.length === 0 ? (
              <EmptyState title="仕訳がありません" description="報酬の配賦・出金が発生するとここに記録されます。" />
            ) : (
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>日時</th>
                      <th>区分</th>
                      <th>Bucket</th>
                      <th>金額（BTC）</th>
                      <th>参照</th>
                      <th>冪等キー</th>
                      <th>摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...entries].reverse().slice(0, 200).map((e) => {
                      const negative = e.amountBtc.startsWith("-");
                      return (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap text-ink-muted">
                            {formatDateTime(e.createdAt)}
                          </td>
                          <td className="text-xs">{ENTRY_LABEL[e.entryType] ?? e.entryType}</td>
                          <td>
                            <Badge tone={e.bucket === "AVAILABLE" ? "online" : "degraded"}>
                              {e.bucket}
                            </Badge>
                          </td>
                          <td className={negative ? "text-neg" : "text-pos"}>
                            {e.amountBtc}
                          </td>
                          <td className="text-[11px] text-ink-dim">
                            {e.refType && `${e.refType}/${(e.refId ?? "").slice(0, 10)}`}
                          </td>
                          <td>
                            <code className="text-[10px] text-ink-dim">
                              {e.idempotencyKey?.slice(0, 28) ?? "—"}
                            </code>
                          </td>
                          <td className="max-w-[16rem] truncate text-[11px] text-ink-muted">
                            {e.memo}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
