/**
 * 管理者向け API（1 ファイルに集約）
 *
 * ★ 全ての操作で以下を必ず通す:
 *     1. CSRF 検証
 *     2. セッション検証
 *     3. RBAC（SUPPORT / AUDITOR は変更操作不可）
 *     4. 監査ログ
 */

import { getSessionContext, verifyCsrf, hasRecentTwoFactor } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import {
  requireAdmin,
  requireWithdrawalApprover,
  canConfigureTenant,
  isReadOnly,
  ForbiddenError,
} from "@/modules/auth/rbac";
import { approveWithdrawal, rejectWithdrawal, WithdrawalError } from "@/modules/wallet";
import { persistSnapshots } from "@/modules/mining/aggregate";
import { syncPayouts } from "@/modules/provider/registry";
import {
  allocatePayoutToUsers,
  allocateAllPending,
  AllocationError,
} from "@/modules/revenue/allocation";
import { verifyTotp } from "@/modules/auth/totp";
import { decryptField, newId } from "@/lib/crypto";
import {
  approveWithdrawalSchema,
  rejectWithdrawalSchema,
  updateUserSchema,
  updateProviderSchema,
  tenantSettingsSchema,
  formatZodError,
} from "@/lib/validation";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  ok,
  handler,
  unauthorized,
  forbidden,
  validationError,
  unprocessable,
  notFound,
  twoFactorRequired,
  getClientIp,
} from "@/lib/api";

export const dynamic = "force-dynamic";

type Body = { action?: string; [key: string]: unknown };

export const POST = handler(async (req: Request) => {
  if (!(await verifyCsrf(req))) return forbidden("CSRF トークンが不正です");

  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  try {
    requireAdmin(ctx.user);
  } catch {
    return forbidden();
  }

  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as Body;
  const store = await getStore();

  // 読み取り専用ロール（SUPPORT / AUDITOR）は、どの変更操作も実行できない
  if (isReadOnly(ctx.user)) {
    return forbidden("読み取り専用の権限では変更操作を行えません");
  }

  /** 管理者の重要操作には 2FA を必須にする */
  async function requireAdminMfa(code: string | undefined): Promise<Response | null> {
    if (!ctx) return unauthorized();
    if (hasRecentTwoFactor(ctx.session)) return null;
    if (!ctx.user.twoFactorEnabled) {
      return forbidden(
        "管理者の重要操作には2段階認証の設定が必須です。設定画面から有効にしてください。",
      );
    }
    const credentials = await store.getCredentials(ctx.user.id);
    if (!credentials?.totpSecretEnc) return forbidden("2段階認証が設定されていません");
    if (!code) return twoFactorRequired();
    if (verifyTotp(decryptField(credentials.totpSecretEnc), code) === null) {
      return twoFactorRequired("認証コードが正しくありません");
    }
    return null;
  }

  switch (body.action) {
    // --- 出金承認 ----------------------------------------------------------
    case "approve-withdrawal": {
      try {
        requireWithdrawalApprover(ctx.user);
      } catch (err) {
        return forbidden(err instanceof ForbiddenError ? err.message : undefined);
      }
      const parsed = approveWithdrawalSchema.safeParse(body);
      if (!parsed.success) return validationError(formatZodError(parsed.error));

      const blocked = await requireAdminMfa(parsed.data.code);
      if (blocked) return blocked;

      const id = typeof body.withdrawalId === "string" ? body.withdrawalId : "";
      try {
        const withdrawal = await approveWithdrawal({
          approver: ctx.user,
          withdrawalId: id,
          note: parsed.data.note,
          ip,
        });
        return ok({ withdrawal });
      } catch (err) {
        if (err instanceof ForbiddenError) return forbidden(err.message);
        if (err instanceof WithdrawalError) return unprocessable(err.message);
        throw err;
      }
    }

    // --- 出金却下 ----------------------------------------------------------
    case "reject-withdrawal": {
      try {
        requireWithdrawalApprover(ctx.user);
      } catch (err) {
        return forbidden(err instanceof ForbiddenError ? err.message : undefined);
      }
      const parsed = rejectWithdrawalSchema.safeParse(body);
      if (!parsed.success) return validationError(formatZodError(parsed.error));

      const id = typeof body.withdrawalId === "string" ? body.withdrawalId : "";
      try {
        const withdrawal = await rejectWithdrawal({
          approver: ctx.user,
          withdrawalId: id,
          note: parsed.data.note,
          ip,
        });
        return ok({ withdrawal });
      } catch (err) {
        if (err instanceof WithdrawalError) return unprocessable(err.message);
        throw err;
      }
    }

    // --- ユーザー更新 ------------------------------------------------------
    case "update-user": {
      const parsed = updateUserSchema.safeParse(body);
      if (!parsed.success) return validationError(formatZodError(parsed.error));
      const id = typeof body.userId === "string" ? body.userId : "";

      const before = await store.getUserById(ctx.tenant.id, id);
      if (!before) return notFound();

      // 権限昇格は 2FA を必須にする（内部不正への防御）
      if (parsed.data.role && parsed.data.role !== before.role) {
        const blocked = await requireAdminMfa(
          typeof body.code === "string" ? body.code : undefined,
        );
        if (blocked) return blocked;
      }

      const updated = await store.updateUser(ctx.tenant.id, id, parsed.data);
      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: parsed.data.kycStatus ? AUDIT_ACTIONS.KYC_UPDATE : AUDIT_ACTIONS.USER_UPDATE,
        targetType: "user",
        targetId: id,
        detail: {
          before: { role: before.role, status: before.status, kycStatus: before.kycStatus },
          after: parsed.data,
        },
        ip,
      });
      return ok({ user: updated });
    }

    // --- プロバイダー更新 --------------------------------------------------
    case "update-provider": {
      const parsed = updateProviderSchema.safeParse(body);
      if (!parsed.success) return validationError(formatZodError(parsed.error));
      const id = typeof body.providerId === "string" ? body.providerId : "";

      const updated = await store.updateProvider(ctx.tenant.id, id, parsed.data);
      if (!updated) return notFound();

      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: AUDIT_ACTIONS.PROVIDER_UPDATE,
        targetType: "provider",
        targetId: id,
        detail: parsed.data,
        ip,
      });
      return ok({ provider: updated });
    }

    // --- プロバイダー手動同期 ----------------------------------------------
    case "sync-providers": {
      const saved = await persistSnapshots(ctx.tenant.id);
      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: AUDIT_ACTIONS.PROVIDER_SYNC,
        targetType: "provider",
        targetId: "all",
        detail: { snapshots: saved },
        ip,
      });
      return ok({ snapshots: saved });
    }

    // --- テナント設定 ------------------------------------------------------
    case "update-tenant-settings": {
      if (!canConfigureTenant(ctx.user)) {
        return forbidden("テナント設定を変更する権限がありません");
      }
      const parsed = tenantSettingsSchema.safeParse(body);
      if (!parsed.success) return validationError(formatZodError(parsed.error));

      const updated = await store.updateTenantSettings(ctx.tenant.id, parsed.data);
      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: AUDIT_ACTIONS.TENANT_SETTINGS_UPDATE,
        targetType: "tenant",
        targetId: ctx.tenant.id,
        detail: parsed.data,
        ip,
      });
      return ok({ settings: updated });
    }

    // --- payout の同期（実プールから払い出し履歴を取り込む） ----------------
    case "sync-payouts": {
      const result = await syncPayouts(ctx.tenant.id);
      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: "revenue.sync_payouts",
        targetType: "payout",
        targetId: "all",
        detail: result,
        ip,
      });
      return ok(result);
    }

    // --- 配賦の実行 ----------------------------------------------------------
    case "allocate-payout": {
      const id = typeof body.payoutId === "string" ? body.payoutId : null;
      const actor = { userId: ctx.user.id, email: ctx.user.email, role: ctx.user.role };
      try {
        if (id) {
          const result = await allocatePayoutToUsers(ctx.tenant.id, id, actor);
          return ok(result);
        }
        const result = await allocateAllPending(ctx.tenant.id, actor);
        return ok(result);
      } catch (err) {
        if (err instanceof AllocationError) return unprocessable(err.message);
        throw err;
      }
    }

    // --- アラートの確認 ------------------------------------------------------
    case "acknowledge-alert": {
      const id = typeof body.alertId === "string" ? body.alertId : null;
      if (!id) return validationError([{ path: "alertId", message: "必須です" }]);
      await store.acknowledgeAlert(ctx.tenant.id, id, ctx.user.id);
      return ok({ acknowledged: true });
    }

    // --- 障害情報の作成 ----------------------------------------------------
    case "create-incident": {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const bodyText = typeof body.body === "string" ? body.body.trim() : "";
      if (!title || title.length > 200) {
        return validationError([{ path: "title", message: "タイトルを入力してください" }]);
      }
      const incident = await store.createIncident({
        id: newId(),
        tenantId: ctx.tenant.id,
        title,
        severity: (["SEV1", "SEV2", "SEV3", "SEV4"] as const).includes(
          body.severity as "SEV1",
        )
          ? (body.severity as "SEV1")
          : "SEV3",
        status: "INVESTIGATING",
        body: bodyText.slice(0, 4000),
        affectedComponents: Array.isArray(body.affectedComponents)
          ? (body.affectedComponents as string[]).slice(0, 20)
          : [],
        startedAt: new Date().toISOString(),
        resolvedAt: null,
      });
      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: AUDIT_ACTIONS.INCIDENT_CREATE,
        targetType: "incident",
        targetId: incident.id,
        detail: { title },
        ip,
      });
      return ok({ incident });
    }

    default:
      return validationError([{ path: "action", message: "不明な操作です" }]);
  }
});
