/**
 * zod スキーマ。API とフォームで共用する。
 *
 * 方針:
 *   - 上限値を必ず設ける（巨大な入力による DoS・表示崩れの防止）
 *   - BTC 金額は文字列で受け取り、正規表現で桁数まで検証する
 */

import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("メールアドレスの形式が正しくありません");

export const passwordSchema = z
  .string()
  .min(10, "パスワードは10文字以上にしてください")
  .max(200);

/** BTC 金額: 小数点以下 8 桁まで。負数・指数表記を許さない */
export const btcAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "BTC 金額の形式が正しくありません（小数点以下8桁まで）");

export const totpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, "6桁の数字を入力してください");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, "名前を入力してください").max(100),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "パスワードを入力してください").max(200),
});

export const twoFactorLoginSchema = z.object({
  challengeId: z.string().min(1).max(200),
  code: totpCodeSchema,
});

export const enableTwoFactorSchema = z.object({
  code: totpCodeSchema,
});

/**
 * BTC アドレスの形式チェック（第一関門）。
 * チェックサム検証は modules/wallet/address.ts で行う。
 */
export const btcAddressSchema = z
  .string()
  .trim()
  .min(14)
  .max(90)
  .regex(
    /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|tb1[a-z0-9]{8,87}|[mn2][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    "Bitcoin アドレスの形式が正しくありません",
  );

export const createAddressSchema = z.object({
  address: btcAddressSchema,
  label: z.string().trim().min(1).max(50),
  code: totpCodeSchema,
});

export const createWithdrawalSchema = z.object({
  addressId: z.string().min(1).max(100),
  amountBtc: btcAmountSchema,
  code: totpCodeSchema,
});

/** シミュレーターの入力。上限は現実的な最大値に合わせる */
export const simulatorSchema = z.object({
  hashrateThs: z.number().min(0).max(10_000_000),
  efficiencyJPerTh: z.number().min(1).max(1000),
  electricityPriceKwh: z.number().min(0).max(10),
  btcPriceUsd: z.number().min(0).max(100_000_000),
  networkHashrateThs: z.number().min(1).max(1e12).optional(),
  difficulty: z.number().min(1).max(1e18).optional(),
  blockRewardBtc: z.number().min(0).max(50).optional(),
  poolFeeRate: z.number().min(0).max(0.5),
  platformFeeRate: z.number().min(0).max(0.5),
  uptimeRate: z.number().min(0).max(1),
  upfrontCostUsd: z.number().min(0).max(100_000_000).optional(),
});

export const seriesRangeSchema = z.enum(["1h", "24h", "7d", "30d", "90d", "1y"]);

export const createContractSchema = z.object({
  planId: z.string().min(1).max(100),
});

export const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(4000),
});

export const ticketMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

/** テナントのカラー設定。CSS へ注入するため厳格に検証する（XSS 防止） */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "#RRGGBB 形式で入力してください");

export const tenantSettingsSchema = z.object({
  brandName: z.string().trim().min(1).max(60),
  logoText: z.string().trim().min(1).max(4),
  colorPrimary: hexColorSchema,
  colorAccent: hexColorSchema,
  platformFeeRate: z.number().min(0).max(0.5),
  poolFeeRate: z.number().min(0).max(0.5),
  electricityPriceKwh: z.number().min(0).max(10),
  minWithdrawalBtc: btcAmountSchema,
  withdrawalFeeBtc: btcAmountSchema,
});

export const approveWithdrawalSchema = z.object({
  note: z.string().trim().max(500).default(""),
  code: totpCodeSchema,
});

export const rejectWithdrawalSchema = z.object({
  note: z.string().trim().min(1, "却下理由を入力してください").max(500),
});

export const updateUserSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"]).optional(),
  role: z
    .enum(["USER", "ORG_ADMIN", "TENANT_ADMIN", "PLATFORM_ADMIN", "SUPPORT", "AUDITOR"])
    .optional(),
  kycStatus: z
    .enum(["NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED", "EXPIRED"])
    .optional(),
});

export const updateProviderSchema = z.object({
  enabled: z.boolean().optional(),
  status: z.enum(["ONLINE", "DEGRADED", "OFFLINE", "MAINTENANCE"]).optional(),
  priority: z.number().int().min(1).max(100).optional(),
});

/** zod のエラーを API レスポンス用に整形する */
export function formatZodError(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({
    path: i.path.join(".") || "_",
    message: i.message,
  }));
}
