import { getStore } from "@/lib/store";
import { resolveTenant } from "@/modules/tenant/resolve";
import { verifyPassword, generateToken } from "@/lib/crypto";
import { createSessionForUser } from "@/modules/auth/session";
import { loginSchema, formatZodError } from "@/lib/validation";
import { checkRateLimit, RATE_LIMITS, resetRateLimit } from "@/lib/rate-limit";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  ok,
  handler,
  validationError,
  apiError,
  tooManyRequests,
  getClientIp,
} from "@/lib/api";
import { cache, globalKey } from "@/lib/cache";

/** ログイン失敗の連続回数でロックする閾値 */
const MAX_FAILED_ATTEMPTS = 10;
const LOCK_MINUTES = 15;

export const POST = handler(async (req: Request) => {
  const ip = getClientIp(req);
  const body = await req.json().catch(() => null);

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return validationError(formatZodError(parsed.error));

  const { email, password } = parsed.data;

  // レート制限は IP とアカウントの両方で掛ける
  for (const key of [`login:ip:${ip}`, `login:acct:${email.toLowerCase()}`]) {
    const rl = checkRateLimit(key, RATE_LIMITS.login);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);
  }

  const tenant = await resolveTenant();
  const store = await getStore();
  const user = await store.getUserByEmail(tenant.id, email);

  // ★ ユーザーが存在しない場合も、パスワードが違う場合も同じ応答にする
  //   （どのメールアドレスが登録済みかを推測されないため）
  const genericFailure = () =>
    apiError(401, "UNAUTHORIZED", "メールアドレスまたはパスワードが正しくありません");

  if (!user) return genericFailure();

  const credentials = await store.getCredentials(user.id);
  if (!credentials) return genericFailure();

  if (credentials.lockedUntil && new Date(credentials.lockedUntil).getTime() > Date.now()) {
    return apiError(
      401,
      "UNAUTHORIZED",
      "ログイン試行が多すぎたため、一時的にロックされています。しばらくしてからお試しください",
    );
  }

  if (!verifyPassword(password, credentials.passwordHash)) {
    const failed = credentials.failedAttempts + 1;
    await store.updateCredentials(user.id, {
      failedAttempts: failed,
      lockedUntil:
        failed >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
          : null,
    });
    await audit({
      tenantId: tenant.id,
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      targetType: "user",
      targetId: user.id,
      detail: { failedAttempts: failed },
      ip,
      userAgent: req.headers.get("user-agent"),
      result: "FAILURE",
    });
    return genericFailure();
  }

  if (user.status === "SUSPENDED") {
    return apiError(403, "FORBIDDEN", "このアカウントは停止されています");
  }

  await store.updateCredentials(user.id, { failedAttempts: 0, lockedUntil: null });
  resetRateLimit(`login:acct:${email.toLowerCase()}`);

  // --- 2FA が有効なら、ここではセッションを作らない ------------------------
  if (user.twoFactorEnabled && credentials.totpSecretEnc) {
    // 短命のチャレンジトークンを発行する（パスワード検証済みであることの証明）
    const challengeId = generateToken(24);
    cache.set(
      globalKey("2fa-challenge", challengeId),
      { userId: user.id, tenantId: tenant.id, ip },
      300, // 5 分で失効
    );
    return ok({
      twoFactorRequired: true,
      challengeId,
    });
  }

  // --- 2FA 未設定ならセッションを発行 --------------------------------------
  await createSessionForUser(user, {
    ip,
    userAgent: req.headers.get("user-agent"),
    twoFactorVerified: false,
  });
  await store.updateUser(tenant.id, user.id, {
    lastLoginAt: new Date().toISOString(),
    lastLoginIp: ip,
  });
  await audit({
    tenantId: tenant.id,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    targetType: "user",
    targetId: user.id,
    detail: { twoFactor: false },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return ok({
    twoFactorRequired: false,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});
