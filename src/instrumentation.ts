/**
 * 起動時 Deployment Safety ガード（フェーズ14）
 *
 * Next.js の instrumentation フック。サーバー起動時に 1 回だけ実行される。
 * production で致命的な設定不備があれば起動を拒否する（fail-fast）。
 *
 * どうしても起動が必要な緊急時のみ FORCE_START=true で警告に格下げできる
 * （使用は監査ログ的にコンソールへ大きく残る）。
 */

export async function register() {
  // Node.js ランタイムでのみ実行（edge には crypto 等が無い）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { config, assertProductionFatal, assertProductionConfig } = await import(
    "@/lib/config"
  );

  const fatal = assertProductionFatal();
  const warnings = assertProductionConfig();

  for (const w of warnings) console.warn(`[startup] 警告: ${w}`);

  if (fatal.length > 0) {
    for (const f of fatal) console.error(`[startup] 致命的: ${f}`);
    if (process.env.FORCE_START === "true") {
      console.error(
        "[startup] ★★ FORCE_START=true により致命的な設定不備のまま起動しています。" +
          "これは緊急時の一時措置であり、即座に是正してください ★★",
      );
    } else {
      throw new Error(
        `本番起動を拒否しました（Deployment Safety）: ${fatal.join(" / ")} ` +
          "— 緊急時のみ FORCE_START=true で起動できます",
      );
    }
  }

  // demo ユーザーの存在チェック（DB がある場合のみ。インメモリは buildSeed が既に防いでいる）
  if (config.isProduction && config.databaseUrl) {
    try {
      const { getStore } = await import("@/lib/store");
      const store = await getStore();
      const tenant = await store.getDefaultTenant();
      const demo = await store.getUserByEmail(tenant.id, "demo@example.com");
      const admin = await store.getUserByEmail(tenant.id, "admin@example.com");
      if (demo || admin) {
        console.error(
          "[startup] ★★ 本番 DB に demo アカウント（demo@/admin@example.com）が存在します。" +
            "demo seed が本番へ流出しています。直ちに削除してください ★★",
        );
      }
      const providers = await store.listProviders(tenant.id);
      if (providers.some((p) => p.enabled && p.kind === "MOCK")) {
        console.error(
          "[startup] ★★ 本番で MOCK プロバイダーが有効です。無効化してください ★★",
        );
      }
    } catch {
      // 起動時チェックの失敗自体では落とさない（DB 接続は store 層が別途処理）
    }
  }

  if (config.pilotMode) {
    console.info(
      "[startup] PILOT MODE: 実マイニングデータ・実収益管理は有効、外部出金は全面無効です",
    );
  }
}
