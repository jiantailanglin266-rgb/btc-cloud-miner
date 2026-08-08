import { requireSession } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { getBalance } from "@/modules/wallet/ledger";
import { getWalletProvider } from "@/modules/wallet";
import { getPrice } from "@/modules/bitcoin/service";
import { WalletClient } from "./WalletClient";
import { Card, CardTitle, PageHeader, Stat, DemoNotice } from "@/components/ui";
import { formatUsd, formatBtc } from "@/lib/format";
import { config } from "@/lib/config";

export const metadata = { title: "ウォレット" };
export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const ctx = await requireSession();
  const store = await getStore();

  const [balance, addresses, withdrawals, price] = await Promise.all([
    getBalance(ctx.tenant.id, ctx.user.id),
    store.listAddresses(ctx.tenant.id, ctx.user.id),
    store.listWithdrawals(ctx.tenant.id, { userId: ctx.user.id }),
    getPrice(),
  ]);

  const walletProvider = getWalletProvider();

  return (
    <>
      <PageHeader
        title="ウォレット"
        description="マイニング報酬の残高と出金の管理"
      />

      {!walletProvider.isLive && (
        <div className="mb-4">
          <DemoNotice>
            現在のウォレットプロバイダーは <code>{walletProvider.name}</code>{" "}
            です。<strong>実際の Bitcoin 送金・署名は一切行われません。</strong>
            本番運用時は、カストディ事業者または HSM を接続してください（WALLET_PROVIDER_MODE=custody）。
          </DemoNotice>
        </div>
      )}

      {!config.wallet.withdrawalEnabled && (
        <div className="mb-4 rounded-xl border border-neg/40 bg-neg/10 px-3 py-2 text-xs text-neg">
          現在、出金機能を一時停止しています。
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Available"
          value={formatBtc(balance.availableBtc)}
          sub={formatUsd(Number(balance.availableBtc) * price.usd)}
          tone="brand"
        />
        <Stat
          label="Locked（処理中）"
          value={formatBtc(balance.lockedBtc)}
          sub={formatUsd(Number(balance.lockedBtc) * price.usd)}
        />
        <Stat
          label="累計獲得"
          value={formatBtc(balance.lifetimeEarnedBtc)}
          sub={formatUsd(Number(balance.lifetimeEarnedBtc) * price.usd)}
          tone="pos"
        />
        <Stat
          label="累計出金"
          value={formatBtc(balance.lifetimeWithdrawnBtc)}
          sub={formatUsd(Number(balance.lifetimeWithdrawnBtc) * price.usd)}
        />
      </div>

      <div className="mt-4">
        <WalletClient
          initial={{ balance, addresses, withdrawals }}
          settings={{
            minWithdrawalBtc: ctx.settings.minWithdrawalBtc,
            withdrawalFeeBtc: ctx.settings.withdrawalFeeBtc,
            addressCooldownHours: ctx.settings.addressCooldownHours,
            twoApproverThresholdBtc: ctx.settings.withdrawalTwoApproverThresholdBtc,
          }}
          twoFactorEnabled={ctx.user.twoFactorEnabled}
          kycStatus={ctx.user.kycStatus}
          withdrawalEnabled={config.wallet.withdrawalEnabled}
          btcPriceUsd={price.usd}
        />
      </div>

      <Card className="mt-4">
        <CardTitle>秘密鍵の取り扱いについて</CardTitle>
        <ul className="space-y-1.5 text-xs leading-relaxed text-ink-muted">
          <li>
            ・本システムは<strong className="text-ink">お客様および当社の秘密鍵を一切保持していません</strong>。
            送金の署名は、外部のカストディ事業者または HSM の内部でのみ行われます。
          </li>
          <li>
            ・出金先アドレスは登録から {ctx.settings.addressCooldownHours}{" "}
            時間が経過するまで利用できません（アカウント乗っ取り時の即時持ち出しを防ぐため）。
          </li>
          <li>
            ・{ctx.settings.withdrawalTwoApproverThresholdBtc} BTC
            を超える出金、または異常検知でフラグが立った出金は、管理者2名の承認が必要です。
          </li>
          <li>・出金の申請者と承認者は必ず別人になります（申請者本人は承認できません）。</li>
        </ul>
      </Card>
    </>
  );
}
