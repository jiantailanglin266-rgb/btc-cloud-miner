# DEPLOYMENT.md — デプロイ手順

---

## 0. デプロイ前チェックリスト

- [ ] `npm test` が全て緑
- [ ] `npm run build` がエラーゼロ
- [ ] `.env` 系ファイルがコミットされていない（`git status` で確認）
- [ ] `ENCRYPTION_KEY` を新規生成した（開発用固定鍵のまま本番に出さない）
- [ ] `DATABASE_URL` を設定した（サーバーレスでインメモリは禁止）
- [ ] `WALLET_PROVIDER_MODE` / `MINING_PROVIDER_MODE` の設定が意図どおり（本番で mock なら警告が出る）
- [ ] `ADMIN_IP_ALLOWLIST` を設定した
- [ ] 管理者アカウントの 2FA を有効化した
- [ ] デモ用 seed を本番 DB に流していない

鍵の生成:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 1. 構成 A: Docker Compose（最小・自己ホスト）

小規模・検証・オンプレ向け。1 台のサーバーで完結する。

```bash
# 1. リポジトリを配置
git clone <repository-url> && cd btc-cloud-miner

# 2. 本番用の環境変数を用意（compose の environment を上書き）
cp .env.example .env.production
# ENCRYPTION_KEY / ADMIN_IP_ALLOWLIST 等を編集

# 3. 起動
docker compose up -d --build

# 4. マイグレーション
docker compose exec app npx prisma migrate deploy

# 5. 初期テナント・管理者の作成
#    デモ seed は使わず、本番用の初期化を行うこと。
#    最低限必要なのは tenants 1行・tenant_settings 1行・管理者 user 1行。
#    手順は docs/管理者マニュアル.md §1 を参照。

# 6. 確認
curl http://localhost:3000/api/health/ready
```

TLS 終端は前段のリバースプロキシ（Caddy / nginx / ALB）で行う。
SSE を使うため、プロキシのバッファリングを無効にすること（nginx: `proxy_buffering off;`）。

---

## 2. 構成 B: Vercel + Supabase（最速で公開）

| 手順 | 内容 |
|---|---|
| 1 | Supabase でプロジェクト作成 → `Connection string`（pooler, port 6543）を取得 |
| 2 | ローカルで `DATABASE_URL=<direct url> npx prisma migrate deploy` を実行 |
| 3 | Vercel にリポジトリを import |
| 4 | 環境変数を設定: `DATABASE_URL`（pooler URL + `?pgbouncer=true`）・`ENCRYPTION_KEY`・`APP_URL` 他 |
| 5 | デプロイ。`/api/health/ready` で `"store":"prisma"` を確認 |

注意:
- **`DATABASE_URL` 未設定のままデプロイしない**（インスタンス間でセッション・レート制限が共有されない）
- SSE はサーバーレスの実行時間上限の影響を受ける。クライアントは自動でポーリングにフォールバックするが、
  常時接続が必要な規模になったら構成 C へ移行する
- Stratum の常時接続（Backend Mining Gateway）はサーバーレスでは動かない。別途 VM / コンテナで動かす

---

## 3. 構成 C: AWS（本番推奨。ARCHITECTURE.md §6 対応）

```
Route53 → CloudFront(WAF) → ALB → ECS Fargate (app ×2〜)
                                   ECS Fargate (mining-gateway ×2)  ← Stratum 常時接続
                             RDS PostgreSQL (Multi-AZ) / ElastiCache Redis
                             Secrets Manager / KMS / CloudWatch
```

手順の骨子:

```bash
# 1. イメージのビルドと push
docker build -t btc-cloud-miner .
aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker tag btc-cloud-miner <account>.dkr.ecr.<region>.amazonaws.com/btc-cloud-miner:v1
docker push <account>.dkr.ecr.<region>.amazonaws.com/btc-cloud-miner:v1

# 2. インフラ（infra/terraform の骨格を各環境に合わせて完成させる）
cd infra/terraform
terraform init
terraform plan -var-file=production.tfvars
terraform apply -var-file=production.tfvars

# 3. マイグレーション（ECS one-off task か踏み台から）
npx prisma migrate deploy
```

ポイント:
- シークレットは**タスク定義の環境変数に直接書かず**、Secrets Manager 参照を使う
- ALB のアイドルタイムアウトを 60s 以上に（SSE の heartbeat は 25s 間隔）
- ヘルスチェックは Liveness `/api/health`、ターゲットグループは `/api/health/ready`
- DB は Multi-AZ + 自動バックアップ + PITR。`DATABASE.md §6` の RPO/RTO を満たす設定にする

---

## 4. マイグレーション運用

```bash
# 開発: マイグレーション作成
npx prisma migrate dev --name <変更内容>

# 本番: 適用（db push は本番禁止）
npx prisma migrate deploy
```

- 後方互換の 2 段階デプロイを守る（DATABASE.md §5）
- 適用前にスナップショットを取得する

## 5. ロールバック

| 対象 | 手順 |
|---|---|
| アプリ | 直前のイメージタグへ戻す（ECS: タスク定義のリビジョン切替 / Vercel: Instant Rollback） |
| DB | 追加系マイグレーションはそのまま旧アプリで動く。破壊的変更はスナップショットから復元 |
| 設定 | Secrets Manager のバージョン戻し |

## 6. デプロイ後の確認

```bash
curl https://<domain>/api/health          # {"ok":true}
curl https://<domain>/api/health/ready    # "store":"prisma" であること（"memory" なら DB 未接続）
```

- [ ] ログインできる
- [ ] ダッシュボードに数値が出る
- [ ] 管理コンソールの「本番構成の警告」がゼロ（/admin）
- [ ] `MOCK` 状態のプロバイダーが意図せず有効になっていない
- [ ] セキュリティヘッダが付いている（`curl -I` で確認）
