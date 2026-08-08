# MINING_PROVIDER.md — マイニングプロバイダー統合

本システムは **ASIC を自社保有しない**。外部の実設備をアダプタで接続するコントロールプレーンである。

## 1. 接続モデル（3種）

| モデル | kind | 説明 | 電力の扱い（既定） |
|---|---|---|---|
| A. 提携マイニングファーム | `FARM_GENERIC` | ファームの管理 API から当社契約分のワーカー統計・payout を取得 | INCLUDED / PASS_THROUGH |
| B. 顧客保有 ASIC | `CUSTOMER_OWNED` | 顧客のプールアカウントを read-only で読む（ASIC へ直接コマンドは送らない設計） | USER_PAYS |
| C. ハッシュレートプロバイダー | `PROVIDER_A/B`（テンプレ） | 事業者 API から契約ハッシュレート分の統計を取得 | INCLUDED |

## 2. アダプタ一覧

| kind | ファイル | isLive | payout対応 | 用途 |
|---|---|---|---|---|
| `MOCK` | `adapters/mock.ts` | ✗ | ✓（擬似） | デモ・テスト |
| `POOL_REST` | `adapters/pool-rest.ts` | ✓ | – | 汎用 REST プール（形式を parseResponse で調整） |
| `BRAIINS` | `adapters/braiins.ts` | ✓ | ✓ | Braiins Pool（read-only トークン） |
| `F2POOL` | `adapters/f2pool.ts` | ✓ | ✓ | F2Pool（アカウント名のみで読取可） |
| `FARM_GENERIC` | `adapters/farm-generic.ts` | ✓ | ✓ | 提携ファーム標準形 |
| `CUSTOMER_OWNED` | `adapters/customer-owned.ts` | ✓ | 委譲先次第 | 顧客プールアカウントへの委譲 |
| `STRATUM` | `adapters/stratum.ts` | ✓ | – | プール接続の監視（下記 STRATUM.md） |
| `PROVIDER_A/B` | テンプレート | ✓ | – | 新規事業者契約時に 3 メソッドを実装 |

## 3. 統一インターフェース

各アダプタが実装するのは最小 2 メソッド（`fetchWorkers` / `healthCheck`）＋任意の payout 系。
フェーズ2 で要求される 12 メソッドは **`ProviderFacade`** が派生値として提供する:

```
connect() / disconnect()          … 常時接続型のみ（任意）
healthCheck()
getWorkers() / getHashrate() / getWorkerStatus()
getAcceptedShares() / getRejectedShares()
getEstimatedRevenue()             … プール申告の推定（参考値）
getActualRevenue()                … payout 合計（実績）。非対応なら null
getPayoutHistory() / getPoolBalance()
```

すべての取得値は `SourcedValue<T>`（`source` / `fetchedAt` / `isEstimate` / `isStale`）で返る。
**非対応の値を 0 で装うことは禁止** — 取れないものは `null`。

## 4. 資格情報の扱い

- DB には `credentialsRef`（参照名）のみ保存。値は環境変数（本番: Secrets Manager）から解決
- 参照名 → 環境変数名: `btc-cloud-miner/pool/api-key` → `BTC_CLOUD_MINER_POOL_API_KEY`
- プールには **read-only（統計閲覧のみ）のキー**を発行させること。出金権限を持つキーを本システムに渡さない

## 5. 新しいプロバイダーの追加手順

1. `adapters/provider-a.ts` をコピーし、`buildRequest` / `parseWorkers` / `healthCheck` を実装
2. 単位変換に注意（本システムは **TH/s 統一**）。全数値を `safeNumber` で範囲検証
3. `types/index.ts` の `ProviderKind` に追加 → `registry.ts` の switch に 1 行（網羅チェックが強制）
4. 実 API レスポンスの fixture でパーステストを書く（`tests/provider-adapters.test.ts` 参照）

## 6. 障害分離

- プロバイダーごとに独立した circuit breaker（連続5回失敗→60秒遮断→半開試行）
- タイムアウト 10s・指数バックオフ・優先度順フェイルオーバー
- 全滅しても例外を投げず、UI は最終値＋`DEGRADED`/`OFFLINE` バッジで継続
- 状態は `ONLINE / DEGRADED / OFFLINE / MAINTENANCE` の4値管理
