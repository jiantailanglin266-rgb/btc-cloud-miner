/**
 * インメモリ Store 実装（デモ・開発・テスト用）
 *
 * ★ 本番では使わないこと。
 *   - プロセス再起動でデータが消える
 *   - 複数インスタンス間で共有されない（セッションが揮発する）
 *   本番は必ず DATABASE_URL を設定して Prisma 実装を使う。
 *
 * デモデータは決定的な擬似乱数（mulberry32）で生成する。
 * 起動のたびに数値が変わると「毎回違う」ことに気付けないため、シードを固定している。
 */

import type { Store } from "./types";
import type {
  AiInsight,
  Alert,
  AuditLog,
  Contract,
  Earning,
  HashrateAllocation,
  Incident,
  LedgerEntry,
  MiningProvider,
  Notification,
  Plan,
  PoolPayout,
  RawProviderSnapshot,
  Session,
  SyncLock,
  SupportTicket,
  Tenant,
  TenantSettings,
  User,
  UserCredentials,
  WalletAccount,
  WalletAddress,
  Withdrawal,
  Worker,
  WorkerSnapshot,
} from "@/types";
import { hashPassword, newId } from "@/lib/crypto";
import { config } from "@/lib/config";
import { addBtc } from "@/lib/decimal";
import { demoAddress } from "@/modules/wallet/address";

// ---------------------------------------------------------------------------
// 決定的 PRNG
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// データベース本体
// ---------------------------------------------------------------------------

type Db = {
  tenants: Tenant[];
  settings: Map<string, TenantSettings>;
  users: User[];
  credentials: Map<string, UserCredentials>;
  sessions: Map<string, Session>;
  plans: Plan[];
  contracts: Contract[];
  allocations: HashrateAllocation[];
  providers: MiningProvider[];
  workers: Worker[];
  snapshots: WorkerSnapshot[];
  accounts: WalletAccount[];
  ledger: LedgerEntry[];
  addresses: WalletAddress[];
  withdrawals: Withdrawal[];
  earnings: Earning[];
  notifications: Notification[];
  tickets: SupportTicket[];
  incidents: Incident[];
  auditLogs: AuditLog[];
  insights: AiInsight[];
  payouts: PoolPayout[];
  alerts: Alert[];
  rawSnapshots: RawProviderSnapshot[];
  locks: Map<string, SyncLock>;
};

const DEFAULT_TENANT_ID = "tenant-default";
const ACME_TENANT_ID = "tenant-acme";

export const DEMO_ACCOUNTS = {
  user: { email: "demo@example.com", password: "demo1234" },
  admin: { email: "admin@example.com", password: "admin1234" },
  support: { email: "support@example.com", password: "support1234" },
  tenantAdmin: { email: "owner@acme.example.com", password: "acme1234" },
} as const;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// シード
// ---------------------------------------------------------------------------

function buildSeed(): Db {
  const rnd = mulberry32(20260808);
  const now = Date.now();
  const day = 86_400_000;

  const db: Db = {
    tenants: [],
    settings: new Map(),
    users: [],
    credentials: new Map(),
    sessions: new Map(),
    plans: [],
    contracts: [],
    allocations: [],
    providers: [],
    workers: [],
    snapshots: [],
    accounts: [],
    ledger: [],
    addresses: [],
    withdrawals: [],
    earnings: [],
    notifications: [],
    tickets: [],
    incidents: [],
    auditLogs: [],
    insights: [],
    payouts: [],
    alerts: [],
    rawSnapshots: [],
    locks: new Map(),
  };

  // --- テナント ------------------------------------------------------------
  db.tenants.push(
    {
      id: DEFAULT_TENANT_ID,
      slug: "default",
      name: config.brandName,
      status: "ACTIVE",
      createdAt: iso(now - 400 * day),
    },
    {
      id: ACME_TENANT_ID,
      slug: "acme",
      name: "ACME Mining Cloud",
      status: "ACTIVE",
      createdAt: iso(now - 120 * day),
    },
  );

  const baseSettings = (tenantId: string, over: Partial<TenantSettings>): TenantSettings => ({
    tenantId,
    brandName: config.brandName,
    logoText: "₿",
    colorPrimary: "#f7931a",
    colorAccent: "#2f7cff",
    platformFeeRate: config.fees.platformFeeRate,
    poolFeeRate: config.fees.poolFeeRate,
    electricityPriceKwh: config.fees.electricityPriceKwh,
    minWithdrawalBtc: config.wallet.minWithdrawalBtc,
    withdrawalFeeBtc: config.wallet.withdrawalFeeBtc,
    withdrawalTwoApproverThresholdBtc: config.wallet.twoApproverThresholdBtc,
    addressCooldownHours: config.wallet.addressCooldownHours,
    defaultCurrency: "USD",
    featureFlags: { simulator: true, support: true, aiInsights: true },
    ...over,
  });

  db.settings.set(DEFAULT_TENANT_ID, baseSettings(DEFAULT_TENANT_ID, {}));
  db.settings.set(
    ACME_TENANT_ID,
    baseSettings(ACME_TENANT_ID, {
      // ホワイトラベルの例: 名前・ロゴ・色・手数料をすべて変えられる
      brandName: "ACME Mining Cloud",
      logoText: "A",
      colorPrimary: "#7c5cff",
      colorAccent: "#22d3ee",
      platformFeeRate: 0.035,
      poolFeeRate: 0.015,
    }),
  );

  // --- ユーザー ------------------------------------------------------------
  const mkUser = (
    id: string,
    tenantId: string,
    email: string,
    name: string,
    role: User["role"],
    password: string,
    over: Partial<User> = {},
  ) => {
    const user: User = {
      id,
      tenantId,
      organizationId: null,
      email,
      name,
      role,
      status: "ACTIVE",
      kycStatus: "APPROVED",
      twoFactorEnabled: false,
      createdAt: iso(now - 200 * day),
      lastLoginAt: iso(now - 2 * 3600_000),
      lastLoginIp: "203.0.113.20",
      deletedAt: null,
      ...over,
    };
    db.users.push(user);
    db.credentials.set(id, {
      userId: id,
      passwordHash: hashPassword(password),
      totpSecretEnc: null,
      recoveryCodesEnc: null,
      failedAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: iso(now - 200 * day),
    });
    db.accounts.push({
      id: `acct-${id}`,
      tenantId,
      userId: id,
      createdAt: iso(now - 200 * day),
    });
    return user;
  };

  const demoUser = mkUser(
    "user-demo",
    DEFAULT_TENANT_ID,
    DEMO_ACCOUNTS.user.email,
    "デモ 太郎",
    "USER",
    DEMO_ACCOUNTS.user.password,
  );
  mkUser(
    "user-admin",
    DEFAULT_TENANT_ID,
    DEMO_ACCOUNTS.admin.email,
    "運営 管理者",
    "PLATFORM_ADMIN",
    DEMO_ACCOUNTS.admin.password,
  );
  mkUser(
    "user-support",
    DEFAULT_TENANT_ID,
    DEMO_ACCOUNTS.support.email,
    "サポート 花子",
    "SUPPORT",
    DEMO_ACCOUNTS.support.password,
  );
  mkUser(
    "user-acme",
    ACME_TENANT_ID,
    DEMO_ACCOUNTS.tenantAdmin.email,
    "ACME オーナー",
    "TENANT_ADMIN",
    DEMO_ACCOUNTS.tenantAdmin.password,
  );
  // 一般ユーザーを追加（管理画面の一覧を意味のあるものにするため）
  const extraNames = ["佐藤 一郎", "鈴木 次郎", "高橋 三郎", "田中 四郎", "伊藤 五郎"];
  extraNames.forEach((name, i) => {
    mkUser(
      `user-${i + 1}`,
      DEFAULT_TENANT_ID,
      `user${i + 1}@example.com`,
      name,
      "USER",
      `user${i + 1}pass`,
      {
        kycStatus: (["APPROVED", "PENDING", "APPROVED", "NOT_SUBMITTED", "APPROVED"] as const)[i],
        status: i === 3 ? "SUSPENDED" : "ACTIVE",
      },
    );
  });

  // --- プラン --------------------------------------------------------------
  const planDefs: Array<[string, number, number, number]> = [
    ["Starter", 100, 90, 620],
    ["Standard", 500, 365, 3000],
    ["Professional", 2000, 365, 11400],
    ["Enterprise", 10000, 730, 54000],
  ];
  for (const [name, ths, days, price] of planDefs) {
    db.plans.push({
      id: `plan-${name.toLowerCase()}`,
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
    });
  }

  // --- 契約 ----------------------------------------------------------------
  const contract: Contract = {
    id: "contract-demo-1",
    tenantId: DEFAULT_TENANT_ID,
    userId: demoUser.id,
    planId: "plan-standard",
    planName: "Standard",
    providerId: "provider-mock-01",
    connectionModel: "PARTNER_FARM",
    hashrateThs: config.mining.mockHashrateThs,
    status: "ACTIVE",
    startsAt: iso(now - 120 * day),
    endsAt: iso(now + 245 * day),
    autoRenew: true,
    upfrontCostUsd: 3000,
    poolFeeRate: 0.02,
    platformFeeRate: 0.02,
    revenueShareRate: 0,
    hostingFeeRate: 0,
    electricityCostTreatment: "INCLUDED",
    createdAt: iso(now - 120 * day),
  };
  db.contracts.push(contract);

  // --- プロバイダー --------------------------------------------------------
  const mkProvider = (over: Partial<MiningProvider> & Pick<MiningProvider, "id" | "kind" | "name">): MiningProvider => ({
    tenantId: DEFAULT_TENANT_ID,
    region: "-",
    endpoint: null,
    credentialsRef: null,
    credentialsEnc: null,
    workerPrefix: null,
    status: "ONLINE",
    lastOkAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastLatencyMs: null,
    lastSyncAt: null,
    priority: 1,
    enabled: true,
    poolName: "",
    payoutScheme: "FPPS",
    ...over,
  });
  db.providers.push(
    mkProvider({
      id: "provider-mock-01",
      kind: "MOCK",
      name: "Demo Farm Reykjavik",
      region: "IS-1",
      lastOkAt: iso(now - 60_000),
      lastLatencyMs: 12,
      lastSyncAt: iso(now - 60_000),
      poolName: "demo-pool-eu",
    }),
    mkProvider({
      id: "provider-mock-02",
      kind: "MOCK",
      name: "Demo Farm Texas",
      region: "US-TX-2",
      status: "DEGRADED",
      lastOkAt: iso(now - 12 * 60_000),
      lastError: "upstream latency 4210ms",
      consecutiveFailures: 2,
      lastLatencyMs: 4210,
      lastSyncAt: iso(now - 12 * 60_000),
      priority: 2,
      poolName: "demo-pool-us",
      payoutScheme: "PPS_PLUS",
    }),
    mkProvider({
      id: "provider-pool-01",
      kind: "POOL_REST",
      name: "Pool REST (未接続)",
      credentialsRef: "btc-cloud-miner/pool/api-key",
      status: "MAINTENANCE",
      priority: 3,
      enabled: false,
    }),
  );

  // --- ワーカー ------------------------------------------------------------
  // クラウドマイニングでは実機を「スライス」単位で割り当てるのが一般的。
  // 1台をユーザー間で分割するため、ワーカー = 実機の 1/10 スライスとして扱う
  const models: Array<[string, number, number]> = [
    ["Antminer S21 Hydro (1/10)", 33.5, 16.0],
    ["Antminer S21 Pro (1/10)", 23.4, 15.0],
    ["Whatsminer M60S (1/10)", 18.6, 18.5],
    ["Avalon A1466 (1/10)", 15.0, 21.0],
  ];
  let allocated = 0;
  let workerIndex = 0;
  const targetThs = contract.hashrateThs;

  while (allocated < targetThs && workerIndex < 200) {
    const [model, rated, eff] = models[workerIndex % models.length];
    // 契約量ぴったりに合わせるため、最後の1台は端数にする
    const remaining = targetThs - allocated;
    const share = Math.min(rated, remaining);
    const providerId = workerIndex % 5 === 4 ? "provider-mock-02" : "provider-mock-01";
    const id = `worker-${String(workerIndex + 1).padStart(3, "0")}`;
    db.workers.push({
      id,
      tenantId: DEFAULT_TENANT_ID,
      providerId,
      externalWorkerId: `w${workerIndex + 1}`,
      minerId: `MIN-${(100000 + Math.floor(rnd() * 899999)).toString()}`,
      model,
      ratedHashrateThs: share,
      ratedEfficiencyJPerTh: eff,
      // 数台だけ意図的に OFFLINE にして、アラート・AI 検知が見えるようにする
      status: workerIndex === 13 ? "OFFLINE" : "ACTIVE",
      lastSeenAt: workerIndex === 13 ? iso(now - 23 * 60_000) : iso(now - 40_000),
    });
    db.allocations.push({
      id: `alloc-${id}`,
      tenantId: DEFAULT_TENANT_ID,
      contractId: contract.id,
      providerId,
      workerId: id,
      hashrateThs: share,
      createdAt: iso(now - 120 * day),
    });
    allocated += share;
    workerIndex++;
  }

  // --- 報酬履歴・元帳 ------------------------------------------------------
  // 過去 120 日分の日次報酬。決定的に生成する。
  const accountId = `acct-${demoUser.id}`;
  let lifetime = "0.00000000";
  for (let d = 120; d >= 1; d--) {
    const at = now - d * day;
    // 難易度上昇を模して、古い日ほどわずかに採掘量が多い
    const drift = 1 + d * 0.0006;
    const noise = 0.94 + rnd() * 0.12;
    const gross = (0.00024494 * drift * noise).toFixed(8);
    const poolFee = (Number(gross) * 0.02).toFixed(8);
    const platformFee = (Number(gross) * 0.02).toFixed(8);
    const net = (Number(gross) - Number(poolFee) - Number(platformFee)).toFixed(8);

    db.earnings.push({
      id: `earn-${d}`,
      tenantId: DEFAULT_TENANT_ID,
      userId: demoUser.id,
      contractId: contract.id,
      earnedAt: iso(at),
      grossBtc: gross,
      poolFeeBtc: poolFee,
      platformFeeBtc: platformFee,
      electricityFeeBtc: "0.00000000",
      netBtc: net,
      hashrateThs: contract.hashrateThs * (0.97 + rnd() * 0.05),
      uptimeRate: 0.97 + rnd() * 0.029,
      // デモ seed は疑似的な「確定」履歴だが、実プール payout 由来ではないため
      // ESTIMATED とし、実収益（ACTUAL）と絶対に混同させない
      kind: "ESTIMATED",
      payoutId: null,
    });

    db.ledger.push({
      id: `led-${d}`,
      tenantId: DEFAULT_TENANT_ID,
      accountId,
      entryType: "MINING_REWARD",
      bucket: "AVAILABLE",
      amountBtc: net,
      refType: "earning",
      refId: `earn-${d}`,
      idempotencyKey: `earning:${d}`,
      memo: `日次マイニング報酬（${new Date(at).toISOString().slice(0, 10)}）`,
      createdAt: iso(at),
    });
    lifetime = addBtc(lifetime, net);
  }

  // --- 出金先アドレス ------------------------------------------------------
  // チェックサムまで正しい形式のデモ用アドレス（誰も秘密鍵を持たないため送金は届かない）
  const demoAddr1 = demoAddress("main");
  const demoAddr2 = demoAddress("sub");
  const demoAddr3 = demoAddress("flagged");
  db.addresses.push(
    {
      id: "addr-1",
      tenantId: DEFAULT_TENANT_ID,
      userId: demoUser.id,
      address: demoAddr1,
      label: "メインウォレット",
      createdAt: iso(now - 40 * day),
      usableAt: iso(now - 39 * day),
    },
    {
      id: "addr-2",
      tenantId: DEFAULT_TENANT_ID,
      userId: demoUser.id,
      address: demoAddr2,
      label: "サブウォレット（クールダウン中）",
      createdAt: iso(now - 3 * 3600_000),
      usableAt: iso(now + 21 * 3600_000),
    },
    {
      id: "addr-3",
      tenantId: DEFAULT_TENANT_ID,
      userId: "user-1",
      address: demoAddr3,
      label: "新規登録アドレス",
      createdAt: iso(now - 2 * 3600_000),
      usableAt: iso(now + 22 * 3600_000),
    },
  );

  // --- 出金（承認待ち・過去分） --------------------------------------------
  const wdPast: Withdrawal = {
    id: "wd-1001",
    tenantId: DEFAULT_TENANT_ID,
    userId: demoUser.id,
    userEmail: demoUser.email,
    addressId: "addr-1",
    address: demoAddr1,
    amountBtc: "0.00500000",
    feeBtc: "0.00015000",
    netBtc: "0.00485000",
    status: "CONFIRMED",
    riskScore: 8,
    riskReasons: [],
    requiredApprovals: 1,
    approvals: [
      {
        approverId: "user-admin",
        approverEmail: DEMO_ACCOUNTS.admin.email,
        decidedAt: iso(now - 20 * day),
        decision: "APPROVE",
        note: "通常範囲",
      },
    ],
    requestedIp: "203.0.113.20",
    txId: "demo-tx-0000000000000000000000000000000000000000000000000000000000",
    confirmations: 128,
    idempotencyKey: "seed-wd-1001",
    createdAt: iso(now - 20 * day),
    updatedAt: iso(now - 20 * day + 3600_000),
  };
  db.withdrawals.push(wdPast);
  db.ledger.push({
    id: "led-wd-1001",
    tenantId: DEFAULT_TENANT_ID,
    accountId,
    entryType: "WITHDRAWAL_SETTLE",
    bucket: "AVAILABLE",
    amountBtc: "-0.00500000",
    refType: "withdrawal",
    refId: "wd-1001",
    idempotencyKey: "seed-wd-1001-settle",
    memo: "出金（送金完了）",
    createdAt: iso(now - 20 * day),
  });

  // 承認待ちの出金を1件（管理画面の承認フローをすぐ試せるように）
  const wdPending: Withdrawal = {
    id: "wd-1002",
    tenantId: DEFAULT_TENANT_ID,
    userId: "user-1",
    userEmail: "user1@example.com",
    addressId: "addr-3",
    address: demoAddr3,
    amountBtc: "0.02000000",
    feeBtc: "0.00015000",
    netBtc: "0.01985000",
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
    txId: null,
    confirmations: 0,
    idempotencyKey: "seed-wd-1002",
    createdAt: iso(now - 40 * 60_000),
    updatedAt: iso(now - 40 * 60_000),
  };
  db.withdrawals.push(wdPending);

  // --- 通知 ----------------------------------------------------------------
  db.notifications.push(
    {
      id: "notif-1",
      tenantId: DEFAULT_TENANT_ID,
      userId: demoUser.id,
      level: "WARNING",
      title: "ワーカーが停止しています",
      body: "worker-014 が 23 分前から応答していません。プロバイダー側で確認中です。",
      href: "/mining/workers",
      readAt: null,
      createdAt: iso(now - 23 * 60_000),
    },
    {
      id: "notif-2",
      tenantId: DEFAULT_TENANT_ID,
      userId: demoUser.id,
      level: "INFO",
      title: "ネットワーク難易度が調整されました",
      body: "難易度が +2.1% 調整されました。推定収益はわずかに減少します。",
      href: "/network",
      readAt: null,
      createdAt: iso(now - 6 * 3600_000),
    },
    {
      id: "notif-3",
      tenantId: DEFAULT_TENANT_ID,
      userId: demoUser.id,
      level: "INFO",
      title: "出金が完了しました",
      body: "0.00485 BTC の送金が完了しました（確認数 128）。",
      href: "/wallet/withdrawals",
      readAt: iso(now - 19 * day),
      createdAt: iso(now - 20 * day),
    },
  );

  // --- 障害情報 ------------------------------------------------------------
  db.incidents.push({
    id: "inc-1",
    tenantId: DEFAULT_TENANT_ID,
    title: "Demo Farm Texas の統計取得が遅延しています",
    severity: "SEV3",
    status: "MONITORING",
    body: "上流プロバイダーの API 応答が遅延しており、統計の更新間隔が通常より長くなっています。採掘自体は継続しています。",
    affectedComponents: ["provider-mock-02"],
    startedAt: iso(now - 3 * 3600_000),
    resolvedAt: null,
  });

  // --- サポート ------------------------------------------------------------
  db.tickets.push({
    id: "ticket-1",
    tenantId: DEFAULT_TENANT_ID,
    userId: demoUser.id,
    userEmail: demoUser.email,
    subject: "出金にかかる時間について",
    category: "出金",
    status: "RESOLVED",
    messages: [
      {
        id: "msg-1",
        authorId: demoUser.id,
        authorName: "デモ 太郎",
        isStaff: false,
        body: "出金申請してから着金まで、通常どれくらいかかりますか？",
        createdAt: iso(now - 21 * day),
      },
      {
        id: "msg-2",
        authorId: "user-support",
        authorName: "サポート 花子",
        isStaff: true,
        body: "承認までが通常 1〜24 時間、その後のブロードキャストと確認で 30 分〜2 時間程度です。金額が大きい場合は 2 名承認となるため、やや長くなることがあります。",
        createdAt: iso(now - 21 * day + 2 * 3600_000),
      },
    ],
    createdAt: iso(now - 21 * day),
    updatedAt: iso(now - 21 * day + 2 * 3600_000),
  });

  // --- 監査ログ ------------------------------------------------------------
  const auditSeed: Array<[string, string, string, number]> = [
    ["auth.login", "user", "user-demo", 2],
    ["withdrawal.request", "withdrawal", "wd-1002", 0.7],
    ["withdrawal.approve", "withdrawal", "wd-1001", 480],
    ["provider.update", "provider", "provider-mock-02", 3],
    ["user.kyc_update", "user", "user-1", 26],
  ];
  auditSeed.forEach(([action, targetType, targetId, hoursAgo], i) => {
    db.auditLogs.push({
      id: `audit-${i + 1}`,
      tenantId: DEFAULT_TENANT_ID,
      actorUserId: action.startsWith("withdrawal.approve") ? "user-admin" : "user-demo",
      actorEmail: action.startsWith("withdrawal.approve")
        ? DEMO_ACCOUNTS.admin.email
        : DEMO_ACCOUNTS.user.email,
      actorRole: action.startsWith("withdrawal.approve") ? "PLATFORM_ADMIN" : "USER",
      action,
      targetType,
      targetId,
      detail: {},
      ip: "203.0.113.20",
      userAgent: "Mozilla/5.0",
      result: "SUCCESS",
      createdAt: iso(now - hoursAgo * 3600_000),
    });
  });

  return db;
}

// HMR で状態が消えないように globalThis に保持する
const g = globalThis as unknown as { __btcMemoryDb?: Db };
const db: Db = g.__btcMemoryDb ?? buildSeed();
g.__btcMemoryDb = db;

export function resetMemoryStore(): void {
  const fresh = buildSeed();
  Object.assign(db, fresh);
}

// ---------------------------------------------------------------------------
// Store 実装
// ---------------------------------------------------------------------------

const clone = <T>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));

export const memoryStore: Store = {
  kind: "memory",

  // --- テナント -----------------------------------------------------------
  async getTenantBySlug(slug) {
    return clone(db.tenants.find((t) => t.slug === slug) ?? null);
  },
  async getTenantById(id) {
    return clone(db.tenants.find((t) => t.id === id) ?? null);
  },
  async getDefaultTenant() {
    return clone(db.tenants[0]);
  },
  async listTenants() {
    return clone(db.tenants);
  },
  async getTenantSettings(tenantId) {
    const s = db.settings.get(tenantId);
    if (!s) throw new Error(`テナント設定が見つかりません: ${tenantId}`);
    return clone(s);
  },
  async updateTenantSettings(tenantId, patch) {
    const s = db.settings.get(tenantId);
    if (!s) throw new Error(`テナント設定が見つかりません: ${tenantId}`);
    const next = { ...s, ...patch, tenantId };
    db.settings.set(tenantId, next);
    return clone(next);
  },

  // --- ユーザー -----------------------------------------------------------
  async getUserByEmail(tenantId, email) {
    const lower = email.toLowerCase();
    return clone(
      db.users.find(
        (u) => u.tenantId === tenantId && u.email.toLowerCase() === lower && !u.deletedAt,
      ) ?? null,
    );
  },
  async getUserById(tenantId, id) {
    return clone(db.users.find((u) => u.tenantId === tenantId && u.id === id) ?? null);
  },
  async getUserByIdAnyTenant(id) {
    return clone(db.users.find((u) => u.id === id) ?? null);
  },
  async listUsers(tenantId, filter) {
    let list = db.users.filter((u) => u.tenantId === tenantId && !u.deletedAt);
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      list = list.filter(
        (u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q),
      );
    }
    if (filter?.role) list = list.filter((u) => u.role === filter.role);
    if (filter?.status) list = list.filter((u) => u.status === filter.status);
    return clone(list);
  },
  async createUser(user, credentials) {
    db.users.push(user);
    db.credentials.set(user.id, credentials);
    db.accounts.push({
      id: `acct-${user.id}`,
      tenantId: user.tenantId,
      userId: user.id,
      createdAt: user.createdAt,
    });
    return clone(user);
  },
  async updateUser(tenantId, id, patch) {
    const i = db.users.findIndex((u) => u.tenantId === tenantId && u.id === id);
    if (i === -1) return null;
    db.users[i] = { ...db.users[i], ...patch, id, tenantId };
    return clone(db.users[i]);
  },

  async getCredentials(userId) {
    return clone(db.credentials.get(userId) ?? null);
  },
  async updateCredentials(userId, patch) {
    const c = db.credentials.get(userId);
    if (!c) return null;
    const next = { ...c, ...patch, userId };
    db.credentials.set(userId, next);
    return clone(next);
  },

  // --- セッション ---------------------------------------------------------
  async createSession(session) {
    db.sessions.set(session.id, session);
    return clone(session);
  },
  async getSessionByTokenHash(tokenHash) {
    for (const s of db.sessions.values()) {
      if (s.tokenHash === tokenHash) return clone(s);
    }
    return null;
  },
  async listSessionsByUser(userId) {
    return clone([...db.sessions.values()].filter((s) => s.userId === userId));
  },
  async updateSession(id, patch) {
    const s = db.sessions.get(id);
    if (!s) return null;
    const next = { ...s, ...patch, id };
    db.sessions.set(id, next);
    return clone(next);
  },
  async deleteSession(id) {
    db.sessions.delete(id);
  },
  async deleteSessionsByUser(userId) {
    for (const [id, s] of db.sessions) {
      if (s.userId === userId) db.sessions.delete(id);
    }
  },

  // --- プラン・契約 -------------------------------------------------------
  async listPlans(tenantId) {
    // ホワイトラベルテナントは既定テナントのプランを継承する（MVP の簡略化）
    const own = db.plans.filter((p) => p.tenantId === tenantId);
    const list = own.length > 0 ? own : db.plans.filter((p) => p.tenantId === DEFAULT_TENANT_ID);
    return clone(list.map((p) => ({ ...p, tenantId })));
  },
  async getPlan(tenantId, id) {
    const p = db.plans.find((x) => x.id === id);
    return p ? clone({ ...p, tenantId }) : null;
  },
  async upsertPlan(plan) {
    const i = db.plans.findIndex((p) => p.id === plan.id);
    if (i === -1) db.plans.push(plan);
    else db.plans[i] = plan;
    return clone(plan);
  },
  async listContracts(tenantId, userId) {
    return clone(
      db.contracts.filter(
        (c) => c.tenantId === tenantId && (userId ? c.userId === userId : true),
      ),
    );
  },
  async getContract(tenantId, id) {
    return clone(db.contracts.find((c) => c.tenantId === tenantId && c.id === id) ?? null);
  },
  async createContract(contract) {
    db.contracts.push(contract);
    return clone(contract);
  },
  async updateContract(tenantId, id, patch) {
    const i = db.contracts.findIndex((c) => c.tenantId === tenantId && c.id === id);
    if (i === -1) return null;
    db.contracts[i] = { ...db.contracts[i], ...patch, id, tenantId };
    return clone(db.contracts[i]);
  },
  async listAllocations(tenantId, contractId) {
    return clone(
      db.allocations.filter(
        (a) => a.tenantId === tenantId && (contractId ? a.contractId === contractId : true),
      ),
    );
  },
  async createAllocation(allocation) {
    db.allocations.push(allocation);
    return clone(allocation);
  },

  // --- プロバイダー・ワーカー ---------------------------------------------
  async listProviders(tenantId) {
    const own = db.providers.filter((p) => p.tenantId === tenantId);
    const list =
      own.length > 0 ? own : db.providers.filter((p) => p.tenantId === DEFAULT_TENANT_ID);
    return clone(list.map((p) => ({ ...p, tenantId })));
  },
  async getProvider(tenantId, id) {
    const p = db.providers.find((x) => x.id === id);
    return p ? clone({ ...p, tenantId }) : null;
  },
  async upsertProvider(provider) {
    const i = db.providers.findIndex((p) => p.id === provider.id);
    if (i === -1) db.providers.push(provider);
    else db.providers[i] = provider;
    return clone(provider);
  },
  async updateProvider(tenantId, id, patch) {
    const i = db.providers.findIndex((p) => p.id === id);
    if (i === -1) return null;
    db.providers[i] = { ...db.providers[i], ...patch, id };
    return clone(db.providers[i]);
  },

  async listWorkers(tenantId, filter) {
    const own = db.workers.filter((w) => w.tenantId === tenantId);
    const list =
      own.length > 0 ? own : db.workers.filter((w) => w.tenantId === DEFAULT_TENANT_ID);
    const scoped = filter?.providerId
      ? list.filter((w) => w.providerId === filter.providerId)
      : list;
    return clone(scoped.map((w) => ({ ...w, tenantId })));
  },
  async getWorker(tenantId, id) {
    const w = db.workers.find((x) => x.id === id);
    return w ? clone({ ...w, tenantId }) : null;
  },
  async upsertWorkers(tenantId, workers) {
    for (const w of workers) {
      const i = db.workers.findIndex(
        (x) => x.providerId === w.providerId && x.externalWorkerId === w.externalWorkerId,
      );
      if (i === -1) db.workers.push(w);
      else db.workers[i] = { ...db.workers[i], ...w };
    }
  },

  async saveSnapshots(tenantId, snapshots) {
    for (const s of snapshots) {
      const i = db.snapshots.findIndex(
        (x) => x.workerId === s.workerId && x.bucketAt === s.bucketAt,
      );
      if (i === -1) db.snapshots.push(s);
      else db.snapshots[i] = s;
    }
    // メモリ肥大を防ぐため直近 20000 件のみ保持する
    if (db.snapshots.length > 20000) {
      db.snapshots.sort((a, b) => b.bucketAt.localeCompare(a.bucketAt));
      db.snapshots.length = 20000;
    }
  },
  async listSnapshots(tenantId, filter) {
    let list = db.snapshots.filter((s) => s.tenantId === tenantId);
    if (filter.workerId) list = list.filter((s) => s.workerId === filter.workerId);
    if (filter.fromMs) {
      list = list.filter((s) => new Date(s.bucketAt).getTime() >= filter.fromMs!);
    }
    list = [...list].sort((a, b) => b.bucketAt.localeCompare(a.bucketAt));
    return clone(filter.limit ? list.slice(0, filter.limit) : list);
  },
  async latestSnapshotByWorker(tenantId) {
    const map = new Map<string, WorkerSnapshot>();
    for (const s of db.snapshots) {
      if (s.tenantId !== tenantId) continue;
      const cur = map.get(s.workerId);
      if (!cur || s.bucketAt > cur.bucketAt) map.set(s.workerId, s);
    }
    return map;
  },

  // --- ウォレット ---------------------------------------------------------
  async getWalletAccount(tenantId, userId) {
    let a = db.accounts.find((x) => x.tenantId === tenantId && x.userId === userId);
    if (!a) {
      a = { id: `acct-${userId}`, tenantId, userId, createdAt: new Date().toISOString() };
      db.accounts.push(a);
    }
    return clone(a);
  },
  async listLedgerEntries(tenantId, accountId) {
    return clone(
      db.ledger.filter((e) => e.tenantId === tenantId && e.accountId === accountId),
    );
  },
  async appendLedger(tenantId, entries) {
    // 冪等キーの重複チェック（1つでも重複したら全体を書かない = 部分適用を防ぐ）
    for (const e of entries) {
      if (!e.idempotencyKey) continue;
      const dup = db.ledger.some(
        (x) => x.tenantId === tenantId && x.idempotencyKey === e.idempotencyKey,
      );
      if (dup) return false;
    }
    db.ledger.push(...entries);
    return true;
  },

  async listAddresses(tenantId, userId) {
    return clone(
      db.addresses.filter((a) => a.tenantId === tenantId && a.userId === userId),
    );
  },
  async getAddress(tenantId, id) {
    return clone(db.addresses.find((a) => a.tenantId === tenantId && a.id === id) ?? null);
  },
  async createAddress(address) {
    db.addresses.push(address);
    return clone(address);
  },
  async deleteAddress(tenantId, id) {
    const i = db.addresses.findIndex((a) => a.tenantId === tenantId && a.id === id);
    if (i !== -1) db.addresses.splice(i, 1);
  },

  async listWithdrawals(tenantId, filter) {
    let list = db.withdrawals.filter((w) => w.tenantId === tenantId);
    if (filter?.userId) list = list.filter((w) => w.userId === filter.userId);
    if (filter?.status) list = list.filter((w) => w.status === filter.status);
    return clone([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },
  async getWithdrawal(tenantId, id) {
    return clone(db.withdrawals.find((w) => w.tenantId === tenantId && w.id === id) ?? null);
  },
  async getWithdrawalByIdempotencyKey(tenantId, key) {
    return clone(
      db.withdrawals.find((w) => w.tenantId === tenantId && w.idempotencyKey === key) ?? null,
    );
  },
  async createWithdrawal(withdrawal) {
    db.withdrawals.push(withdrawal);
    return clone(withdrawal);
  },
  async updateWithdrawal(tenantId, id, patch) {
    const i = db.withdrawals.findIndex((w) => w.tenantId === tenantId && w.id === id);
    if (i === -1) return null;
    db.withdrawals[i] = { ...db.withdrawals[i], ...patch, id, tenantId };
    return clone(db.withdrawals[i]);
  },

  async listEarnings(tenantId, userId, fromMs) {
    let list = db.earnings.filter((e) => e.tenantId === tenantId && e.userId === userId);
    if (fromMs) list = list.filter((e) => new Date(e.earnedAt).getTime() >= fromMs);
    return clone([...list].sort((a, b) => b.earnedAt.localeCompare(a.earnedAt)));
  },
  async createEarnings(tenantId, earnings) {
    db.earnings.push(...earnings);
  },

  // --- 通知・サポート・障害 -----------------------------------------------
  async listNotifications(tenantId, userId) {
    return clone(
      db.notifications
        .filter((n) => n.tenantId === tenantId && n.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
  async createNotification(notification) {
    db.notifications.push(notification);
    return clone(notification);
  },
  async markNotificationRead(tenantId, userId, id) {
    const n = db.notifications.find(
      (x) => x.tenantId === tenantId && x.userId === userId && x.id === id,
    );
    if (n && !n.readAt) n.readAt = new Date().toISOString();
  },
  async markAllNotificationsRead(tenantId, userId) {
    const at = new Date().toISOString();
    for (const n of db.notifications) {
      if (n.tenantId === tenantId && n.userId === userId && !n.readAt) n.readAt = at;
    }
  },

  async listTickets(tenantId, userId) {
    return clone(
      db.tickets.filter(
        (t) => t.tenantId === tenantId && (userId ? t.userId === userId : true),
      ),
    );
  },
  async getTicket(tenantId, id) {
    return clone(db.tickets.find((t) => t.tenantId === tenantId && t.id === id) ?? null);
  },
  async createTicket(ticket) {
    db.tickets.push(ticket);
    return clone(ticket);
  },
  async updateTicket(tenantId, id, patch) {
    const i = db.tickets.findIndex((t) => t.tenantId === tenantId && t.id === id);
    if (i === -1) return null;
    db.tickets[i] = { ...db.tickets[i], ...patch, id, tenantId };
    return clone(db.tickets[i]);
  },

  async listIncidents(tenantId) {
    const own = db.incidents.filter((i) => i.tenantId === tenantId);
    const list =
      own.length > 0 ? own : db.incidents.filter((i) => i.tenantId === DEFAULT_TENANT_ID);
    return clone(list.map((i) => ({ ...i, tenantId })));
  },
  async createIncident(incident) {
    db.incidents.push(incident);
    return clone(incident);
  },
  async updateIncident(tenantId, id, patch) {
    const i = db.incidents.findIndex((x) => x.id === id);
    if (i === -1) return null;
    db.incidents[i] = { ...db.incidents[i], ...patch, id };
    return clone(db.incidents[i]);
  },

  // --- 監査・AI -----------------------------------------------------------
  async appendAuditLog(log) {
    db.auditLogs.push(log);
    if (db.auditLogs.length > 5000) db.auditLogs.splice(0, db.auditLogs.length - 5000);
  },
  async listAuditLogs(tenantId, filter) {
    let list = db.auditLogs.filter((l) => l.tenantId === tenantId);
    if (filter?.actorUserId) list = list.filter((l) => l.actorUserId === filter.actorUserId);
    if (filter?.action) list = list.filter((l) => l.action.includes(filter.action!));
    list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return clone(list.slice(0, filter?.limit ?? 200));
  },

  async listInsights(tenantId) {
    return clone(db.insights.filter((i) => i.tenantId === tenantId));
  },
  async replaceInsights(tenantId, insights) {
    db.insights = db.insights.filter((i) => i.tenantId !== tenantId);
    db.insights.push(...insights);
  },

  // --- Pool Payout ---------------------------------------------------------
  async insertPayout(payout) {
    const dup = db.payouts.some(
      (p) =>
        p.providerId === payout.providerId &&
        p.externalPayoutId === payout.externalPayoutId,
    );
    if (dup) return false;
    db.payouts.push(payout);
    return true;
  },
  async listPayouts(tenantId, filter) {
    let list = db.payouts.filter((p) => p.tenantId === tenantId);
    if (filter?.allocationStatus) {
      list = list.filter((p) => p.allocationStatus === filter.allocationStatus);
    }
    list = [...list].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    return clone(filter?.limit ? list.slice(0, filter.limit) : list);
  },
  async getPayout(tenantId, id) {
    return clone(db.payouts.find((p) => p.tenantId === tenantId && p.id === id) ?? null);
  },
  async updatePayout(tenantId, id, patch) {
    const i = db.payouts.findIndex((p) => p.tenantId === tenantId && p.id === id);
    if (i === -1) return null;
    db.payouts[i] = { ...db.payouts[i], ...patch, id, tenantId };
    return clone(db.payouts[i]);
  },

  // --- 監視アラート ---------------------------------------------------------
  async insertAlert(alert) {
    // 同種・同対象の未確認アラートがあれば重複させない（アラート疲れの防止）
    const dup = db.alerts.some(
      (a) =>
        a.tenantId === alert.tenantId &&
        a.kind === alert.kind &&
        a.targetType === alert.targetType &&
        a.targetId === alert.targetId &&
        !a.acknowledgedAt,
    );
    if (dup) return false;
    db.alerts.push(alert);
    if (db.alerts.length > 2000) db.alerts.splice(0, db.alerts.length - 2000);
    return true;
  },
  async listAlerts(tenantId, filter) {
    let list = db.alerts.filter((a) => a.tenantId === tenantId);
    if (filter?.unacknowledgedOnly) list = list.filter((a) => !a.acknowledgedAt);
    list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return clone(filter?.limit ? list.slice(0, filter.limit) : list);
  },
  async acknowledgeAlert(tenantId, id, userId) {
    const a = db.alerts.find((x) => x.tenantId === tenantId && x.id === id);
    if (a && !a.acknowledgedAt) {
      a.acknowledgedAt = new Date().toISOString();
      a.acknowledgedBy = userId;
    }
  },

  // --- Raw スナップショット -------------------------------------------------
  async insertRawSnapshot(snapshot) {
    db.rawSnapshots.push(snapshot);
    // 直近 500 件のみ保持（デバッグ用途なので上限を設ける）
    if (db.rawSnapshots.length > 500) db.rawSnapshots.splice(0, db.rawSnapshots.length - 500);
  },
  async listRawSnapshots(tenantId, providerId, limit = 50) {
    return clone(
      db.rawSnapshots
        .filter((s) => s.tenantId === tenantId && (!providerId || s.providerId === providerId))
        .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
        .slice(0, limit),
    );
  },

  // --- 同期ロック（TTL 付き。二重同期・二重 payout の防止） -----------------
  async acquireLock(key, holder, ttlMs) {
    const now = Date.now();
    const existing = db.locks.get(key);
    // 有効なロックが他者に握られていれば取得失敗
    if (existing && new Date(existing.expiresAt).getTime() > now && existing.holder !== holder) {
      return false;
    }
    db.locks.set(key, {
      key,
      holder,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    });
    return true;
  },
  async releaseLock(key, holder) {
    const existing = db.locks.get(key);
    if (existing && existing.holder === holder) db.locks.delete(key);
  },
};

export { DEFAULT_TENANT_ID, ACME_TENANT_ID, newId };
