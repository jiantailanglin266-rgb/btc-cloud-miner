/**
 * ドメイン型定義
 *
 * DB 実装（Prisma）とインメモリ実装が共有する「共通語彙」。
 * ここに無い概念はアプリのどこにも存在しない、という状態を保つ。
 *
 * 単位の規約（事故防止のため命名で強制する）:
 *   - BTC 金額は末尾 `Btc`、文字列で保持（numeric(18,8) 相当。number で持たない）
 *   - ハッシュレートは末尾 `Ths`（TH/s に統一。PH/s・EH/s は表示時に変換）
 *   - 電力効率は `JPerTh`（J/TH）
 *   - 料率は 0〜1 の number（0.02 = 2%）
 */

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

/** BTC 金額。丸め誤差を防ぐため文字列で保持し、計算は lib/decimal.ts を通す */
export type BtcAmount = string;

export type ISODateString = string;

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// ---------------------------------------------------------------------------
// テナント
// ---------------------------------------------------------------------------

export type TenantStatus = "ACTIVE" | "SUSPENDED" | "TRIAL";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: ISODateString;
};

export type TenantSettings = {
  tenantId: string;
  brandName: string;
  logoText: string;
  colorPrimary: string;
  colorAccent: string;
  platformFeeRate: number;
  poolFeeRate: number;
  electricityPriceKwh: number;
  minWithdrawalBtc: BtcAmount;
  withdrawalFeeBtc: BtcAmount;
  withdrawalTwoApproverThresholdBtc: BtcAmount;
  addressCooldownHours: number;
  defaultCurrency: "USD" | "JPY";
  featureFlags: Record<string, boolean>;
};

export type TenantBranding = Pick<
  TenantSettings,
  "brandName" | "logoText" | "colorPrimary" | "colorAccent"
> & { tenantId: string; slug: string };

// ---------------------------------------------------------------------------
// ユーザー・認証
// ---------------------------------------------------------------------------

export type UserRole =
  | "USER"
  | "ORG_ADMIN"
  | "TENANT_ADMIN"
  | "PLATFORM_ADMIN"
  | "SUPPORT"
  | "AUDITOR";

export type UserStatus = "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION";

export type KycStatus =
  | "NOT_SUBMITTED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED";

export type User = {
  id: string;
  tenantId: string;
  organizationId: string | null;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  kycStatus: KycStatus;
  twoFactorEnabled: boolean;
  createdAt: ISODateString;
  lastLoginAt: ISODateString | null;
  lastLoginIp: string | null;
  deletedAt: ISODateString | null;
};

export type UserCredentials = {
  userId: string;
  /** `scrypt$<salt>$<hash>` 形式。平文保存は禁止 */
  passwordHash: string;
  /** AES-256-GCM で暗号化した TOTP シークレット（`enc:v1:...`） */
  totpSecretEnc: string | null;
  /** ハッシュ化したリカバリーコードを暗号化して保持 */
  recoveryCodesEnc: string | null;
  failedAttempts: number;
  lockedUntil: ISODateString | null;
  passwordChangedAt: ISODateString;
};

export type Session = {
  id: string;
  userId: string;
  tenantId: string;
  /** SHA-256 ハッシュのみ保存。生トークンは Cookie にのみ存在する */
  tokenHash: string;
  /** step-up 認証の基準時刻。null なら 2FA 未通過 */
  twoFactorVerifiedAt: ISODateString | null;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  lastSeenAt: ISODateString;
  ip: string | null;
  userAgent: string | null;
};

// ---------------------------------------------------------------------------
// プラン・契約
// ---------------------------------------------------------------------------

export type PayoutScheme = "PPS_PLUS" | "FPPS" | "PPLNS";

export type Plan = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  hashrateThs: number;
  termDays: number;
  priceUsd: number;
  poolFeeRate: number;
  platformFeeRate: number;
  /** 0 なら電力コストは事業者負担（ユーザーに転嫁しない） */
  electricityPriceKwh: number;
  payoutScheme: PayoutScheme;
  active: boolean;
};

export type ContractStatus =
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "EXPIRED"
  | "CANCELLED"
  | "SUSPENDED";

export type Contract = {
  id: string;
  tenantId: string;
  userId: string;
  planId: string;
  planName: string;
  hashrateThs: number;
  status: ContractStatus;
  startsAt: ISODateString;
  endsAt: ISODateString;
  autoRenew: boolean;
  upfrontCostUsd: number;
  createdAt: ISODateString;
};

export type HashrateAllocation = {
  id: string;
  tenantId: string;
  contractId: string;
  providerId: string;
  workerId: string | null;
  hashrateThs: number;
  createdAt: ISODateString;
};

// ---------------------------------------------------------------------------
// マイニングプロバイダー・ワーカー
// ---------------------------------------------------------------------------

export type ProviderKind =
  | "MOCK"
  | "POOL_REST"
  | "STRATUM"
  | "PROVIDER_A"
  | "PROVIDER_B";

export type ProviderStatus = "ONLINE" | "DEGRADED" | "OFFLINE" | "MAINTENANCE";

export type MiningProvider = {
  id: string;
  tenantId: string;
  kind: ProviderKind;
  name: string;
  region: string;
  endpoint: string | null;
  /** Secrets Manager のキー名のみ。認証情報の値は絶対に保持しない */
  credentialsRef: string | null;
  status: ProviderStatus;
  lastOkAt: ISODateString | null;
  lastError: string | null;
  consecutiveFailures: number;
  priority: number;
  enabled: boolean;
  poolName: string;
  payoutScheme: PayoutScheme;
};

export type WorkerStatus = "ACTIVE" | "OFFLINE" | "MAINTENANCE" | "UNKNOWN";

export type Worker = {
  id: string;
  tenantId: string;
  providerId: string;
  externalWorkerId: string;
  minerId: string;
  model: string;
  ratedHashrateThs: number;
  ratedEfficiencyJPerTh: number;
  status: WorkerStatus;
  lastSeenAt: ISODateString | null;
};

/** プロバイダーから取得した1時点のワーカー統計（正規化済み） */
export type WorkerSnapshot = {
  workerId: string;
  tenantId: string;
  bucketAt: ISODateString;
  hashrateThs: number;
  acceptedShares: number;
  rejectedShares: number;
  temperatureC: number | null;
  powerW: number | null;
  uptimeSec: number;
  poolStatus: string;
  workerStatus: WorkerStatus;
  /** プロバイダーの申告値。参考値であり、本システムの推定とは別 */
  estimatedEarningsBtc: BtcAmount | null;
};

/** アダプタがプロバイダーから取得して返す生データの正規化形 */
export type ProviderWorkerReading = {
  externalWorkerId: string;
  minerId: string;
  model: string;
  hashrateThs: number;
  ratedHashrateThs: number;
  ratedEfficiencyJPerTh: number;
  acceptedShares: number;
  rejectedShares: number;
  temperatureC: number | null;
  powerW: number | null;
  uptimeSec: number;
  poolStatus: string;
  workerStatus: WorkerStatus;
  estimatedEarningsBtc: BtcAmount | null;
};

export type ProviderHealth = {
  providerId: string;
  name: string;
  kind: ProviderKind;
  status: ProviderStatus;
  latencyMs: number | null;
  lastOkAt: ISODateString | null;
  consecutiveFailures: number;
  message: string | null;
};

// ---------------------------------------------------------------------------
// Bitcoin ネットワーク
// ---------------------------------------------------------------------------

/** データの鮮度。UI で「古い値です」を出すために必ず伝播させる */
export type Freshness = {
  source: string;
  fetchedAt: ISODateString;
  stale: boolean;
  ageSec: number;
};

export type BitcoinNetworkInfo = {
  difficulty: number;
  networkHashrateThs: number;
  blockHeight: number;
  blockRewardBtc: number;
  /** 次回難易度調整までの残ブロック数 */
  blocksUntilAdjustment: number;
  /** 次回難易度調整の推定変化率（0.021 = +2.1%） */
  estimatedAdjustmentRate: number;
  mempoolTxCount: number;
  recommendedFeeSatPerVb: number;
  freshness: Freshness;
};

export type BitcoinPrice = {
  usd: number;
  jpy: number;
  change24hRate: number;
  freshness: Freshness;
};

// ---------------------------------------------------------------------------
// 収益
// ---------------------------------------------------------------------------

export type RevenueInput = {
  hashrateThs: number;
  networkHashrateThs: number;
  difficulty: number;
  blockRewardBtc: number;
  btcPriceUsd: number;
  electricityPriceKwh: number;
  efficiencyJPerTh: number;
  poolFeeRate: number;
  platformFeeRate: number;
  uptimeRate: number;
  /** 初期費用（ROI 計算用）。0 ならサブスク型として ROI を出さない */
  upfrontCostUsd?: number;
};

export type RevenueResult = {
  /** 常に true。UI・API から「推定である」ことを消せないようにするためのフラグ */
  isEstimate: true;
  estimatedBtcPerDay: number;
  estimatedBtcPerMonth: number;
  estimatedBtcPerYear: number;
  grossRevenueUsdPerDay: number;
  electricityCostUsdPerDay: number;
  poolFeeUsdPerDay: number;
  platformFeeUsdPerDay: number;
  netRevenueUsdPerDay: number;
  netRevenueUsdPerMonth: number;
  profitMargin: number;
  /** これを下回ると赤字になる BTC 価格 */
  breakEvenBtcPriceUsd: number;
  /** これを上回ると赤字になる電力単価 */
  breakEvenElectricityPriceKwh: number;
  /** 初期費用の回収に要する日数。回収不能なら null */
  roiDays: number | null;
  powerConsumptionKw: number;
  disclaimer: string;
};

export type SensitivityPoint = {
  label: string;
  factor: number;
  netRevenueUsdPerDay: number;
  profitMargin: number;
};

export type SensitivityResult = {
  btcPrice: SensitivityPoint[];
  difficulty: SensitivityPoint[];
  electricityPrice: SensitivityPoint[];
};

// ---------------------------------------------------------------------------
// ウォレット
// ---------------------------------------------------------------------------

export type LedgerEntryType =
  | "MINING_REWARD"
  | "FEE"
  | "WITHDRAWAL_LOCK"
  | "WITHDRAWAL_SETTLE"
  | "WITHDRAWAL_REVERSE"
  | "ADJUSTMENT";

export type LedgerBucket = "AVAILABLE" | "LOCKED";

export type LedgerEntry = {
  id: string;
  tenantId: string;
  accountId: string;
  entryType: LedgerEntryType;
  bucket: LedgerBucket;
  /** 符号付き。同一トランザクション内の合計はゼロになるよう仕訳する */
  amountBtc: BtcAmount;
  refType: string | null;
  refId: string | null;
  idempotencyKey: string | null;
  memo: string;
  createdAt: ISODateString;
};

export type WalletAccount = {
  id: string;
  tenantId: string;
  userId: string;
  createdAt: ISODateString;
};

export type WalletBalance = {
  availableBtc: BtcAmount;
  lockedBtc: BtcAmount;
  lifetimeEarnedBtc: BtcAmount;
  lifetimeWithdrawnBtc: BtcAmount;
};

export type WalletAddress = {
  id: string;
  tenantId: string;
  userId: string;
  address: string;
  label: string;
  createdAt: ISODateString;
  /** この時刻を過ぎるまで送金できない（クールダウン） */
  usableAt: ISODateString;
};

export type WithdrawalStatus =
  | "PENDING_REVIEW"
  | "FLAGGED"
  | "APPROVED"
  | "REJECTED"
  | "BROADCASTING"
  | "BROADCASTED"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED";

export type Withdrawal = {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  addressId: string;
  address: string;
  amountBtc: BtcAmount;
  feeBtc: BtcAmount;
  netBtc: BtcAmount;
  status: WithdrawalStatus;
  riskScore: number;
  riskReasons: string[];
  requiredApprovals: number;
  approvals: WithdrawalApproval[];
  requestedIp: string | null;
  txId: string | null;
  confirmations: number;
  idempotencyKey: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type WithdrawalApproval = {
  approverId: string;
  approverEmail: string;
  decidedAt: ISODateString;
  decision: "APPROVE" | "REJECT";
  note: string;
};

export type Earning = {
  id: string;
  tenantId: string;
  userId: string;
  contractId: string;
  earnedAt: ISODateString;
  grossBtc: BtcAmount;
  poolFeeBtc: BtcAmount;
  platformFeeBtc: BtcAmount;
  electricityFeeBtc: BtcAmount;
  netBtc: BtcAmount;
  hashrateThs: number;
  uptimeRate: number;
};

// ---------------------------------------------------------------------------
// 通知・サポート・障害・監査
// ---------------------------------------------------------------------------

export type NotificationLevel = "INFO" | "WARNING" | "CRITICAL";

export type Notification = {
  id: string;
  tenantId: string;
  userId: string;
  level: NotificationLevel;
  title: string;
  body: string;
  href: string | null;
  readAt: ISODateString | null;
  createdAt: ISODateString;
};

export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export type SupportTicket = {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  subject: string;
  category: string;
  status: TicketStatus;
  messages: SupportMessage[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type SupportMessage = {
  id: string;
  authorId: string;
  authorName: string;
  isStaff: boolean;
  body: string;
  createdAt: ISODateString;
};

export type IncidentSeverity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type IncidentStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";

export type Incident = {
  id: string;
  tenantId: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  body: string;
  affectedComponents: string[];
  startedAt: ISODateString;
  resolvedAt: ISODateString | null;
};

export type AuditResult = "SUCCESS" | "FAILURE";

export type AuditLog = {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  result: AuditResult;
  createdAt: ISODateString;
};

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export type InsightSeverity = "INFO" | "WARNING" | "CRITICAL";

export type AiInsight = {
  id: string;
  tenantId: string;
  kind:
    | "HASHRATE_ANOMALY"
    | "WORKER_OFFLINE"
    | "REJECT_RATE_HIGH"
    | "THERMAL_RISK"
    | "EFFICIENCY_DEGRADATION"
    | "PROFITABILITY_WARNING"
    | "DIFFICULTY_TREND"
    | "MAINTENANCE_FORECAST";
  severity: InsightSeverity;
  title: string;
  detail: string;
  recommendation: string;
  targetType: "worker" | "provider" | "portfolio";
  targetId: string;
  /** 判断根拠の数値。人が検算できるように必ず添える */
  evidence: Record<string, number | string>;
  createdAt: ISODateString;
};

// ---------------------------------------------------------------------------
// ダッシュボード集約
// ---------------------------------------------------------------------------

export type DashboardSummary = {
  currentHashrateThs: number;
  averageHashrateThs: number;
  purchasedHashrateThs: number;
  allocatedHashrateThs: number;
  activeMiners: number;
  offlineMiners: number;
  totalMiners: number;
  uptimeRate: number;
  efficiencyJPerTh: number;
  acceptedShares: number;
  rejectedShares: number;
  rejectRate: number;
  network: BitcoinNetworkInfo;
  price: BitcoinPrice;
  revenue: RevenueResult;
  providerStatuses: ProviderHealth[];
  generatedAt: ISODateString;
};

export type SeriesRange = "1h" | "24h" | "7d" | "30d" | "90d" | "1y";

export type SeriesPoint = {
  t: ISODateString;
  v: number;
};

export type MetricSeries = {
  metric: string;
  unit: string;
  range: SeriesRange;
  points: SeriesPoint[];
};
