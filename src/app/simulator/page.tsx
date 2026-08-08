import Link from "next/link";
import { getNetworkAndPrice, isMockData } from "@/modules/bitcoin/service";
import { resolveTenantSettings } from "@/modules/tenant/resolve";
import { getSessionContext } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { SimulatorClient } from "./SimulatorClient";
import { Badge } from "@/components/ui";

export const metadata = { title: "収益シミュレーター" };
export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const [{ network, price }, { settings }, ctx] = await Promise.all([
    getNetworkAndPrice(),
    resolveTenantSettings(),
    getSessionContext(),
  ]);

  // ログイン済みなら自分の契約値をプリセットする
  let presetHashrateThs = 500;
  if (ctx) {
    const store = await getStore();
    const contracts = await store.listContracts(ctx.tenant.id, ctx.user.id);
    const active = contracts.filter((c) => c.status === "ACTIVE");
    if (active.length > 0) {
      presetHashrateThs = active.reduce((s, c) => s + c.hashrateThs, 0);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold sm:text-xl">収益シミュレーター</h1>
            {isMockData(network.freshness) && <Badge tone="demo">デモ値</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            条件を変えると結果がその場で再計算されます。
            <strong className="text-ink">これはシミュレーションであり、収益の保証ではありません。</strong>
          </p>
        </div>
        <Link
          href={ctx ? "/dashboard" : "/"}
          className="rounded-xl border border-line-strong bg-white/5 px-4 py-2 text-sm"
        >
          {ctx ? "ダッシュボードへ" : "トップへ"}
        </Link>
      </div>

      <SimulatorClient
        defaults={{
          hashrateThs: presetHashrateThs,
          efficiencyJPerTh: 17.5,
          electricityPriceKwh: settings.electricityPriceKwh,
          btcPriceUsd: price.usd,
          difficulty: network.difficulty,
          networkHashrateThs: network.networkHashrateThs,
          blockRewardBtc: network.blockRewardBtc,
          poolFeeRate: settings.poolFeeRate,
          platformFeeRate: settings.platformFeeRate,
          uptimeRate: 0.985,
          upfrontCostUsd: 3000,
        }}
        networkSource={network.freshness.source}
      />
    </main>
  );
}
