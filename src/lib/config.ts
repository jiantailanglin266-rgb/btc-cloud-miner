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
    /** mock | custody */
    providerMode: str("WALLET_PROVIDER_MODE", "mock"),
    custodyApiUrl: process.env.CUSTODY_API_URL || null,
    withdrawalEnabled: bool("FEATURE_WITHDRAWAL_ENABLED", true),
    minWithdrawalBtc: str("MIN_WITHDRAWAL_BTC", "0.001"),
    withdrawalFeeBtc: str("WITHDRAWAL_FEE_BTC", "0.00015"),
    twoApproverThresholdBtc: str("WITHDRAWAL_TWO_APPROVER_THRESHOLD_BTC", "0.01"),
    addressCooldownHours: num("WITHDRAWAL_ADDRESS_COOLDOWN_HOURS", 24),
  },

  fees: {
    platformFeeRate: num("DEFAULT_PLATFORM_FEE_RATE", 0.02),
    poolFeeRate: num("DEFAULT_POOL_FEE_RATE", 0.02),
    electricityPriceKwh: num("DEFAULT_ELECTRICITY_PRICE_KWH", 0.06),
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
