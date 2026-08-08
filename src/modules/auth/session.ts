/**
 * セッション管理（サーバー専用）
 *
 * JWT ではなくサーバー側セッションを採用している。
 * 理由: 金銭を扱うため「即時失効できる」ことが必須。JWT は有効期限まで失効させられない。
 *
 * Next.js 16 では cookies() が非同期なので、必ず await する。
 */

import { cookies } from "next/headers";
import type { Session, User, Tenant, TenantSettings } from "@/types";
import { getStore } from "@/lib/store";
import { generateToken, hashToken, newId } from "@/lib/crypto";
import { config } from "@/lib/config";

export const SESSION_COOKIE = "bcm_session";
export const CSRF_COOKIE = "bcm_csrf";

/** 絶対有効期限 */
const SESSION_MAX_AGE_SEC = 30 * 24 * 3600;
/** アイドルタイムアウト */
const SESSION_IDLE_SEC = 12 * 3600;
/** step-up 認証の有効時間。この時間内に 2FA を通っていれば出金等を許可する */
export const STEP_UP_WINDOW_SEC = 300;

export type SessionContext = {
  session: Session;
  user: User;
  tenant: Tenant;
  settings: TenantSettings;
};

// ---------------------------------------------------------------------------
// 発行・破棄
// ---------------------------------------------------------------------------

export async function createSessionForUser(
  user: User,
  opts: { ip?: string | null; userAgent?: string | null; twoFactorVerified: boolean },
): Promise<{ session: Session; token: string; csrfToken: string }> {
  const store = await getStore();
  const token = generateToken(32);
  const now = Date.now();

  const session: Session = {
    id: newId(),
    userId: user.id,
    tenantId: user.tenantId,
    tokenHash: hashToken(token),
    twoFactorVerifiedAt: opts.twoFactorVerified ? new Date(now).toISOString() : null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_MAX_AGE_SEC * 1000).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
  };
  await store.createSession(session);

  const csrfToken = generateToken(24);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  // CSRF は double-submit 方式なので httpOnly にしない（JS から読んでヘッダに載せる）
  jar.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });

  return { session, token, csrfToken };
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const store = await getStore();
    const session = await store.getSessionByTokenHash(hashToken(token));
    if (session) await store.deleteSession(session.id);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

// ---------------------------------------------------------------------------
// 取得・検証
// ---------------------------------------------------------------------------

/**
 * 現在のセッションを取得する。
 * 無効・期限切れ・アイドル超過・ユーザー停止のいずれかなら null。
 *
 * ★ 権限（role）はセッションにキャッシュせず、毎回 DB から取り直す。
 *   権限を剥奪した直後に旧権限で操作されるのを防ぐため。
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const store = await getStore();
  const session = await store.getSessionByTokenHash(hashToken(token));
  if (!session) return null;

  const now = Date.now();
  if (new Date(session.expiresAt).getTime() < now) {
    await store.deleteSession(session.id);
    return null;
  }
  if (now - new Date(session.lastSeenAt).getTime() > SESSION_IDLE_SEC * 1000) {
    await store.deleteSession(session.id);
    return null;
  }

  const user = await store.getUserByIdAnyTenant(session.userId);
  if (!user || user.deletedAt || user.status === "SUSPENDED") {
    await store.deleteSession(session.id);
    return null;
  }

  const tenant = await store.getTenantById(user.tenantId);
  if (!tenant || tenant.status === "SUSPENDED") return null;
  const settings = await store.getTenantSettings(user.tenantId);

  // lastSeenAt は 1 分に 1 回だけ更新する（書き込み負荷の削減）
  if (now - new Date(session.lastSeenAt).getTime() > 60_000) {
    await store.updateSession(session.id, { lastSeenAt: new Date(now).toISOString() });
  }

  return { session, user, tenant, settings };
}

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

export class UnauthorizedError extends Error {
  constructor(message = "ログインが必要です") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class StepUpRequiredError extends Error {
  constructor(message = "この操作には2段階認証の再確認が必要です") {
    super(message);
    this.name = "StepUpRequiredError";
  }
}

/**
 * step-up 認証の確認。
 * 出金・アドレス登録・2FA 無効化など、被害の大きい操作の直前に必ず呼ぶ。
 */
export function hasRecentTwoFactor(session: Session): boolean {
  if (!session.twoFactorVerifiedAt) return false;
  const age = Date.now() - new Date(session.twoFactorVerifiedAt).getTime();
  return age <= STEP_UP_WINDOW_SEC * 1000;
}

export async function markTwoFactorVerified(sessionId: string): Promise<void> {
  const store = await getStore();
  await store.updateSession(sessionId, {
    twoFactorVerifiedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

/**
 * double-submit トークン方式の検証。
 * Cookie の値とリクエストヘッダの値が一致することを求める。
 * 攻撃者は他オリジンから Cookie を読めないため、ヘッダを合わせられない。
 */
export async function verifyCsrf(req: Request): Promise<boolean> {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  // Sec-Fetch-Site による多層防御（対応ブラウザでは cross-site を弾ける）
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const jar = await cookies();
  const cookieToken = jar.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get("x-csrf-token");
  if (!cookieToken || !headerToken) return false;
  return cookieToken === headerToken;
}
