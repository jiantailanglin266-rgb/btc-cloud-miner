/**
 * Next.js 16 の `proxy`（旧 middleware）
 *
 * Next.js 16 で `middleware.ts` は `proxy.ts` に改称され、
 * export する関数名も `proxy` になった。ランタイムは nodejs 固定（edge 非対応）。
 *
 * ここでやること:
 *   1. Host からテナント slug を解決し、下流へヘッダで渡す
 *   2. 認証が必要なパスの未ログインアクセスを /login へ飛ばす（体感速度のため）
 *   3. 管理画面の IP 許可リスト
 *
 * ★ ここでの認証チェックは「UX のための早期リダイレクト」に過ぎない。
 *   本当の認可は必ず各ページ・各 API で行う（proxy を素通りされても守れるように）。
 */

import { NextResponse, type NextRequest } from "next/server";

const TENANT_HEADER = "x-bcm-tenant-slug";
const SESSION_COOKIE = "bcm_session";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/mining",
  "/revenue",
  "/wallet",
  "/contracts",
  "/network",
  "/notifications",
  "/support",
  "/settings",
  "/admin",
];

function extractSlug(host: string | null): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();
  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  const parts = hostname.split(".");
  if (parts.length < 3) return null;
  const slug = parts[0];
  return slug === "www" || slug === "app" ? null : slug;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- 管理画面の IP 制限 ---------------------------------------------------
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const allowlist = (process.env.ADMIN_IP_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowlist.length > 0) {
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        request.headers.get("x-real-ip") ??
        "";
      if (!allowlist.includes(ip)) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    }
  }

  // --- 未ログインの早期リダイレクト ---------------------------------------
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isProtected && !request.cookies.get(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // --- テナント解決 --------------------------------------------------------
  const slug = extractSlug(request.headers.get("host"));
  const requestHeaders = new Headers(request.headers);
  // クライアントが偽装ヘッダを送ってきても、必ずここで上書きする
  requestHeaders.delete(TENANT_HEADER);
  if (slug) requestHeaders.set(TENANT_HEADER, slug);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // 静的アセットと画像最適化を除く全パス
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
