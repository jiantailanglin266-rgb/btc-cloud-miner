/**
 * PostgreSQL（Prisma）による Store 実装
 *
 * ★ Prisma クライアントを import してよいのはこのファイルだけ。★
 *   他の場所から import すると、DB 実装を差し替えられなくなる。
 *
 * 変換規約:
 *   - Decimal → string（BTC 金額は文字列のまま持ち回る。number にすると丸め誤差が出る）
 *   - BigInt  → number（shares・uptime は 2^53 を超えないため安全）
 *   - DateTime → ISO 文字列
 */

import { PrismaClient } from "@prisma/client";
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
  Session,
  SupportTicket,
  SupportMessage,
  Tenant,
  TenantSettings,
  User,
  UserCredentials,
  WalletAccount,
  WalletAddress,
  Withdrawal,
  WithdrawalApproval,
  Worker,
  WorkerSnapshot,
} from "@/types";
import { fromSat, toSat } from "@/lib/decimal";
import { config } from "@/lib/config";

// HMR で接続が増え続けないように globalThis に保持する
const g = globalThis as unknown as { __btcPrisma?: PrismaClient };

type DecimalLike = { toString(): string };

/** Decimal → BTC 文字列（常に小数点以下 8 桁に正規化する） */
function btc(value: DecimalLike | null | undefined): string {
  if (value === null || value === undefined) return "0.00000000";
  return fromSat(toSat(value.toString()));
}

/** Decimal → number（ハッシュレート・料率など、精度が問題にならない値） */
function num(value: DecimalLike | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value.toString());
}

function numOrNull(value: DecimalLike | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value.toString());
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function isoReq(d: Date): string {
  return d.toISOString();
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ---------------------------------------------------------------------------
// マッパー（DB 行 → ドメイン型）
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapTenant(r: any): Tenant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    createdAt: isoReq(r.createdAt),
  };
}

function mapSettings(r: any): TenantSettings {
  return {
    tenantId: r.tenantId,
    brandName: r.brandName,
    logoText: r.logoText,
    colorPrimary: r.colorPrimary,
    colorAccent: r.colorAccent,
    platformFeeRate: num(r.platformFeeRate),
    poolFeeRate: num(r.poolFeeRate),
    electricityPriceKwh: num(r.electricityPriceKwh),
    minWithdrawalBtc: btc(r.minWithdrawalBtc),
    withdrawalFeeBtc: btc(r.withdrawalFeeBtc),
    withdrawalTwoApproverThresholdBtc: btc(r.withdrawalTwoApproverThresholdBtc),
    addressCooldownHours: r.addressCooldownHours,
    defaultCurrency: r.defaultCurrency,
    featureFlags: jsonObject(r.featureFlags) as Record<string, boolean>,
  };
}

function mapUser(r: any): User {
  return {
    id: r.id,
    tenantId: r.tenantId,
    organizationId: r.organizationId,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    kycStatus: r.kycStatus,
    twoFactorEnabled: r.twoFactorEnabled,
    createdAt: isoReq(r.createdAt),
    lastLoginAt: iso(r.lastLoginAt),
    lastLoginIp: r.lastLoginIp,
    deletedAt: iso(r.deletedAt),
  };
}

function mapCredentials(r: any): UserCredentials {
  return {
    userId: r.userId,
    passwordHash: r.passwordHash,
    totpSecretEnc: r.totpSecretEnc,
    recoveryCodesEnc: r.recoveryCodesEnc,
    failedAttempts: r.failedAttempts,
    lockedUntil: iso(r.lockedUntil),
    passwordChangedAt: isoReq(r.passwordChangedAt),
  };
}

function mapSession(r: any): Session {
  return {
    id: r.id,
    userId: r.userId,
    tenantId: r.tenantId,
    tokenHash: r.tokenHash,
    twoFactorVerifiedAt: iso(r.twoFactorVerifiedAt),
    createdAt: isoReq(r.createdAt),
    expiresAt: isoReq(r.expiresAt),
    lastSeenAt: isoReq(r.lastSeenAt),
    ip: r.ip,
    userAgent: r.userAgent,
  };
}

function mapPlan(r: any): Plan {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    description: r.description,
    hashrateThs: num(r.hashrateThs),
    termDays: r.termDays,
    priceUsd: num(r.priceUsd),
    poolFeeRate: num(r.poolFeeRate),
    platformFeeRate: num(r.platformFeeRate),
    electricityPriceKwh: num(r.electricityPriceKwh),
    payoutScheme: r.payoutScheme,
    active: r.active,
  };
}

function mapContract(r: any): Contract {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    planId: r.planId,
    planName: r.planName,
    providerId: r.providerId ?? null,
    connectionModel: r.connectionModel ?? "PARTNER_FARM",
    hashrateThs: num(r.hashrateThs),
    status: r.status,
    startsAt: isoReq(r.startsAt),
    endsAt: isoReq(r.endsAt),
    autoRenew: r.autoRenew,
    upfrontCostUsd: num(r.upfrontCostUsd),
    poolFeeRate: num(r.poolFeeRate),
    platformFeeRate: num(r.platformFeeRate),
    revenueShareRate: num(r.revenueShareRate),
    hostingFeeRate: num(r.hostingFeeRate),
    electricityCostTreatment: r.electricityCostTreatment ?? "INCLUDED",
    createdAt: isoReq(r.createdAt),
  };
}

function mapPayout(r: any): PoolPayout {
  return {
    id: r.id,
    tenantId: r.tenantId,
    providerId: r.providerId,
    externalPayoutId: r.externalPayoutId,
    amountBtc: btc(r.amountBtc),
    paidAt: isoReq(r.paidAt),
    txId: r.txId,
    source: r.source,
    fetchedAt: isoReq(r.fetchedAt),
    allocationStatus: r.allocationStatus,
    allocatedAt: iso(r.allocatedAt),
  };
}

function mapAlert(r: any): Alert {
  return {
    id: r.id,
    tenantId: r.tenantId,
    kind: r.kind,
    severity: r.severity,
    message: r.message,
    evidence: jsonObject(r.evidence) as Record<string, number | string>,
    targetType: r.targetType,
    targetId: r.targetId,
    createdAt: isoReq(r.createdAt),
    acknowledgedAt: iso(r.acknowledgedAt),
    acknowledgedBy: r.acknowledgedBy,
  };
}

function mapAllocation(r: any): HashrateAllocation {
  return {
    id: r.id,
    tenantId: r.tenantId,
    contractId: r.contractId,
    providerId: r.providerId,
    workerId: r.workerId,
    hashrateThs: num(r.hashrateThs),
    createdAt: isoReq(r.createdAt),
  };
}

function mapProvider(r: any): MiningProvider {
  return {
    id: r.id,
    tenantId: r.tenantId,
    kind: r.kind,
    name: r.name,
    region: r.region,
    endpoint: r.endpoint,
    credentialsRef: r.credentialsRef,
    status: r.status,
    lastOkAt: iso(r.lastOkAt),
    lastError: r.lastError,
    consecutiveFailures: r.consecutiveFailures,
    priority: r.priority,
    enabled: r.enabled,
    poolName: r.poolName,
    payoutScheme: r.payoutScheme,
  };
}

function mapWorker(r: any): Worker {
  return {
    id: r.id,
    tenantId: r.tenantId,
    providerId: r.providerId,
    externalWorkerId: r.externalWorkerId,
    minerId: r.minerId,
    model: r.model,
    ratedHashrateThs: num(r.ratedHashrateThs),
    ratedEfficiencyJPerTh: num(r.ratedEfficiencyJPerTh),
    status: r.status,
    lastSeenAt: iso(r.lastSeenAt),
  };
}

function mapSnapshot(r: any): WorkerSnapshot {
  return {
    workerId: r.workerId,
    tenantId: r.tenantId,
    bucketAt: isoReq(r.bucketAt),
    hashrateThs: num(r.hashrateThs),
    acceptedShares: Number(r.acceptedShares),
    rejectedShares: Number(r.rejectedShares),
    temperatureC: numOrNull(r.temperatureC),
    powerW: numOrNull(r.powerW),
    uptimeSec: Number(r.uptimeSec),
    poolStatus: r.poolStatus,
    workerStatus: r.workerStatus,
    estimatedEarningsBtc: r.estimatedEarningsBtc ? btc(r.estimatedEarningsBtc) : null,
  };
}

function mapLedger(r: any): LedgerEntry {
  return {
    id: r.id,
    tenantId: r.tenantId,
    accountId: r.accountId,
    entryType: r.entryType,
    bucket: r.bucket,
    amountBtc: btc(r.amountBtc),
    refType: r.refType,
    refId: r.refId,
    idempotencyKey: r.idempotencyKey,
    memo: r.memo,
    createdAt: isoReq(r.createdAt),
  };
}

function mapAddress(r: any): WalletAddress {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    address: r.address,
    label: r.label,
    createdAt: isoReq(r.createdAt),
    usableAt: isoReq(r.usableAt),
  };
}

function mapWithdrawal(r: any): Withdrawal {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    userEmail: r.userEmail,
    addressId: r.addressId,
    address: r.address,
    amountBtc: btc(r.amountBtc),
    feeBtc: btc(r.feeBtc),
    netBtc: btc(r.netBtc),
    status: r.status,
    riskScore: r.riskScore,
    riskReasons: jsonArray<string>(r.riskReasons),
    requiredApprovals: r.requiredApprovals,
    approvals: jsonArray<WithdrawalApproval>(r.approvals),
    requestedIp: r.requestedIp,
    txId: r.txId,
    confirmations: r.confirmations,
    idempotencyKey: r.idempotencyKey,
    createdAt: isoReq(r.createdAt),
    updatedAt: isoReq(r.updatedAt),
  };
}

function mapEarning(r: any): Earning {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    contractId: r.contractId,
    earnedAt: isoReq(r.earnedAt),
    grossBtc: btc(r.grossBtc),
    poolFeeBtc: btc(r.poolFeeBtc),
    platformFeeBtc: btc(r.platformFeeBtc),
    electricityFeeBtc: btc(r.electricityFeeBtc),
    netBtc: btc(r.netBtc),
    hashrateThs: num(r.hashrateThs),
    uptimeRate: num(r.uptimeRate),
    kind: r.kind ?? "ESTIMATED",
    payoutId: r.payoutId ?? null,
  };
}

function mapNotification(r: any): Notification {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    level: r.level,
    title: r.title,
    body: r.body,
    href: r.href,
    readAt: iso(r.readAt),
    createdAt: isoReq(r.createdAt),
  };
}

function mapTicket(r: any): SupportTicket {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    userEmail: r.userEmail,
    subject: r.subject,
    category: r.category,
    status: r.status,
    messages: jsonArray<SupportMessage>(r.messages),
    createdAt: isoReq(r.createdAt),
    updatedAt: isoReq(r.updatedAt),
  };
}

function mapIncident(r: any): Incident {
  return {
    id: r.id,
    tenantId: r.tenantId,
    title: r.title,
    severity: r.severity,
    status: r.status,
    body: r.body,
    affectedComponents: jsonArray<string>(r.affectedComponents),
    startedAt: isoReq(r.startedAt),
    resolvedAt: iso(r.resolvedAt),
  };
}

function mapAudit(r: any): AuditLog {
  return {
    id: r.id,
    tenantId: r.tenantId,
    actorUserId: r.actorUserId,
    actorEmail: r.actorEmail,
    actorRole: r.actorRole,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    detail: jsonObject(r.detail),
    ip: r.ip,
    userAgent: r.userAgent,
    result: r.result,
    createdAt: isoReq(r.createdAt),
  };
}

function mapInsight(r: any): AiInsight {
  return {
    id: r.id,
    tenantId: r.tenantId,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    recommendation: r.recommendation,
    targetType: r.targetType,
    targetId: r.targetId,
    evidence: jsonObject(r.evidence) as Record<string, number | string>,
    createdAt: isoReq(r.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Store 実装
// ---------------------------------------------------------------------------

export async function createPrismaStore(): Promise<Store> {
  const prisma = g.__btcPrisma ?? new PrismaClient();
  g.__btcPrisma = prisma;

  // 起動時に必ず疎通確認する（失敗すれば index.ts がメモリへフォールバックする）
  await prisma.$queryRaw`SELECT 1`;

  const store: Store = {
    kind: "prisma",

    // --- テナント ---------------------------------------------------------
    async getTenantBySlug(slug) {
      const r = await prisma.tenant.findUnique({ where: { slug } });
      return r ? mapTenant(r) : null;
    },
    async getTenantById(id) {
      const r = await prisma.tenant.findUnique({ where: { id } });
      return r ? mapTenant(r) : null;
    },
    async getDefaultTenant() {
      const r = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
      if (!r) {
        throw new Error(
          "テナントが 1 件も存在しません。`npm run prisma:seed` で初期データを投入してください。",
        );
      }
      return mapTenant(r);
    },
    async listTenants() {
      return (await prisma.tenant.findMany({ orderBy: { createdAt: "asc" } })).map(mapTenant);
    },
    async getTenantSettings(tenantId) {
      const r = await prisma.tenantSettings.findUnique({ where: { tenantId } });
      if (!r) throw new Error(`テナント設定が見つかりません: ${tenantId}`);
      return mapSettings(r);
    },
    async updateTenantSettings(tenantId, patch) {
      const r = await prisma.tenantSettings.update({
        where: { tenantId },
        data: {
          ...(patch.brandName !== undefined && { brandName: patch.brandName }),
          ...(patch.logoText !== undefined && { logoText: patch.logoText }),
          ...(patch.colorPrimary !== undefined && { colorPrimary: patch.colorPrimary }),
          ...(patch.colorAccent !== undefined && { colorAccent: patch.colorAccent }),
          ...(patch.platformFeeRate !== undefined && { platformFeeRate: patch.platformFeeRate }),
          ...(patch.poolFeeRate !== undefined && { poolFeeRate: patch.poolFeeRate }),
          ...(patch.electricityPriceKwh !== undefined && {
            electricityPriceKwh: patch.electricityPriceKwh,
          }),
          ...(patch.minWithdrawalBtc !== undefined && {
            minWithdrawalBtc: patch.minWithdrawalBtc,
          }),
          ...(patch.withdrawalFeeBtc !== undefined && {
            withdrawalFeeBtc: patch.withdrawalFeeBtc,
          }),
          ...(patch.featureFlags !== undefined && { featureFlags: patch.featureFlags }),
        },
      });
      return mapSettings(r);
    },

    // --- ユーザー ---------------------------------------------------------
    async getUserByEmail(tenantId, email) {
      const r = await prisma.user.findUnique({
        where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
      });
      return r && !r.deletedAt ? mapUser(r) : null;
    },
    async getUserById(tenantId, id) {
      const r = await prisma.user.findFirst({ where: { id, tenantId } });
      return r ? mapUser(r) : null;
    },
    async getUserByIdAnyTenant(id) {
      const r = await prisma.user.findUnique({ where: { id } });
      return r ? mapUser(r) : null;
    },
    async listUsers(tenantId, filter) {
      const rows = await prisma.user.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(filter?.role ? { role: filter.role } : {}),
          ...(filter?.status ? { status: filter.status } : {}),
          ...(filter?.q
            ? {
                OR: [
                  { email: { contains: filter.q, mode: "insensitive" as const } },
                  { name: { contains: filter.q, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows.map(mapUser);
    },
    async createUser(user, credentials) {
      // ユーザー・認証情報・ウォレット口座は必ず同時に作る（片方だけ存在する状態を作らない）
      await prisma.$transaction([
        prisma.user.create({
          data: {
            id: user.id,
            tenantId: user.tenantId,
            organizationId: user.organizationId,
            email: user.email.toLowerCase(),
            name: user.name,
            role: user.role,
            status: user.status,
            kycStatus: user.kycStatus,
            twoFactorEnabled: user.twoFactorEnabled,
            createdAt: new Date(user.createdAt),
          },
        }),
        prisma.userCredential.create({
          data: {
            userId: credentials.userId,
            passwordHash: credentials.passwordHash,
            totpSecretEnc: credentials.totpSecretEnc,
            recoveryCodesEnc: credentials.recoveryCodesEnc,
            failedAttempts: credentials.failedAttempts,
            passwordChangedAt: new Date(credentials.passwordChangedAt),
          },
        }),
        prisma.walletAccount.create({
          data: { id: `acct-${user.id}`, tenantId: user.tenantId, userId: user.id },
        }),
      ]);
      return user;
    },
    async updateUser(tenantId, id, patch) {
      const existing = await prisma.user.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const r = await prisma.user.update({
        where: { id },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.role !== undefined && { role: patch.role }),
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.kycStatus !== undefined && { kycStatus: patch.kycStatus }),
          ...(patch.twoFactorEnabled !== undefined && {
            twoFactorEnabled: patch.twoFactorEnabled,
          }),
          ...(patch.lastLoginAt !== undefined && {
            lastLoginAt: patch.lastLoginAt ? new Date(patch.lastLoginAt) : null,
          }),
          ...(patch.lastLoginIp !== undefined && { lastLoginIp: patch.lastLoginIp }),
          ...(patch.deletedAt !== undefined && {
            deletedAt: patch.deletedAt ? new Date(patch.deletedAt) : null,
          }),
        },
      });
      return mapUser(r);
    },

    async getCredentials(userId) {
      const r = await prisma.userCredential.findUnique({ where: { userId } });
      return r ? mapCredentials(r) : null;
    },
    async updateCredentials(userId, patch) {
      const r = await prisma.userCredential.update({
        where: { userId },
        data: {
          ...(patch.passwordHash !== undefined && { passwordHash: patch.passwordHash }),
          ...(patch.totpSecretEnc !== undefined && { totpSecretEnc: patch.totpSecretEnc }),
          ...(patch.recoveryCodesEnc !== undefined && {
            recoveryCodesEnc: patch.recoveryCodesEnc,
          }),
          ...(patch.failedAttempts !== undefined && { failedAttempts: patch.failedAttempts }),
          ...(patch.lockedUntil !== undefined && {
            lockedUntil: patch.lockedUntil ? new Date(patch.lockedUntil) : null,
          }),
          ...(patch.passwordChangedAt !== undefined && {
            passwordChangedAt: new Date(patch.passwordChangedAt),
          }),
        },
      });
      return mapCredentials(r);
    },

    // --- セッション -------------------------------------------------------
    async createSession(session) {
      await prisma.session.create({
        data: {
          id: session.id,
          userId: session.userId,
          tenantId: session.tenantId,
          tokenHash: session.tokenHash,
          twoFactorVerifiedAt: session.twoFactorVerifiedAt
            ? new Date(session.twoFactorVerifiedAt)
            : null,
          createdAt: new Date(session.createdAt),
          expiresAt: new Date(session.expiresAt),
          lastSeenAt: new Date(session.lastSeenAt),
          ip: session.ip,
          userAgent: session.userAgent,
        },
      });
      return session;
    },
    async getSessionByTokenHash(tokenHash) {
      const r = await prisma.session.findUnique({ where: { tokenHash } });
      return r ? mapSession(r) : null;
    },
    async listSessionsByUser(userId) {
      return (await prisma.session.findMany({ where: { userId } })).map(mapSession);
    },
    async updateSession(id, patch) {
      const r = await prisma.session.update({
        where: { id },
        data: {
          ...(patch.lastSeenAt !== undefined && { lastSeenAt: new Date(patch.lastSeenAt) }),
          ...(patch.twoFactorVerifiedAt !== undefined && {
            twoFactorVerifiedAt: patch.twoFactorVerifiedAt
              ? new Date(patch.twoFactorVerifiedAt)
              : null,
          }),
        },
      });
      return mapSession(r);
    },
    async deleteSession(id) {
      await prisma.session.deleteMany({ where: { id } });
    },
    async deleteSessionsByUser(userId) {
      await prisma.session.deleteMany({ where: { userId } });
    },

    // --- プラン・契約 -----------------------------------------------------
    async listPlans(tenantId) {
      return (
        await prisma.plan.findMany({ where: { tenantId }, orderBy: { hashrateThs: "asc" } })
      ).map(mapPlan);
    },
    async getPlan(tenantId, id) {
      const r = await prisma.plan.findFirst({ where: { id, tenantId } });
      return r ? mapPlan(r) : null;
    },
    async upsertPlan(plan) {
      const data = {
        tenantId: plan.tenantId,
        name: plan.name,
        description: plan.description,
        hashrateThs: plan.hashrateThs,
        termDays: plan.termDays,
        priceUsd: plan.priceUsd,
        poolFeeRate: plan.poolFeeRate,
        platformFeeRate: plan.platformFeeRate,
        electricityPriceKwh: plan.electricityPriceKwh,
        payoutScheme: plan.payoutScheme,
        active: plan.active,
      };
      await prisma.plan.upsert({
        where: { id: plan.id },
        create: { id: plan.id, ...data },
        update: data,
      });
      return plan;
    },
    async listContracts(tenantId, userId) {
      return (
        await prisma.contract.findMany({
          where: { tenantId, ...(userId ? { userId } : {}) },
          orderBy: { createdAt: "desc" },
        })
      ).map(mapContract);
    },
    async getContract(tenantId, id) {
      const r = await prisma.contract.findFirst({ where: { id, tenantId } });
      return r ? mapContract(r) : null;
    },
    async createContract(contract) {
      await prisma.contract.create({
        data: {
          id: contract.id,
          tenantId: contract.tenantId,
          userId: contract.userId,
          planId: contract.planId,
          planName: contract.planName,
          providerId: contract.providerId,
          connectionModel: contract.connectionModel,
          hashrateThs: contract.hashrateThs,
          status: contract.status,
          startsAt: new Date(contract.startsAt),
          endsAt: new Date(contract.endsAt),
          autoRenew: contract.autoRenew,
          upfrontCostUsd: contract.upfrontCostUsd,
          poolFeeRate: contract.poolFeeRate,
          platformFeeRate: contract.platformFeeRate,
          revenueShareRate: contract.revenueShareRate,
          hostingFeeRate: contract.hostingFeeRate,
          electricityCostTreatment: contract.electricityCostTreatment,
          createdAt: new Date(contract.createdAt),
        },
      });
      return contract;
    },
    async updateContract(tenantId, id, patch) {
      const existing = await prisma.contract.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const r = await prisma.contract.update({
        where: { id },
        data: {
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.autoRenew !== undefined && { autoRenew: patch.autoRenew }),
          ...(patch.hashrateThs !== undefined && { hashrateThs: patch.hashrateThs }),
        },
      });
      return mapContract(r);
    },
    async listAllocations(tenantId, contractId) {
      return (
        await prisma.hashrateAllocation.findMany({
          where: { tenantId, ...(contractId ? { contractId } : {}) },
        })
      ).map(mapAllocation);
    },
    async createAllocation(allocation) {
      await prisma.hashrateAllocation.create({
        data: {
          id: allocation.id,
          tenantId: allocation.tenantId,
          contractId: allocation.contractId,
          providerId: allocation.providerId,
          workerId: allocation.workerId,
          hashrateThs: allocation.hashrateThs,
          createdAt: new Date(allocation.createdAt),
        },
      });
      return allocation;
    },

    // --- プロバイダー・ワーカー -------------------------------------------
    async listProviders(tenantId) {
      return (
        await prisma.miningProvider.findMany({
          where: { tenantId },
          orderBy: { priority: "asc" },
        })
      ).map(mapProvider);
    },
    async getProvider(tenantId, id) {
      const r = await prisma.miningProvider.findFirst({ where: { id, tenantId } });
      return r ? mapProvider(r) : null;
    },
    async upsertProvider(provider) {
      const data = {
        tenantId: provider.tenantId,
        kind: provider.kind,
        name: provider.name,
        region: provider.region,
        endpoint: provider.endpoint,
        credentialsRef: provider.credentialsRef,
        status: provider.status,
        lastOkAt: provider.lastOkAt ? new Date(provider.lastOkAt) : null,
        lastError: provider.lastError,
        consecutiveFailures: provider.consecutiveFailures,
        priority: provider.priority,
        enabled: provider.enabled,
        poolName: provider.poolName,
        payoutScheme: provider.payoutScheme,
      };
      await prisma.miningProvider.upsert({
        where: { id: provider.id },
        create: { id: provider.id, ...data },
        update: data,
      });
      return provider;
    },
    async updateProvider(tenantId, id, patch) {
      const existing = await prisma.miningProvider.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const r = await prisma.miningProvider.update({
        where: { id },
        data: {
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.enabled !== undefined && { enabled: patch.enabled }),
          ...(patch.priority !== undefined && { priority: patch.priority }),
          ...(patch.lastOkAt !== undefined && {
            lastOkAt: patch.lastOkAt ? new Date(patch.lastOkAt) : null,
          }),
          ...(patch.lastError !== undefined && { lastError: patch.lastError }),
          ...(patch.consecutiveFailures !== undefined && {
            consecutiveFailures: patch.consecutiveFailures,
          }),
        },
      });
      return mapProvider(r);
    },

    async listWorkers(tenantId, filter) {
      return (
        await prisma.worker.findMany({
          where: { tenantId, ...(filter?.providerId ? { providerId: filter.providerId } : {}) },
          orderBy: { externalWorkerId: "asc" },
        })
      ).map(mapWorker);
    },
    async getWorker(tenantId, id) {
      const r = await prisma.worker.findFirst({ where: { id, tenantId } });
      return r ? mapWorker(r) : null;
    },
    async upsertWorkers(tenantId, workers) {
      // 件数が多いので順次 upsert する（Prisma は複合キーの createMany upsert を持たない）
      for (const w of workers) {
        const data = {
          tenantId,
          providerId: w.providerId,
          externalWorkerId: w.externalWorkerId,
          minerId: w.minerId,
          model: w.model,
          ratedHashrateThs: w.ratedHashrateThs,
          ratedEfficiencyJPerTh: w.ratedEfficiencyJPerTh,
          status: w.status,
          lastSeenAt: w.lastSeenAt ? new Date(w.lastSeenAt) : null,
        };
        await prisma.worker.upsert({
          where: {
            providerId_externalWorkerId: {
              providerId: w.providerId,
              externalWorkerId: w.externalWorkerId,
            },
          },
          create: { id: w.id, ...data },
          update: data,
        });
      }
    },

    async saveSnapshots(tenantId, snapshots) {
      // 同じ bucket の重複取り込みは skipDuplicates で無視する（冪等）
      await prisma.workerSnapshot.createMany({
        data: snapshots.map((s) => ({
          workerId: s.workerId,
          tenantId,
          bucketAt: new Date(s.bucketAt),
          hashrateThs: s.hashrateThs,
          acceptedShares: BigInt(Math.floor(s.acceptedShares)),
          rejectedShares: BigInt(Math.floor(s.rejectedShares)),
          temperatureC: s.temperatureC,
          powerW: s.powerW,
          uptimeSec: BigInt(Math.floor(s.uptimeSec)),
          poolStatus: s.poolStatus,
          workerStatus: s.workerStatus,
          estimatedEarningsBtc: s.estimatedEarningsBtc,
        })),
        skipDuplicates: true,
      });
    },
    async listSnapshots(tenantId, filter) {
      return (
        await prisma.workerSnapshot.findMany({
          where: {
            tenantId,
            ...(filter.workerId ? { workerId: filter.workerId } : {}),
            ...(filter.fromMs ? { bucketAt: { gte: new Date(filter.fromMs) } } : {}),
          },
          orderBy: { bucketAt: "desc" },
          take: filter.limit ?? 5000,
        })
      ).map(mapSnapshot);
    },
    async latestSnapshotByWorker(tenantId) {
      // 直近 1 時間から各ワーカーの最新 1 件を拾う
      const rows = await prisma.workerSnapshot.findMany({
        where: { tenantId, bucketAt: { gte: new Date(Date.now() - 3600_000) } },
        orderBy: { bucketAt: "desc" },
        take: 20000,
      });
      const map = new Map<string, WorkerSnapshot>();
      for (const r of rows) {
        if (!map.has(r.workerId)) map.set(r.workerId, mapSnapshot(r));
      }
      return map;
    },

    // --- ウォレット -------------------------------------------------------
    async getWalletAccount(tenantId, userId) {
      const existing = await prisma.walletAccount.findUnique({ where: { userId } });
      if (existing) return { ...mapAccount(existing) };
      const created = await prisma.walletAccount.create({
        data: { id: `acct-${userId}`, tenantId, userId },
      });
      return mapAccount(created);
    },
    async listLedgerEntries(tenantId, accountId) {
      return (
        await prisma.ledgerEntry.findMany({
          where: { tenantId, accountId },
          orderBy: { createdAt: "asc" },
        })
      ).map(mapLedger);
    },
    async appendLedger(tenantId, entries) {
      try {
        // ★ 単一トランザクションで書く。片方だけ入る状態を作らない
        await prisma.$transaction(
          entries.map((e) =>
            prisma.ledgerEntry.create({
              data: {
                id: e.id,
                tenantId,
                accountId: e.accountId,
                entryType: e.entryType,
                bucket: e.bucket,
                amountBtc: e.amountBtc,
                refType: e.refType,
                refId: e.refId,
                idempotencyKey: e.idempotencyKey,
                memo: e.memo,
                createdAt: new Date(e.createdAt),
              },
            }),
          ),
        );
        return true;
      } catch (err) {
        // UNIQUE(tenantId, idempotencyKey) 違反 = 既に処理済み
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },

    async listAddresses(tenantId, userId) {
      return (
        await prisma.walletAddress.findMany({
          where: { tenantId, userId },
          orderBy: { createdAt: "desc" },
        })
      ).map(mapAddress);
    },
    async getAddress(tenantId, id) {
      const r = await prisma.walletAddress.findFirst({ where: { id, tenantId } });
      return r ? mapAddress(r) : null;
    },
    async createAddress(address) {
      await prisma.walletAddress.create({
        data: {
          id: address.id,
          tenantId: address.tenantId,
          userId: address.userId,
          address: address.address,
          label: address.label,
          createdAt: new Date(address.createdAt),
          usableAt: new Date(address.usableAt),
        },
      });
      return address;
    },
    async deleteAddress(tenantId, id) {
      await prisma.walletAddress.deleteMany({ where: { id, tenantId } });
    },

    async listWithdrawals(tenantId, filter) {
      return (
        await prisma.withdrawal.findMany({
          where: {
            tenantId,
            ...(filter?.userId ? { userId: filter.userId } : {}),
            ...(filter?.status ? { status: filter.status } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 500,
        })
      ).map(mapWithdrawal);
    },
    async getWithdrawal(tenantId, id) {
      const r = await prisma.withdrawal.findFirst({ where: { id, tenantId } });
      return r ? mapWithdrawal(r) : null;
    },
    async getWithdrawalByIdempotencyKey(tenantId, key) {
      const r = await prisma.withdrawal.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
      });
      return r ? mapWithdrawal(r) : null;
    },
    async createWithdrawal(w) {
      await prisma.withdrawal.create({
        data: {
          id: w.id,
          tenantId: w.tenantId,
          userId: w.userId,
          userEmail: w.userEmail,
          addressId: w.addressId,
          address: w.address,
          amountBtc: w.amountBtc,
          feeBtc: w.feeBtc,
          netBtc: w.netBtc,
          status: w.status,
          riskScore: w.riskScore,
          riskReasons: w.riskReasons,
          requiredApprovals: w.requiredApprovals,
          approvals: w.approvals as unknown as object,
          requestedIp: w.requestedIp,
          txId: w.txId,
          confirmations: w.confirmations,
          idempotencyKey: w.idempotencyKey,
          createdAt: new Date(w.createdAt),
        },
      });
      return w;
    },
    async updateWithdrawal(tenantId, id, patch) {
      const existing = await prisma.withdrawal.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const r = await prisma.withdrawal.update({
        where: { id },
        data: {
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.txId !== undefined && { txId: patch.txId }),
          ...(patch.confirmations !== undefined && { confirmations: patch.confirmations }),
          ...(patch.approvals !== undefined && {
            approvals: patch.approvals as unknown as object,
          }),
        },
      });
      return mapWithdrawal(r);
    },

    async listEarnings(tenantId, userId, fromMs) {
      return (
        await prisma.earning.findMany({
          where: {
            tenantId,
            userId,
            ...(fromMs ? { earnedAt: { gte: new Date(fromMs) } } : {}),
          },
          orderBy: { earnedAt: "desc" },
          take: 1000,
        })
      ).map(mapEarning);
    },
    async createEarnings(tenantId, earnings) {
      await prisma.earning.createMany({
        data: earnings.map((e) => ({
          id: e.id,
          tenantId,
          userId: e.userId,
          contractId: e.contractId,
          earnedAt: new Date(e.earnedAt),
          grossBtc: e.grossBtc,
          poolFeeBtc: e.poolFeeBtc,
          platformFeeBtc: e.platformFeeBtc,
          electricityFeeBtc: e.electricityFeeBtc,
          netBtc: e.netBtc,
          hashrateThs: e.hashrateThs,
          uptimeRate: e.uptimeRate,
          kind: e.kind,
          payoutId: e.payoutId,
        })),
        skipDuplicates: true,
      });
    },

    // --- Pool Payout -------------------------------------------------------
    async insertPayout(payout) {
      try {
        await prisma.poolPayout.create({
          data: {
            id: payout.id,
            tenantId: payout.tenantId,
            providerId: payout.providerId,
            externalPayoutId: payout.externalPayoutId,
            amountBtc: payout.amountBtc,
            paidAt: new Date(payout.paidAt),
            txId: payout.txId,
            source: payout.source,
            fetchedAt: new Date(payout.fetchedAt),
            allocationStatus: payout.allocationStatus,
            allocatedAt: payout.allocatedAt ? new Date(payout.allocatedAt) : null,
          },
        });
        return true;
      } catch (err) {
        if (isUniqueViolation(err)) return false; // 既に取り込み済み（冪等）
        throw err;
      }
    },
    async listPayouts(tenantId, filter) {
      return (
        await prisma.poolPayout.findMany({
          where: {
            tenantId,
            ...(filter?.allocationStatus
              ? { allocationStatus: filter.allocationStatus }
              : {}),
          },
          orderBy: { paidAt: "desc" },
          take: filter?.limit ?? 200,
        })
      ).map(mapPayout);
    },
    async getPayout(tenantId, id) {
      const r = await prisma.poolPayout.findFirst({ where: { id, tenantId } });
      return r ? mapPayout(r) : null;
    },
    async updatePayout(tenantId, id, patch) {
      const existing = await prisma.poolPayout.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const r = await prisma.poolPayout.update({
        where: { id },
        data: {
          ...(patch.allocationStatus !== undefined && {
            allocationStatus: patch.allocationStatus,
          }),
          ...(patch.allocatedAt !== undefined && {
            allocatedAt: patch.allocatedAt ? new Date(patch.allocatedAt) : null,
          }),
        },
      });
      return mapPayout(r);
    },

    // --- 監視アラート -------------------------------------------------------
    async insertAlert(alert) {
      const dup = await prisma.alert.findFirst({
        where: {
          tenantId: alert.tenantId,
          kind: alert.kind,
          targetType: alert.targetType,
          targetId: alert.targetId,
          acknowledgedAt: null,
        },
      });
      if (dup) return false;
      await prisma.alert.create({
        data: {
          id: alert.id,
          tenantId: alert.tenantId,
          kind: alert.kind,
          severity: alert.severity,
          message: alert.message,
          evidence: alert.evidence as unknown as object,
          targetType: alert.targetType,
          targetId: alert.targetId,
          createdAt: new Date(alert.createdAt),
        },
      });
      return true;
    },
    async listAlerts(tenantId, filter) {
      return (
        await prisma.alert.findMany({
          where: {
            tenantId,
            ...(filter?.unacknowledgedOnly ? { acknowledgedAt: null } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: filter?.limit ?? 200,
        })
      ).map(mapAlert);
    },
    async acknowledgeAlert(tenantId, id, userId) {
      await prisma.alert.updateMany({
        where: { id, tenantId, acknowledgedAt: null },
        data: { acknowledgedAt: new Date(), acknowledgedBy: userId },
      });
    },

    // --- 通知・サポート・障害 ---------------------------------------------
    async listNotifications(tenantId, userId) {
      return (
        await prisma.notification.findMany({
          where: { tenantId, userId },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      ).map(mapNotification);
    },
    async createNotification(n) {
      await prisma.notification.create({
        data: {
          id: n.id,
          tenantId: n.tenantId,
          userId: n.userId,
          level: n.level,
          title: n.title,
          body: n.body,
          href: n.href,
          readAt: n.readAt ? new Date(n.readAt) : null,
          createdAt: new Date(n.createdAt),
        },
      });
      return n;
    },
    async markNotificationRead(tenantId, userId, id) {
      await prisma.notification.updateMany({
        where: { id, tenantId, userId, readAt: null },
        data: { readAt: new Date() },
      });
    },
    async markAllNotificationsRead(tenantId, userId) {
      await prisma.notification.updateMany({
        where: { tenantId, userId, readAt: null },
        data: { readAt: new Date() },
      });
    },

    async listTickets(tenantId, userId) {
      return (
        await prisma.supportTicket.findMany({
          where: { tenantId, ...(userId ? { userId } : {}) },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })
      ).map(mapTicket);
    },
    async getTicket(tenantId, id) {
      const r = await prisma.supportTicket.findFirst({ where: { id, tenantId } });
      return r ? mapTicket(r) : null;
    },
    async createTicket(t) {
      await prisma.supportTicket.create({
        data: {
          id: t.id,
          tenantId: t.tenantId,
          userId: t.userId,
          userEmail: t.userEmail,
          subject: t.subject,
          category: t.category,
          status: t.status,
          messages: t.messages as unknown as object,
          createdAt: new Date(t.createdAt),
        },
      });
      return t;
    },
    async updateTicket(tenantId, id, patch) {
      const existing = await prisma.supportTicket.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const r = await prisma.supportTicket.update({
        where: { id },
        data: {
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.messages !== undefined && {
            messages: patch.messages as unknown as object,
          }),
        },
      });
      return mapTicket(r);
    },

    async listIncidents(tenantId) {
      return (
        await prisma.incident.findMany({
          where: { tenantId },
          orderBy: { startedAt: "desc" },
          take: 100,
        })
      ).map(mapIncident);
    },
    async createIncident(i) {
      await prisma.incident.create({
        data: {
          id: i.id,
          tenantId: i.tenantId,
          title: i.title,
          severity: i.severity,
          status: i.status,
          body: i.body,
          affectedComponents: i.affectedComponents,
          startedAt: new Date(i.startedAt),
          resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : null,
        },
      });
      return i;
    },
    async updateIncident(tenantId, id, patch) {
      const existing = await prisma.incident.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const r = await prisma.incident.update({
        where: { id },
        data: {
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.body !== undefined && { body: patch.body }),
          ...(patch.resolvedAt !== undefined && {
            resolvedAt: patch.resolvedAt ? new Date(patch.resolvedAt) : null,
          }),
        },
      });
      return mapIncident(r);
    },

    // --- 監査・AI ---------------------------------------------------------
    async appendAuditLog(log) {
      await prisma.auditLog.create({
        data: {
          id: log.id,
          tenantId: log.tenantId,
          actorUserId: log.actorUserId,
          actorEmail: log.actorEmail,
          actorRole: log.actorRole,
          action: log.action,
          targetType: log.targetType,
          targetId: log.targetId,
          detail: log.detail as unknown as object,
          ip: log.ip,
          userAgent: log.userAgent,
          result: log.result,
          createdAt: new Date(log.createdAt),
        },
      });
    },
    async listAuditLogs(tenantId, filter) {
      return (
        await prisma.auditLog.findMany({
          where: {
            tenantId,
            ...(filter?.actorUserId ? { actorUserId: filter.actorUserId } : {}),
            ...(filter?.action ? { action: { contains: filter.action } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: filter?.limit ?? 200,
        })
      ).map(mapAudit);
    },

    async listInsights(tenantId) {
      return (
        await prisma.aiInsight.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      ).map(mapInsight);
    },
    async replaceInsights(tenantId, insights) {
      await prisma.$transaction([
        prisma.aiInsight.deleteMany({ where: { tenantId } }),
        prisma.aiInsight.createMany({
          data: insights.map((i) => ({
            id: i.id,
            tenantId,
            kind: i.kind,
            severity: i.severity,
            title: i.title,
            detail: i.detail,
            recommendation: i.recommendation,
            targetType: i.targetType,
            targetId: i.targetId,
            evidence: i.evidence as unknown as object,
            createdAt: new Date(i.createdAt),
          })),
        }),
      ]);
    },
  };

  return store;
}

function mapAccount(r: any): WalletAccount {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    createdAt: isoReq(r.createdAt),
  };
}

/** Prisma の一意制約違反（P2002） */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

export { config };
