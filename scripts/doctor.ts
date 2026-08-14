/**
 * CLI 診断（フェーズ18）
 *
 *   npm run doctor
 *
 * 本番投入前に環境・DB・暗号鍵・プロバイダー・外部 API・移行状態をチェックし、
 * PASS / WARN / FAIL を出力する。FAIL が 1 つでもあれば exit code 1。
 *
 * ★ 外部 API への接続は「疎通のみ」。プロバイダーの実キーは使わない（read-only の軽い GET）。
 */

import { config, isDemoMode, assertProductionConfig } from "@/lib/config";
import { getStore } from "@/lib/store";
import { encryptField, decryptField } from "@/lib/crypto";
import { getNetworkInfo, getPrice } from "@/modules/bitcoin/service";

type Level = "PASS" | "WARN" | "FAIL";
const results: Array<{ area: string; level: Level; message: string }> = [];

function check(area: string, level: Level, message: string) {
  results.push({ area, level, message });
}

async function run() {
  // 1. Environment
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  check(
    "Environment",
    nodeMajor >= 20 ? "PASS" : "FAIL",
    `Node.js ${process.versions.node}（要 20.9+）`,
  );
  check(
    "Environment",
    isDemoMode() ? "WARN" : "PASS",
    isDemoMode() ? "デモモード（実データソース未接続）" : "実データソース構成",
  );

  // 2. Database
  try {
    const store = await getStore();
    await store.getDefaultTenant();
    check(
      "Database",
      store.kind === "prisma" ? "PASS" : "WARN",
      store.kind === "prisma"
        ? "PostgreSQL 接続 OK"
        : "インメモリ（再起動で消える。本番は DATABASE_URL 必須）",
    );
  } catch (err) {
    check("Database", "FAIL", `接続失敗: ${err instanceof Error ? err.message : err}`);
  }

  // 3. Encryption
  if (!config.encryptionKey) {
    check(
      "Encryption",
      config.isProduction ? "FAIL" : "WARN",
      "ENCRYPTION_KEY 未設定（開発用固定鍵。本番では危険）",
    );
  } else {
    try {
      const sample = "doctor-roundtrip-テスト🔑";
      const ok = decryptField(encryptField(sample)) === sample;
      check("Encryption", ok ? "PASS" : "FAIL", ok ? "AES-256-GCM 往復 OK" : "往復検証に失敗");
    } catch (err) {
      check("Encryption", "FAIL", `暗号化エラー: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 4. Provider
  try {
    const store = await getStore();
    const tenant = await store.getDefaultTenant();
    const providers = await store.listProviders(tenant.id);
    const enabled = providers.filter((p) => p.enabled);
    const live = enabled.filter((p) => p.kind !== "MOCK");
    if (config.mining.providerMode === "live") {
      check(
        "Provider",
        live.length > 0 ? "PASS" : "FAIL",
        live.length > 0
          ? `live プロバイダー ${live.length} 件`
          : "live モードだが実プロバイダーが未登録",
      );
    } else {
      check("Provider", "WARN", `mock モード（登録 ${enabled.length} 件）`);
    }
    // 資格情報が平文でないことを確認
    const plainLeak = providers.some(
      (p) => p.credentialsEnc && !p.credentialsEnc.startsWith("enc:"),
    );
    check(
      "Provider",
      plainLeak ? "FAIL" : "PASS",
      plainLeak ? "暗号化されていない資格情報を検出" : "資格情報は暗号化 or 参照方式",
    );
  } catch (err) {
    check("Provider", "FAIL", `${err instanceof Error ? err.message : err}`);
  }

  // 5. Bitcoin API
  try {
    const net = await getNetworkInfo();
    const mode = net.freshness.source.startsWith("mock") ? "WARN" : "PASS";
    check(
      "Bitcoin API",
      mode,
      `${net.freshness.source} / height=${net.blockHeight} / diff=${net.difficulty.toExponential(2)}`,
    );
  } catch (err) {
    check("Bitcoin API", "FAIL", `${err instanceof Error ? err.message : err}`);
  }

  // 6. Price API
  try {
    const price = await getPrice();
    const mode = price.freshness.source.startsWith("mock") ? "WARN" : "PASS";
    check("Price API", mode, `${price.freshness.source} / $${price.usd}`);
  } catch (err) {
    check("Price API", "FAIL", `${err instanceof Error ? err.message : err}`);
  }

  // 7. Worker（設定確認のみ）
  check(
    "Worker",
    "PASS",
    `同期間隔 ${config.mining.syncIntervalSec}s（npm run worker で起動）`,
  );

  // 8. Migration
  if (config.databaseUrl) {
    try {
      const store = await getStore();
      // payout テーブル等の新スキーマにアクセスできるか
      const tenant = await store.getDefaultTenant();
      await store.listPayouts(tenant.id, { limit: 1 });
      check("Migration", "PASS", "新スキーマ（pool_payouts 等）にアクセス可能");
    } catch (err) {
      check(
        "Migration",
        "FAIL",
        `マイグレーション未適用の可能性: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    check("Migration", "WARN", "DATABASE_URL 未設定（インメモリはマイグレーション不要）");
  }

  // 本番構成の警告
  for (const w of assertProductionConfig()) {
    check("Production", "WARN", w);
  }

  // --- 出力 ---------------------------------------------------------------
  const icon = { PASS: "✓", WARN: "!", FAIL: "✗" };
  const color = { PASS: "\x1b[32m", WARN: "\x1b[33m", FAIL: "\x1b[31m" };
  console.log("\n  BTC CLOUD MINER — doctor\n");
  for (const r of results) {
    console.log(
      `  ${color[r.level]}${icon[r.level]} ${r.level}\x1b[0m  [${r.area}] ${r.message}`,
    );
  }
  const fails = results.filter((r) => r.level === "FAIL").length;
  const warns = results.filter((r) => r.level === "WARN").length;
  console.log(
    `\n  結果: PASS ${results.filter((r) => r.level === "PASS").length} / WARN ${warns} / FAIL ${fails}\n`,
  );
  process.exit(fails > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("doctor 実行エラー:", err);
  process.exit(1);
});
