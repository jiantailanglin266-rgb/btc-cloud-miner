/**
 * NiceHash API 署名（フェーズ3）
 *
 * ★ 公式実装（github.com/nicehash/rest-clients-demo javascript/api.js）を
 *   2026-08-14 に取得して確認した仕様に基づく。推測ではない。
 *
 * 署名: HMAC-SHA256（鍵 = apiSecret）で以下を 0x00 区切りで連結した入力に対して計算:
 *   apiKey \0 time \0 nonce \0 \0 organizationId \0 \0 method \0 path \0 query [\0 body]
 *   （query が無ければ空文字。body が無ければ最後の \0 body 自体を付けない）
 *
 * ヘッダ:
 *   X-Time: サーバー時刻(ms)   X-Nonce: 32文字乱数   X-Organization-Id
 *   X-Request-Id: nonce と同値   X-Auth: `${apiKey}:${hexSignature}`
 *
 * ★ apiSecret はこのモジュールの引数としてのみ受け取り、ログ・例外メッセージに含めない。
 */

import { createHmac, randomBytes } from "node:crypto";

export type NicehashCredentials = {
  apiKey: string;
  apiSecret: string;
  organizationId: string;
};

export type SignedRequestInput = {
  method: string;
  /** クエリを含まないパス（例 /main/api/v2/hashpower/order） */
  path: string;
  /** URL エンコード済みクエリ文字列（例 algorithm=SHA256ASICBOOST）。無ければ "" */
  query: string;
  /** JSON 文字列化済み body。無ければ null */
  body: string | null;
  timeMs: number;
  nonce: string;
};

export function createNonce(): string {
  // 公式実装は 32 文字の英数字。暗号乱数から生成する
  return randomBytes(24).toString("base64url").slice(0, 32);
}

/** 署名本体（純関数・テスト対象） */
export function buildSignature(creds: NicehashCredentials, req: SignedRequestInput): string {
  const h = createHmac("sha256", creds.apiSecret);
  const NUL = Buffer.from([0]);

  h.update(creds.apiKey);
  h.update(NUL);
  h.update(String(req.timeMs));
  h.update(NUL);
  h.update(req.nonce);
  h.update(NUL);
  h.update(NUL); // 空フィールド（公式実装どおり）
  h.update(creds.organizationId);
  h.update(NUL);
  h.update(NUL); // 空フィールド
  h.update(req.method.toUpperCase());
  h.update(NUL);
  h.update(req.path);
  h.update(NUL);
  h.update(req.query ?? "");
  if (req.body !== null && req.body !== undefined) {
    h.update(NUL);
    h.update(req.body);
  }
  return h.digest("hex");
}

/** リクエストヘッダ一式を構築する */
export function buildAuthHeaders(
  creds: NicehashCredentials,
  req: SignedRequestInput,
): Record<string, string> {
  const signature = buildSignature(creds, req);
  return {
    "X-Time": String(req.timeMs),
    "X-Nonce": req.nonce,
    "X-Request-Id": req.nonce,
    "X-Organization-Id": creds.organizationId,
    "X-Auth": `${creds.apiKey}:${signature}`,
    "X-User-Agent": "btc-cloud-miner/1.0",
    Accept: "application/json",
  };
}
