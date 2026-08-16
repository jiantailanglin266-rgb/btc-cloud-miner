/**
 * 環境変数の集約。
 *
 * 方針: 「未設定なら安全側の既定値で動く」。どの変数も必須にしない。
 * ただし本番（NODE_ENV=production）で危険な既定値が使われている場合は警告する。
 */

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

export const config = {
  env: str("NODE_ENV", "development"),
  isProduction: process.env.NODE_ENV === "production",
  appUrl: str("APP_URL", "http://localhost:3000"),
  brandName: str("APP_BRAND_NAME", "BTC CLOUD MINER"),

  databaseUrl: process.env.DATABASE_URL || null,
  redisUrl: process.env.REDIS_URL || null,

  encryptionKey: process.env.ENCRYPTION_KEY || null,
  sessionPepper: str("SESSION_PEPPER", ""),

  mining: {
    /** mock | live */
    providerMode: str("MINING_PROVIDER_MODE", "mock"),
    mockHashrateThs: num("MOCK_HASHRATE_THS", 500),
    timeoutMs: num("PROVIDER_TIMEOUT_MS", 10_000),
    failureThreshold: num("PROVIDER_FAILURE_THRESHOLD", 5),
    breakerResetMs: num("PROVIDER_BREAKER_RESET_MS", 60_000),
    syncIntervalSec: num("MINING_SYNC_INTERVAL_SEC", 300),
  },

  stratum: {
    url: process.env.STRATUM_URL || null,
    worker: process.env.STRATUM_WORKER || null,
    password: process.env.STRATUM_PASSWORD || null,
    version: str("STRATUM_VERSION", "v1"),
  },

  bitcoin: {
    sources: [
      process.env.BITCOIN_SOURCE_PRIMARY,
      process.env.BITCOIN_SOURCE_SECONDARY,
      process.env.BITCOIN_SOURCE_TERTIARY,
    ].filter((s): s is string => Boolean(s)),
    rpcUrl: process.env.BITCOIN_RPC_URL || null,
    cacheTtlSec: num("BITCOIN_CACHE_TTL_SEC", 60),
    staleMaxSec: num("BITCOIN_STALE_MAX_SEC", 86_400),
  },

  price: {
    sources: [
      process.env.PRICE_SOURCE_PRIMARY,
      process.env.PRICE_SOURCE_SECONDARY,
    ].filter((s): s is string => Boolean(s)),
    cacheTtlSec: num("PRICE_CACHE_TTL_SEC", 60),
  },

  wallet: {
    /** mock | sandbox | live（custody は live の旧名） */
    providerMode: str("WALLET_PROVIDER_MODE", "mock"),
    custodyApiUrl: process.env.CUSTODY_API_URL || null,
    withdrawalEnabled: bool("FEATURE_WITHDRAWAL_ENABLED", true),
    minWithdrawalBtc: str("MIN_WITHDRAWAL_BTC", "0.001"),
    withdrawalFeeBtc: str("WITHDRAWAL_FEE_BTC", "0.00015"),
    twoApproverThresholdBtc: str("WITHDRAWAL_TWO_APPROVER_THRESHOLD_BTC", "0.01"),
    addressCooldownHours: num("WITHDRAWAL_ADDRESS_COOLDOWN_HOURS", 24),
    /** 1回あたりの出金上限 */
    maxPerWithdrawalBtc: str("WITHDRAWAL_MAX_PER_TX_BTC", "0.5"),
    /** ユーザーあたり24時間の出金上限 */
    dailyLimitBtc: str("WITHDRAWAL_DAILY_LIMIT_BTC", "1.0"),
  },

  fees: {
    platformFeeRate: num("DEFAULT_PLATFORM_FEE_RATE", 0.02),
    poolFeeRate: num("DEFAULT_POOL_FEE_RATE", 0.02),
    electricityPriceKwh: num("DEFAULT_ELECTRICITY_PRICE_KWH", 0.06),
  },

  /**
   * Pilot Mode（フェーズ19）:
   * 実 Mining data・実 Pool balance・実 Payout は使用可能だが、
   * 外部出金（withdrawal）を全面禁止する。実 BTC 収益管理だけを安全に実証するモード。
   */
  pilotMode: bool("PILOT_MODE", false),

  nicehash: {
    /** mock | paper | live。既定 mock（ネットワーク接続なし）。paper=実市場データ・仮想注文 */
    mode: str("NICEHASH_MODE", "mock"),
    apiBase: process.env.NICEHASH_API_BASE || null,
    // 資格情報は Secrets Manager が環境変数として注入する。DB・Git に置かない。
    // 権限は Hashpower 注文(View/Create/Manage)のみ。★Withdrawal 権限は付与しない
    apiKey: process.env.NICEHASH_API_KEY || null,
    apiSecret: process.env.NICEHASH_API_SECRET || null,
    organizationId: process.env.NICEHASH_ORG_ID || null,
    /**
     * ★ Kill Switch（フェーズ18）: false の間は live モードでも実注文 API を一切呼ばない。
     * 既定 false。Paper/Backtest で十分検証されるまで有効化しないこと。
     */
    tradingEnabled: bool("FEATURE_NICEHASH_TRADING_ENABLED", false),
    /** マーケット手数料率。API から取得できない場合のフォールバック（要・実測確認） */
    marketFeeRate: num("NICEHASH_MARKET_FEE_RATE", 0.03),
    /** 新規注文の固定手数料 BTC（同上） */
    orderFeeBtc: num("NICEHASH_ORDER_FEE_BTC", 0.0001),
    /** Opportunity Scanner の間隔（秒）。Rate Limit を考慮して既定 60s */
    scanIntervalSec: num("ARBITRAGE_SCAN_INTERVAL_SEC", 60),
  },

  arbitrage: {
    /** 安全マージン初期値（保守的に 10%） */
    safetyMarginRate: num("ARBITRAGE_SAFETY_MARGIN", 0.10),
    /** Hysteresis: 開始・停止のマージン閾値を分ける */
    startMarginRate: num("ARBITRAGE_START_MARGIN", 0.08),
    stopMarginRate: num("ARBITRAGE_STOP_MARGIN", 0.03),
    minConfidence: num("ARBITRAGE_MIN_CONFIDENCE", 0.6),
    minRuntimeSec: num("ARBITRAGE_MIN_RUNTIME_SEC", 300),
    maxRuntimeSec: num("ARBITRAGE_MAX_RUNTIME_SEC", 1800),
    /** リスク上限（フェーズ17） */
    maxOrderBtc: str("ARBITRAGE_MAX_ORDER_BTC", "0.005"),
    maxDailySpendBtc: str("ARBITRAGE_MAX_DAILY_SPEND_BTC", "0.02"),
    maxDailyLossBtc: str("ARBITRAGE_MAX_DAILY_LOSS_BTC", "0.005"),
    maxConcurrentOrders: num("ARBITRAGE_MAX_CONCURRENT_ORDERS", 2),
    maxHashrateThs: num("ARBITRAGE_MAX_HASHRATE_THS", 2000),
    maxDrawdownRate: num("ARBITRAGE_MAX_DRAWDOWN_PERCENT", 20) / 100,
    /** 成功報酬率（実現純益のみ・HWM 併用） */
    performanceFeeRate: num("ARBITRAGE_PERFORMANCE_FEE_RATE", 0.2),
    /** データ鮮度の許容（秒）。超えたら注文しない */
    maxDataAgeSec: num("ARBITRAGE_MAX_DATA_AGE_SEC", 180),
    usdJpyFallback: num("ARBITRAGE_USDJPY", 152),
  },

  adminIpAllowlist: (process.env.ADMIN_IP_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  ai: {
    anthropicKey: process.env.ANTHROPIC_API_KEY || null,
    openaiKey: process.env.OPENAI_API_KEY || null,
  },

  smtpUrl: process.env.SMTP_URL || null,
} as const;

/** デモモード = 実データソースに一切つながっていない状態 */
export function isDemoMode(): boolean {
  return (
    config.mining.providerMode === "mock" &&
    config.bitcoin.sources.length === 0 &&
    config.bitcoin.rpcUrl === null
  );
}

/**
 * 起動時の構成チェック。
 * 本番で Mock / 開発用鍵が使われていたら大きく警告する（黙って動かさない）。
 */
/**
 * Deployment Safety（フェーズ14）:
 * 本番起動時の致命的な設定不備。これらは警告でなく「起動拒否レベル」として扱う。
 * 呼び出し側（instrumentation / doctor）は fatal が 1 つでもあれば起動を止めるか
 * 大きく警告する。
 */
export function assertProductionFatal(): string[] {
  const fatal: string[] = [];
  if (!config.isProduction) return fatal;

  if (!config.databaseUrl) {
    fatal.push("DATABASE_URL が未設定です（本番でインメモリは禁止）");
  }
  if (!config.encryptionKey) {
    fatal.push("ENCRYPTION_KEY が未設定です（開発用固定鍵での本番稼働は禁止）");
  }
  if (config.wallet.providerMode === "live" && !config.wallet.custodyApiUrl) {
    fatal.push("WALLET_PROVIDER_MODE=live ですが CUSTODY_API_URL が未設定です");
  }
  return fatal;
}

export function assertProductionConfig(): string[] {
  const warnings: string[] = [];
  if (!config.isProduction) return warnings;

  if (!config.databaseUrl) {
    warnings.push(
      "DATABASE_URL が未設定です。インメモリストアで動作するため、再起動でデータが消え、複数インスタンス間で共有されません。",
    );
  }
  if (!config.encryptionKey) {
    warnings.push(
      "ENCRYPTION_KEY が未設定です。開発用の固定鍵が使われるため、TOTP シークレットが実質的に保護されません。",
    );
  }
  if (config.wallet.providerMode === "mock") {
    warnings.push(
      "WALLET_PROVIDER_MODE=mock です。実際の送金は一切行われません（デモ実装）。",
    );
  }
  if (config.mining.providerMode === "mock") {
    warnings.push(
      "MINING_PROVIDER_MODE=mock です。表示されるマイニング統計は実データではありません。",
    );
  }
  if (config.adminIpAllowlist.length === 0) {
    warnings.push("ADMIN_IP_ALLOWLIST が未設定です。管理画面が全 IP から到達可能です。");
  }
  return warnings;
}
