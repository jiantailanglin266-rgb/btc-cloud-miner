import Link from "next/link";
import { resolveTenantSettings, toBranding } from "@/modules/tenant/resolve";
import { getNetworkAndPrice } from "@/modules/bitcoin/service";
import { getStore } from "@/lib/store";
import { calculateRevenue } from "@/modules/revenue/engine";
import { Badge, Card, DemoNotice } from "@/components/ui";
import { formatHashrate, formatUsd, formatCompact, formatPercent } from "@/lib/format";
import { isDemoMode } from "@/lib/config";
import { DEMO_ACCOUNTS } from "@/lib/store";

export default async function LandingPage() {
  const { tenant, settings } = await resolveTenantSettings();
  const branding = toBranding(tenant, settings);
  const store = await getStore();
  const [{ network, price }, plans] = await Promise.all([
    getNetworkAndPrice(),
    store.listPlans(tenant.id),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      {/* ヘッダー */}
      <header className="mb-14 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] text-lg font-bold text-black">
            {branding.logoText}
          </span>
          <span className="text-base font-semibold tracking-tight">{branding.brandName}</span>
          {isDemoMode() && <Badge tone="demo">DEMO</Badge>}
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/simulator" className="rounded-lg px-3 py-2 text-ink-muted hover:text-ink">
            収益シミュレーター
          </Link>
          <Link href="/login" className="rounded-lg px-3 py-2 text-ink-muted hover:text-ink">
            ログイン
          </Link>
          <Link
            href="/register"
            className="rounded-xl bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] px-4 py-2 font-medium text-black"
          >
            無料で始める
          </Link>
        </nav>
      </header>

      {/* ヒーロー */}
      <section className="mb-16">
        <Badge tone="brand" dot>
          ASIC / SHA-256 クラウドマイニング管理
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
          ASIC を<span className="text-gradient">買わず・置かず・触らず</span>に、
          <br />
          マイニングを運用する。
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
          Bitcoin の採掘には実際の SHA-256 ハッシュ計算が必要です。それは変えられません。
          <br className="hidden sm:block" />
          本サービスが変えるのは、<strong className="text-ink">
            そのための設備をあなた自身が購入・設置・保守する必要
          </strong>
          です。
          <br className="hidden sm:block" />
          外部の ASIC ファーム・マイニングプール・ハッシュレートプロバイダーを API と Stratum
          で統合し、稼働状況・収益・コスト・出金までをブラウザ 1 画面に集約します。
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/register"
            className="rounded-xl bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] px-5 py-2.5 text-sm font-medium text-black"
          >
            アカウントを作成
          </Link>
          <Link
            href="/simulator"
            className="rounded-xl border border-line-strong bg-white/5 px-5 py-2.5 text-sm"
          >
            収益をシミュレーションする
          </Link>
        </div>

        {isDemoMode() && (
          <div className="mt-6 max-w-2xl">
            <DemoNotice>
              これはデモ環境です。マイニング統計は動作確認用の擬似データで、実際の設備には接続していません。
              デモアカウント: <code className="text-purple-100">{DEMO_ACCOUNTS.user.email}</code> /{" "}
              <code className="text-purple-100">{DEMO_ACCOUNTS.user.password}</code>
              （管理者: <code className="text-purple-100">{DEMO_ACCOUNTS.admin.email}</code> /{" "}
              <code className="text-purple-100">{DEMO_ACCOUNTS.admin.password}</code>）
            </DemoNotice>
          </div>
        )}
      </section>

      {/* ネットワーク状況 */}
      <section className="mb-16">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">
          Bitcoin ネットワークの現在値
          {network.freshness.source.startsWith("mock") && (
            <span className="ml-2 text-xs text-purple-300">（デモ値）</span>
          )}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Network Difficulty" value={formatCompact(network.difficulty)} />
          <MiniStat
            label="Network Hashrate"
            value={formatHashrate(network.networkHashrateThs, 1)}
          />
          <MiniStat label="Block Height" value={network.blockHeight.toLocaleString()} />
          <MiniStat label="Block Reward" value={`${network.blockRewardBtc} BTC`} />
          <MiniStat label="BTC Price" value={formatUsd(price.usd, 0)} />
          <MiniStat
            label="次回難易度調整"
            value={`${network.blocksUntilAdjustment.toLocaleString()} ブロック後`}
          />
          <MiniStat
            label="推定変化率"
            value={formatPercent(network.estimatedAdjustmentRate, 2)}
          />
          <MiniStat label="Mempool" value={`${formatCompact(network.mempoolTxCount, 1)} tx`} />
        </div>
      </section>

      {/* 何が見えるか */}
      <section className="mb-16">
        <h2 className="mb-5 text-xl font-semibold">1 画面で運用に必要なすべてを</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            title="リアルタイム稼働監視"
            body="契約ハッシュレート・実効ハッシュレート・稼働台数・温度・shares を秒単位で可視化。ワーカー停止は即座に検知して通知します。"
          />
          <Feature
            title="収益の完全な内訳"
            body="総収益から電力コスト・プール手数料・プラットフォーム手数料を差し引いた純収益まで、すべての内訳を開示します。"
          />
          <Feature
            title="損益分岐点の常時表示"
            body="BTC 価格・電力単価がいくらを下回ると赤字になるかを常に表示。感度分析（価格 -50% / 難易度 +30%）も併せて確認できます。"
          />
          <Feature
            title="プロバイダー非依存"
            body="複数の ASIC ファーム・プールをアダプタ方式で統合。1 社が停止しても他社のデータは表示され続けます。"
          />
          <Feature
            title="安全な出金フロー"
            body="2段階認証・アドレスクールダウン・異常検知・管理者の複数名承認。秘密鍵はシステムに保持しません。"
          />
          <Feature
            title="AI 運用最適化"
            body="ハッシュレートの統計的異常・reject 率の上昇・温度リスク・劣化トレンドを検知し、根拠となる数値とともに推奨アクションを提示します。"
          />
        </div>
      </section>

      {/* プラン */}
      <section className="mb-16">
        <h2 className="mb-2 text-xl font-semibold">契約プラン</h2>
        <p className="mb-5 text-sm text-ink-muted">
          下の推定収益は、現在のネットワーク難易度・BTC 価格・電力単価
          {settings.electricityPriceKwh}/kWh を前提とした
          <strong className="text-ink">推定値</strong>です。
          難易度と価格は常に変動するため、実際の収益は増減し、条件によっては赤字になります。
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const revenue = calculateRevenue({
              hashrateThs: plan.hashrateThs,
              networkHashrateThs: network.networkHashrateThs,
              difficulty: network.difficulty,
              blockRewardBtc: network.blockRewardBtc,
              btcPriceUsd: price.usd,
              electricityPriceKwh: plan.electricityPriceKwh,
              efficiencyJPerTh: 17.5,
              poolFeeRate: plan.poolFeeRate,
              platformFeeRate: plan.platformFeeRate,
              uptimeRate: 0.985,
              upfrontCostUsd: plan.priceUsd,
            });
            const profitable = revenue.netRevenueUsdPerDay > 0;
            const roiWithinTerm =
              revenue.roiDays !== null && revenue.roiDays <= plan.termDays;

            return (
              <Card key={plan.id} className="flex flex-col">
                <div className="text-xs text-ink-muted">{plan.name}</div>
                <div className="mt-1 text-2xl font-semibold text-brand">
                  {formatHashrate(plan.hashrateThs, 0)}
                </div>
                <div className="mt-0.5 text-xs text-ink-dim">
                  {plan.termDays} 日間 / {formatUsd(plan.priceUsd, 0)}
                </div>
                <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
                  <Row
                    label="推定 BTC / 月"
                    value={revenue.estimatedBtcPerMonth.toFixed(8)}
                  />
                  <Row
                    label="推定 純収益 / 日"
                    value={formatUsd(revenue.netRevenueUsdPerDay)}
                    tone={profitable ? "pos" : "neg"}
                  />
                  <Row
                    label="損益分岐 BTC 価格"
                    value={formatUsd(revenue.breakEvenBtcPriceUsd, 0)}
                  />
                  <Row
                    label="初期費用の回収"
                    value={
                      revenue.roiDays === null
                        ? "回収不能"
                        : `${Math.ceil(revenue.roiDays).toLocaleString()} 日`
                    }
                    tone={roiWithinTerm ? "pos" : "neg"}
                  />
                </dl>
                {!roiWithinTerm && (
                  <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn">
                    現在の条件では、初期費用が契約期間内に回収できない見込みです。
                    条件が改善しない限り損失となる可能性があります。
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* 免責 */}
      <section className="mb-12">
        <Card className="border-warn/30 bg-warn/5">
          <h2 className="mb-2 text-sm font-medium text-warn">リスクに関する重要な説明</h2>
          <ul className="space-y-1.5 text-xs leading-relaxed text-ink-muted">
            <li>
              ・本サービスはハッシュレートの利用に関する役務であり、投資商品ではありません。元本保証・利回り保証は一切ありません。
            </li>
            <li>
              ・表示される収益はすべて<strong className="text-ink">推定値</strong>です。
              ネットワーク難易度の上昇、BTC 価格の下落、設備の停止、電力価格の変動により、
              実際の収益は大きく減少し、<strong className="text-ink">損失が発生する可能性があります</strong>。
            </li>
            <li>
              ・Bitcoin のブロック報酬は約 4
              年ごとに半減します。次回の半減期以降、同じハッシュレートで得られる BTC
              は半分になります。
            </li>
            <li>
              ・Bitcoin の採掘には実際の SHA-256
              計算資源が必要です。計算せずに BTC を得られる仕組みは存在しません。
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <Link href="/legal/risk" className="text-accent hover:underline">
              リスク開示
            </Link>
            <Link href="/legal/terms" className="text-accent hover:underline">
              利用規約
            </Link>
            <Link href="/legal/privacy" className="text-accent hover:underline">
              プライバシーポリシー
            </Link>
          </div>
        </Card>
      </section>

      <footer className="border-t border-line pt-6 text-xs text-ink-dim">
        <p>
          {branding.brandName} — Bitcoin Cloud Mining Management Platform
          {isDemoMode() && "（デモ環境）"}
        </p>
      </footer>
    </main>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] text-ink-dim">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">{body}</p>
    </Card>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-dim">{label}</dt>
      <dd
        className={
          tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
}
