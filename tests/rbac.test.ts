import { describe, it, expect } from "vitest";
import {
  isAdmin,
  canApproveWithdrawal,
  canConfigureTenant,
  canViewAudit,
  isReadOnly,
  assertNotSelfApproval,
  assertNotDuplicateApproval,
  requireWithdrawalApprover,
  ForbiddenError,
} from "@/modules/auth/rbac";
import type { User, UserRole } from "@/types";

function user(role: UserRole): User {
  return {
    id: `u-${role}`,
    tenantId: "t1",
    organizationId: null,
    email: `${role}@example.com`,
    name: role,
    role,
    status: "ACTIVE",
    kycStatus: "APPROVED",
    twoFactorEnabled: true,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    lastLoginIp: null,
    deletedAt: null,
  };
}

describe("ロール権限マトリクス", () => {
  it("管理コンソールへのアクセス", () => {
    expect(isAdmin(user("USER"))).toBe(false);
    expect(isAdmin(user("ORG_ADMIN"))).toBe(false);
    expect(isAdmin(user("TENANT_ADMIN"))).toBe(true);
    expect(isAdmin(user("PLATFORM_ADMIN"))).toBe(true);
    expect(isAdmin(user("SUPPORT"))).toBe(true);
    expect(isAdmin(user("AUDITOR"))).toBe(true);
  });

  it("★ SUPPORT / AUDITOR は出金を承認できない（読取専用の強制）", () => {
    expect(canApproveWithdrawal(user("SUPPORT"))).toBe(false);
    expect(canApproveWithdrawal(user("AUDITOR"))).toBe(false);
    expect(canApproveWithdrawal(user("USER"))).toBe(false);
    expect(canApproveWithdrawal(user("TENANT_ADMIN"))).toBe(true);
    expect(canApproveWithdrawal(user("PLATFORM_ADMIN"))).toBe(true);
    expect(() => requireWithdrawalApprover(user("SUPPORT"))).toThrow(ForbiddenError);
  });

  it("テナント設定・監査閲覧", () => {
    expect(canConfigureTenant(user("SUPPORT"))).toBe(false);
    expect(canConfigureTenant(user("TENANT_ADMIN"))).toBe(true);
    expect(canViewAudit(user("AUDITOR"))).toBe(true);
    expect(canViewAudit(user("SUPPORT"))).toBe(false);
    expect(isReadOnly(user("SUPPORT"))).toBe(true);
    expect(isReadOnly(user("AUDITOR"))).toBe(true);
    expect(isReadOnly(user("PLATFORM_ADMIN"))).toBe(false);
  });
});

describe("4-eyes 原則", () => {
  it("申請者本人による承認を拒否する", () => {
    expect(() => assertNotSelfApproval("u1", "u1")).toThrow(ForbiddenError);
    expect(() => assertNotSelfApproval("u1", "u2")).not.toThrow();
  });

  it("同一人物の二重承認を拒否する", () => {
    expect(() => assertNotDuplicateApproval("u1", ["u1", "u2"])).toThrow(ForbiddenError);
    expect(() => assertNotDuplicateApproval("u3", ["u1", "u2"])).not.toThrow();
  });
});
