import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { getProviderHealth } from "@/modules/provider/registry";
import { isReadOnly } from "@/modules/auth/rbac";
import { ProviderPanel } from "./ProviderPanel";
import { AddProvider } from "./AddProvider";
import { Card, CardTitle, PageHeader } from "@/components/ui";

export const metadata = { title: "プロバイダー管理" };
export const dynamic = "force-dynamic";

export default async function AdminProvidersPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const [providers, health] = await Promise.all([
    store.listProviders(ctx.tenant.id),
    getProviderHealth(ctx.tenant.id),
  ]);

  return (
    <>
      <PageHeader
        title="プロバイダー管理"
        description="外部マイニング設備・プールとの接続の管理"
      />

      {!isReadOnly(ctx.user) && <AddProvider />}

      <Card className="mb-4">
        <CardTitle>新しいプロバイダーを追加するには</CardTitle>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-muted">
          <li>
            契約したプロバイダーの API 仕様に合わせて{" "}
            <code>src/modules/provider/adapters/provider-a.ts</code>{" "}
            （テンプレート）の 3 箇所を実装します。
          </li>
          <li>
            API キーは DB に保存せず、Secrets Manager（開発時は環境変数）に置き、
            <code>credentialsRef</code> に参照名だけを設定します。
          </li>
          <li>
            <code>MINING_PROVIDER_MODE=live</code> に切り替えると実データが使われます。
          </li>
        </ol>
      </Card>

      <ProviderPanel
        providers={providers}
        health={health}
        readOnly={isReadOnly(ctx.user)}
      />
    </>
  );
}
