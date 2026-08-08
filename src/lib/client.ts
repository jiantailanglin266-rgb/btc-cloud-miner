"use client";

/**
 * クライアントから API を呼ぶための薄いラッパー。
 * CSRF トークン（double-submit）の付与を1箇所に集約する。
 */

export type ApiSuccess<T> = { ok: true; data: T; meta: Record<string, unknown> };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }

  const method = (init.method ?? (init.json !== undefined ? "POST" : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("bcm_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const res = await fetch(path, { ...init, method, headers, body });
  const json = (await res.json().catch(() => null)) as
    | ApiSuccess<T>
    | ApiFailure
    | null;

  if (!json) {
    throw new ApiError("INTERNAL_ERROR", "サーバーからの応答を解釈できませんでした", null, res.status);
  }
  if (!json.ok) {
    throw new ApiError(json.error.code, json.error.message, json.error.details, res.status);
  }
  return json.data;
}
