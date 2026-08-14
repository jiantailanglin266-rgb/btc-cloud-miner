/**
 * LIVE Smoke Test（フェーズ20）
 *
 *   LIVE_PROVIDER_TEST=true F2POOL_ACCOUNT=<account> npm run smoke:live
 *
 * 実プールへ read-only の GET を1回だけ行い、疎通と主要値を表示する。
 * ★ LIVE_PROVIDER_TEST=true でなければ何もしない（CI での誤接続を防ぐ）。
 * ★ 書き込み・出金は一切行わない。
 */

import { F2PoolAdapter } from "@/modules/provider/adapters/f2pool";
import { testProviderConnection } from "@/modules/provider/test-connection";
import type { MiningProvider } from "@/types";

async function main() {
  if (process.env.LIVE_PROVIDER_TEST !== "true") {
    console.log(
      "[live-smoke] LIVE_PROVIDER_TEST=true が設定されていないため実行しません（安全のため）。",
    );
    process.exit(0);
  }
  const account = process.env.F2POOL_ACCOUNT;
  if (!account) {
    console.error("[live-smoke] F2POOL_ACCOUNT が未設定です。");
    process.exit(1);
  }

  const provider: MiningProvider = {
    id: "smoke-f2", tenantId: "smoke", kind: "F2POOL", name: "F2Pool (live smoke)",
    region: "", endpoint: null, credentialsRef: "f2pool/account", credentialsEnc: null,
    workerPrefix: null, status: "OFFLINE", lastOkAt: null, lastError: null,
    consecutiveFailures: 0, lastLatencyMs: null, lastSyncAt: null, priority: 1,
    enabled: true, poolName: "", payoutScheme: "FPPS",
  };
  // credentialsRef "f2pool/account" → 環境変数 F2POOL_ACCOUNT
  process.env.F2POOL_ACCOUNT = account;

  console.log("[live-smoke] F2Pool へ read-only 接続します…");
  const result = await testProviderConnection(provider);
  console.log(`[live-smoke] 結果: ${result.code} (${result.latencyMs}ms) — ${result.message}`);
  if (result.info) {
    console.log(`  workers=${result.info.workerCount} hashrate=${result.info.currentHashrateThs} TH/s`);
    console.log(`  unpaid=${result.info.unpaidBtc} paid=${result.info.paidBtc} BTC`);
  }

  if (result.code === "CONNECTED") {
    const adapter = new F2PoolAdapter(provider);
    const payouts = await adapter.getPayoutHistory(Date.now() - 30 * 86_400_000);
    console.log(`  直近30日の payout: ${payouts.length} 件`);
  }
  process.exit(result.code === "CONNECTED" ? 0 : 1);
}

main().catch((err) => {
  console.error("[live-smoke] エラー:", err);
  process.exit(1);
});
