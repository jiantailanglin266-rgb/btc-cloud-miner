# FREE_TIER_DEPLOYMENT.md — 固定費ほぼ 0 円の PoC 環境と商用環境

「無料だから」という理由でセキュリティ要件を下げない。
以下の構成でも SECURITY.md の全要件（2FA・監査・暗号化・レート制限）は有効である。

---

## A. PoC 環境（固定費 0〜数百円/月）

| 役割 | サービス（無料枠） | 移行先候補（依存回避） |
|---|---|---|
| Frontend / API | Vercel Hobby（100GB帯域） | Cloudflare Pages / Netlify / 任意の Docker ホスト |
| Database | **Neon Free**（0.5GB・自動休止）または Supabase Free（500MB） | 任意の PostgreSQL（Prisma 接続文字列を差し替えるだけ） |
| リポジトリ / CI | GitHub Free + Actions（月2,000分） | GitLab CI / 自前 runner |
| 監視 | UptimeRobot Free（5分間隔監視）+ Vercel ログ | Grafana Cloud Free / Betterstack |
| Bitcoin Network API | mempool.space 公開 API（無料・キー不要） | blockchain.info / 自社フルノード |
| Price API | CoinGecko 公開 API（無料枠） | CoinCap / 取引所公開 API |
| Mining Pool | F2Pool 公開 API（アカウント名のみ・無料）/ Braiins（無料トークン） | 任意（Generic REST Adapter） |
| Secrets | Vercel 環境変数（暗号化保存） | Doppler Free / SOPS |

### セットアップ（約 20 分）

```bash
# 1. Neon（または Supabase）で DB 作成 → DATABASE_URL を取得
# 2. マイグレーション（ローカルから直接続 URL で）
DATABASE_URL='postgresql://...' npx prisma migrate deploy

# 3. Vercel へ import し、環境変数を設定:
#    DATABASE_URL / ENCRYPTION_KEY（node -e "..."で生成）/ APP_URL
#    BITCOIN_SOURCE_PRIMARY=https://mempool.space/api
#    PRICE_SOURCE_PRIMARY=https://api.coingecko.com/api/v3
#    MINING_PROVIDER_MODE=mock   ← プール接続の準備ができるまで
#    WALLET_PROVIDER_MODE=mock
# 4. デプロイ → /api/health/ready で "store":"prisma" を確認
```

### PoC で実プールに接続する（費用 0 円のまま）

1. F2Pool にアカウント作成（自分の ASIC またはテスト用に他者設備の閲覧許可）
2. 管理画面 → プロバイダー追加: kind=`F2POOL`, credentialsRef=`f2pool/account`
3. Vercel 環境変数 `F2POOL_ACCOUNT=<アカウント名>` を設定
4. `MINING_PROVIDER_MODE=live` へ切替 → 接続失敗時は **LIVE CONNECTION FAILED** が表示される（Mock 値を実データと偽装しない）

### PoC 構成の既知の制約（サービスの正直な限界）

| 制約 | 影響 | 対応 |
|---|---|---|
| サーバーレスの実行時間上限 | SSE が切れやすい | クライアントが自動でポーリングへフォールバック（実装済み） |
| Stratum 常時接続が不可 | Gateway が動かない | PoC では Pool REST のみ使用。Stratum は Fly.io Free 相当の常駐 VM か商用環境で |
| 定期ジョブなし | payout 同期が手動 | 管理画面の「payout を同期」ボタン、または GitHub Actions cron（無料枠）で `/api/admin` を叩く |
| Neon の自動休止 | 初回アクセスが数秒遅い | PoC では許容。商用は常時起動プランへ |
| インメモリのレート制限 | インスタンス間で非共有 | PoC の規模では実害なし。商用は Redis |

---

## B. 商用 Production 環境（月額目安 $80〜$400、規模による）

PoC との本質的な違いは「常駐プロセス」「共有キャッシュ」「マネージドバックアップ」「監視」。

| 役割 | 最小商用（〜$100/月） | 標準商用（〜$400/月） |
|---|---|---|
| アプリ | Fly.io / Railway 常駐 ×1 | AWS ECS Fargate ×2 + ALB |
| Mining Gateway（Stratum） | 同上に同居 | Fargate 常駐 ×2 |
| DB | Neon Launch / Supabase Pro（PITR付き） | RDS PostgreSQL Multi-AZ |
| Redis | Upstash 従量 | ElastiCache |
| Secrets | Doppler / SOPS | AWS Secrets Manager + KMS |
| 監視 | Grafana Cloud Free + UptimeRobot | CloudWatch + OTel + PagerDuty |
| 定期ジョブ | アプリ内 cron（node-cron） | EventBridge / BullMQ ワーカー |

移行はすべて環境変数の差し替えで完結する（コード変更不要）:
`DATABASE_URL` / `REDIS_URL` / 各ソース URL / Secrets の注入方法のみ。

### 商用で必ず追加するもの（無料構成では代替不可）

1. カストディ契約（実出金）— WITHDRAWAL.md §4
2. DB の PITR バックアップとリストア訓練
3. 24/7 監視アラートの通知先（オンコール）
4. ペネトレーションテスト
5. 法務レビュー（docs/法規制・コンプライアンス.md）
