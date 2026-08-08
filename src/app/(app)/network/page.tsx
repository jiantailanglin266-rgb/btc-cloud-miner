import { getNetworkAndPrice, estimateNextAdjustmentAt, nextHalving, isMockData } from "@/modules/bitcoin/service";
import { Badge, Card, CardTitle, KeyValue, PageHeader, StaleNotice, DemoNotice } from "@/components/ui";
import { formatHashrate, formatCompact, formatUsd, formatJpy, formatPercent, formatDateTime } from "@/lib/format";

export const metadata = { title: "ネットワーク情報" };
export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const { network, price } = await getNetworkAndPrice();
  const halving = nextHalving(network);

  return (
    <>
      <PageHeader
        title="Bitcoin ネットワーク"
        description="採掘収益に直接影響するネットワークの状態"
      />

      {isMockData(network.freshness) && (
        <div className="mb-4">
          <DemoNotice>
            外部データソースが設定されていないため、デモ用の値を表示しています。
            実データを表示するには、環境変数 BITCOIN_SOURCE_PRIMARY（または BITCOIN_RPC_URL）を設定してください。
          </DemoNotice>
        </div>
      )}

      {network.freshness.stale && (
        <div className="mb-4">
          <StaleNotice ageSec={network.freshness.ageSec} source={network.freshness.source} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle
            hint={`取得元: ${network.freshness.source} · ${formatDateTime(network.freshness.fetchedAt)}`}
            action={
              <Badge tone={network.freshness.stale ? "degraded" : "online"} dot>
                {network.freshness.stale ? "STALE" : "FRESH"}
              </Badge>
            }
          >
            ネットワーク
          </CardTitle>
          <div className="divide-y divide-line">
            <KeyValue label="Difficulty" value={formatCompact(network.difficulty)} />
            <KeyValue
              label="Network Hashrate"
              value={formatHashrate(network.networkHashrateThs, 2)}
            />
            <KeyValue label="Block Height" value={network.blockHeight.toLocaleString()} />
            <KeyValue label="Block Reward" value={`${network.blockRewardBtc} BTC`} />
            <KeyValue label="Mempool" value={`${network.mempoolTxCount.toLocaleString()} tx`} />
            <KeyValue
              label="推奨手数料"
              value={`${network.recommendedFeeSatPerVb} sat/vB`}
            />
          </div>
        </Card>

        <Card>
          <CardTitle hint={`取得元: ${price.freshness.source}`}>BTC 価格</CardTitle>
          <div className="divide-y divide-line">
            <KeyValue label="USD" value={formatUsd(price.usd, 0)} />
            <KeyValue label="JPY" value={formatJpy(price.jpy)} />
            <KeyValue
              label="24時間変化"
              value={formatPercent(price.change24hRate, 2)}
              tone={price.change24hRate >= 0 ? "pos" : "neg"}
            />
          </div>
        </Card>

        <Card>
          <CardTitle hint="難易度は約2週間（2016ブロック）ごとに調整されます">
            次回の難易度調整
          </CardTitle>
          <div className="divide-y divide-line">
            <KeyValue
              label="残ブロック数"
              value={network.blocksUntilAdjustment.toLocaleString()}
            />
            <KeyValue
              label="推定日時"
              value={formatDateTime(estimateNextAdjustmentAt(network))}
            />
            <KeyValue
              label="推定変化率"
              value={formatPercent(network.estimatedAdjustmentRate, 2)}
              tone={network.estimatedAdjustmentRate > 0 ? "neg" : "pos"}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
            難易度が上がると、同じハッシュレートで採掘できる BTC
            は反比例して減少します。推定変化率が
            {formatPercent(network.estimatedAdjustmentRate, 2)} の場合、
            調整後の推定収益はおおよそ同じ割合だけ
            {network.estimatedAdjustmentRate > 0 ? "減少" : "増加"}します。
          </p>
        </Card>

        <Card>
          <CardTitle hint="約4年（21万ブロック）ごとにブロック報酬が半分になります">
            次回の半減期
          </CardTitle>
          <div className="divide-y divide-line">
            <KeyValue label="対象ブロック高" value={halving.height.toLocaleString()} />
            <KeyValue
              label="残ブロック数"
              value={halving.blocksRemaining.toLocaleString()}
            />
            <KeyValue label="推定日時" value={formatDateTime(halving.estimatedAt)} />
            <KeyValue
              label="半減後の報酬"
              value={`${halving.nextRewardBtc} BTC`}
              tone="neg"
            />
          </div>
          <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn">
            半減期を過ぎると、同じハッシュレートで得られる BTC
            は半分になります。長期契約を検討する際は、必ずこの点を織り込んでください。
          </p>
        </Card>
      </div>
    </>
  );
}
