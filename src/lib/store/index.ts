/**
 * Store の選択。
 *
 *   DATABASE_URL 未設定 → memory（デモモード）
 *   DATABASE_URL 設定済 → prisma（PostgreSQL）。初期化に失敗したら memory へフォールバックし警告
 *
 * ★ アプリのどこからも `getStore()` 経由でしかデータにアクセスしない。
 *   Prisma クライアントを直接 import してよいのは store/prisma.ts だけ。
 */

import type { Store } from "./types";
import { memoryStore } from "./memory";
import { config } from "@/lib/config";

let cached: Store | null = null;
let initPromise: Promise<Store> | null = null;

async function init(): Promise<Store> {
  if (!config.databaseUrl) {
    if (config.isProduction) {
      console.warn(
        "[store] DATABASE_URL が未設定のため、インメモリストアで起動します。" +
          "本番では再起動でデータが消え、複数インスタンス間でセッションが共有されません。",
      );
    }
    return memoryStore;
  }

  try {
    // 動的 import。DATABASE_URL が無い環境では Prisma クライアントを読み込まない
    const mod = await import("./prisma");
    const store = await mod.createPrismaStore();
    console.info("[store] PostgreSQL (Prisma) を使用します");
    return store;
  } catch (err) {
    console.error(
      "[store] Prisma の初期化に失敗しました。インメモリストアにフォールバックします。",
      err instanceof Error ? err.message : err,
    );
    console.error(
      "[store] `npx prisma generate` と `npx prisma migrate deploy` を実行したか確認してください。",
    );
    return memoryStore;
  }
}

export async function getStore(): Promise<Store> {
  if (cached) return cached;
  if (!initPromise) {
    initPromise = init().then((s) => {
      cached = s;
      return s;
    });
  }
  return initPromise;
}

export type { Store } from "./types";
export { DEMO_ACCOUNTS, DEFAULT_TENANT_ID, ACME_TENANT_ID } from "./memory";
