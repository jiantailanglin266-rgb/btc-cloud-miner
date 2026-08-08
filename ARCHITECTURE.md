# ARCHITECTURE.md — システムアーキテクチャ / データフロー / インフラ設計

---

## 1. 設計方針（3箇条）

1. **Modular Monolith で始め、境界はマイクロサービス前提で切る。**
   MVP は 1 プロセスで動かすが、`src/modules/<domain>/` 単位で依存方向を固定し、
   各モジュールが「インターフェース経由でしか他モジュールを呼ばない」状態を保つ。
   将来そのままプロセス分割できる。

2. **外部依存はすべて差し替え可能なアダプタにする。**
   マイニングプロバイダー・BTC ネットワーク情報源・ウォレット・AI・DB・キャッシュ。
   環境変数が未設定なら Mock / インメモリにフォールバックし、**開発者は契約ゼロで全機能を動かせる**。

3. **お金に関わる計算は純関数、副作用は境界だけ。**
   Revenue Engine・手数料計算・残高計算は入出力が決まった純関数として実装し、
   ユニットテストで固定する。DB 書き込み・外部送金はその外側に置く。

---

## 2. 全体アーキテクチャ

```
                         ┌──────────────────────────────┐
   PC / Tablet / Phone   │        Browser (Next.js)      │
   ────────────────────▶ │  App Router / RSC / Client    │
                         └───────────┬──────────────────┘
                                     │ HTTPS  (+ SSE for realtime)
                         ┌───────────▼──────────────────┐
                         │      Edge / CDN / WAF         │  ← CloudFront・Cloudflare 等
                         └───────────┬──────────────────┘
                                     │
                         ┌───────────▼──────────────────┐
                         │        API Gateway            │  ← Next.js Route Handlers
                         │  authn / authz / ratelimit    │     (+ 将来 Kong/APIGW へ分離可)
                         │  tenant resolve / audit       │
                         └───────────┬──────────────────┘
                                     │
   ┌─────────────────────────────────┼─────────────────────────────────────┐
   │                    Application Modules (Modular Monolith)             │
   │                                                                       │
   │  auth      mining     provider     bitcoin     revenue                │
   │  tenant    wallet     billing      notify      admin      ai          │
   │                                                                       │
   └───┬───────────────┬───────────────┬───────────────┬───────────────────┘
       │               │               │               │
  ┌────▼─────┐   ┌─────▼─────┐   ┌─────▼──────┐  ┌─────▼────────────┐
  │PostgreSQL│   │   Redis   │   │  Queue     │  │ Object Storage   │
  │ (RLS)    │   │ cache/    │   │ (BullMQ)   │  │ (レポート/CSV)   │
  │          │   │ ratelimit │   │ workers    │  │                  │
  └──────────┘   └───────────┘   └─────┬──────┘  └──────────────────┘
                                       │
   ┌───────────────────────────────────▼───────────────────────────────────┐
   │                     Backend Mining Gateway (別プロセス可)              │
   │   StratumClient (V1→V2) / Provider REST poller / Health prober        │
   └───┬───────────────────┬───────────────────┬───────────────────────────┘
       │                   │                   │
  ┌────▼──────┐     ┌──────▼──────┐     ┌──────▼───────┐    ┌──────────────┐
  │ Mining    │     │ Mining Pool │     │ Bitcoin Node │    │ Custody /    │
  │ Provider  │     │ (Stratum)   │     │ / Explorer   │    │ HSM / KMS    │
  │ ASIC Farm │     │             │     │  APIs        │    │ (署名)        │
  └───────────┘     └─────────────┘     └──────────────┘    └──────────────┘
                                  ↓
                          Bitcoin Network
```

**重要**: ブラウザから Stratum を直接叩かせない。Stratum は TCP ベースの永続接続であり、
認証情報がクライアントに露出するため、必ず Backend Mining Gateway を経由させる。

> 補足：**Stratum** = マイニングプールとマイナー機器の間の通信プロトコル。
> プールが「この範囲を計算して」と仕事（job）を配り、マイナーが結果（share）を返す。
> **V2** は暗号化・改ざん耐性・仕事選択の分散化が加わった新版。

---

## 3. モジュール構成と依存方向

```
                    ┌─────────────┐
                    │   app/      │  ルーティング・表示のみ
                    └──────┬──────┘
                           │ 呼ぶ
                    ┌──────▼──────┐
                    │  modules/   │  ビジネスロジック
                    └──────┬──────┘
                           │ 呼ぶ
            ┌──────────────┼──────────────┐
       ┌────▼────┐   ┌─────▼─────┐  ┌─────▼─────┐
       │  store  │   │ adapters  │  │   core    │
       │ (DB抽象)│   │ (外部I/O) │  │ (純関数)  │
       └─────────┘   └───────────┘  └───────────┘
```

| モジュール | 責務 | 外部依存 |
|---|---|---|
| `auth` | 登録・ログイン・セッション・TOTP・RBAC | – |
| `tenant` | テナント解決・ブランディング・テナント設定 | – |
| `mining` | ワーカー統計の取り込み・集計・稼働率算出 | provider 経由 |
| `provider` | `MiningProviderInterface` とアダプタ群・ヘルス管理 | 外部 Provider / Pool / Stratum |
| `bitcoin` | ネットワーク情報・価格の取得と多重化キャッシュ | 外部 Explorer / Price API |
| `revenue` | 収益計算エンジン・シミュレーター（純関数） | – |
| `wallet` | 残高・出金申請・承認・異常検知 | 外部 Custody |
| `billing` | プラン・契約・ハッシュレート割当 | 外部 決済（商用） |
| `notify` | 通知の生成・配信 | 外部 メール（商用） |
| `admin` | 管理者向け集約ユースケース | – |
| `ai` | 異常検知・推奨アクション生成 | 外部 LLM（任意） |

**依存ルール（lint で強制する）**
- `app/` からは `modules/` と `lib/` のみ import 可。Prisma / 外部 SDK を直接 import しない
- `modules/*/core.ts`（純関数）は他モジュールを import しない
- Prisma クライアントは `lib/store/prisma.ts` からのみ import
- 外部 SDK は `modules/*/adapters/` からのみ import

---

## 4. データフロー

### 4.1 マイニング統計の取り込み（DF-1）

```
[Scheduler (cron / BullMQ repeatable)]
        │ 5分ごと
        ▼
[ProviderRegistry] ── 有効な Provider を列挙
        │
        ├─ for each provider ──▶ [Adapter.fetchWorkers()]
        │                              │ timeout 10s / retry 3回(指数バックオフ)
        │                              │ circuit breaker: 連続5回失敗で60s遮断
        │                              ▼
        │                        [正規化: WorkerSnapshot[]]
        │                              │
        ▼                              ▼
[ProviderHealth 更新]           [worker_snapshots へ upsert]
 ONLINE/DEGRADED/OFFLINE                │
        │                               ▼
        │                        [5分足 → 1時間足 → 日足 ロールアップ]
        │                               │
        └──────────────┬────────────────┘
                       ▼
              [異常検知 (ai module)]
                       │
                       ▼
              [通知生成 / アラート]
```

失敗時: circuit breaker が開いている間はキャッシュ済みの最終スナップショットを返し、
UI には `データが N 分前のものです` と `DEGRADED` バッジを出す。**500 は返さない。**

### 4.2 ダッシュボード表示（DF-2）

```
[Browser] ─GET /dashboard─▶ [RSC (Server Component)]
                                │ lib/store を直接呼ぶ（API 往復なし）
                                ├─▶ 契約・割当ハッシュレート
                                ├─▶ 直近スナップショット集計
                                ├─▶ BitcoinNetworkService.get()  (Redis cache 60s)
                                └─▶ RevenueEngine.calculate()     (純関数)
                                │
                                ▼
                        初期HTML（数値入りで即表示）
                                │
[Browser] ─GET /api/stream/dashboard (SSE)─▶ [Route Handler]
                                │ 10秒ごとに差分push
                                ▼
                        クライアントで数値・グラフを更新
```

### 4.3 出金フロー（DF-3）— 最も慎重に設計する経路

```
[User] 出金申請
   │  ① 2FA 再認証（step-up）
   ▼
[POST /api/wallet/withdrawals]  Idempotency-Key 必須
   │  ② zod バリデーション（アドレス形式・最低額・上限）
   │  ③ KYC 状態チェック
   │  ④ アドレス登録から24h 経過チェック（クールダウン）
   │  ⑤ 残高チェック → available を locked へ原子移動（DB トランザクション + 楽観ロック）
   │  ⑥ 異常検知スコアリング（金額・頻度・新規アドレス・IP/デバイス変化）
   ▼
[status = PENDING_REVIEW]  ── 高リスクなら FLAGGED
   │
   ▼  管理者（申請者とは別人格・admin MFA 必須）
[POST /api/admin/withdrawals/:id/approve]
   │  ⑦ 金額が閾値超なら 2 名承認（4-eyes）
   ▼
[status = APPROVED] → Queue へ enqueue
   │
   ▼
[Worker: WalletProvider.send()]  ← 署名は外部カストディ/HSM 内で実行
   │  ⑧ 送信結果の txid を保存。失敗時は locked を available へ戻す（補償トランザクション）
   ▼
[status = BROADCASTED] → 確認数監視 → [status = CONFIRMED]
   │
   ▼
[監査ログ・通知（メール＋アプリ内）]
```

各ステップは監査ログに記録される。**却下・失敗時は必ず locked を戻す**（残高が消えない設計）。

### 4.4 Bitcoin ネットワーク情報の多重化（DF-4）

```
BitcoinNetworkService.get()
   │
   ├─ 1. Redis キャッシュ（TTL 60s）にあれば即返す
   │
   ├─ 2. なければ primary ソースへ（timeout 5s）
   │        └─ 失敗 → secondary → tertiary
   │
   ├─ 3. 成功 → キャッシュ更新（fresh）＋ 長期キャッシュ更新（TTL 24h, stale 用）
   │
   └─ 4. 全滅 → 長期キャッシュから stale 値を返す（`stale: true`, `ageSec` 付き）
            └─ それも無ければ `unavailable` を返し、UI は該当カードのみグレーアウト
```

---

## 5. リアルタイム方式の選択

| 用途 | 方式 | 理由 |
|---|---|---|
| ダッシュボード数値・グラフ | **SSE**（Server-Sent Events） | 一方向・自動再接続・HTTP/2 で十分。実装と運用が軽い |
| 管理者のライブ監視 | SSE | 同上 |
| 将来: 双方向操作（ワーカー再起動指示等） | WebSocket | 双方向が必要になった時点で追加 |
| SSE 不可な環境 | ポーリング（15s） | 企業プロキシ対策のフォールバック |

> 補足：**SSE** = サーバーからブラウザへ一方向にデータを押し出す HTTP の仕組み。
> WebSocket より簡単で、切断時の自動再接続が標準で入っている。

---

## 6. インフラ設計

### 6.1 環境

| 環境 | 用途 | データ |
|---|---|---|
| `local` | 開発 | インメモリ or ローカル Postgres。Mock プロバイダー |
| `dev` | 結合確認 | 共有 Postgres。Mock プロバイダー |
| `staging` | 本番同等検証 | 本番同等構成。プロバイダーは testnet / sandbox |
| `production` | 本番 | 本番。全外部接続は本番契約 |

### 6.2 本番構成（AWS を例に。GCP / Azure へも移植可能な要素だけを使う）

```
Route53 ─ CloudFront (WAF) ─ ALB ─ ECS Fargate (app x N, autoscaling)
                                     │
                                     ├─ ECS Fargate (worker x N)  ← BullMQ consumer
                                     └─ ECS Fargate (mining-gateway x 2) ← Stratum 常時接続
                                     │
                          RDS PostgreSQL (Multi-AZ, PITR)
                          ElastiCache Redis (cluster mode)
                          S3 (レポート・エクスポート)
                          Secrets Manager + KMS
                          CloudWatch / OpenTelemetry Collector
```

移植性のための原則:
- コンテナ（Docker）で動くものしか使わない
- ベンダー固有 SaaS はアダプタ越しに使う（Secrets / Queue / Storage）
- IaC は Terraform（`infra/terraform/` にモジュール分割）

| 役割 | AWS | GCP | Azure |
|---|---|---|---|
| コンテナ実行 | ECS Fargate / EKS | Cloud Run / GKE | Container Apps / AKS |
| RDB | RDS PostgreSQL | Cloud SQL | Azure DB for PostgreSQL |
| キャッシュ | ElastiCache | Memorystore | Azure Cache for Redis |
| シークレット | Secrets Manager | Secret Manager | Key Vault |
| 鍵管理 | KMS / CloudHSM | Cloud KMS | Key Vault Managed HSM |
| オブジェクト | S3 | GCS | Blob Storage |

### 6.3 マルチテナントのドメイン設計

| パターン | 例 | 実装 |
|---|---|---|
| サブドメイン | `acme.btccloudminer.io` | Host ヘッダから `tenantSlug` を解決 |
| 独自ドメイン | `mining.acme.co.jp` | `tenant_domains` テーブルで逆引き＋証明書は ACM/Let's Encrypt |
| パス | `/t/acme`（開発用） | 開発・デモ用のみ |

テナント解決は `proxy.ts`（Next.js 16。旧 middleware）で行い、
`x-tenant-id` ヘッダとして下流に渡す。**クライアントから tenantId を受け取らない**（なりすまし防止）。

### 6.4 スケーリングとデータ保持

| データ | 粒度 | 保持 | 手段 |
|---|---|---|---|
| worker_snapshots | 5分 | 30日 | パーティション（月次）＋自動 DROP |
| worker_stats_hourly | 1時間 | 1年 | ロールアップジョブ |
| worker_stats_daily | 1日 | 永年 | ロールアップジョブ |
| earnings / payouts | イベント | 永年 | – |
| audit_logs | イベント | 7年 | 追記専用＋コールドストレージへ移送 |

---

## 7. 障害対策マトリクス

| 障害 | 影響 | 対策 | ユーザーへの見え方 |
|---|---|---|---|
| Provider API 停止 | 統計更新停止 | circuit breaker → 最終値を表示、Provider を `OFFLINE` に | `DEGRADED` バッジ＋最終更新時刻 |
| Provider 一部劣化 | 一部ワーカー欠測 | 該当ワーカーのみ `UNKNOWN` | 該当行のみ注記 |
| Stratum 切断 | share 受信停止 | 指数バックオフ再接続、バックアッププールへ切替 | プール状態バッジ |
| BTC 情報 API 全滅 | 難易度・価格が古い | stale キャッシュ返却 | `情報が古い可能性` 注記 |
| Redis 停止 | キャッシュ喪失 | インメモリ LRU にフォールバック（レート制限は fail-closed） | 体感変化なし（やや遅い） |
| DB 停止 | 致命 | Multi-AZ フェイルオーバー、read replica で閲覧継続 | メンテナンス画面 |
| Queue 停止 | 出金処理遅延 | 出金は `APPROVED` のまま保持。復旧後に再処理（冪等） | 「処理中」表示 |
| Custody 停止 | 送金不可 | 送金のみ停止。申請・承認は継続 | 「送金は一時停止中」 |

Provider 状態は `ONLINE` / `DEGRADED` / `OFFLINE` / `MAINTENANCE` の4値で管理し、
ヘルスチェック（30秒間隔）と実データ取得の成否の両方で更新する。

---

## 8. MVP と 商用版の分離

| 領域 | MVP（本リポジトリで実装） | 商用版（追加実装／契約が必要） |
|---|---|---|
| 認証 | メール＋PW、TOTP 2FA、セッション | SSO(SAML/OIDC)、メール確認、PWリセット |
| KYC | ステータス管理・出金ゲート | 外部 eKYC 連携、制裁リスト照合 |
| プロバイダー | Mock / Pool REST / Stratum 骨格 | 実プロバイダー契約・Stratum V2 |
| BTC 情報 | 複数ソース＋キャッシュ＋stale | 自社フルノード運用 |
| 収益 | 完全実装（純関数＋テスト） | 実測 payout との差分補正 |
| ウォレット | 残高・申請・承認・異常検知（Mock 送金） | カストディ／HSM 連携、実送金 |
| 課金 | プラン・契約管理 | 決済（Stripe）・請求書・税務 |
| マルチテナント | テナント分離・ブランディング | 独自ドメイン自動化、テナント別課金 |
| AI | ルールベース異常検知・推奨 | ML モデル、需要予測、LLM レポート |
| 通知 | アプリ内通知 | メール／SMS／Webhook |
| 監視 | ヘルスチェック・監査ログ | APM、SIEM、24/7 オンコール |

---

## 9. 技術スタック確定

| レイヤー | 採用 | 理由 |
|---|---|---|
| Frontend | Next.js 16 (App Router) / React 19 / TypeScript / Tailwind CSS v4 | SSR で初期表示が速く、RSC から直接 DB を読める |
| Backend | Next.js Route Handlers（Node ランタイム） | MVP は同一プロセス。境界が切ってあるので分離可能 |
| 重い非同期 | Node worker（BullMQ 互換 IF）／将来 Python FastAPI（AI 予測） | ML は Python 資産が豊富なため分離余地を残す |
| DB | PostgreSQL 16（Prisma） | 時系列パーティション・RLS・JSONB |
| Cache | Redis（未設定時はインメモリ LRU） | キャッシュ・レート制限・Pub/Sub |
| Realtime | SSE | 一方向で十分。運用が軽い |
| Queue | BullMQ 互換インターフェース（未設定時はインプロセス実行） | 出金・同期・ロールアップ |
| IaC | Terraform | マルチクラウド移植性 |
| CI/CD | GitHub Actions | typecheck → test → build → docker → deploy |
| 監視 | OpenTelemetry | ベンダー中立 |

> Python / FastAPI は MVP では使わない。AI 予測モデルを本格導入する段階で
> `services/ai-predictor`（FastAPI）として切り出す前提で、`ai` モジュールの
> インターフェースを HTTP 越しでも満たせる形にしてある。
