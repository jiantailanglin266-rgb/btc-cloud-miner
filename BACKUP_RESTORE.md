# BACKUP_RESTORE.md — PostgreSQL バックアップ・リストア（フェーズ16）

対象: 本番 PostgreSQL（Neon / Supabase / RDS / 自己ホスト）。
検証コマンド: `npm run db:verify`（主要テーブルの存在確認）。

---

## 1. バックアップ

### マネージド DB（推奨）

| サービス | 方法 |
|---|---|
| Neon | 自動（Point-in-time restore が Free でも履歴保持。Pro で 7〜30 日） |
| Supabase | 日次自動バックアップ（Pro）。ダッシュボードから取得 |
| RDS | 自動スナップショット + WAL（保持 35 日まで設定可） |

### 手動論理バックアップ（週次で別リージョンへ・すべての構成で実施）

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner \
  --file="backup-$(date +%Y%m%d).dump"
# 暗号化して別リージョンのオブジェクトストレージへ
gpg --symmetric --cipher-algo AES256 backup-*.dump
```

- 保持: 日次 35 日 / 週次 12 週 / 月次 12 ヶ月
- **バックアップにも個人情報・元帳が含まれる**。本体と同じアクセス制御・暗号化を適用する

## 2. リストア

```bash
# 1. 新しい空 DB を用意（本番へ直接上書きしない）
createdb btc_cloud_miner_restore

# 2. リストア
pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" backup-YYYYMMDD.dump

# 3. 検証（必須）
DATABASE_URL="$RESTORE_DATABASE_URL" npm run db:verify
DATABASE_URL="$RESTORE_DATABASE_URL" npm run ledger:verify
```

`ledger:verify` が PASS になることが「リストア成功」の定義（残高が元帳から再導出できること）。

## 3. Point-in-Time Recovery（PITR）

誤削除・誤 UPDATE の直前へ戻す:

| サービス | 手順 |
|---|---|
| Neon | ダッシュボード → Restore → 時刻指定 → 新ブランチとして復元（本番を止めずに検証できる） |
| RDS | 「特定時点への復元」→ 新インスタンス作成 → 検証後に切替 |
| 自己ホスト | WAL アーカイブ + `recovery_target_time` |

**目標値**: RPO 5 分 / RTO 1 時間（REQUIREMENTS.md §4）

## 4. リストア検証（四半期ごとに必ず実施）

1. 最新バックアップを staging 相当へリストア
2. `npm run db:verify` → 全テーブル PASS
3. `npm run ledger:verify` → FAIL ゼロ
4. `/admin/reconciliation` で payout と Ledger の一致を確認
5. 管理者ログイン → ダッシュボード表示を目視
6. 実施記録（日時・担当・結果）を残す

## 5. 災害復旧（DR）

| シナリオ | 手順 |
|---|---|
| DB リージョン障害 | 別リージョンの週次論理バックアップからリストア → DATABASE_URL 切替 → db:verify/ledger:verify → 起動 |
| 誤マイグレーション | 適用前スナップショットへ PITR → 修正版を再適用 |
| 元帳の破壊的不整合 | **まず `FEATURE_WITHDRAWAL_ENABLED=false`** → 直前の整合時点へ PITR → 差分 payout を再同期（冪等なので二重計上しない）→ reconcile で確認 |
| 全損 | インフラを IaC から再構築 → 最新バックアップをリストア → PRODUCTION_CHECKLIST を一巡 |

★ payout 同期・配賦は冪等（UNIQUE 制約・元帳冪等キー）なので、
リストア後に同期を再実行しても二重計上は起きない。これが DR を単純にする設計上の要。
