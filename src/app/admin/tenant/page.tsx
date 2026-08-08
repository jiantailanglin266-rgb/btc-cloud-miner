import { requireSession } from "@/modules/auth/session";
import { canConfigureTenant } from "@/modules/auth/rbac";
import { redirect } from "next/navigation";
import { getStore } from "@/lib/store";
import { TenantSettingsForm } from "./TenantSettingsForm";
import { Card, CardTitle, PageHeader } from "@/components/ui";

export const metadata = { title: "テナント設定" };
export const dynamic = "force-dynamic";

export default async function AdminTenantPage() {
  const ctx = await requireSession();
  if (!canConfigureTenant(ctx.user)) redirect("/admin");

  const store = await getStore();
  const tenants = await store.listTenants();

  return (
    <>
      <PageHeader
        title="テナント設定"
        description="ブランディング・手数料・出金ポリシー（ホワイトラベル向け）"
      />

      <Card className="mb-4">
        <CardTitle>マルチテナントについて</CardTitle>
        <p className="text-xs leading-relaxed text-ink-muted">
          本システムは 1 つのデプロイで複数ブランドを運用できます。
          テナントはサブドメイン（例: <code>acme.example.com</code>
          ）で識別され、ロゴ・サービス名・カラー・手数料率・出金ポリシーをテナントごとに設定できます。
          現在 {tenants.length} テナントが登録されています（
          {tenants.map((t) => t.slug).join(", ")}）。
        </p>
      </Card>

      <TenantSettingsForm initial={ctx.settings} tenantName={ctx.tenant.name} />
    </>
  );
}
