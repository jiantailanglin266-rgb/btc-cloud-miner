/**
 * デモデータ投入スクリプト
 *
 *   npx prisma migrate deploy   # 先にスキーマを適用する
 *   npm run prisma:seed
 *
 * ★ このファイルは tsx から直接実行されるため、`@/` エイリアスを使わない。
 *   Next.js のビルドパイプラインを通らないので、依存は最小限にしてある。
 *
 * ★ 本番環境で実行しないこと。デモ用アカウントが作られる。
 */

import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync, createHash } from "node:crypto";

const prisma = new PrismaClient();

const DEFAULT_TENANT_ID = "tenant-default";
const ACME_TENANT_ID = "tenant-acme";

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** 決定的な擬似乱数（毎回同じデモデータになるようにする） */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Bech32（デモ用の有効な BTC アドレス生成） -------------------------------
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}
function convertBits(data: number[]): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const value of data) {
    acc = (acc << 8) | value;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}
function demoAddress(seed: string): string {
  const hash = createHash("sha256").update(`btc-cloud-miner:demo:${seed}`).digest();
  const data = [0, ...convertBits(Array.from(hash.subarray(0, 20)))];
  const mod = polymod([...hrpExpand("bc"), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return `bc1${[...data, ...checksum].map((d) => B32[d]).join("")}`;
}

async function main() {
  // ★ フェーズ15: production への demo seed 投入を構造的に禁止する
  if (process.env.NODE_ENV === "production") {
    console.error(
      "NODE_ENV=production では demo seed を実行できません。\n" +
        "本番の初期化は docs/管理者マニュアル.md §1 の手順（テナント・管理者のみ作成）に従ってください。",
    );
    process.exit(1);
  }
  const rnd = mulberry32(20260808);
  const now = Date.now();
  const day = 86_400_000;
  const at = (msAgo: number) => new Date(now - msAgo);

  console.log("デモデータを投入します…");

  // --- テナント ------------------------------------------------------------
  for (const [id, slug, name] of [
    [DEFAULT_TENANT_ID, "default", "BTC CLOUD MINER"],
    [ACME_TENANT_ID, "acme", "ACME Mining Cloud"],
  ] as const) {
    await prisma.tenant.upsert({
      where: { id },
      create: { id, slug, name, status: "ACTIVE" },
      update: { name },
    });
  }

  const settingsBase = {
    platformFeeRate: 0.02,
    poolFeeRate: 0.02,
    electricityPriceKwh: 0.06,
    minWithdrawalBtc: "0.001",
    withdrawalFeeBtc: "0.00015",
    withdrawalTwoApproverThresholdBtc: "0.01",
    addressCooldownHours: 24,
    defaultCurrency: "USD",
    featureFlags: { simulator: true, support: true, aiInsights: true },
  };

  await prisma.tenantSettings.upsert({
    where: { tenantId: DEFAULT_TENANT_ID },
    create: {
      tenantId: DEFAULT_TENANT_ID,
      brandName: "BTC CLOUD MINER",
      logoText: "₿",
      colorPrimary: "#f7931a",
      colorAccent: "#2f7cff",
      ...settingsBase,
    },
    update: {},
  });

  // ホワイトラベルの例: 名前・ロゴ・色・手数料をすべて変えられる
  await prisma.tenantSettings.upsert({
    where: { tenantId: ACME_TENANT_ID },
    create: {
      tenantId: ACME_TENANT_ID,
      brandName: "ACME Mining Cloud",
      logoText: "A",
      colorPrimary: "#7c5cff",
      colorAccent: "#22d3ee",
      ...settingsBase,
      platformFeeRate: 0.035,
      poolFeeRate: 0.015,
    },
    update: {},
  });

  // --- ユーザー ------------------------------------------------------------
  const users: Array<[string, string, string, string, string, string]> = [
    ["user-demo", DEFAULT_TENANT_ID, "demo@example.com", "デモ 太郎", "USER", "demo1234"],
    ["user-admin", DEFAULT_TENANT_ID, "admin@example.com", "運営 管理者", "PLATFORM_ADMIN", "admin1234"],
    ["user-support", DEFAULT_TENANT_ID, "support@example.com", "サポート 花子", "SUPPORT", "support1234"],
    ["user-acme", ACME_TENANT_ID, "owner@acme.example.com", "ACME オーナー", "TENANT_ADMIN", "acme1234"],
    ["user-1", DEFAULT_TENANT_ID, "user1@example.com", "佐藤 一郎", "USER", "user1pass"],
    ["user-2", DEFAULT_TENANT_ID, "user2@example.com", "鈴木 次郎", "USER", "user2pass"],
    ["user-3", DEFAULT_TENANT_ID, "user3@example.com", "高橋 三郎", "USER", "user3pass"],
  ];

  for (const [id, tenantId, email, name, role, password] of users) {
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        tenantId,
        email,
        name,
        role,
        status: "ACTIVE",
        kycStatus: "APPROVED",
        createdAt: at(200 * day),
        lastLoginAt: at(2 * 3600_000),
        lastLoginIp: "203.0.113.20",
      },
      update: {},
    });
    await prisma.userCredential.upsert({
      where: { userId: id },
      create: { userId: id, passwordHash: hashPassword(password) },
      update: {},
    });
    await prisma.walletAccount.upsert({
      where: { userId: id },
      create: { id: `acct-${id}`, tenantId, userId: id },
      update: {},
    });
  }

  // --- プラン --------------------------------------------------------------
  const plans: Array<[string, number, number, number]> = [
    ["Starter", 100, 90, 620],
    ["Standard", 500, 365, 3000],
    ["Professional", 2000, 365, 11400],
    ["Enterprise", 10000, 730, 54000],
  ];
  for (const [name, ths, days, price] of plans) {
    const id = `plan-${name.toLowerCase()}`;
    await prisma.plan.upsert({
      where: { id },
      create: {
        id,
        tenantId: DEFAULT_TENANT_ID,
        name,
        description: `${ths.toLocaleString()} TH/s を ${days} 日間`,
        hashrateThs: ths,
        termDays: days,
        priceUsd: price,
        poolFeeRate: 0.02,
        platformFeeRate: 0.02,
        electricityPriceKwh: 0.06,
        payoutScheme: "FPPS",
        active: true,
      },
      update: {},
    });
  }

  // --- 契約 ----------------------------------------------------------------
  await prisma.contract.upsert({
    where: { id: "contract-demo-1" },
    create: {
      id: "contract-demo-1",
      tenantId: DEFAULT_TENANT_ID,
      userId: "user-demo",
      planId: "plan-standard",
      planName: "Standard",
      hashrateThs: 500,
      status: "ACTIVE",
      startsAt: at(120 * day),
      endsAt: new Date(now + 245 * day),
      autoRenew: true,
      upfrontCostUsd: 3000,
      createdAt: at(120 * day),
    },
    update: {},
  });

  // --- プロバイダー --------------------------------------------------------
  const providers = [
    {
      id: "provider-mock-01",
      kind: "MOCK",
      name: "Demo Farm Reykjavik",
      region: "IS-1",
      status: "ONLINE",
      priority: 1,
      enabled: true,
      poolName: "demo-pool-eu",
      payoutScheme: "FPPS",
    },
    {
      id: "provider-mock-02",
      kind: "MOCK",
      name: "Demo Farm Texas",
      region: "US-TX-2",
      status: "DEGRADED",
      priority: 2,
      enabled: true,
      poolName: "demo-pool-us",
      payoutScheme: "PPS_PLUS",
    },
    {
      id: "provider-pool-01",
      kind: "POOL_REST",
      name: "Pool REST (未接続)",
      region: "-",
      status: "MAINTENANCE",
      priority: 3,
      enabled: false,
      poolName: "-",
      payoutScheme: "FPPS",
      credentialsRef: "btc-cloud-miner/pool/api-key",
    },
  ];
  for (const p of providers) {
    await prisma.miningProvider.upsert({
      where: { id: p.id },
      create: { tenantId: DEFAULT_TENANT_ID, lastOkAt: at(60_000), ...p },
      update: {},
    });
  }

  // --- ワーカー ------------------------------------------------------------
  // ワーカー = 実機の 1/10 スライス（クラウドマイニングの一般的な割当単位）
  const models: Array<[string, number, number]> = [
    ["Antminer S21 Hydro (1/10)", 33.5, 16.0],
    ["Antminer S21 Pro (1/10)", 23.4, 15.0],
    ["Whatsminer M60S (1/10)", 18.6, 18.5],
    ["Avalon A1466 (1/10)", 15.0, 21.0],
  ];
  let allocated = 0;
  let i = 0;
  while (allocated < 500 && i < 200) {
    const [model, rated, eff] = models[i % models.length];
    const share = Math.min(rated, 500 - allocated);
    const providerId = i % 5 === 4 ? "provider-mock-02" : "provider-mock-01";
    const id = `worker-${String(i + 1).padStart(3, "0")}`;
    await prisma.worker.upsert({
      where: { providerId_externalWorkerId: { providerId, externalWorkerId: `w${i + 1}` } },
      create: {
        id,
        tenantId: DEFAULT_TENANT_ID,
        providerId,
        externalWorkerId: `w${i + 1}`,
        minerId: `MIN-${100000 + Math.floor(rnd() * 899999)}`,
        model,
        ratedHashrateThs: share,
        ratedEfficiencyJPerTh: eff,
        // 1 台だけ意図的に停止させ、アラート・AI 検知が見えるようにする
        status: i === 13 ? "OFFLINE" : "ACTIVE",
        lastSeenAt: i === 13 ? at(23 * 60_000) : at(40_000),
      },
      update: {},
    });
    await prisma.hashrateAllocation.upsert({
      where: { id: `alloc-${id}` },
      create: {
        id: `alloc-${id}`,
        tenantId: DEFAULT_TENANT_ID,
        contractId: "contract-demo-1",
        providerId,
        workerId: id,
        hashrateThs: share,
      },
      update: {},
    });
    allocated += share;
    i++;
  }

  // --- 報酬履歴・元帳 ------------------------------------------------------
  for (let d = 120; d >= 1; d--) {
    const drift = 1 + d * 0.0006;
    const noise = 0.94 + rnd() * 0.12;
    const gross = 0.00024494 * drift * noise;
    const poolFee = gross * 0.02;
    const platformFee = gross * 0.02;
    const net = gross - poolFee - platformFee;

    await prisma.earning.upsert({
      where: { id: `earn-${d}` },
      create: {
        id: `earn-${d}`,
        tenantId: DEFAULT_TENANT_ID,
        userId: "user-demo",
        contractId: "contract-demo-1",
        earnedAt: at(d * day),
        grossBtc: gross.toFixed(8),
        poolFeeBtc: poolFee.toFixed(8),
        platformFeeBtc: platformFee.toFixed(8),
        electricityFeeBtc: "0",
        netBtc: net.toFixed(8),
        hashrateThs: 500 * (0.97 + rnd() * 0.05),
        uptimeRate: 0.97 + rnd() * 0.029,
      },
      update: {},
    });

    await prisma.ledgerEntry.upsert({
      where: { tenantId_idempotencyKey: { tenantId: DEFAULT_TENANT_ID, idempotencyKey: `earning:${d}` } },
      create: {
        id: `led-${d}`,
        tenantId: DEFAULT_TENANT_ID,
        accountId: "acct-user-demo",
        entryType: "MINING_REWARD",
        bucket: "AVAILABLE",
        amountBtc: net.toFixed(8),
        refType: "earning",
        refId: `earn-${d}`,
        idempotencyKey: `earning:${d}`,
        memo: "日次マイニング報酬",
        createdAt: at(d * day),
      },
      update: {},
    });
  }

  // --- 出金先アドレス ------------------------------------------------------
  const addr = [
    ["addr-1", "user-demo", demoAddress("main"), "メインウォレット", 40 * day, -39 * day],
    ["addr-2", "user-demo", demoAddress("sub"), "サブウォレット（クールダウン中）", 3 * 3600_000, 21 * 3600_000],
    ["addr-3", "user-1", demoAddress("flagged"), "新規登録アドレス", 2 * 3600_000, 22 * 3600_000],
  ] as const;
  for (const [id, userId, address, label, createdAgo, usableOffset] of addr) {
    await prisma.walletAddress.upsert({
      where: { id },
      create: {
        id,
        tenantId: DEFAULT_TENANT_ID,
        userId,
        address,
        label,
        createdAt: at(createdAgo),
        usableAt: new Date(now + (usableOffset < 0 ? usableOffset : usableOffset)),
      },
      update: {},
    });
  }

  // --- 出金（承認待ち。管理画面の承認フローをすぐ試せるように） --------------
  await prisma.withdrawal.upsert({
    where: { id: "wd-1002" },
    create: {
      id: "wd-1002",
      tenantId: DEFAULT_TENANT_ID,
      userId: "user-1",
      userEmail: "user1@example.com",
      addressId: "addr-3",
      address: demoAddress("flagged"),
      amountBtc: "0.02",
      feeBtc: "0.00015",
      netBtc: "0.01985",
      status: "FLAGGED",
      riskScore: 72,
      riskReasons: [
        "新規登録アドレス（登録から 2 時間）",
        "平均出金額の 6.2 倍",
        "普段と異なる IP（初出の国）",
      ],
      requiredApprovals: 2,
      approvals: [],
      requestedIp: "198.51.100.77",
      idempotencyKey: "seed-wd-1002",
      createdAt: at(40 * 60_000),
    },
    update: {},
  });

  // --- 通知・障害 ----------------------------------------------------------
  await prisma.notification.upsert({
    where: { id: "notif-1" },
    create: {
      id: "notif-1",
      tenantId: DEFAULT_TENANT_ID,
      userId: "user-demo",
      level: "WARNING",
      title: "ワーカーが停止しています",
      body: "worker-014 が 23 分前から応答していません。",
      href: "/mining/workers",
      createdAt: at(23 * 60_000),
    },
    update: {},
  });

  await prisma.incident.upsert({
    where: { id: "inc-1" },
    create: {
      id: "inc-1",
      tenantId: DEFAULT_TENANT_ID,
      title: "Demo Farm Texas の統計取得が遅延しています",
      severity: "SEV3",
      status: "MONITORING",
      body: "上流プロバイダーの API 応答が遅延しています。採掘自体は継続しています。",
      affectedComponents: ["provider-mock-02"],
      startedAt: at(3 * 3600_000),
    },
    update: {},
  });

  console.log("完了しました。");
  console.log("  一般ユーザー : demo@example.com / demo1234");
  console.log("  管理者       : admin@example.com / admin1234");
  console.log("  サポート     : support@example.com / support1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
