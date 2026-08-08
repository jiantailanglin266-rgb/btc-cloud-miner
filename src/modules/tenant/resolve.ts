/**
 * テナント解決（マルチテナント）
 *
 * ★ セキュリティ上の最重要ルール ★
 *   tenantId は必ずサーバー側で Host ヘッダから解決する。
 *   リクエストボディやクエリの tenantId は一切信用しない。
 *   （信用すると、他テナントの ID を送るだけでデータが読めてしまう）
 *
 * 解決順:
 *   1. Host のサブドメイン（acme.example.com → slug "acme"）
 *   2. 開発用のパスプレフィックス（/t/acme）※開発環境のみ
 *   3. 既定テナント
 */

import { headers } from "next/headers";
import type { Tenant, TenantSettings, TenantBranding } from "@/types";
import { getStore } from "@/lib/store";
import { config } from "@/lib/config";

/** proxy.ts が下流へ渡すヘッダ名 */
export const TENANT_HEADER = "x-bcm-tenant-slug";

/** localhost / IP アドレス / 単一ラベルのホストはサブドメインを持たないとみなす */
export function extractSlugFromHost(host: string | null): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();
  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;

  const parts = hostname.split(".");
  // acme.example.com → 3 パート。example.com → 2 パート（サブドメインなし）
  if (parts.length < 3) return null;
  const slug = parts[0];
  if (slug === "www" || slug === "app") return null;
  return slug;
}

export async function resolveTenant(): Promise<Tenant> {
  const store = await getStore();
  const h = await headers();

  // proxy.ts が解決済みの slug を渡していればそれを使う
  const fromProxy = h.get(TENANT_HEADER);
  if (fromProxy) {
    const t = await store.getTenantBySlug(fromProxy);
    if (t && t.status !== "SUSPENDED") return t;
  }

  const slug = extractSlugFromHost(h.get("host"));
  if (slug) {
    const t = await store.getTenantBySlug(slug);
    if (t && t.status !== "SUSPENDED") return t;
  }

  return store.getDefaultTenant();
}

export async function resolveTenantSettings(): Promise<{
  tenant: Tenant;
  settings: TenantSettings;
}> {
  const tenant = await resolveTenant();
  const store = await getStore();
  const settings = await store.getTenantSettings(tenant.id);
  return { tenant, settings };
}

export function toBranding(tenant: Tenant, settings: TenantSettings): TenantBranding {
  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    brandName: settings.brandName || config.brandName,
    logoText: settings.logoText,
    colorPrimary: settings.colorPrimary,
    colorAccent: settings.colorAccent,
  };
}

/**
 * テナントのカラーを CSS 変数として出力する。
 * ★ 値は必ず #RRGGBB 形式に検証済みのものだけを渡すこと（CSS インジェクション防止）。
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

export function brandingCssVars(branding: TenantBranding): Record<string, string> {
  const primary = HEX.test(branding.colorPrimary) ? branding.colorPrimary : "#f7931a";
  const accent = HEX.test(branding.colorAccent) ? branding.colorAccent : "#2f7cff";
  return {
    "--brand-primary": primary,
    "--brand-accent": accent,
  };
}
