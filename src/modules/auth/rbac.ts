/**
 * RBAC（役割ベースのアクセス制御）
 *
 * 原則:
 *   - 権限判定はサーバー側でのみ行う。UI の出し分けはセキュリティ境界ではない
 *   - SUPPORT は「読み取りだけ」。出金の承認・却下は機能的に不可能にする
 *   - 出金は「申請者 ≠ 承認者」を必ず担保する（4-eyes）
 */

import type { User, UserRole } from "@/types";

/** 管理コンソールに入れるロール */
export const ADMIN_ROLES: UserRole[] = [
  "PLATFORM_ADMIN",
  "TENANT_ADMIN",
  "SUPPORT",
  "AUDITOR",
];

/** 出金を承認・却下できるロール（SUPPORT と AUDITOR は含めない） */
export const WITHDRAWAL_APPROVER_ROLES: UserRole[] = ["PLATFORM_ADMIN", "TENANT_ADMIN"];

/** テナント設定・料金を変更できるロール */
export const TENANT_CONFIG_ROLES: UserRole[] = ["PLATFORM_ADMIN", "TENANT_ADMIN"];

/** 監査ログを閲覧できるロール */
export const AUDIT_VIEWER_ROLES: UserRole[] = [
  "PLATFORM_ADMIN",
  "TENANT_ADMIN",
  "AUDITOR",
];

export function isAdmin(user: User): boolean {
  return ADMIN_ROLES.includes(user.role);
}

export function canApproveWithdrawal(user: User): boolean {
  return WITHDRAWAL_APPROVER_ROLES.includes(user.role);
}

export function canConfigureTenant(user: User): boolean {
  return TENANT_CONFIG_ROLES.includes(user.role);
}

export function canViewAudit(user: User): boolean {
  return AUDIT_VIEWER_ROLES.includes(user.role);
}

/** 読み取り専用ロール（変更操作を一律で拒否する） */
export function isReadOnly(user: User): boolean {
  return user.role === "SUPPORT" || user.role === "AUDITOR";
}

export class ForbiddenError extends Error {
  constructor(message = "この操作を行う権限がありません") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function requireAdmin(user: User): void {
  if (!isAdmin(user)) throw new ForbiddenError();
}

export function requireWithdrawalApprover(user: User): void {
  if (!canApproveWithdrawal(user)) {
    throw new ForbiddenError("出金の承認権限がありません");
  }
}

/**
 * 4-eyes の検証。申請者本人による承認を拒否する。
 * 内部不正への最も基本的な防御。
 */
export function assertNotSelfApproval(approverId: string, requesterId: string): void {
  if (approverId === requesterId) {
    throw new ForbiddenError("自分が申請した出金を自分で承認することはできません");
  }
}

/** 二重承認の防止（同じ人が2回承認しても承認数にカウントしない） */
export function assertNotDuplicateApproval(
  approverId: string,
  existingApproverIds: string[],
): void {
  if (existingApproverIds.includes(approverId)) {
    throw new ForbiddenError("この出金には既に承認済みです");
  }
}

export const ROLE_LABEL_JA: Record<UserRole, string> = {
  USER: "一般ユーザー",
  ORG_ADMIN: "組織管理者",
  TENANT_ADMIN: "テナント管理者",
  PLATFORM_ADMIN: "プラットフォーム管理者",
  SUPPORT: "サポート（読取のみ）",
  AUDITOR: "監査（読取のみ）",
};
