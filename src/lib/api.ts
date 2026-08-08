/**
 * API レスポンスヘルパー。
 * 全ての Route Handler はこれを使う（形式を1箇所に集約するため）。
 * 仕様は API.md §1 と対応する。
 */

import { NextResponse } from "next/server";
import { newId } from "./crypto";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "TWO_FACTOR_REQUIRED"
  | "FORBIDDEN"
  | "KYC_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR";

type Meta = { requestId: string; generatedAt: string } & Record<string, unknown>;

function meta(extra?: Record<string, unknown>): Meta {
  return { requestId: newId(), generatedAt: new Date().toISOString(), ...extra };
}

export function ok<T>(data: T, extraMeta?: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data, meta: meta(extraMeta) }, init);
}

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, details }, meta: meta() },
    { status },
  );
}

export function validationError(details: unknown) {
  return apiError(400, "VALIDATION_ERROR", "入力内容を確認してください", details);
}

export function unauthorized(message = "ログインが必要です") {
  return apiError(401, "UNAUTHORIZED", message);
}

export function twoFactorRequired(message = "2段階認証が必要です") {
  return apiError(401, "TWO_FACTOR_REQUIRED", message);
}

export function forbidden(message = "この操作を行う権限がありません") {
  return apiError(403, "FORBIDDEN", message);
}

export function kycRequired(message = "本人確認が完了していません") {
  return apiError(403, "KYC_REQUIRED", message);
}

/**
 * 見つからない場合。
 * ★ 他テナント・他ユーザーのリソースにも 403 ではなく 404 を返す。
 *   403 を返すと「そのIDは存在する」という情報が漏れるため。
 */
export function notFound(message = "対象が見つかりません") {
  return apiError(404, "NOT_FOUND", message);
}

export function conflict(message: string) {
  return apiError(409, "CONFLICT", message);
}

export function unprocessable(message: string, details?: unknown) {
  return apiError(422, "UNPROCESSABLE", message, details);
}

export function tooManyRequests(retryAfterSec: number) {
  const res = apiError(
    429,
    "RATE_LIMITED",
    `リクエストが多すぎます。${retryAfterSec} 秒後に再試行してください`,
  );
  res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

export function dependencyUnavailable(message: string, retryAfterSec = 30) {
  const res = apiError(503, "DEPENDENCY_UNAVAILABLE", message);
  res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

export function internalError(err: unknown) {
  // 詳細はサーバーログにのみ出す。クライアントには返さない（情報漏洩の防止）
  console.error("[api] internal error:", err);
  return apiError(500, "INTERNAL_ERROR", "処理中にエラーが発生しました");
}

/** 外部データの鮮度をヘッダで伝える（UI が「古い値です」を出すため） */
export function withFreshness<T extends NextResponse>(
  res: T,
  freshness: { stale: boolean; ageSec: number },
): T {
  res.headers.set(
    "X-Data-Freshness",
    freshness.stale ? `stale:${freshness.ageSec}` : "fresh",
  );
  return res;
}

/** Route Handler を try-catch で包む。想定外の例外を 500 に正規化する */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return internalError(err);
    }
  };
}

export function getClientIp(req: Request): string | null {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip");
}
