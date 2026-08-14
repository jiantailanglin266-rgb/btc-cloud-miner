/**
 * プロバイダー資格情報の解決
 *
 * 優先順位:
 *   1. credentialsRef（Secrets Manager / 環境変数の参照名）← 本番推奨
 *   2. credentialsEnc（AES-256-GCM で暗号化した DB フィールド）← 管理画面登録
 *
 * ★ 平文の資格情報は DB に保存しない。ログにも出さない。
 * ★ この関数はサーバー専用（decryptField が Node crypto を使う）。
 */

import type { MiningProvider } from "@/types";
import { decryptField } from "@/lib/crypto";
import { toEnvName } from "./pool-rest";

export function resolveProviderSecret(provider: MiningProvider): string | null {
  // 1. 参照名 → 環境変数（本番は Secrets Manager がこの環境変数を注入）
  if (provider.credentialsRef) {
    const fromEnv = process.env[toEnvName(provider.credentialsRef)];
    if (fromEnv) return fromEnv;
  }
  // 2. 暗号化 DB フィールド
  if (provider.credentialsEnc) {
    try {
      return decryptField(provider.credentialsEnc);
    } catch {
      // 復号失敗は資格情報なし扱い（鍵ローテーション途中など）。中身はログに出さない
      console.error(`[provider] ${provider.id} の資格情報の復号に失敗しました`);
      return null;
    }
  }
  return null;
}

/**
 * 末尾4文字だけ見せるマスク（UI 表示用）。
 * "abcd1234efgh" → "••••••••efgh"
 */
export function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return "••••••••" + value.slice(-4);
}
