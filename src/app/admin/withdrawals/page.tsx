import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { canApproveWithdrawal } from "@/modules/auth/rbac";
import { getWalletProvider } from "@/modules/wallet";
import { WithdrawalQueue } from "./WithdrawalQueue";
import { Card, CardTitle, DemoNotice, PageHeader } from "@/components/ui";

export const metadata = { title: "出金承認" };
export const dynamic = "force-dynamic";

export default async function AdminWithdrawalsPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const withdrawals = await store.listWithdrawals(ctx.tenant.id);
  const provider = getWalletProvider();

  return (
    <>
      <PageHeader
        title="出金承認"
        description="申請された出金の確認・承認・却下"
      />

      {!provider.isLive && (
        <div className="mb-4">
          <DemoNotice>
            ウォレットプロバイダーが <code>{provider.name}</code>{" "}
            のため、承認しても実際の送金は行われません（デモ用の txid が生成されます）。
          </DemoNotice>
        </div>
      )}

      <Card className="mb-4">
        <CardTitle>承認ルール</CardTitle>
        <ul className="space-y-1 text-xs leading-relaxed text-ink-muted">
          <li>・申請者本人は承認できません（4-eyes 原則）。</li>
          <li>
            ・{ctx.settings.withdrawalTwoApproverThresholdBtc} BTC
            を超える出金、またはリスクスコアが 50 以上の出金は、管理者2名の承認が必要です。
          </li>
          <li>・承認操作には管理者自身の2段階認証が必要です。</li>
          <li>・却下すると、保留されていた残高は自動的にユーザーへ戻されます。</li>
          <li>・すべての操作は監査ログに記録されます。</li>
        </ul>
      </Card>

      <WithdrawalQueue
        initial={withdrawals}
        canApprove={canApproveWithdrawal(ctx.user)}
        currentUserId={ctx.user.id}
      />
    </>
  );
}
