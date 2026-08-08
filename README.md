# BTC CLOUD MINER

**Bitcoin Cloud Mining Management Platform** — マルチテナント SaaS

外部の ASIC マイニング設備・マイニングプール・ハッシュレートプロバイダーを API / Stratum で統合し、
ブラウザから稼働状況・収益・コスト・出金までを一元管理するプラットフォームです。

> **本システムの前提**
> Bitcoin の採掘には実際の SHA-256 ハッシュ計算資源（ASIC）が必要です。計算せずに BTC を生成する仕組みは存在しません。
> 本システムの価値は「ASIC を不要にすること」ではなく、**「ASIC 設備をユーザー自身が購入・設置・管理する必要をなくし、クラウド経由で抽象化・統合管理すること」**にあります。

---

## クイックスタート（環境変数ゼロで動きます）

```bash
git clone <repository-url>
cd btc-cloud-miner
npm install
npm run dev
```

http://localhost:3000 を開き、以下のデモアカウントでログインしてください。

| ロール | メール | パスワード |
|---|---|---|
| 一般ユーザー | `demo@example.com` | `demo1234` |
| 管理者 | `admin@example.com` | `admin1234` |
| サポート（読取のみ） | `support@example.com` | `support1234` |
| テナント管理者（ACME） | `owner@acme.example.com` | `acme1234` |

**モックファースト設計**: DB・Redis・外部 API・カストディが未設定でも、全機能がデモモードで動作します。
デモ環境では画面に `DEMO` バッジが表示され、マイニング統計は決定的に生成された擬似データです。

---

## 主な機能

| 領域 | 内容 |
|---|---|
| ダッシュボード | 実効/契約ハッシュレート・稼働台数・shares・温度・稼働率・ネットワーク情報・BTC価格をリアルタイム表示（SSE + ポーリングフォールバック） |
| マイニング統合層 | `MiningProviderInterface` + アダプタ方式（Mock / Pool REST / Stratum V1 / 事業者テンプレート×2）。circuit breaker・retry・フェイルオーバー内蔵 |
| Bitcoin ネットワーク | 難易度・ハッシュレート・ブロック高・mempool・次回調整予測・半減期。複数ソース + stale キャッシュで全滅時も停止しない |
| 収益エンジン | 純関数 `MiningRevenueEngine`。推定採掘量・電力コスト・手数料・純収益・損益分岐点・ROI・感度分析。**全出力に `isEstimate` と免責を強制** |
| シミュレーター | ハッシュレート・効率・電力単価・価格・難易度・手数料をスライダーで変更→即時再計算。1年間の累積推移も表示 |
| ウォレット | 複式元帳による残高管理・アドレス検証（Base58Check/Bech32 チェックサム）・出金申請・異常検知・4-eyes 承認。**秘密鍵は一切保持しない** |
| 管理コンソール | ユーザー/KYC・出金承認・プロバイダー・ワーカー・プラン・テナント設定・障害情報・監査ログ・稼働状況・AI インサイト |
| マルチテナント | サブドメインでテナント解決。ロゴ・名称・カラー・手数料をテナント別に設定（ホワイトラベル対応） |
| AI Optimizer | ルールベース + 統計（Zスコア・回帰）による異常検知・停止検知・劣化予測。全検知に根拠数値を添付 |
| セキュリティ | scrypt・TOTP 2FA・step-up 認証・CSRF・レート制限・監査ログ・RBAC・セキュリティヘッダ（詳細は SECURITY.md） |

## アーキテクチャ（概要）

```
Browser ── HTTPS/SSE ──▶ Next.js 16 (App Router)
                           ├─ modules/   ビジネスロジック（Modular Monolith）
                           │    auth / tenant / provider / mining / bitcoin
                           │    revenue / wallet / billing / ai / admin
                           ├─ lib/store  DB抽象（memory ⇄ Prisma/PostgreSQL）
                           └─ adapters   外部I/O（Provider / Pool / Stratum / Custody）
                                  │
              External: ASIC Farms / Mining Pools / Bitcoin APIs / Custody(HSM)
```

設計方針 3 箇条:
1. **Modular Monolith で始め、境界はマイクロサービス前提で切る**（後から分離可能）
2. **外部依存はすべてアダプタ**（未設定なら Mock で完全動作。特定企業にロックインしない）
3. **金銭計算は純関数・残高は複式元帳**（テスト可能・監査可能・壊れない）

詳細: [ARCHITECTURE.md](./ARCHITECTURE.md)

## ドキュメント

| ファイル | 内容 |
|---|---|
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 要件定義（機能/非機能/受け入れ基準） |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | アーキテクチャ・データフロー・インフラ設計 |
| [DATABASE.md](./DATABASE.md) | DB 設計（34テーブル・インデックス・RLS・マイグレーション運用） |
| [API.md](./API.md) | API 設計（全エンドポイント・共通仕様・SSE） |
| [SECURITY.md](./SECURITY.md) | 脅威モデルと対策・出金セキュリティ・監査 |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | デプロイ手順（Docker / クラウド / 環境変数チェックリスト） |
| [OPERATIONS.md](./OPERATIONS.md) | 運用手順・障害対応ランブック |
| [docs/](./docs/) | ER図・画面設計・ロードマップ・外部依存・コスト・法規制・マニュアル類 |

## コマンド

```bash
npm run dev          # 開発サーバー
npm run build        # 本番ビルド
npm test             # ユニットテスト（127件）
npm run typecheck    # 型チェック
npm run lint         # ESLint

# PostgreSQL を使う場合（.env.local に DATABASE_URL を設定後）
npx prisma migrate dev --name init
npm run prisma:seed  # デモデータ投入（本番では実行しない）

# Docker（本番相当）
docker compose up -d
docker compose exec app npx prisma migrate deploy
```

## 環境変数

すべて任意です（未設定ならデモモード）。全一覧とそれぞれの「未設定時の挙動」は [.env.example](./.env.example) を参照してください。

| 変数 | 未設定時 | 本番 |
|---|---|---|
| `DATABASE_URL` | インメモリ（再起動で消える） | **必須**（PostgreSQL） |
| `ENCRYPTION_KEY` | 開発用固定鍵 | **必須**（hex 64文字） |
| `REDIS_URL` | インメモリ LRU | 推奨 |
| `MINING_PROVIDER_MODE` | `mock` | `live` + プロバイダー契約 |
| `WALLET_PROVIDER_MODE` | `mock`（実送金なし） | `custody` + カストディ実装 |
| `BITCOIN_SOURCE_PRIMARY` | Mock 値 | 実 API URL |

⚠ **Vercel 等サーバーレスへデモモード（インメモリ）のままデプロイしないでください。**
インスタンス間でセッションが共有されず、ログインが不安定になります。本番公開時は `DATABASE_URL` が必須です。

## 免責・コンプライアンス

- 表示される収益はすべて**推定値**であり、収益を保証するものではありません
- 本リポジトリの利用規約・プライバシーポリシーは**ひな型**です。事業開始前に必ず [docs/法規制・コンプライアンス.md](./docs/法規制・コンプライアンス.md) のチェックリストに沿って専門家のレビューを受けてください
- 秘密鍵・API キーをリポジトリにコミットしないでください（`.env.example` のみ）

## License

Proprietary — クライアント納品用
