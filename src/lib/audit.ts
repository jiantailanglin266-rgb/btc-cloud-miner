/**
 * 監査ログ。
 *
 * 原則:
 *   1. 金銭・権限・認証に関わる操作は必ず記録する
 *   2. 記録に失敗しても業務は止めない（try-catch で握る）
 *      → ただしエラーはサーバーログに残し、監視で気付けるようにする
 *   3. 機微情報（パスワード・トークン・TOTP・全額のアドレス）はマスクする
 *   4. 追記のみ。更新・削除の API を提供しない
 */

import type { AuditLog, AuditResult } from "@/types";
import { getStore } from "./store";
import { newId } from "./crypto";

const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "secret",
  "totp",
  "code",
  "apiKey",
  "credentials",
  "recoveryCodes",
];

/** 機微なキーを再帰的にマスクする */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[深すぎるため省略]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s.toLowerCase()))) {
      out[k] = "[マスク]";
    } else {
      out[k] = maskSensitive(v, depth + 1);
    }
  }
  return out;
}

export type AuditParams = {
  tenantId: string;
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  result?: AuditResult;
};

export async function audit(params: AuditParams): Promise<void> {
  try {
    const store = await getStore();
    const log: AuditLog = {
      id: newId(),
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      detail: (maskSensitive(params.detail ?? {}) as Record<string, unknown>) ?? {},
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      result: params.result ?? "SUCCESS",
      createdAt: new Date().toISOString(),
    };
    await store.appendAuditLog(log);
  } catch (err) {
    // 監査ログの失敗で業務を止めない。ただし必ずログには出す
    console.error("[audit] 監査ログの記録に失敗しました", err);
  }
}

/** 監査対象のアクション名（タイポ防止のため定数化） */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: "auth.login.success",
  LOGIN_FAILURE: "auth.login.failure",
  LOGOUT: "auth.logout",
  REGISTER: "auth.register",
  TWO_FACTOR_ENABLE: "auth.2fa.enable",
  TWO_FACTOR_DISABLE: "auth.2fa.disable",
  TWO_FACTOR_VERIFY: "auth.2fa.verify",
  SESSION_REVOKE: "auth.session.revoke",
  ADDRESS_CREATE: "wallet.address.create",
  ADDRESS_DELETE: "wallet.address.delete",
  WITHDRAWAL_REQUEST: "withdrawal.request",
  WITHDRAWAL_APPROVE: "withdrawal.approve",
  WITHDRAWAL_REJECT: "withdrawal.reject",
  WITHDRAWAL_CANCEL: "withdrawal.cancel",
  CONTRACT_CREATE: "contract.create",
  CONTRACT_CANCEL: "contract.cancel",
  USER_UPDATE: "admin.user.update",
  KYC_UPDATE: "admin.user.kyc_update",
  PROVIDER_UPDATE: "admin.provider.update",
  PROVIDER_SYNC: "admin.provider.sync",
  TENANT_SETTINGS_UPDATE: "admin.tenant.settings_update",
  PLAN_UPDATE: "admin.plan.update",
  INCIDENT_CREATE: "admin.incident.create",
  EXPORT_CSV: "data.export.csv",
} as const;
