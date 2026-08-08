/**
 * CustomerOwnedMinerProvider — 顧客保有 ASIC の接続（接続モデル B）
 *
 * 顧客が自宅・自社に持つ ASIC を本システムで監視・収益管理するモデル。
 *
 * 仕組み:
 *   顧客の ASIC はインターネットから直接見えない（見えてはいけない）。
 *   そのため顧客は自分のマイニングプールアカウントを本システムに接続する。
 *   つまり実体は「顧客のプールアカウントを read-only で読む」ことであり、
 *   既存のプールアダプタ（Braiins / F2Pool / Generic REST）へ委譲する。
 *
 *   このアダプタの役割は:
 *     1. 委譲先プールアダプタの生成（provider.poolName で種別を指定）
 *     2. 「これは顧客保有設備であり、電力・保守は顧客responsibility」という
 *        文脈の付与（配賦時に electricityCostTreatment=USER_PAYS が既定）
 *
 * ★ 顧客の ASIC へ本システムから直接コマンドを送る機能は意図的に作らない。
 *   （遠隔操作は事故時の責任範囲が曖昧になり、攻撃対象にもなるため。
 *    再起動等の操作は顧客自身が行う）
 */

import type { MiningProvider, PoolBalance } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
  RawPayout,
} from "../interface";
import { BraiinsPoolAdapter } from "./braiins";
import { F2PoolAdapter } from "./f2pool";
import { PoolRestAdapter } from "./pool-rest";

/** poolName フィールドで委譲先プールを指定する */
const DELEGATE_KINDS = ["braiins", "f2pool", "generic"] as const;
export type DelegateKind = (typeof DELEGATE_KINDS)[number];

export class CustomerOwnedMinerAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "CUSTOMER_OWNED" as const;
  readonly isLive = true;

  private readonly delegate: MiningProviderAdapter;

  /** 委譲先が対応している場合のみ定義される（Facade が undefined 判定で分岐する） */
  getPoolBalance?: () => Promise<PoolBalance>;
  getPayoutHistory?: (sinceMs?: number) => Promise<RawPayout[]>;

  constructor(provider: MiningProvider) {
    this.id = provider.id;
    this.name = provider.name;

    const delegateKind = (provider.poolName || "generic").toLowerCase() as DelegateKind;
    // 委譲先アダプタには同じ provider 設定（endpoint / credentialsRef）を渡す
    switch (delegateKind) {
      case "braiins":
        this.delegate = new BraiinsPoolAdapter(provider);
        break;
      case "f2pool":
        this.delegate = new F2PoolAdapter(provider);
        break;
      case "generic":
        this.delegate = new PoolRestAdapter(provider);
        break;
      default:
        throw new Error(
          `顧客保有マイナーの委譲先プールが不明です: ${String(delegateKind)}。` +
            `provider.poolName に ${DELEGATE_KINDS.join(" / ")} のいずれかを設定してください。`,
        );
    }

    // 委譲先が対応するケイパビリティだけを公開する（未対応を 0 でごまかさない）
    const d = this.delegate;
    if (d.getPoolBalance) this.getPoolBalance = () => d.getPoolBalance!.call(d);
    if (d.getPayoutHistory)
      this.getPayoutHistory = (sinceMs?: number) => d.getPayoutHistory!.call(d, sinceMs);
  }

  fetchWorkers(): Promise<ProviderFetchResult> {
    return this.delegate.fetchWorkers();
  }

  healthCheck(): Promise<ProviderHealthResult> {
    return this.delegate.healthCheck();
  }
}
