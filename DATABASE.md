# DATABASE.md — データベース設計書

RDBMS: PostgreSQL 16 / ORM: Prisma
すべての業務テーブルは `tenant_id` を持ち、アプリ層と RLS（Row Level Security）の二重で分離する。

---

## 1. テーブル一覧

| # | テーブル | 用途 | テナント分離 |
|---|---|---|:--:|
| 1 | `tenants` | テナント（ホワイトラベル提供先・自社） | – |
| 2 | `tenant_domains` | テナントの独自ドメイン | ✅ |
| 3 | `tenant_settings` | ブランディング・料金・手数料・機能フラグ | ✅ |
| 4 | `organizations` | B2B 契約企業（テナント内の顧客組織） | ✅ |
| 5 | `users` | ユーザー | ✅ |
| 6 | `user_credentials` | パスワードハッシュ・TOTP シークレット（暗号化） | ✅ |
| 7 | `sessions` | セッション（トークンは SHA-256 ハッシュのみ） | ✅ |
| 8 | `kyc_records` | 本人確認ステータス | ✅ |
| 9 | `plans` | 料金プラン定義 | ✅ |
| 10 | `contracts` | 契約（購入ハッシュレート・期間） | ✅ |
| 11 | `hashrate_allocations` | 契約 → プロバイダー／ワーカーへの割当 | ✅ |
| 12 | `mining_providers` | 接続先プロバイダー定義と状態 | ✅ |
| 13 | `mining_pools` | プール定義（Stratum URL 等） | ✅ |
| 14 | `workers` | ASIC ワーカー（1台 = 1レコード） | ✅ |
| 15 | `worker_snapshots` | ワーカー統計（5分粒度・時系列） | ✅ |
| 16 | `worker_stats_hourly` | 1時間ロールアップ | ✅ |
| 17 | `worker_stats_daily` | 日次ロールアップ | ✅ |
| 18 | `network_snapshots` | Bitcoin ネットワーク情報の履歴 | – |
| 19 | `price_snapshots` | BTC 価格履歴 | – |
| 20 | `earnings` | 採掘報酬の確定記録 | ✅ |
| 21 | `wallet_accounts` | ユーザーごとの BTC 残高 | ✅ |
| 22 | `wallet_addresses` | 出金先アドレス | ✅ |
| 23 | `withdrawals` | 出金申請・承認・送金 | ✅ |
| 24 | `withdrawal_approvals` | 承認履歴（4-eyes 用） | ✅ |
| 25 | `ledger_entries` | 複式記帳の元帳（残高の唯一の真実） | ✅ |
| 26 | `invoices` | 請求（商用版） | ✅ |
| 27 | `notifications` | 通知 | ✅ |
| 28 | `support_tickets` | サポートチケット | ✅ |
| 29 | `support_messages` | チケット内メッセージ | ✅ |
| 30 | `incidents` | 障害情報 | ✅ |
| 31 | `audit_logs` | 監査ログ（追記専用） | ✅ |
| 32 | `api_health_checks` | 外部 API の稼働記録 | – |
| 33 | `ai_insights` | AI 異常検知・推奨アクション | ✅ |
| 34 | `idempotency_keys` | 冪等キー（二重実行防止） | ✅ |

---

## 2. 主要カラム仕様

### 2.1 `tenants`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text UNIQUE | サブドメイン識別子 |
| `name` | text | サービス表示名（変更可＝「BTC CLOUD MINER」に固定しない） |
| `status` | enum | `ACTIVE` / `SUSPENDED` / `TRIAL` |
| `created_at` / `updated_at` | timestamptz | |

### 2.2 `tenant_settings`

| カラム | 型 | 説明 |
|---|---|---|
| `tenant_id` | uuid PK/FK | |
| `brand_name` | text | 表示サービス名 |
| `logo_url` | text | ロゴ |
| `color_primary` / `color_accent` | text | テーマカラー（`#RRGGBB`） |
| `platform_fee_rate` | numeric(6,5) | プラットフォーム手数料率（例 0.02000 = 2%） |
| `pool_fee_rate` | numeric(6,5) | 既定プール手数料率 |
| `electricity_price_kwh` | numeric(10,4) | 既定電力単価（USD/kWh） |
| `min_withdrawal_btc` | numeric(18,8) | 最低出金額 |
| `withdrawal_fee_btc` | numeric(18,8) | 出金手数料 |
| `withdrawal_auto_approve_limit_btc` | numeric(18,8) | この額以下は1名承認 |
| `feature_flags` | jsonb | 機能ON/OFF |
| `default_currency` | text | `USD` / `JPY` |

### 2.3 `users`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `organization_id` | uuid FK NULL | B2B のみ |
| `email` | citext | テナント内で一意（`UNIQUE(tenant_id, email)`） |
| `name` | text | |
| `role` | enum | `USER` / `ORG_ADMIN` / `TENANT_ADMIN` / `PLATFORM_ADMIN` / `SUPPORT` / `AUDITOR` |
| `status` | enum | `ACTIVE` / `SUSPENDED` / `PENDING_VERIFICATION` |
| `two_factor_enabled` | boolean | |
| `last_login_at` | timestamptz | |
| `last_login_ip` | inet | |
| `deleted_at` | timestamptz NULL | 論理削除 |

### 2.4 `user_credentials`

| カラム | 型 | 説明 |
|---|---|---|
| `user_id` | uuid PK/FK | |
| `password_hash` | text | `scrypt$<salt>$<hash>` 形式。平文保存禁止 |
| `totp_secret_enc` | text NULL | **AES-256-GCM で暗号化**（`enc:v1:...`）。平文保存禁止 |
| `recovery_codes_enc` | text NULL | 同上（ハッシュ配列を暗号化） |
| `password_changed_at` | timestamptz | |
| `failed_attempts` | int | 連続失敗回数 |
| `locked_until` | timestamptz NULL | ロックアウト |

### 2.5 `mining_providers`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `kind` | enum | `MOCK` / `POOL_REST` / `STRATUM` / `PROVIDER_A` / `PROVIDER_B` |
| `name` | text | 表示名 |
| `endpoint` | text | API / Stratum URL |
| `credentials_ref` | text | **Secrets Manager のキー名のみ**（値は DB に置かない） |
| `status` | enum | `ONLINE` / `DEGRADED` / `OFFLINE` / `MAINTENANCE` |
| `last_ok_at` | timestamptz | 最後に成功した時刻 |
| `last_error` | text | 直近エラー（PII を含めない） |
| `consecutive_failures` | int | circuit breaker 用 |
| `priority` | int | フェイルオーバー順 |
| `enabled` | boolean | |

### 2.6 `workers`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `provider_id` | uuid FK | |
| `external_worker_id` | text | プロバイダー側 ID（`UNIQUE(provider_id, external_worker_id)`） |
| `miner_id` | text | 機器 ID |
| `model` | text | 例 `S21 Hydro` |
| `rated_hashrate_ths` | numeric(14,4) | 定格 TH/s |
| `rated_efficiency_j_per_th` | numeric(10,3) | 定格 J/TH |
| `status` | enum | `ACTIVE` / `OFFLINE` / `MAINTENANCE` / `UNKNOWN` |
| `last_seen_at` | timestamptz | |

### 2.7 `worker_snapshots`（時系列・パーティション）

| カラム | 型 | 説明 |
|---|---|---|
| `id` | bigserial PK | |
| `tenant_id` | uuid | |
| `worker_id` | uuid FK | |
| `bucket_at` | timestamptz | 5分境界に丸めた時刻 |
| `hashrate_ths` | numeric(14,4) | |
| `accepted_shares` | bigint | |
| `rejected_shares` | bigint | |
| `temperature_c` | numeric(6,2) NULL | |
| `power_w` | numeric(10,2) NULL | |
| `uptime_sec` | bigint | |
| `pool_status` | text | |
| `worker_status` | text | |
| `estimated_earnings_btc` | numeric(18,10) NULL | プロバイダー申告値（参考） |

- `PRIMARY KEY (worker_id, bucket_at)` の一意制約で重複取り込みを防止（upsert）
- `PARTITION BY RANGE (bucket_at)` 月次。30日超のパーティションは DROP

### 2.8 `ledger_entries`（残高の唯一の真実）

残高は「カラムを直接更新」せず、**元帳の合計**で表す。整合性が壊れない。

| カラム | 型 | 説明 |
|---|---|---|
| `id` | bigserial PK | |
| `tenant_id` | uuid | |
| `account_id` | uuid FK → `wallet_accounts` | |
| `entry_type` | enum | `MINING_REWARD` / `FEE` / `WITHDRAWAL_LOCK` / `WITHDRAWAL_SETTLE` / `WITHDRAWAL_REVERSE` / `ADJUSTMENT` |
| `bucket` | enum | `AVAILABLE` / `LOCKED` |
| `amount_btc` | numeric(18,8) | 符号付き。**合計が残高** |
| `ref_type` / `ref_id` | text / uuid | 関連レコード |
| `idempotency_key` | text NULL | `UNIQUE(tenant_id, idempotency_key)` |
| `created_at` | timestamptz | |

不変条件（DB 制約＋定期検証ジョブ）:
- `SUM(amount_btc) WHERE bucket='AVAILABLE'` >= 0
- `SUM(amount_btc) WHERE bucket='LOCKED'` >= 0
- 1件の出金に対する `WITHDRAWAL_LOCK` は最大1件（冪等キーで担保）

### 2.9 `withdrawals`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` / `user_id` | uuid FK | |
| `address_id` | uuid FK | |
| `amount_btc` | numeric(18,8) | |
| `fee_btc` | numeric(18,8) | |
| `net_btc` | numeric(18,8) | 実送金額 |
| `status` | enum | `PENDING_REVIEW` / `FLAGGED` / `APPROVED` / `REJECTED` / `BROADCASTING` / `BROADCASTED` / `CONFIRMED` / `FAILED` / `CANCELLED` |
| `risk_score` | int | 0-100 |
| `risk_reasons` | jsonb | 検知理由 |
| `requested_ip` | inet / `requested_ua` | text |
| `tx_id` | text NULL | ブロードキャスト後 |
| `confirmations` | int | |
| `idempotency_key` | text | `UNIQUE(tenant_id, idempotency_key)` |

### 2.10 `audit_logs`（追記専用）

| カラム | 型 | 説明 |
|---|---|---|
| `id` | bigserial PK | |
| `tenant_id` | uuid | |
| `actor_user_id` | uuid NULL | システム操作は NULL |
| `actor_role` | text | |
| `action` | text | 例 `withdrawal.approve` |
| `target_type` / `target_id` | text / text | |
| `before` / `after` | jsonb NULL | 差分（機微情報はマスク） |
| `ip` | inet / `user_agent` text | |
| `result` | enum | `SUCCESS` / `FAILURE` |
| `created_at` | timestamptz | |

`UPDATE` / `DELETE` をアプリロールから REVOKE し、追記専用にする。

---

## 3. インデックス方針

| テーブル | インデックス | 目的 |
|---|---|---|
| `users` | `UNIQUE(tenant_id, email)` / `(tenant_id, role)` | ログイン・管理一覧 |
| `sessions` | `UNIQUE(token_hash)` / `(user_id)` / `(expires_at)` | 検証・失効掃除 |
| `workers` | `UNIQUE(provider_id, external_worker_id)` / `(tenant_id, status)` | 取り込み upsert・一覧 |
| `worker_snapshots` | `PK(worker_id, bucket_at)` / `(tenant_id, bucket_at DESC)` | 時系列取得 |
| `worker_stats_hourly` | `PK(worker_id, bucket_at)` | グラフ |
| `earnings` | `(tenant_id, user_id, earned_at DESC)` | 履歴 |
| `ledger_entries` | `(account_id, bucket)` / `UNIQUE(tenant_id, idempotency_key)` | 残高集計・冪等 |
| `withdrawals` | `(tenant_id, status, created_at DESC)` / `UNIQUE(tenant_id, idempotency_key)` | 承認キュー |
| `audit_logs` | `(tenant_id, created_at DESC)` / `(actor_user_id)` / `(action)` | 監査検索 |
| `notifications` | `(user_id, read_at NULLS FIRST, created_at DESC)` | 未読取得 |

**方針**
- 一覧系は必ず `tenant_id` を先頭に置いた複合インデックス
- 時系列は `bucket_at DESC` を含める
- カーディナリティの低い列（status）単独のインデックスは作らない
- 実測（`pg_stat_statements`）で不要と判明したものは削除する

---

## 4. Row Level Security（RLS）

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

- アプリは接続ごとに `SET LOCAL app.tenant_id = '<uuid>'` を発行する
- アプリ層のフィルタと **二重**で守る（アプリのバグ1つでテナント越境しない）
- マイグレーション・バッチ用ロールのみ `BYPASSRLS` を持つ

---

## 5. マイグレーション運用

1. スキーマ変更は必ず Prisma Migrate（`prisma/migrations/`）でバージョン管理する
2. **後方互換の2段階デプロイ**を守る
   - 追加（nullable で列追加 → コードが両対応 → データ移行 → NOT NULL 化）
   - 削除（コードから参照を外す → 次リリースで DROP）
3. 本番適用は `prisma migrate deploy`（自動生成の `db push` は本番禁止）
4. 適用前に必ずスナップショットを取得。ロールバック手順を PR に記載
5. 破壊的変更（列削除・型変更）はレビュー2名必須
6. 時系列テーブルのパーティションは月次で自動作成するジョブを用意する

---

## 6. バックアップ・リカバリ

| 項目 | 設定 |
|---|---|
| フルバックアップ | 日次（保持 35日） |
| PITR | WAL 連続アーカイブ（任意時点へ復元） |
| 目標復旧時点（RPO） | 5分 |
| 目標復旧時間（RTO） | 1時間 |
| リストア訓練 | 四半期に1回、staging へ復元して検証 |
| 論理バックアップ | `pg_dump` 週次（別リージョンへ） |

---

## 7. 数値型の扱い（重要）

- **BTC 金額は `numeric(18,8)`**（satoshi 単位まで正確）。`float` / `double` を絶対に使わない
- ハッシュレートは `numeric(14,4)` の TH/s で統一（PH/s・EH/s は表示時に変換）
- 手数料率は `numeric(6,5)`（0.00000〜1.00000）
- アプリ側は `string` で受け渡し、計算時のみ decimal ライブラリまたは整数（satoshi）で処理する
- JavaScript の `number` で BTC 金額を加算・減算しない（丸め誤差が発生するため）
