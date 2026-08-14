/**
 * F2Pool Live Verification（フェーズ2）
 *
 *   LIVE_PROVIDER_TEST=true F2POOL_ACCOUNT_NAME=<name> npm run verify:f2pool
 *
 * 実 F2Pool API へ read-only 接続し、項目別に PASS / WARN / FAIL を表示する。
 * 必要な環境変数が無ければ **実 API へ一切アクセスせず SKIPPED** で終了する。
 *
 * ★ Secret（アカウント名・トークン）は標準出力に表示しない（末尾4桁マスクのみ）。
 * ★ 書き込み系 API は一切呼ばない。
 */

import { F2PoolAdapter } from "@/modules/provider/adapters/f2pool";
import { maskSecret } from "@/modules/provider/adapters/secret";
import type { MiningProvider } from "@/types";

type Level = "PASS" | "WARN" | "FAIL";
const rows: Array<{ item: string; level: Level; detail: string }> = [];
const put = (item: string, level: Level, detail: string) => rows.push({ item, level, detail });

function render(exitCode: number): never {
  const icon = { PASS: "✓", WARN: "!", FAIL: "✗" } as const;
  const color = { PASS: "\x1b[32m", WARN: "\x1b[33m", FAIL: "\x1b[31m" } as const;
  console.log("\n  F2Pool Live Verification\n");
  for (const r of rows) {
    console.log(`  ${color[r.level]}${icon[r.level]} ${r.level}\x1b[0m  ${r.item.padEnd(22)} ${r.detail}`);
  }
  const fails = rows.filter((r) => r.level === "FAIL").length;
  console.log(
    `\n  結果: PASS ${rows.filter((r) => r.level === "PASS").length} / WARN ${rows.filter((r) => r.level === "WARN").length} / FAIL ${fails}\n`,
  );
  process.exit(exitCode >= 0 ? exitCode : fails > 0 ? 1 : 0);
}

async function main() {
  const account = process.env.F2POOL_ACCOUNT_NAME || process.env.F2POOL_ACCOUNT;
  const liveEnabled = process.env.LIVE_PROVIDER_TEST === "true";

  if (!liveEnabled || !account) {
    console.log("\n  F2Pool Live Verification: SKIPPED");
    console.log(
      `    LIVE_PROVIDER_TEST=${liveEnabled ? "true" : "未設定"} / F2POOL_ACCOUNT_NAME=${account ? "設定済み" : "未設定"}`,
    );
    console.log("    実 API へはアクセスしていません。両方を設定すると実疎通を検証します。\n");
    process.exit(0);
  }

  console.log(`\n  対象アカウント: ${maskSecret(account)}（マスク表示）`);

  // credentialsRef "f2pool/account-name" → 環境変数 F2POOL_ACCOUNT_NAME
  const provider: MiningProvider = {
    id: "verify-f2", tenantId: "verify", kind: "F2POOL", name: "F2Pool",
    region: "", endpoint: process.env.F2POOL_ENDPOINT || null,
    credentialsRef: "f2pool/account-name", credentialsEnc: null, workerPrefix: null,
    status: "OFFLINE", lastOkAt: null, lastError: null, consecutiveFailures: 0,
    lastLatencyMs: null, lastSyncAt: null, priority: 1, enabled: true,
    poolName: "", payoutScheme: "FPPS",
  };

  const adapter = new F2PoolAdapter(provider);

  // --- Authentication / Reachability / Latency ------------------------------
  let probe: Awaited<ReturnType<F2PoolAdapter["probe"]>>;
  try {
    probe = await adapter.probe();
    put("Authentication", "PASS", "アカウントを認識しました");
    put("API Reachability", "PASS", "応答あり");
    put(
      "Latency",
      probe.latencyMs < 2000 ? "PASS" : "WARN",
      `${probe.latencyMs} ms${probe.latencyMs >= 2000 ? "（遅延）" : ""}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/認証|アカウント名/.test(msg)) {
      put("Authentication", "FAIL", msg);
    } else if (/レート制限/.test(msg)) {
      put("API Reachability", "FAIL", "429 レート制限");
    } else {
      put("API Reachability", "FAIL", msg.slice(0, 120));
    }
    render(1);
  }

  // --- Account / Workers ----------------------------------------------------
  put("Account", "PASS", `識別子 ${maskSecret(probe.account)}`);
  put(
    "Workers",
    probe.workerCount > 0 ? "PASS" : "WARN",
    probe.workerCount > 0
      ? `${probe.workerCount} 台`
      : "0 台（ASIC が未接続、またはワーカー名未設定）",
  );

  // --- Hashrate（realtime / 1h / 24h） --------------------------------------
  try {
    const result = await adapter.fetchWorkers();
    const rt = result.reportedTotalHashrateThs ?? 0;
    put("Hashrate realtime", rt > 0 ? "PASS" : "WARN", `${rt.toFixed(2)} TH/s`);
    const h1 = result.readings.reduce((s, w) => s + (w.hashrate1hThs ?? 0), 0);
    put("Hashrate 1h", h1 > 0 ? "PASS" : "WARN", h1 > 0 ? `${h1.toFixed(2)} TH/s` : "取得なし");
    const h24 = result.readings.reduce((s, w) => s + w.ratedHashrateThs, 0);
    put("Hashrate 24h", h24 > 0 ? "PASS" : "WARN", h24 > 0 ? `${h24.toFixed(2)} TH/s` : "取得なし");
  } catch (err) {
    put("Hashrate realtime", "FAIL", err instanceof Error ? err.message.slice(0, 120) : "取得失敗");
  }

  // --- Balance --------------------------------------------------------------
  try {
    const balance = await adapter.getPoolBalance();
    put("Balance", "PASS", `unpaid ${balance.unpaidBtc} / paid ${balance.paidBtc} BTC`);
  } catch {
    put("Balance", "FAIL", "取得失敗");
  }

  // --- Payout ---------------------------------------------------------------
  try {
    const payouts = await adapter.getPayoutHistory(Date.now() - 90 * 86_400_000);
    put(
      "Payout availability",
      payouts.length > 0 ? "PASS" : "WARN",
      payouts.length > 0 ? `直近90日 ${payouts.length} 件` : "payout 履歴なし（最低支払額未達の可能性）",
    );
    if (payouts.length > 0) {
      const last = payouts[payouts.length - 1];
      put("Last payout", "PASS", `${last.paidAt.slice(0, 10)} / ${last.amountBtc} BTC`);
    } else {
      put("Last payout", "WARN", "—");
    }
  } catch {
    put("Payout availability", "FAIL", "取得失敗");
  }

  // --- Provider health ------------------------------------------------------
  const health = await adapter.healthCheck();
  put(
    "Provider health",
    health.status === "ONLINE" ? "PASS" : health.status === "DEGRADED" ? "WARN" : "FAIL",
    `${health.status}${health.message ? ` — ${health.message}` : ""}`,
  );

  render(-1);
}

main().catch((err) => {
  console.error("verify:f2pool 実行エラー:", err instanceof Error ? err.message : err);
  process.exit(1);
});
