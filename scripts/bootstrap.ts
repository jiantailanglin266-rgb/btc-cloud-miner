/**
 * 本番/paper 運用の初期化 CLI（管理者マニュアル §1 の「初期化スクリプト」）
 *
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com \
 *   BOOTSTRAP_ADMIN_PASSWORD='16文字以上の強いパスワード' \
 *   npm run bootstrap
 *
 * 作成するのは以下の 3 行だけ（デモデータは一切作らない）:
 *   - tenants: 既定テナント 1 行
 *   - tenant_settings: 既定設定
 *   - PLATFORM_ADMIN ユーザー 1 名 + scrypt 資格情報
 *
 * 安全装置:
 *   - DATABASE_URL 必須（インメモリへの bootstrap は無意味なため拒否）
 *   - 既にユーザーが 1 人でも存在する DB では拒否（誤実行で権限者を増やさない）
 *   - パスワードは 16 文字未満を拒否。ログ・標準出力には一切出さない
 *
 * ★ このファイルは tsx から直接実行されるため、`@/` エイリアスを使わない。
 */

import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const DEFAULT_TENANT_ID = "tenant-default";

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[bootstrap] DATABASE_URL が未設定です。永続 DB なしでの初期化は行えません。");
    process.exit(1);
  }
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !email.includes("@")) {
    console.error("[bootstrap] BOOTSTRAP_ADMIN_EMAIL を設定してください。");
    process.exit(1);
  }
  if (!password || password.length < 16) {
    console.error("[bootstrap] BOOTSTRAP_ADMIN_PASSWORD は 16 文字以上にしてください。");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.count();
    if (existing > 0) {
      console.error(
        `[bootstrap] 既にユーザーが ${existing} 名存在するため中止しました。` +
          "（追加の管理者は既存管理者が /admin/users から作成してください）",
      );
      process.exit(1);
    }

    await prisma.tenant.upsert({
      where: { id: DEFAULT_TENANT_ID },
      create: { id: DEFAULT_TENANT_ID, slug: "default", name: "BTC CLOUD MINER", status: "ACTIVE" },
      update: {},
    });
    await prisma.tenantSettings.upsert({
      where: { tenantId: DEFAULT_TENANT_ID },
      create: {
        tenantId: DEFAULT_TENANT_ID,
        brandName: "BTC CLOUD MINER",
        logoText: "₿",
        colorPrimary: "#f7931a",
        colorAccent: "#2f7cff",
        platformFeeRate: 0.02,
        poolFeeRate: 0.02,
        electricityPriceKwh: 0.06,
        minWithdrawalBtc: "0.001",
        withdrawalFeeBtc: "0.00015",
        withdrawalTwoApproverThresholdBtc: "0.01",
        addressCooldownHours: 24,
        defaultCurrency: "USD",
        featureFlags: { simulator: true, support: true, aiInsights: true },
      },
      update: {},
    });

    const adminId = `user-${randomBytes(8).toString("hex")}`;
    await prisma.user.create({
      data: {
        id: adminId,
        tenantId: DEFAULT_TENANT_ID,
        email,
        name: "Platform Admin",
        role: "PLATFORM_ADMIN",
        status: "ACTIVE",
        kycStatus: "APPROVED",
      },
    });
    await prisma.userCredential.create({
      data: { userId: adminId, passwordHash: hashPassword(password) },
    });

    console.info(`[bootstrap] 完了: テナント default と管理者 ${email} を作成しました。`);
    console.info("[bootstrap] ★ すぐにログインして 2FA を有効化してください（/settings）。");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // パスワードが混ざらないようメッセージのみ出す
  console.error("[bootstrap] 失敗:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
