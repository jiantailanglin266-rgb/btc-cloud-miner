import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { isReadOnly } from "@/modules/auth/rbac";
import { UserTable } from "./UserTable";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "ユーザー管理" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const ctx = await requireSession();
  const store = await getStore();
  const users = await store.listUsers(ctx.tenant.id);

  return (
    <>
      <PageHeader
        title="ユーザー管理"
        description={`${users.length} 名（KYC・ステータス・権限の管理）`}
      />
      <UserTable initial={users} readOnly={isReadOnly(ctx.user)} />
    </>
  );
}
