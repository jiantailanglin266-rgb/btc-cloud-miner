import { requireSession } from "@/modules/auth/session";
import { reconcile } from "@/modules/revenue/reconciliation";
import { ReconciliationView } from "./ReconciliationView";
import { Card, CardTitle, PageHeader } from "@/components/ui";

export const metadata = { title: "Reconciliation" };
export const dynamic = "force-dynamic";

export default async function AdminReconciliationPage() {
  const ctx = await requireSession();
  // 表示時に検証を実行（差分があれば内部で CRITICAL アラートが上がる）
  const report = await reconcile(ctx.tenant.id);

  return (
    <>
      <PageHeader
        title="Reconciliation（照合）"
        description="プールの実 payout と内部 Ledger が satoshi 単位で一致しているかを検証"
      />

      <Card className="mb-4">
        <CardTitle>照合の考え方</CardTitle>
        <p className="text-xs leading-relaxed text-ink-muted">
          配賦済み payout について、Pool Payout 額 と Ledger 上の配賦 gross 合計が
          <strong className="text-ink"> satoshi 単位で厳密一致</strong>することを検証します。
          1 satoshi でもズレると <code>LEDGER_IMBALANCE</code> の CRITICAL
          アラートが発報されます。すべて整数（bigint satoshi）で計算し、浮動小数点は使いません。
        </p>
      </Card>

      <ReconciliationView initial={report} />
    </>
  );
}
