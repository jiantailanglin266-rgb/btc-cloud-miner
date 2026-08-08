/**
 * 暗号ユーティリティ（サーバー専用）
 *
 *  - パスワード: scrypt（`scrypt$<salt>$<hash>`）
 *  - フィールド暗号化: AES-256-GCM（`enc:v1:<iv>:<tag>:<ct>`）
 *  - トークン: 暗号学的乱数 + SHA-256 ハッシュ保存
 *
 * `enc:v1:` のバージョンプレフィックスにより、
 *   (a) 暗号化前の平文との共存
 *   (b) 鍵ローテーション（v1 → v2 への段階移行）
 * が可能になる。
 */

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from "node:crypto";
import { config } from "./config";

// ---------------------------------------------------------------------------
// パスワード
// ---------------------------------------------------------------------------

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  // hex として解釈できない文字は黙って落ちるため、空バッファを明示的に拒否する。
  // これを怠ると「壊れたハッシュ vs 任意のパスワード」が空 == 空 で一致してしまう。
  if (salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, SCRYPT_PARAMS);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  // タイミング攻撃対策: 長さが同じ場合のみ定数時間比較
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// フィールド暗号化（AES-256-GCM）
// ---------------------------------------------------------------------------

const ENC_PREFIX = "enc:v1:";

/**
 * 開発用の固定鍵。
 * 本番で ENCRYPTION_KEY 未設定の場合は config.assertProductionConfig() が警告を出す。
 * この鍵は公開されているため、本番で使えば実質的に暗号化していないのと同じ。
 */
const DEV_KEY = createHash("sha256").update("btc-cloud-miner:dev-key").digest();

function getKey(): Buffer {
  if (!config.encryptionKey) return DEV_KEY;
  const key = Buffer.from(config.encryptionKey, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY は 32 バイト（hex 64 文字）である必要があります");
  }
  return key;
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** 平文がそのまま渡された場合はそのまま返す（暗号化導入前のデータとの共存） */
export function decryptField(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value;
  const [iv, tag, ct] = value.slice(ENC_PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

// ---------------------------------------------------------------------------
// トークン
// ---------------------------------------------------------------------------

/** セッショントークン等。Cookie にのみ入れ、DB にはハッシュを保存する */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  const h = createHash("sha256");
  h.update(token);
  if (config.sessionPepper) h.update(config.sessionPepper);
  return h.digest("hex");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacHex(key: string, input: string): string {
  return createHmac("sha256", key).update(input).digest("hex");
}

/** 疑似 UUID（crypto.randomUUID が使える環境ではそちらを使う） */
export function newId(): string {
  return randomBytes(16).toString("hex");
}
