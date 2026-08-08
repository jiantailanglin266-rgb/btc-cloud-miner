/**
 * ウォレット操作 API
 *
 * アドレス登録・出金申請・出金取消をこの 1 ファイルに集約している。
 * （route.ts は HTTP メソッド以外を export できないため、action で分岐する）
 *
 * ★ 出金は本システムで最も危険な経路。ARCHITECTURE.md §4.3 の全ステップを通す。
 */

import {
  getSessionContext,
  verifyCsrf,
  hasRecentTwoFactor,
  markTwoFactorVerified,
} from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { getBalance } from "@/modules/wallet/ledger";
import {
  requestWithdrawal,
  cancelWithdrawal,
  WithdrawalError,
} from "@/modules/wallet";
import { validateBitcoinAddress } from "@/modules/wallet/address";
import { createAddressSchema, createWithdrawalSchema, formatZodError } from "@/lib/validation";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { decryptField, newId } from "@/lib/crypto";
import { verifyTotp } from "@/modules/auth/totp";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  ok,
  handler,
  unauthorized,
  forbidden,
  validationError,
  unprocessable,
  conflict,
  tooManyRequests,
  twoFactorRequired,
  getClientIp,
} from "@/lib/api";
import type { WalletAddress } from "@/types";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  const store = await getStore();
  const [balance, addresses, withdrawals] = await Promise.all([
    getBalance(ctx.tenant.id, ctx.user.id),
    store.listAddresses(ctx.tenant.id, ctx.user.id),
    store.listWithdrawals(ctx.tenant.id, { userId: ctx.user.id }),
  ]);

  return ok({ balance, addresses, withdrawals });
});

type Body = {
  action?: "create-address" | "delete-address" | "withdraw" | "cancel";
  [key: string]: unknown;
};

export const POST = handler(async (req: Request) => {
  if (!(await verifyCsrf(req))) return forbidden("CSRF トークンが不正です");

  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as Body;
  const store = await getStore();

  /**
   * step-up 認証。
   * 直近 5 分以内に 2FA を通っていなければ、この場でコードを検証する。
   * 2FA 未設定のユーザーは出金・アドレス登録ができない（意図的な制約）。
   */
  async function requireStepUp(code: string | undefined): Promise<Response | null> {
    if (!ctx) return unauthorized();
    if (hasRecentTwoFactor(ctx.session)) return null;

    if (!ctx.user.twoFactorEnabled) {
      return forbidden(
        "この操作には2段階認証の設定が必要です。設定画面から有効にしてください。",
      );
    }
    const credentials = await store.getCredentials(ctx.user.id);
    if (!credentials?.totpSecretEnc) {
      return forbidden("2段階認証が設定されていません");
    }
    if (!code) return twoFactorRequired();

    const rl = checkRateLimit(`stepup:${ctx.user.id}`, RATE_LIMITS.twoFactor);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

    if (verifyTotp(decryptField(credentials.totpSecretEnc), code) === null) {
      return twoFactorRequired("認証コードが正しくありません");
    }
    await markTwoFactorVerified(ctx.session.id);
    return null;
  }

  switch (body.action) {
    // --- アドレス登録 ------------------------------------------------------
    case "create-address": {
      const parsed = createAddressSchema.safeParse(body);
      if (!parsed.success) return validationError(formatZodError(parsed.error));

      const blocked = await requireStepUp(parsed.data.code);
      if (blocked) return blocked;

      // ★ チェックサムまで検証する（1文字の打ち間違いで資産が永久に失われるため）
      const validation = validateBitcoinAddress(parsed.data.address);
      if (!validation.valid) {
        return validationError([
          { path: "address", message: validation.reason ?? "アドレスが不正です" },
        ]);
      }

      const existing = await store.listAddresses(ctx.tenant.id, ctx.user.id);
      if (existing.some((a) => a.address === parsed.data.address)) {
        return conflict("このアドレスは既に登録されています");
      }
      if (existing.length >= 10) {
        return conflict("登録できるアドレスは 10 件までです");
      }

      const now = Date.now();
      const address: WalletAddress = {
        id: newId(),
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        address: parsed.data.address,
        label: parsed.data.label,
        createdAt: new Date(now).toISOString(),
        // ★ クールダウン: 登録直後の持ち出しを防ぐ
        usableAt: new Date(
          now + ctx.settings.addressCooldownHours * 3_600_000,
        ).toISOString(),
      };
      await store.createAddress(address);

      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: AUDIT_ACTIONS.ADDRESS_CREATE,
        targetType: "wallet_address",
        targetId: address.id,
        detail: { kind: validation.kind, network: validation.network },
        ip,
      });

      return ok({ address });
    }

    // --- アドレス削除 ------------------------------------------------------
    case "delete-address": {
      const id = typeof body.addressId === "string" ? body.addressId : null;
      if (!id) return validationError([{ path: "addressId", message: "必須です" }]);

      const blocked = await requireStepUp(
        typeof body.code === "string" ? body.code : undefined,
      );
      if (blocked) return blocked;

      const address = await store.getAddress(ctx.tenant.id, id);
      // 他人のアドレスは「存在しない」ものとして扱う
      if (!address || address.userId !== ctx.user.id) {
        return unprocessable("対象のアドレスが見つかりません");
      }

      await store.deleteAddress(ctx.tenant.id, id);
      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: AUDIT_ACTIONS.ADDRESS_DELETE,
        targetType: "wallet_address",
        targetId: id,
        ip,
      });
      return ok({ deleted: true });
    }

    // --- 出金申請 ----------------------------------------------------------
    case "withdraw": {
      const parsed = createWithdrawalSchema.safeParse(body);
      if (!parsed.success) return validationError(formatZodError(parsed.error));

      const rl = checkRateLimit(`withdraw:${ctx.user.id}`, RATE_LIMITS.withdrawal);
      if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

      const blocked = await requireStepUp(parsed.data.code);
      if (blocked) return blocked;

      // ★ 冪等キー: ネットワーク再送で二重申請にならないようにする
      const idempotencyKey =
        req.headers.get("idempotency-key") ??
        `${ctx.user.id}:${parsed.data.addressId}:${parsed.data.amountBtc}:${Math.floor(Date.now() / 60_000)}`;

      try {
        const withdrawal = await requestWithdrawal({
          user: ctx.user,
          settings: ctx.settings,
          addressId: parsed.data.addressId,
          amountBtc: parsed.data.amountBtc,
          idempotencyKey,
          ip,
          userAgent: req.headers.get("user-agent"),
        });
        return ok({ withdrawal });
      } catch (err) {
        if (err instanceof WithdrawalError) return unprocessable(err.message);
        throw err;
      }
    }

    // --- 出金の取消 --------------------------------------------------------
    case "cancel": {
      const id = typeof body.withdrawalId === "string" ? body.withdrawalId : null;
      if (!id) return validationError([{ path: "withdrawalId", message: "必須です" }]);
      try {
        const withdrawal = await cancelWithdrawal({ user: ctx.user, withdrawalId: id });
        return ok({ withdrawal });
      } catch (err) {
        if (err instanceof WithdrawalError) return unprocessable(err.message);
        throw err;
      }
    }

    default:
      return validationError([{ path: "action", message: "不明な操作です" }]);
  }
});
