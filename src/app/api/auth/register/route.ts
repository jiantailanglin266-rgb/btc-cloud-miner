import { getStore } from "@/lib/store";
import { resolveTenant } from "@/modules/tenant/resolve";
import { hashPassword, newId } from "@/lib/crypto";
import { createSessionForUser } from "@/modules/auth/session";
import { registerSchema, formatZodError } from "@/lib/validation";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { ok, handler, validationError, conflict, tooManyRequests, getClientIp } from "@/lib/api";
import type { User } from "@/types";

export const POST = handler(async (req: Request) => {
  const ip = getClientIp(req);
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return validationError(formatZodError(parsed.error));

  const rl = checkRateLimit(`register:${ip}`, RATE_LIMITS.register);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const { email, password, name } = parsed.data;
  const tenant = await resolveTenant();
  const store = await getStore();

  const existing = await store.getUserByEmail(tenant.id, email);
  if (existing) {
    return conflict("このメールアドレスは既に登録されています");
  }

  const now = new Date().toISOString();
  const user: User = {
    id: newId(),
    tenantId: tenant.id,
    organizationId: null,
    email: email.toLowerCase(),
    name,
    role: "USER",
    // MVP ではメール確認を省略しているため ACTIVE。
    // 商用版ではメール確認を必須にし、PENDING_VERIFICATION から始めること。
    status: "ACTIVE",
    kycStatus: "NOT_SUBMITTED",
    twoFactorEnabled: false,
    createdAt: now,
    lastLoginAt: now,
    lastLoginIp: ip,
    deletedAt: null,
  };

  await store.createUser(user, {
    userId: user.id,
    passwordHash: hashPassword(password),
    totpSecretEnc: null,
    recoveryCodesEnc: null,
    failedAttempts: 0,
    lockedUntil: null,
    passwordChangedAt: now,
  });

  await createSessionForUser(user, {
    ip,
    userAgent: req.headers.get("user-agent"),
    twoFactorVerified: false,
  });

  await audit({
    tenantId: tenant.id,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: AUDIT_ACTIONS.REGISTER,
    targetType: "user",
    targetId: user.id,
    ip,
  });

  await store.createNotification({
    id: newId(),
    tenantId: tenant.id,
    userId: user.id,
    level: "INFO",
    title: "ようこそ",
    body: "セキュリティのため、設定画面から2段階認証を有効にしてください。出金には2段階認証が必要です。",
    href: "/settings",
    readAt: null,
    createdAt: now,
  });

  return ok({ user: { id: user.id, email: user.email, name: user.name } });
});
