import { getStore } from "@/lib/store";
import { decryptField } from "@/lib/crypto";
import { verifyTotp } from "@/modules/auth/totp";
import { createSessionForUser } from "@/modules/auth/session";
import { twoFactorLoginSchema, formatZodError } from "@/lib/validation";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { ok, handler, validationError, apiError, tooManyRequests, getClientIp } from "@/lib/api";
import { cache, globalKey } from "@/lib/cache";

type Challenge = { userId: string; tenantId: string; ip: string | null };

export const POST = handler(async (req: Request) => {
  const ip = getClientIp(req);
  const body = await req.json().catch(() => null);
  const parsed = twoFactorLoginSchema.safeParse(body);
  if (!parsed.success) return validationError(formatZodError(parsed.error));

  const { challengeId, code } = parsed.data;

  const rl = checkRateLimit(`2fa:${challengeId}`, RATE_LIMITS.twoFactor);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const key = globalKey("2fa-challenge", challengeId);
  const hit = cache.get<Challenge>(key);
  if (!hit || hit.stale) {
    return apiError(401, "UNAUTHORIZED", "認証の有効期限が切れました。もう一度ログインしてください");
  }

  const store = await getStore();
  const user = await store.getUserById(hit.value.tenantId, hit.value.userId);
  const credentials = user ? await store.getCredentials(user.id) : null;
  if (!user || !credentials?.totpSecretEnc) {
    return apiError(401, "UNAUTHORIZED", "認証に失敗しました");
  }

  const secret = decryptField(credentials.totpSecretEnc);
  const matchedStep = verifyTotp(secret, code);

  if (matchedStep === null) {
    await audit({
      tenantId: user.tenantId,
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      targetType: "user",
      targetId: user.id,
      detail: { reason: "2fa_mismatch" },
      ip,
      result: "FAILURE",
    });
    return apiError(401, "UNAUTHORIZED", "認証コードが正しくありません");
  }

  // ★ 使用済みコードの再利用（リプレイ）を拒否する
  const usedKey = globalKey("totp-used", user.id, String(matchedStep));
  if (cache.get(usedKey)) {
    return apiError(401, "UNAUTHORIZED", "この認証コードは既に使用されています");
  }
  cache.set(usedKey, true, 90);

  // チャレンジは 1 回で使い切る
  cache.del(key);

  await createSessionForUser(user, {
    ip,
    userAgent: req.headers.get("user-agent"),
    twoFactorVerified: true,
  });
  await store.updateUser(user.tenantId, user.id, {
    lastLoginAt: new Date().toISOString(),
    lastLoginIp: ip,
  });
  await audit({
    tenantId: user.tenantId,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    targetType: "user",
    targetId: user.id,
    detail: { twoFactor: true },
    ip,
  });

  return ok({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});
