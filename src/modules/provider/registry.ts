/**
 * ProviderRegistry — 有効なプロバイダーを列挙し、保護付きでデータを取得する
 *
 * ここが「障害がサービス全体に波及しない」ための要。
 *   - 各プロバイダーは独立した circuit breaker を持つ
 *   - 1社が落ちても他社のデータは取れる
 *   - 全社が落ちても例外を投げず、空 + 状態情報を返す（画面は落とさない）
 */

import type {
  MiningProvider,
  ProviderHealth,
  ProviderStatus,
  ProviderWorkerReading,
  Worker,
} from "@/types";
import type { MiningProviderAdapter } from "./interface";
import { ProviderFacade } from "./interface";
import { MockMiningProviderAdapter } from "./adapters/mock";
import { PoolRestAdapter } from "./adapters/pool-rest";
import { StratumAdapter } from "./adapters/stratum";
import { ProviderAAdapter } from "./adapters/provider-a";
import { ProviderBAdapter } from "./adapters/provider-b";
import { BraiinsPoolAdapter } from "./adapters/braiins";
import { F2PoolAdapter } from "./adapters/f2pool";
import { GenericMiningFarmAdapter } from "./adapters/farm-generic";
import { CustomerOwnedMinerAdapter } from "./adapters/customer-owned";
import { getBreaker, CircuitOpenError } from "@/lib/circuit-breaker";
import { getStore } from "@/lib/store";
import { config } from "@/lib/config";

/**
 * 新しいプロバイダー種別を追加するときは、ここに 1 行足すだけでよい。
 */
export function createAdapter(
  provider: MiningProvider,
  workers: Worker[],
): MiningProviderAdapter {
  switch (provider.kind) {
    case "MOCK":
      return new MockMiningProviderAdapter(provider, workers);
    case "POOL_REST":
      return new PoolRestAdapter(provider);
    case "STRATUM":
      return new StratumAdapter(provider);
    case "PROVIDER_A":
      return new ProviderAAdapter(provider);
    case "PROVIDER_B":
      return new ProviderBAdapter(provider);
    case "BRAIINS":
      return new BraiinsPoolAdapter(provider);
    case "F2POOL":
      return new F2PoolAdapter(provider);
    case "FARM_GENERIC":
      return new GenericMiningFarmAdapter(provider);
    case "CUSTOMER_OWNED":
      return new CustomerOwnedMinerAdapter(provider);
    default: {
      // 網羅性チェック（新しい kind を足したときにコンパイルエラーで気付ける）
      const never: never = provider.kind;
      throw new Error(`未知のプロバイダー種別です: ${never}`);
    }
  }
}

export type ProviderFetchOutcome = {
  provider: MiningProvider;
  adapter: MiningProviderAdapter;
  readings: ProviderWorkerReading[];
  status: ProviderStatus;
  error: string | null;
  latencyMs: number;
};

function breakerFor(provider: MiningProvider) {
  return getBreaker({
    name: `provider:${provider.id}`,
    failureThreshold: config.mining.failureThreshold,
    resetMs: config.mining.breakerResetMs,
    timeoutMs: config.mining.timeoutMs,
  });
}

/**
 * 有効な全プロバイダーからワーカー統計を取得する。
 * ★ この関数は例外を投げない。失敗はすべて outcome の status/error に載せる。
 */
export async function fetchAllProviders(tenantId: string): Promise<ProviderFetchOutcome[]> {
  const store = await getStore();
  const providers = (await store.listProviders(tenantId))
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  const workers = await store.listWorkers(tenantId);

  return Promise.all(
    providers.map(async (provider): Promise<ProviderFetchOutcome> => {
      const started = Date.now();

      // メンテナンス中は呼びに行かない（無駄な失敗を記録しない）
      if (provider.status === "MAINTENANCE") {
        return {
          provider,
          adapter: createAdapter(provider, workers),
          readings: [],
          status: "MAINTENANCE",
          error: null,
          latencyMs: 0,
        };
      }

      let adapter: MiningProviderAdapter;
      try {
        adapter = createAdapter(provider, workers);
      } catch (err) {
        return {
          provider,
          adapter: new MockMiningProviderAdapter(provider, []),
          readings: [],
          status: "OFFLINE",
          error: err instanceof Error ? err.message : String(err),
          latencyMs: 0,
        };
      }

      try {
        const result = await breakerFor(provider).run(() => adapter.fetchWorkers());
        const latencyMs = Date.now() - started;
        await store.updateProvider(tenantId, provider.id, {
          status: provider.status === "DEGRADED" ? "DEGRADED" : "ONLINE",
          lastOkAt: new Date().toISOString(),
          lastError: null,
          consecutiveFailures: 0,
        });
        return {
          provider,
          adapter,
          readings: result.readings,
          status: provider.status === "DEGRADED" ? "DEGRADED" : "ONLINE",
          error: null,
          latencyMs,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // circuit breaker が開いている間は「停止中」として扱う
        const status: ProviderStatus = err instanceof CircuitOpenError ? "OFFLINE" : "DEGRADED";
        await store.updateProvider(tenantId, provider.id, {
          status,
          lastError: message.slice(0, 300),
          consecutiveFailures: provider.consecutiveFailures + 1,
        });
        return {
          provider,
          adapter,
          readings: [],
          status,
          error: message,
          latencyMs: Date.now() - started,
        };
      }
    }),
  );
}

/** 管理画面・ヘルスチェック用の状態一覧 */
export async function getProviderHealth(tenantId: string): Promise<ProviderHealth[]> {
  const store = await getStore();
  const providers = await store.listProviders(tenantId);
  const workers = await store.listWorkers(tenantId);

  return Promise.all(
    providers.map(async (p): Promise<ProviderHealth> => {
      if (!p.enabled) {
        return {
          providerId: p.id,
          name: p.name,
          kind: p.kind,
          status: "MAINTENANCE",
          latencyMs: null,
          lastOkAt: p.lastOkAt,
          consecutiveFailures: p.consecutiveFailures,
          message: "無効化されています",
        };
      }
      try {
        const adapter = createAdapter(p, workers);
        const health = await adapter.healthCheck();
        return {
          providerId: p.id,
          name: p.name,
          kind: p.kind,
          status: health.status,
          latencyMs: health.latencyMs,
          lastOkAt: p.lastOkAt,
          consecutiveFailures: p.consecutiveFailures,
          message: health.message,
        };
      } catch (err) {
        return {
          providerId: p.id,
          name: p.name,
          kind: p.kind,
          status: "OFFLINE",
          latencyMs: null,
          lastOkAt: p.lastOkAt,
          consecutiveFailures: p.consecutiveFailures,
          message: err instanceof Error ? err.message : "ヘルスチェックに失敗しました",
        };
      }
    }),
  );
}

/**
 * 統一 12 メソッド面（ProviderFacade）でアダプタを取得する。
 * getHashrate / getAcceptedShares / getPayoutHistory 等はこちらを使う。
 */
export async function getFacade(
  tenantId: string,
  providerId: string,
): Promise<ProviderFacade | null> {
  const store = await getStore();
  const provider = await store.getProvider(tenantId, providerId);
  if (!provider) return null;
  const workers = await store.listWorkers(tenantId, { providerId });
  return new ProviderFacade(createAdapter(provider, workers));
}

/**
 * 全プロバイダーから payout 履歴を取り込み、未保存分を PoolPayout として保存する。
 * ★ 冪等: UNIQUE(providerId, externalPayoutId) 相当のチェックで二重保存しない。
 * 戻り値は新規保存件数と、対応プロバイダーが 1 つも無かったかどうか。
 */
export async function syncPayouts(
  tenantId: string,
  sinceMs?: number,
): Promise<{ saved: number; skippedDuplicates: number; capableProviders: number }> {
  const store = await getStore();
  const providers = (await store.listProviders(tenantId)).filter((p) => p.enabled);
  const workers = await store.listWorkers(tenantId);

  let saved = 0;
  let skippedDuplicates = 0;
  let capableProviders = 0;

  for (const provider of providers) {
    let adapter: MiningProviderAdapter;
    try {
      adapter = createAdapter(provider, workers);
    } catch {
      continue;
    }
    if (!adapter.getPayoutHistory) continue;
    capableProviders++;

    try {
      const raw = await breakerFor(provider).run(() => adapter.getPayoutHistory!(sinceMs));
      for (const p of raw) {
        const inserted = await store.insertPayout({
          id: `po-${provider.id}-${p.externalPayoutId}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
          tenantId,
          providerId: provider.id,
          externalPayoutId: p.externalPayoutId,
          amountBtc: p.amountBtc,
          paidAt: p.paidAt,
          txId: p.txId,
          source: adapter.isLive ? adapter.name : `mock:${adapter.name}`,
          fetchedAt: new Date().toISOString(),
          allocationStatus: "UNALLOCATED",
          allocatedAt: null,
        });
        if (inserted) saved++;
        else skippedDuplicates++;
      }
    } catch (err) {
      console.warn(
        `[payout] ${provider.name} の payout 取得に失敗しました:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { saved, skippedDuplicates, capableProviders };
}

/**
 * 本番で Mock アダプタが使われていないかを検査する。
 * 「デモのつもりが本番」「本番のつもりがデモ」を防ぐ。
 */
export async function detectMockUsage(tenantId: string): Promise<string[]> {
  const store = await getStore();
  const providers = await store.listProviders(tenantId);
  return providers
    .filter((p) => p.enabled && p.kind === "MOCK")
    .map((p) => `${p.name}（${p.id}）は Mock アダプタです。実データではありません。`);
}
