import { requireSession } from "@/modules/auth/session";
import { runBacktest } from "@/modules/arbitrage/backtest";
import { Card, CardTitle, PageHeader, Badge } from "@/components/ui";
import { LineChart } from "@/components/charts/LineChart";

export const metadata = { title: "Backtest" };
export const dynamic = "force-dynamic";

const STRATEGY_LABEL: Record<string, string> = {
  buyHold: "A. BTC Buy & Hold",
  alwaysOn: "B. NiceHash Always-On",
  threshold: "C. Threshold Strategy",
  dynamic: "D. Dynamic Optimized",
};

export default async function AdminBacktestPage() {
  await requireSession();
  const toMs = Date.now();
  const fromMs = toMs - 365 * 86_400_000;
  const report = await runBacktest({ fromMs, toMs });

  return (
    <>
      <PageHeader
        title="Backtest（過去365日）"
        description="4戦略 × 資金3シナリオの比較。期待値シミュレーションであり将来の成果を保証しません"
      />

      {report.containsFixture && (
        <Card className="mb-4 border-purple-400/40 bg-purple-400/5">
          <p className="text-xs leading-relaxed text-purple-200">
            ⚠ このバックテストは<strong>合成データ（FIXTURE）</strong>を含みます。
            実際の NiceHash 市場・BTC 価格の履歴ではありません。scanner
            の運用で実サンプル（LIVE_API）が蓄積されると、実データでのバックテストに切り替わります。
          </p>
        </Card>
      )}

      {report.capitalScenariosJpy.map((capital) => {
        const rows = report.results.filter((r) => r.capitalJpy === capital);
        const best = [...rows].sort((a, b) => b.finalEquityJpy - a.finalEquityJpy)[0];
        return (
          <Card key={capital} className="mb-4">
            <CardTitle
              hint={`${report.samples.toLocaleString()} サンプル / ${report.fromIso.slice(0, 10)} 〜 ${report.toIso.slice(0, 10)}`}
            >
              資金 ¥{capital.toLocaleString()}
            </CardTitle>

            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>戦略</th><th>最終資産</th><th>純損益</th><th>ROI</th>
                    <th>採掘BTC</th><th>NHコスト</th><th>MaxDD</th>
                    <th>勝率</th><th>黒字時間率</th><th>注文数</th><th>平均マージン</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.strategy}>
                      <td>
                        {STRATEGY_LABEL[r.strategy]}
                        {best.strategy === r.strategy && (
                          <Badge tone="brand"> BEST</Badge>
                        )}
                      </td>
                      <td>¥{r.finalEquityJpy.toLocaleString()}</td>
                      <td className={r.netProfitJpy >= 0 ? "text-pos" : "text-neg"}>
                        ¥{r.netProfitJpy.toLocaleString()}
                      </td>
                      <td className={r.roiRate >= 0 ? "text-pos" : "text-neg"}>
                        {(r.roiRate * 100).toFixed(1)}%
                      </td>
                      <td className="text-[11px]">{r.btcMined.toFixed(6)}</td>
                      <td className="text-[11px]">{r.nicehashCostBtc.toFixed(6)}</td>
                      <td>{(r.maxDrawdownRate * 100).toFixed(1)}%</td>
                      <td>{(r.winRate * 100).toFixed(0)}%</td>
                      <td>{(r.profitableHoursRate * 100).toFixed(0)}%</td>
                      <td>{r.orders}</td>
                      <td>{(r.averageMarginRate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Equity Curves */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {rows.map((r) => (
                <div key={r.strategy}>
                  <div className="mb-1 text-xs text-ink-muted">
                    {STRATEGY_LABEL[r.strategy]}（Equity・JPY）
                  </div>
                  <LineChart
                    points={r.equityCurve.map((p) => ({ t: p.t, v: p.equityJpy }))}
                    unit="JPY"
                    height={140}
                    color={r.netProfitJpy >= 0 ? "pos" : "brand"}
                    caption={`${STRATEGY_LABEL[r.strategy]} の資産推移`}
                    formatValue={(v) => `¥${Math.round(v).toLocaleString()}`}
                  />
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}
