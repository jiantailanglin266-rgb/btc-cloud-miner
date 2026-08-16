import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { runOpportunityScan } from "@/modules/arbitrage/scanner";
import { isReadOnly } from "@/modules/auth/rbac";
import { ArbitragePanel } from "./ArbitragePanel";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { config } from "@/lib/config";

export const metadata = { title: "Hashrate Arbitrage" };
export const dynamic = "force-dynamic";

export default async function AdminArbitragePage() {
  const ctx = await requireSession();
  const store = await getStore();

  // 表示時に 1 回スキャンを実行（DecisionSnapshot も保存される）
  const scan = await runOpportunityScan(ctx.tenant.id);
  const [state, orders, history] = await Promise.all([
    store.getArbitrageState(ctx.tenant.id),
    store.listHashpowerOrders(ctx.tenant.id, { limit: 20 }),
    store.listDecisionSnapshots(ctx.tenant.id, 30),
  ]);

  return (
    <>
      <PageHeader
        title="Hashrate Arbitrage（NiceHash）"
        description="期待マイニング収益とハッシュパワー購入コストのスプレッド監視・自動判定"
      />

      <Card className="mb-4">
        <CardTitle>このシステムの判定原則</CardTitle>
        <ul className="space-y-1 text-xs leading-relaxed text-ink-muted">
          <li>・期待収益 − コスト − 安全マージン（現在 {(state.safetyMarginRate * 100).toFixed(1)}%・予測誤差に応じて自動調整）が閾値を超えた場合のみ BUY</li>
          <li>・Hysteresis: 開始 {(state.startMarginRate * 100).toFixed(0)}% / 停止 {(state.stopMarginRate * 100).toFixed(0)}%（頻繁な ON/OFF を防止）</li>
          <li>・break-even を超える Bid は構造的に不可能。全資金投入も不可能（資金の最大10%×状況係数）</li>
          <li>・すべての判定は入力値つきで記録され、後から「なぜ買った/買わなかった」を検証できます</li>
          <li>・NICEHASH_MODE={config.nicehash.mode} / 実注文 Kill Switch: {config.nicehash.tradingEnabled ? "有効" : "無効（既定）"}</li>
          <li className="text-warn">・期待値は保証ではありません。市場条件により損失が発生する可能性があります</li>
        </ul>
      </Card>

      <ArbitragePanel
        scan={scan}
        state={state}
        orders={orders}
        history={history}
        readOnly={isReadOnly(ctx.user)}
        mode={config.nicehash.mode}
      />
    </>
  );
}
