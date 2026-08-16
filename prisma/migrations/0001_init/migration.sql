-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenantId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "logoText" TEXT NOT NULL DEFAULT 'B',
    "colorPrimary" TEXT NOT NULL DEFAULT '#f7931a',
    "colorAccent" TEXT NOT NULL DEFAULT '#2f7cff',
    "platformFeeRate" DECIMAL(6,5) NOT NULL,
    "poolFeeRate" DECIMAL(6,5) NOT NULL,
    "electricityPriceKwh" DECIMAL(10,4) NOT NULL,
    "minWithdrawalBtc" DECIMAL(18,8) NOT NULL,
    "withdrawalFeeBtc" DECIMAL(18,8) NOT NULL,
    "withdrawalTwoApproverThresholdBtc" DECIMAL(18,8) NOT NULL,
    "addressCooldownHours" INTEGER NOT NULL DEFAULT 24,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "featureFlags" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "kycStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" TEXT,
    "recoveryCodesEnc" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "twoFactorVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "hashrateThs" DECIMAL(14,4) NOT NULL,
    "termDays" INTEGER NOT NULL,
    "priceUsd" DECIMAL(14,2) NOT NULL,
    "poolFeeRate" DECIMAL(6,5) NOT NULL,
    "platformFeeRate" DECIMAL(6,5) NOT NULL,
    "electricityPriceKwh" DECIMAL(10,4) NOT NULL,
    "payoutScheme" TEXT NOT NULL DEFAULT 'FPPS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "providerId" TEXT,
    "connectionModel" TEXT NOT NULL DEFAULT 'PARTNER_FARM',
    "hashrateThs" DECIMAL(14,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "upfrontCostUsd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "poolFeeRate" DECIMAL(6,5) NOT NULL DEFAULT 0.02,
    "platformFeeRate" DECIMAL(6,5) NOT NULL DEFAULT 0.02,
    "revenueShareRate" DECIMAL(6,5) NOT NULL DEFAULT 0,
    "hostingFeeRate" DECIMAL(6,5) NOT NULL DEFAULT 0,
    "electricityCostTreatment" TEXT NOT NULL DEFAULT 'INCLUDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hashrate_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "workerId" TEXT,
    "hashrateThs" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hashrate_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mining_providers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "endpoint" TEXT,
    "credentialsRef" TEXT,
    "credentialsEnc" TEXT,
    "workerPrefix" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastLatencyMs" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "poolName" TEXT NOT NULL DEFAULT '',
    "payoutScheme" TEXT NOT NULL DEFAULT 'FPPS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mining_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalWorkerId" TEXT NOT NULL,
    "minerId" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "ratedHashrateThs" DECIMAL(14,4) NOT NULL,
    "ratedEfficiencyJPerTh" DECIMAL(10,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_snapshots" (
    "workerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "hashrateThs" DECIMAL(14,4) NOT NULL,
    "hashrate1hThs" DECIMAL(14,4),
    "acceptedShares" BIGINT NOT NULL DEFAULT 0,
    "rejectedShares" BIGINT NOT NULL DEFAULT 0,
    "temperatureC" DECIMAL(6,2),
    "powerW" DECIMAL(10,2),
    "uptimeSec" BIGINT NOT NULL DEFAULT 0,
    "poolStatus" TEXT NOT NULL DEFAULT '',
    "workerStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastShareAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT '',
    "estimatedEarningsBtc" DECIMAL(18,10),

    CONSTRAINT "worker_snapshots_pkey" PRIMARY KEY ("workerId","bucketAt")
);

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "amountBtc" DECIMAL(18,8) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "idempotencyKey" TEXT,
    "memo" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_addresses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usableAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "amountBtc" DECIMAL(18,8) NOT NULL,
    "feeBtc" DECIMAL(18,8) NOT NULL,
    "netBtc" DECIMAL(18,8) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskReasons" JSONB NOT NULL DEFAULT '[]',
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "requestedIp" TEXT,
    "txId" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "grossBtc" DECIMAL(18,8) NOT NULL,
    "poolFeeBtc" DECIMAL(18,8) NOT NULL,
    "platformFeeBtc" DECIMAL(18,8) NOT NULL,
    "electricityFeeBtc" DECIMAL(18,8) NOT NULL,
    "netBtc" DECIMAL(18,8) NOT NULL,
    "hashrateThs" DECIMAL(14,4) NOT NULL,
    "uptimeRate" DECIMAL(6,5) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "payoutId" TEXT,

    CONSTRAINT "earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_payouts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalPayoutId" TEXT NOT NULL,
    "amountBtc" DECIMAL(18,8) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "txId" TEXT,
    "source" TEXT NOT NULL DEFAULT '',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocationStatus" TEXT NOT NULL DEFAULT 'UNALLOCATED',
    "allocatedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "confirmations" INTEGER,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "pool_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_provider_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "normalizedResult" JSONB NOT NULL DEFAULT '{}',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_provider_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_locks" (
    "key" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_locks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "provider_certifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL,
    "accountIdentifierMasked" TEXT,
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workerCount" INTEGER,
    "hashrateThs" DECIMAL(14,4),
    "balanceSatoshi" BIGINT,
    "latencyMs" INTEGER,
    "result" TEXT NOT NULL,
    "codeVersion" TEXT NOT NULL DEFAULT '',
    "environment" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "provider_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobKind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retriedAt" TIMESTAMP(3),
    "retriedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DEAD',

    CONSTRAINT "dead_letter_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "message" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "targetType" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'SEV3',
    "status" TEXT NOT NULL DEFAULT 'INVESTIGATING',
    "body" TEXT NOT NULL DEFAULT '',
    "affectedComponents" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "actorRole" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL DEFAULT '',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "userAgent" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "recommendation" TEXT NOT NULL DEFAULT '',
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hashpower_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "algorithm" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "poolId" TEXT,
    "status" TEXT NOT NULL,
    "priceBtcPerFactorDay" DECIMAL(18,8) NOT NULL,
    "requestedThs" DECIMAL(14,4) NOT NULL,
    "deliveredThs" DECIMAL(14,4),
    "amountBtc" DECIMAL(18,8) NOT NULL,
    "spentBtc" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "minedBtc" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "decisionSnapshotId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hashpower_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "confidence" DECIMAL(6,5) NOT NULL,
    "recommendedThs" DECIMAL(14,4) NOT NULL,
    "maxSpendBtc" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "decision_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_samples" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "btcPriceUsd" DOUBLE PRECISION NOT NULL,
    "usdJpy" DOUBLE PRECISION NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "networkHashrateThs" DOUBLE PRECISION NOT NULL,
    "blockSubsidyBtc" DOUBLE PRECISION NOT NULL,
    "avgTxFeesBtcPerBlock" DOUBLE PRECISION NOT NULL,
    "nicehashPriceBtcPerFactorDay" DOUBLE PRECISION NOT NULL,
    "nicehashAvailableFactor" DOUBLE PRECISION NOT NULL,
    "poolEfficiency" DOUBLE PRECISION NOT NULL,
    "sourceMode" TEXT NOT NULL,

    CONSTRAINT "market_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arbitrage_states" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "safetyMarginRate" DOUBLE PRECISION NOT NULL,
    "startMarginRate" DOUBLE PRECISION NOT NULL,
    "stopMarginRate" DOUBLE PRECISION NOT NULL,
    "minRuntimeSec" INTEGER NOT NULL,
    "maxRuntimeSec" INTEGER NOT NULL,
    "maxOrderBtc" DECIMAL(18,8) NOT NULL,
    "maxDailySpendBtc" DECIMAL(18,8) NOT NULL,
    "maxDailyLossBtc" DECIMAL(18,8) NOT NULL,
    "maxConcurrentOrders" INTEGER NOT NULL,
    "maxHashrateThs" DECIMAL(14,4) NOT NULL,
    "maxDrawdownRate" DOUBLE PRECISION NOT NULL,
    "performanceFeeRate" DOUBLE PRECISION NOT NULL,
    "highWaterMarkBtc" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "forecastErrorEma" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "dayKey" TEXT NOT NULL,
    "daySpentBtc" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "dayPnlBtc" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arbitrage_states_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_domain_key" ON "tenant_domains"("domain");

-- CreateIndex
CREATE INDEX "tenant_domains_tenantId_idx" ON "tenant_domains"("tenantId");

-- CreateIndex
CREATE INDEX "users_tenantId_role_idx" ON "users"("tenantId", "role");

-- CreateIndex
CREATE INDEX "users_tenantId_status_idx" ON "users"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "plans_tenantId_active_idx" ON "plans"("tenantId", "active");

-- CreateIndex
CREATE INDEX "contracts_tenantId_userId_idx" ON "contracts"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "contracts_tenantId_status_idx" ON "contracts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "hashrate_allocations_tenantId_contractId_idx" ON "hashrate_allocations"("tenantId", "contractId");

-- CreateIndex
CREATE INDEX "mining_providers_tenantId_enabled_priority_idx" ON "mining_providers"("tenantId", "enabled", "priority");

-- CreateIndex
CREATE INDEX "workers_tenantId_status_idx" ON "workers"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workers_providerId_externalWorkerId_key" ON "workers"("providerId", "externalWorkerId");

-- CreateIndex
CREATE INDEX "worker_snapshots_tenantId_bucketAt_idx" ON "worker_snapshots"("tenantId", "bucketAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_userId_key" ON "wallet_accounts"("userId");

-- CreateIndex
CREATE INDEX "wallet_accounts_tenantId_idx" ON "wallet_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_bucket_idx" ON "ledger_entries"("accountId", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_tenantId_idempotencyKey_key" ON "ledger_entries"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "wallet_addresses_tenantId_userId_idx" ON "wallet_addresses"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "withdrawals_tenantId_status_createdAt_idx" ON "withdrawals"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_tenantId_idempotencyKey_key" ON "withdrawals"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "earnings_tenantId_userId_earnedAt_idx" ON "earnings"("tenantId", "userId", "earnedAt");

-- CreateIndex
CREATE INDEX "earnings_tenantId_kind_idx" ON "earnings"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "pool_payouts_tenantId_allocationStatus_paidAt_idx" ON "pool_payouts"("tenantId", "allocationStatus", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "pool_payouts_providerId_externalPayoutId_key" ON "pool_payouts"("providerId", "externalPayoutId");

-- CreateIndex
CREATE INDEX "raw_provider_snapshots_tenantId_providerId_fetchedAt_idx" ON "raw_provider_snapshots"("tenantId", "providerId", "fetchedAt");

-- CreateIndex
CREATE INDEX "sync_locks_expiresAt_idx" ON "sync_locks"("expiresAt");

-- CreateIndex
CREATE INDEX "provider_certifications_tenantId_providerId_testedAt_idx" ON "provider_certifications"("tenantId", "providerId", "testedAt");

-- CreateIndex
CREATE INDEX "dead_letter_jobs_tenantId_status_createdAt_idx" ON "dead_letter_jobs"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "alerts_tenantId_acknowledgedAt_createdAt_idx" ON "alerts"("tenantId", "acknowledgedAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_tenantId_status_idx" ON "support_tickets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "incidents_tenantId_status_idx" ON "incidents"("tenantId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "ai_insights_tenantId_severity_idx" ON "ai_insights"("tenantId", "severity");

-- CreateIndex
CREATE INDEX "hashpower_orders_tenantId_status_createdAt_idx" ON "hashpower_orders"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "decision_snapshots_tenantId_at_idx" ON "decision_snapshots"("tenantId", "at");

-- CreateIndex
CREATE INDEX "market_samples_at_idx" ON "market_samples"("at");

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hashrate_allocations" ADD CONSTRAINT "hashrate_allocations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "mining_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_snapshots" ADD CONSTRAINT "worker_snapshots_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "wallet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
┌─────────────────────────────────────────────────────────┐
│  Update available 6.19.3 -> 7.9.1                       │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘

