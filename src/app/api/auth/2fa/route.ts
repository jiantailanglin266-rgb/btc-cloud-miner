/**
 * 2段階認証の設定・有効化・無効化・step-up 検証
 *
 * 1 ファイルに集約している理由: route.ts は HTTP メソッド以外を export できないため、
 * 関連する操作を action フィールドで分岐させたほうが共有ロジックを保ちやすい。
 */

import { getStore } from "@/lib/store";
import {
  getSessionContext,
  verifyCsrf,
  markTwoFactorVerified,
} from "@/modules/auth/session";
import {
  generateSecret,
  verifyTotp,
  buildOtpAuthUri,
  generateRecoveryCodes,
} from "@/modules/auth/totp";
import { encryptField, decryptField, sha256Hex } from "@/lib/crypto";
import { totpCodeSchema } from "@/lib/validation";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { cache, globalKey } from "@/lib/cache";
import {
  ok,
  handler,
  unauthorized,
  forbidden,
  validationError,
  apiError,
  tooManyRequests,
} from "@/lib/api";

type Action = "setup" | "enable" | "disable" | "verify";

export const POST = handler(async (req: Request) => {
  if (!(await verifyCsrf(req))) return forbidden("CSRF トークンが不正です");

  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { action?: Action; code?: string };
  const action = body.action;
  const store = await getStore();

  // --- setup: シークレットを発行して QR 用の URI を返す --------------------
  if (action === "setup") {
    const secret = generateSecret();
    // 有効化されるまでは DB に入れず、短命キャッシュに置く
    cache.set(globalKey("2fa-setup", ctx.user.id), secret, 600);
    return ok({
      secret,
      otpauthUri: buildOtpAuthUri({
        secret,
        accountName: ctx.user.email,
        issuer: ctx.settings.brandName,
      }),
    });
  }

  const parsedCode = totpCodeSchema.safeParse(body.code);
  if (!parsedCode.success) {
    return validationError([{ path: "code", message: "6桁の数字を入力してください" }]);
  }
  const code = parsedCode.data;

  const rl = checkRateLimit(`2fa-op:${ctx.user.id}`, RATE_LIMITS.twoFactor);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  // --- enable: コードを検証して有効化する ----------------------------------
  if (action === "enable") {
    const hit = cache.get<string>(globalKey("2fa-setup", ctx.user.id));
    if (!hit || hit.stale) {
      return apiError(409, "CONFLICT", "設定の有効期限が切れました。最初からやり直してください");
    }
    if (verifyTotp(hit.value, code) === null) {
      return apiError(401, "UNAUTHORIZED", "認証コードが正しくありません");
    }

    const recoveryCodes = generateRecoveryCodes();
    await store.updateCredentials(ctx.user.id, {
      totpSecretEnc: encryptField(hit.value),
      // リカバリーコードはハッシュ化してから暗号化して保存する
      recoveryCodesEnc: encryptField(
        JSON.stringify(recoveryCodes.map((c) => sha256Hex(c))),
      ),
    });
    await store.updateUser(ctx.tenant.id, ctx.user.id, { twoFactorEnabled: true });
    await markTwoFactorVerified(ctx.session.id);
    cache.del(globalKey("2fa-setup", ctx.user.id));

    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.user.role,
      action: AUDIT_ACTIONS.TWO_FACTOR_ENABLE,
      targetType: "user",
      targetId: ctx.user.id,
    });

    // リカバリーコードの平文はこの 1 回だけ返す
    return ok({ enabled: true, recoveryCodes });
  }

  // --- verify / disable: 保存済みシークレットで検証する --------------------
  const credentials = await store.getCredentials(ctx.user.id);
  if (!credentials?.totpSecretEnc) {
    return apiError(409, "CONFLICT", "2段階認証が設定されていません");
  }

  const secret = decryptField(credentials.totpSecretEnc);
  const step = verifyTotp(secret, code);
  if (step === null) {
    return apiError(401, "UNAUTHORIZED", "認証コードが正しくありません");
  }

  // 使用済みコードの再利用を拒否する
  const usedKey = globalKey("totp-used", ctx.user.id, String(step));
  if (cache.get(usedKey)) {
    return apiError(401, "UNAUTHORIZED", "この認証コードは既に使用されています");
  }
  cache.set(usedKey, true, 90);

  if (action === "disable") {
    await store.updateCredentials(ctx.user.id, {
      totpSecretEnc: null,
      recoveryCodesEnc: null,
    });
    await store.updateUser(ctx.tenant.id, ctx.user.id, { twoFactorEnabled: false });
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.user.role,
      action: AUDIT_ACTIONS.TWO_FACTOR_DISABLE,
      targetType: "user",
      targetId: ctx.user.id,
    });
    return ok({ enabled: false });
  }

  // verify（step-up 認証）
  await markTwoFactorVerified(ctx.session.id);
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    actorRole: ctx.user.role,
    action: AUDIT_ACTIONS.TWO_FACTOR_VERIFY,
    targetType: "session",
    targetId: ctx.session.id,
  });
  return ok({ verified: true });
});
