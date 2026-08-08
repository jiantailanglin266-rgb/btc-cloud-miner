import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { isReadOnly } from "@/modules/auth/rbac";
import { AllocationPanel } from "./AllocationPanel";
import { Card, CardTitle, PageHeader } from "@/components/ui";

export const metadata = { title: "収益配賦" };
export const dynamic = "force-dynamic";

export default async function AdminAllocationPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const [payouts, providers] = await Promise.all([
    store.listPayouts(ctx.tenant.id, { limit: 100 }),
    store.listProviders(ctx.tenant.id),
  ]);

  return (
    <>
      <PageHeader
        title="収益配賦（Revenue Allocation）"
        description="プールからの実払い出しを取り込み、実測ハッシュレート比でユーザーへ配賦する"
      />

      <Card className="mb-4">
        <CardTitle>配賦のパイプライン</CardTitle>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-muted">
          <li>「payout を同期」— 各プロバイダー/プールの API から払い出し履歴を取り込む（重複は自動排除）</li>
          <li>「未配賦をすべて配賦」— payout 期間中の実測ハッシュレート比で按分し、手数料を控除して元帳へ記帳</li>
          <li>配賦済み payout は再実行しても二重計上されない（3層の冪等性: UNIQUE制約・状態フラグ・元帳冪等キー）</li>
        </ol>
        <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn">
          実在のプールは手数料控除「後」の金額を払い出すため、配賦時にプール手数料は再控除しません
          （二重控除の防止）。控除されるのはプラットフォーム手数料・レベニューシェア・ホスティング費のみです。
        </p>
      </Card>

      <AllocationPanel
        payouts={payouts}
        providerNames={Object.fromEntries(providers.map((p) => [p.id, p.name]))}
        readOnly={isReadOnly(ctx.user)}
      />
    </>
  );
}
