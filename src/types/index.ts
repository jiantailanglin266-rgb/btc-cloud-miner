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

/**
 * 接続モデル（本SaaS事業者は ASIC を所有しない）:
 *   PARTNER_FARM      = 提携マイニングファームの ASIC を接続
 *   CUSTOMER_OWNED    = 顧客自身が保有する ASIC を接続
 *   HASHRATE_PROVIDER = 外部ハッシュレートプロバイダーを接続
 */
export type ConnectionModel = "PARTNER_FARM" | "CUSTOMER_OWNED" | "HASHRATE_PROVIDER";

/**
 * 電力コストの扱い:
 *   INCLUDED     = プロバイダー価格に込み（ユーザーに別途請求しない）
 *   PASS_THROUGH = 実費をユーザーへ転嫁（配賦時に控除）
 *   USER_PAYS    = 顧客保有 ASIC 等でユーザーが直接支払う（本システムは関与しない）
 */
export type ElectricityCostTreatment = "INCLUDED" | "PASS_THROUGH" | "USER_PAYS";

export type Contract = {
  id: string;
  tenantId: string;
  userId: string;
  planId: string;
  planName: string;
  providerId: string | null;
  connectionModel: ConnectionModel;
  hashrateThs: number;
  status: ContractStatus;
  startsAt: ISODateString;
  endsAt: ISODateString;
  autoRenew: boolean;
  upfrontCostUsd: number;
  poolFeeRate: number;
  platformFeeRate: number;
  /** 実報酬からのレベニューシェア率（配賦時に platformFee とは別枠で控除） */
  revenueShareRate: number;
  /** ホスティング費率（PARTNER_FARM で PASS_THROUGH のときに使用） */
  hostingFeeRate: number;
  electricityCostTreatment: ElectricityCostTreatment;
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
  | "PROVIDER_B"
  | "BRAIINS"
  | "F2POOL"
  | "FARM_GENERIC"
  | "CUSTOMER_OWNED";

/**
 * データの出所種別。UI で必ず表示する（LIVE / STALE / MOCK の誤認防止）。
 *   LIVE  = 実データソースから直近に取得した値
 *   STALE = 実データソースだが取得に失敗し、古いキャッシュを表示している
 *   MOCK  = デモ用の擬似データ（実データではない）
 */
export type DataMode = "LIVE" | "STALE" | "MOCK";

/**
 * sourceMode（フェーズ3: Live Data Certification）。
 * DataMode より厳密な 4 区分。**LIVE として扱ってよいのは LIVE_API のみ**。
 *   MOCK       = 擬似生成データ
 *   FIXTURE    = 記録済みフィクスチャ（テスト用）
 *   LIVE_API   = 実 API から直近に取得した実データ（これだけが LIVE）
 *   STALE_LIVE = 実 API 由来だが古いキャッシュ
 */
export type SourceMode = "MOCK" | "FIXTURE" | "LIVE_API" | "STALE_LIVE";

/**
 * 実プロバイダー疎通の証明記録（フェーズ4）。
 * Secret は保存しない（accountIdentifierMasked は末尾4桁マスク済み）。
 */
export type ProviderCertification = {
  id: string;
  tenantId: string;
  providerId: string;
  providerKind: ProviderKind;
  accountIdentifierMasked: string | null;
  testedAt: ISODateString;
  workerCount: number | null;
  hashrateThs: number | null;
  balanceSatoshi: string | null;
  latencyMs: number | null;
  result: TestConnectionCode;
  codeVersion: string;
  environment: string;
};

/** Dead Letter Job（フェーズ13）: 最大試行後も失敗したジョブの記録 */
export type DeadLetterJob = {
  id: string;
  tenantId: string;
  jobKind: string;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string;
  createdAt: ISODateString;
  /** 管理者が再実行した時刻。null = 未再実行 */
  retriedAt: ISODateString | null;
  retriedBy: string | null;
  status: "DEAD" | "RETRIED" | "RESOLVED";
};

/**
 * 出所情報付きの値。外部から取得した数値には必ずこれを付ける。
 * 「どこから・いつ・推定か・古いか」を UI まで運ぶための封筒。
 */
export type SourcedValue<T> = {
  value: T;
  source: string;
  fetchedAt: ISODateString;
  isEstimate: boolean;
  isStale: boolean;
};

/** プール側の残高（未払い・支払済み） */
export type PoolBalance = {
  unpaidBtc: BtcAmount;
  paidBtc: BtcAmount;
  source: string;
  fetchedAt: ISODateString;
  isEstimate: boolean;
  isStale: boolean;
};

/**
 * プールからの実払い出し（Actual Revenue の源泉）。
 * 推定値とは絶対に混同しない。externalPayoutId が冪等キーの素材になる。
 */
export type PoolPayout = {
  id: string;
  tenantId: string;
  providerId: string;
  /** プール側の払い出し識別子（txid や payout id）。UNIQUE(providerId, externalPayoutId) */
  externalPayoutId: string;
  amountBtc: BtcAmount;
  paidAt: ISODateString;
  txId: string | null;
  source: string;
  fetchedAt: ISODateString;
  /**
   * UNALLOCATED     = 未配賦（Safety Gate 通過待ち）
   * ALLOCATED       = ユーザーへ配賦済み
   * PENDING_REVIEW  = Safety Gate 不通過。人間の確認が必要（無条件自動配賦の禁止）
   */
  allocationStatus: "UNALLOCATED" | "ALLOCATED" | "PENDING_REVIEW";
  allocatedAt: ISODateString | null;
  /** ゲート不通過・検証保留の理由（人が読める形） */
  reviewReason: string | null;
  /**
   * Blockchain 検証（フェーズ8）:
   *   VERIFIED             = 公開 API で tx の存在・confirmations を確認済み
   *   VERIFICATION_PENDING = txid はあるが未検証（API 障害時もここ。payout 処理は壊さない）
   *   NOT_APPLICABLE       = txid なし（Mock 等）
   *   MISMATCH             = tx は存在するが金額が payout 額未満
   */
  verificationStatus: "VERIFIED" | "VERIFICATION_PENDING" | "NOT_APPLICABLE" | "MISMATCH";
  confirmations: number | null;
  verifiedAt: ISODateString | null;
};

export type ProviderStatus = "ONLINE" | "DEGRADED" | "OFFLINE" | "MAINTENANCE";

export type MiningProvider = {
  id: string;
  tenantId: string;
  kind: ProviderKind;
  name: string;
  region: string;
  endpoint: string | null;
  /**
   * 外部シークレット参照方式（Secrets Manager のキー名）。値は保持しない。
   * 本番はこちらを推奨。
   */
  credentialsRef: string | null;
  /**
   * アプリ層で暗号化して保持する資格情報（AES-256-GCM, `enc:v1:...`）。
   * 管理画面から登録した API トークン等をここに入れる。ログ・API 応答に平文を出さない。
   * credentialsRef が設定されていればそちらを優先する。
   */
  credentialsEnc: string | null;
  /** ワーカー名からユーザー契約へ紐付けるためのプレフィックス（例 "acme."） */
  workerPrefix: string | null;
  status: ProviderStatus;
  lastOkAt: ISODateString | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** 直近の同期でのプール API 応答時間（ミリ秒）。未取得は null */
  lastLatencyMs: number | null;
  /** 直近でワーカー統計を同期した時刻。未同期は null */
  lastSyncAt: ISODateString | null;
  priority: number;
  enabled: boolean;
  poolName: string;
  payoutScheme: PayoutScheme;
};

/** TEST CONNECTION の結果分類 */
export type TestConnectionCode =
  | "CONNECTED"
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "PROVIDER_OFFLINE";

export type TestConnectionResult = {
  code: TestConnectionCode;
  latencyMs: number | null;
  /** 成功時のみ */
  info: {
    provider: string;
    account: string | null;
    workerCount: number | null;
    currentHashrateThs: number | null;
    unpaidBtc: BtcAmount | null;
    paidBtc: BtcAmount | null;
  } | null;
  message: string;
};

/**
 * プロバイダー API の生レスポンスの記録（デバッグ用）。
 * ★ API Key / Authorization / Cookie / Secret は絶対に保存しない（sanitize 済みのみ）。
 */
export type RawProviderSnapshot = {
  id: string;
  tenantId: string;
  providerId: string;
  endpoint: string;
  statusCode: number;
  /** 生ペイロードの SHA-256（変化検知用。本文は保存しない） */
  payloadHash: string;
  /** 正規化後の要約（機微情報を含まない） */
  normalizedResult: Record<string, unknown>;
  fetchedAt: ISODateString;
};

/** 分散/DB ロック（二重同期・二重 payout の防止） */
export type SyncLock = {
  key: string;
  holder: string;
  acquiredAt: ISODateString;
  expiresAt: ISODateString;
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
  /** 直近1時間平均。取得できないプールは null */
  hashrate1hThs: number | null;
  acceptedShares: number;
  rejectedShares: number;
  temperatureC: number | null;
  powerW: number | null;
  uptimeSec: number;
  poolStatus: string;
  workerStatus: WorkerStatus;
  /** 最終 share 受信時刻 */
  lastShareAt: ISODateString | null;
  /** データ出所（プール名 / mock:...） */
  source: string;
  /** プロバイダーの申告値。参考値であり、本システムの推定とは別 */
  estimatedEarningsBtc: BtcAmount | null;
};

/** アダプタがプロバイダーから取得して返す生データの正規化形 */
export type ProviderWorkerReading = {
  externalWorkerId: string;
  minerId: string;
  model: string;
  /** リアルタイム（直近）ハッシュレート */
  hashrateThs: number;
  /** 直近1時間平均。取得できないプールは null */
  hashrate1hThs: number | null;
  /** 直近24時間平均（rated と兼ねる場合あり） */
  ratedHashrateThs: number;
  ratedEfficiencyJPerTh: number;
  acceptedShares: number;
  rejectedShares: number;
  temperatureC: number | null;
  powerW: number | null;
  uptimeSec: number;
  poolStatus: string;
  workerStatus: WorkerStatus;
  /** 最終 share 受信時刻。取得できないプールは null */
  lastShareAt: ISODateString | null;
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
  | "POOL_FEE"
  | "PLATFORM_FEE"
  | "HOSTING_FEE"
  | "FEE" // 旧汎用区分（後方互換のため残す。新規は上の個別区分を使う）
  | "WITHDRAWAL_LOCK"
  | "WITHDRAWAL_SETTLE"
  | "WITHDRAWAL_REVERSE"
  | "WITHDRAWAL_FEE"
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
  /**
   * この報酬の性質。
   *   ACTUAL    = プールの実払い出し（PoolPayout）を配賦した確定値
   *   ESTIMATED = 推定値（デモ・暫定表示用）。実収益と混同してはならない
   */
  kind: "ACTUAL" | "ESTIMATED";
  /** ACTUAL の場合、元になった payout の ID */
  payoutId: string | null;
};

// ---------------------------------------------------------------------------
// 監視アラート
// ---------------------------------------------------------------------------

export type AlertKind =
  | "HASHRATE_SUDDEN_DROP"
  | "WORKER_OFFLINE"
  | "REJECT_RATE_SPIKE"
  | "POOL_API_UNAVAILABLE"
  | "STRATUM_DISCONNECT"
  | "REVENUE_ANOMALY"
  | "UNEXPECTED_PAYOUT"
  | "WITHDRAWAL_ANOMALY"
  | "DUPLICATE_PAYOUT"
  | "LEDGER_IMBALANCE"
  | "LIVE_CONNECTION_FAILED"
  | "WORKER_SYNC_MISMATCH"
  | "HASHRATE_DATA_ANOMALY"
  | "PAYOUT_VALIDATION_FAILED"
  | "ALLOCATION_GATE_BLOCKED";

export type Alert = {
  id: string;
  tenantId: string;
  kind: AlertKind;
  severity: "WARNING" | "CRITICAL";
  message: string;
  /** 判断根拠の数値（人が検算できる形で必ず残す） */
  evidence: Record<string, number | string>;
  targetType: string;
  targetId: string;
  createdAt: ISODateString;
  acknowledgedAt: ISODateString | null;
  acknowledgedBy: string | null;
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
// Hashpower Marketplace（NiceHash 等）
// ---------------------------------------------------------------------------

/** マーケットプレイスの動作モード。live は実注文を作成する（既定は mock） */
export type HashpowerMode = "mock" | "paper" | "live";

export type HashpowerMarket = "EU" | "USA" | "EU_N" | "USA_E" | "SA" | "ASIA";

/** アルゴリズム設定（NiceHash /main/api/v2/mining/algorithms 由来） */
export type HashpowerAlgoSettings = {
  algorithm: string;
  /** 価格・limit の基準ハッシュ数（例 PH = 1e15 H/s） */
  marketFactor: number;
  displayMarketFactor: string;
  minSpeedLimit: number;
  minPriceBtc: number;
  /** 新規注文時の固定手数料（BTC） */
  orderFeeBtc: number;
  /** 消費額に対するマーケット手数料率（例 0.03 = 3%） */
  marketFeeRate: number;
  source: string;
  fetchedAt: ISODateString;
};

export type OrderbookLevel = {
  /** BTC / marketFactor / day */
  priceBtcPerFactorDay: number;
  /** この価格帯の速度（marketFactor 単位/s） */
  speedFactor: number;
  market: HashpowerMarket;
};

export type HashpowerOrderbook = {
  algorithm: string;
  levels: OrderbookLevel[];
  /** 現在の実効価格（アクティブ注文が付いている最低価格帯） */
  currentPriceBtcPerFactorDay: number | null;
  totalAvailableSpeedFactor: number;
  marketFactor: number;
  source: string;
  sourceMode: SourceMode;
  fetchedAt: ISODateString;
};

export type HashpowerOrderStatus =
  | "PLANNED"
  | "SUBMITTED"
  | "ACTIVE"
  | "PARTIALLY_FILLED"
  | "STOPPING"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

/** ハッシュパワー注文（paper / live 共通。mode で区別） */
export type HashpowerOrder = {
  id: string;
  tenantId: string;
  mode: HashpowerMode;
  /** live のときのみ: NiceHash 側の注文 ID */
  externalOrderId: string | null;
  algorithm: string;
  market: HashpowerMarket;
  poolId: string | null;
  status: HashpowerOrderStatus;
  /** 発注価格（BTC/factor/day） */
  priceBtcPerFactorDay: number;
  /** 要求ハッシュレート */
  requestedThs: number;
  /** 実際に届いたハッシュレート（stats から更新） */
  deliveredThs: number | null;
  /** 予算（satoshi 相当の BTC 文字列） */
  amountBtc: BtcAmount;
  /** 消費済み（コスト） */
  spentBtc: BtcAmount;
  /** この注文期間中に採掘できたと推定/実測される BTC */
  minedBtc: BtcAmount;
  startedAt: ISODateString | null;
  stoppedAt: ISODateString | null;
  /** 決定時のスナップショット ID（説明可能性） */
  decisionSnapshotId: string | null;
  reason: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

// ---------------------------------------------------------------------------
// Arbitrage（収益性判定）
// ---------------------------------------------------------------------------

export type ArbitrageAction = "BUY" | "HOLD" | "STOP" | "WAIT";

/** 判定の入力と結果を丸ごと保存する（「なぜ注文した/しなかった」の説明可能性） */
export type DecisionSnapshot = {
  id: string;
  tenantId: string;
  at: ISODateString;
  /** 入力値（すべて数値・出所付きで保存） */
  inputs: {
    btcPriceUsd: number;
    usdJpy: number;
    difficulty: number;
    networkHashrateThs: number;
    blockSubsidyBtc: number;
    avgTxFeesBtcPerBlock: number;
    poolFeeRate: number;
    expectedPoolEfficiency: number;
    expectedRejectRate: number;
    nicehashPriceBtcPerFactorDay: number | null;
    nicehashMarketFeeRate: number;
    nicehashOrderFeeBtc: number;
    marketFactor: number;
    safetyMarginRate: number;
    dataMode: SourceMode;
  };
  /** 計算結果 */
  outputs: {
    expectedRevenueBtcPerThDay: number;
    costBtcPerThDay: number | null;
    spreadBtcPerThDay: number | null;
    expectedMarginRate: number | null;
    breakEvenPriceBtcPerFactorDay: number;
    maxBidPriceBtcPerFactorDay: number;
    spreadUsdPerHourAt1Ph: number | null;
    spreadJpyPerHourAt1Ph: number | null;
  };
  action: ArbitrageAction;
  reasons: string[];
  confidence: number;
  recommendedThs: number;
  maxSpendBtc: BtcAmount;
};

/** テナントごとのアービトラージ設定・状態（HWM・日次カウンタ・予測誤差） */
export type ArbitrageState = {
  tenantId: string;
  enabled: boolean;
  /** 安全マージン（0.10 = 10%）。adaptive で自動調整され得る */
  safetyMarginRate: number;
  startMarginRate: number;
  stopMarginRate: number;
  minRuntimeSec: number;
  maxRuntimeSec: number;
  maxOrderBtc: BtcAmount;
  maxDailySpendBtc: BtcAmount;
  maxDailyLossBtc: BtcAmount;
  maxConcurrentOrders: number;
  maxHashrateThs: number;
  maxDrawdownRate: number;
  /** 実現損益に対する成功報酬率 */
  performanceFeeRate: number;
  /** High-Water Mark（累積実現純益のピーク・BTC） */
  highWaterMarkBtc: BtcAmount;
  /** 予測誤差の指数移動平均（|expected-actual|/expected） */
  forecastErrorEma: number;
  /** 日次カウンタ（dayKey が変わったらリセット） */
  dayKey: string;
  daySpentBtc: BtcAmount;
  dayPnlBtc: BtcAmount;
  updatedAt: ISODateString;
};

/** バックテスト・履歴用の市場サンプル */
export type MarketSample = {
  id: string;
  at: ISODateString;
  btcPriceUsd: number;
  usdJpy: number;
  difficulty: number;
  networkHashrateThs: number;
  blockSubsidyBtc: number;
  avgTxFeesBtcPerBlock: number;
  nicehashPriceBtcPerFactorDay: number;
  nicehashAvailableFactor: number;
  poolEfficiency: number;
  sourceMode: SourceMode;
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
