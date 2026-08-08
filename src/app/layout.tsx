import type { Metadata, Viewport } from "next";
import "./globals.css";
import { resolveTenantSettings, toBranding, brandingCssVars } from "@/modules/tenant/resolve";
import { assertProductionConfig } from "@/lib/config";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await resolveTenantSettings();
  return {
    title: {
      default: `${settings.brandName} — Bitcoin クラウドマイニング管理`,
      template: `%s | ${settings.brandName}`,
    },
    description:
      "外部 ASIC マイニング設備・マイニングプール・ハッシュレートプロバイダーを統合し、" +
      "ブラウザから一元管理する SaaS 型マイニング管理プラットフォーム。",
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: "#05070d",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { tenant, settings } = await resolveTenantSettings();
  const branding = toBranding(tenant, settings);

  // 本番で危険な既定値が使われていたらサーバーログに警告を出す
  for (const w of assertProductionConfig()) {
    console.warn(`[config] ${w}`);
  }

  return (
    <html lang="ja" style={brandingCssVars(branding) as React.CSSProperties}>
      <body>
        <div className="bg-aurora" />
        <div className="bg-grid" />
        {children}
      </body>
    </html>
  );
}
