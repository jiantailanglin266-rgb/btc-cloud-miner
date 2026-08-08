# BTC CLOUD MINER — 開発セッション引き継ぎ資料

> この文書は、Claude Code で行った開発セッションの全容を第三者の AI（GPT 等）や開発者に引き継ぐための自己完結サマリーです。
> 作成日: 2026-08-08

---

## 1. 依頼内容（オリジナルの要求仕様の要約)

「Bitcoin Cloud Mining Management Platform」をクライアントへ商用納品できるレベルで設計・開発する。

### 最重要の前提条件（依頼者が明示）

- **「計算資源を使わずに Bitcoin を生成する」システムではない**。Bitcoin の PoW には実際の SHA-256 ハッシュ計算資源（ASIC）が必要
- 革新性は「ASIC を不要にすること」ではなく、**「ASIC 設備をユーザー自身が購入・設置・管理する必要をなくし、外部設備（ASIC ファーム / マイニングプール / ハッシュレートプロバイダー）を API・Stratum で統合し、クラウド経由で抽象化・統合管理すること」**
- GPU マイニングは Bitcoin の主要方式として扱わない（ASIC / SHA-256 前提）
- 将来収益を保証する表示は絶対にしない。すべて「推定値」「シミュレーション」と明示
- 実装上不可能なものを可能であるかのように作らない

### 要求された主な仕様

- サービス名は仮称「BTC CLOUD MINER」（変更可能な構造に）
- B2C / B2B / ホワイトラベル対応のマルチテナント SaaS
- 先に設計 15 点（要件定義・アーキ・DFD・DB・API・セキュリティ・インフラ・画面一覧・権限・MVP/商用分離・ロードマップ・外部依存・コスト・法規制・納品物一覧）を作成してから実装
- MiningProviderInterface による Adapter 方式（特定企業に依存しない）
- Stratum V1 対応（V2 拡張可能）、ブラウザから直接叩かせず Backend Mining Gateway 経由
- BitcoinNetworkService（複数ソース・キャッシュ・fallback で外部 API 停止でも全体が止まらない）
- MiningRevenueEngine（収益計算）+ リアルタイムシミュレーター
- ウォレット（秘密鍵を平文 DB 保存しない。HSM/KMS/MPC/カストディ前提の WalletProviderInterface）
- Admin Console、AI Mining Optimizer（運用最適化・監視・予測のみ。採掘アルゴリズムには関与しない）
- MockMiningProvider によるデモ環境（プロバイダー契約なしで全機能確認可能。環境変数で本番切替）
- 技術スタック: Next.js / React / TS / Tailwind / PostgreSQL / Redis / SSE / Docker / Terraform / GitHub Actions
- PHASE 1〜14 の順で開発し、独立した GitHub リポジトリと公開 URL を作成

---

## 2. 成果物（すべて完了）

### URL

| 種別 | URL |
|---|---|
| フル版リポジトリ（公開） | https://github.com/jiantailanglin266-rgb/btc-cloud-miner |
| 公開デモ（GitHub Pages） | https://jiantailanglin266-rgb.github.io/btc-cloud-miner-demo/ |
| デモ用リポジトリ | https://github.com/jiantailanglin266-rgb/btc-cloud-miner-demo |

### ローカル配置

- フル版: `C:\Users\kenta\OneDrive\デスクトップ\MOFURI\自社LP\btc-cloud-miner`
- 静的デモ: `C:\Users\kenta\OneDrive\デスクトップ\MOFURI\自社LP\btc-cloud-miner-demo`（単一 HTML・外部依存ゼロ）
- 開発サーバー: `npm run dev`（launch.json 登録済み・port 3250）

### デモアカウント（インメモリ seed）

| ロール | メール | パスワード |
|---|---|---|
| 一般ユーザー | demo@example.com | demo1234 |
| プラットフォーム管理者 | admin@example.com | admin1234 |
| サポート（読取のみ） | support@example.com | support1234 |
| テナント管理者（ACME） | owner@acme.example.com | acme1234 |

`npm install && npm run dev` だけで環境変数ゼロでもデモモードとして全機能が動作する（モックファースト設計）。

---

## 3. 技術スタックと全体アーキテクチャ

- **Next.js 16**（App Router / Turbopack / `proxy.ts`＝旧 middleware の新名称・nodejs ランタイム）
- React 19 / TypeScript strict / Tailwind CSS v4（`@theme inline` トークン方式）
- Prisma + PostgreSQL 16（`DATABASE_URL` 未設定時はインメモリ Store に自動フォールバック）
- Redis（未設定時はインメモリ LRU）、リアルタイムは SSE（ポーリング自動フォールバック）
- vitest（ユニット 127 件）、Docker（3 ステージ・非 root）、docker-compose、Terraform 骨格、GitHub Actions CI

### レイヤリング（Modular Monolith）

```
src/
├── app/            ルーティングと表示のみ（ロジック禁止）
│   ├── (auth)/     login, register
│   ├── (app)/      dashboard, mining, workers, revenue, simulator,
│   │               wallet, contracts, network, notifications, support, settings
│   ├── admin/      概要, users, withdrawals, providers, workers, plans,
│   │               tenant, incidents, audit, health, ai
│   ├── legal/      terms, privacy, risk（ひな型・要弁護士レビューと明記）
│   └── api/        Route Handlers（auth/dashboard/bitcoin/simulator/wallet/
│                   admin/notifications/stream(SSE)/health）
├── modules/        ビジネスロジック本体
│   ├── auth/       session(サーバー側セッション), totp(RFC6238自前実装), rbac
│   ├── tenant/     Host ヘッダからのテナント解決・ブランディング
│   ├── provider/   interface / registry / adapters(mock, pool-rest,
│   │               stratum, provider-a, provider-b)
│   ├── bitcoin/    service(多重ソース+stale) / sources
│   ├── mining/     aggregate(ダッシュボード集約・時系列)
│   ├── revenue/    engine.ts（★純関数・他モジュール import 禁止）
│   ├── wallet/     ledger(複式元帳) / risk(異常検知) / address(チェックサム検証)
│   │               / interface / providers/mock-custodian
│   └── ai/         optimizer(ルールベース+統計の異常検知)
├── lib/            api / validation(zod) / crypto / decimal / audit /
│                   rate-limit / circuit-breaker / cache / csv / format /
│                   config / store/(types, memory, prisma, index)
├── types/          ドメイン型（DB とメモリ実装の共通語彙）
└── proxy.ts        テナント解決・認証ガード・管理画面 IP 制限
```

### 強制している規約

1. Prisma は `lib/store/prisma.ts` 以外から import 禁止（Store インターフェースで差し替え可能）
2. 外部 fetch/SDK は adapters と bitcoin/sources のみ
3. BTC 金額は文字列 + `lib/decimal.ts`（satoshi 整数 bigint 演算）。number で加減算しない
4. `tenantId` は全 Store メソッドの必須引数（テナント越境をコンパイルレベルで防止）
5. 収益 API の戻り値は型レベルで `isEstimate: true` + `disclaimer` を強制

---

## 4. 主要な設計判断とその理由

| 判断 | 理由 |
|---|---|
| JWT ではなくサーバー側セッション | 金銭を扱うため「即時失効」が必須。JWT は失効できない |
| 残高カラムを持たず複式元帳（ledger_entries の合計＝残高） | 残高が壊れても全履歴から再導出できる。二重計上は UNIQUE(tenantId, idempotencyKey) で構造的に防止 |
| 出金フロー: step-up 2FA → アドレス24hクールダウン → リスクスコアリング → 4-eyes承認（申請者≠承認者、閾値超は2名）→ 冪等送金 → 失敗時は補償トランザクションで残高返却 | 不正出金が最大の脅威。SECURITY.md の脅威モデル T3 対応 |
| 秘密鍵はシステムに一切保持しない | WalletProviderInterface で外部カストディ/HSM に署名を委譲。Mock は署名しない |
| BTC アドレスは正規表現でなくチェックサム検証（Base58Check の double-SHA256 / Bech32・Bech32m の BCH 符号を自前実装） | 送金は取り消せない。打ち間違い検出が必須。BIP-173/350 公式テストベクタでテスト済み |
| TOTP は RFC 6238 を自前実装（~100行） | 依存削減と監査可能性。RFC Appendix B の公式ベクタ 6 件でテスト固定 |
| circuit breaker（CLOSED→OPEN→HALF_OPEN）を全外部呼び出しに適用 | 「相手の障害が自分の障害になる」のを遮断。プロバイダー状態は ONLINE/DEGRADED/OFFLINE/MAINTENANCE の4値管理 |
| Bitcoin 情報は 4 段フォールバック（キャッシュ→複数ソース→stale キャッシュ→Mock）で例外を投げない | 外部 API 全滅でも 500 を返さず、UI は「N分前の値」表示で継続 |
| AI はルールベース+統計（Zスコア・最小二乗トレンド）で開始 | 金融文脈では説明可能性が必須。全検知に根拠数値(evidence)を添付。ML は運用データ蓄積後に補助として追加する方針 |
| Mock データは決定的（時刻からのハッシュベース生成） | リロードで数値が飛ばない・テスト可能・日周変動/瞬断/温度相関まで再現 |
| Stratum はワーカー統計を返さない仕様に忠実（fetchWorkers は空を返す） | 「取れないものを取れるように見せない」。役割は接続監視・job 配信確認・vardiff 取得 |

---

## 5. 検算済みの基準値（テストで固定）

入力: 500 TH/s / 難易度 126.4T / 報酬 3.125 BTC / BTC $95,000 / 17.5 J/TH / $0.06/kWh / プール2% / PF2% / 稼働率 98.5%

| 項目 | 値 |
|---|---|
| 推定 BTC/日 | 0.00024494 |
| Gross / 日 | $23.27 |
| 電力（206.9 kWh/日） | -$12.41 |
| 手数料（プール+PF） | -$0.94 |
| **純収益 / 日** | **$9.93**（利益率 42.7%） |
| 損益分岐 BTC 価格 | $52,780 |
| 損益分岐 電力単価 | $0.1080/kWh |
| 年間純収益 | 約 $3,624 |

計算式: `BTC/day = blockReward × 86400 × hashrate / (difficulty × 2^32) × uptime`

**この試算から導いた重要な事業判断**: 500TH/s の年間純収益が ~$3,624 のため、前払い $12,000 のような価格設定は ROI 1,209 日で契約期間内に回収不能＝景表法リスク。ドキュメントでは**レベニューシェア型を推奨**し、前払いプランは ROI が期間内に収まる価格（例 $3,000 → ROI 303日）に設定。UI は回収不能なプランに警告を表示する。

---

## 6. 検証結果

- **vitest 127 件全緑**: 収益エンジン（既知値一致・恒等式・損益分岐で純収益=0）、decimal（0.1+0.2 問題・365日積算の正確性）、TOTP（RFC ベクタ）、crypto（scrypt・AES-GCM 改ざん検知）、元帳（残高が消えない・冪等重複検出）、アドレス（公式ベクタ・1文字改変で拒否）、リスク検知、circuit breaker（状態遷移）、Mock（決定性・範囲・滑らかさ）、CSV（RFC4180・インジェクション対策）、**テナント分離（他テナントの ID を知っていても引けない）**
- **実機 API パイプライン 29 項目全パス**: ログイン → 誤PW 401 → 未認証 401 → ダッシュボード集約 → 時系列 → シミュレーター（isEstimate 確認）→ 不正入力 400 → 2FA なし出金拒否 → 2FA setup/enable（実 TOTP コード生成）→ 出金申請 → **同一 Idempotency-Key 再送で同一結果** → locked 残高移動 → 残高超過拒否 → 管理者ログイン+2FA → 一般ユーザーの admin API 403 → **管理者承認 → Mock 送金（demo- txid）** → CSRF なし 403 → CSV(BOM) → セキュリティヘッダ
- `npm run build` エラーゼロ（34 ルート）

### セッション中に発見・修正したバグ

1. `verifyPassword("any", "scrypt$zz$zz")` が true を返す脆弱性（hex 解釈不能→空バッファ同士の timingSafeEqual が一致）→ 空バッファの明示的拒否を追加。**テストが検出した**
2. Next.js 16 では `output: "standalone"` 設定時に `next start` がハングする → 検証は `node .next/standalone/server.js`（.next/static と public のコピーが必要）
3. デモ seed が 500TH/s を実機 2 台に割当てて「worker-014 停止」通知と矛盾 → ワーカーを実機の 1/10 スライス（22台）に変更

---

## 7. ドキュメント一覧（リポジトリ内）

ルート: README / REQUIREMENTS / ARCHITECTURE / DATABASE(34テーブル・RLS・パーティション方針) / API(全エンドポイント・エラーコード・SSE仕様) / SECURITY(脅威モデル12件と対策) / DEPLOYMENT(Docker/Vercel+Supabase/AWS) / OPERATIONS(ランブック6本・定期ジョブ・アラート閾値) / .env.example(全変数に「未設定時の挙動」記載)

docs/: ER図(mermaid) / 画面設計書(ASCIIレイアウト・状態設計) / ディレクトリ構成 / 開発ロードマップ(Stage0-4・技術的負債10件) / 外部サービス依存関係(14依存・契約チェックリスト) / コスト構造(インフラ試算3規模・ユニットエコノミクス) / **法規制・コンプライアンス(資金決済法・金商法・景表法・AML等のチェックリスト。法的助言ではない旨明記)** / 納品物一覧 / 管理者マニュアル / 利用者マニュアル / 開発者ガイド

---

## 8. 意図的に MVP から除外したもの（差し替え口は実装済み）

| 項目 | 現状 | 拡張点 |
|---|---|---|
| 実プロバイダー接続 | Mock | `adapters/provider-a.ts` の 3 メソッドを実装するだけ |
| 実送金（カストディ） | Mock（署名しない） | `WalletProvider` 実装 + `WALLET_PROVIDER_MODE=custody` |
| Stratum V2 | V1 のみ | `handleMessage` の差し替えポイントをコメントで明示 |
| メール通知 | アプリ内通知のみ | `modules/notify` |
| 決済（Stripe） | 契約は申請扱い | `billing` モジュール |
| eKYC ベンダー | ステータス手動管理 | `kyc_records` にステータスのみ保持する設計 |
| キュー（BullMQ） | インプロセス実行 | 出金処理は冪等なので載せ替え可能 |
| ML ベースの AI | ルールベース+統計 | evidence 付き出力形式は維持する前提 |

---

## 9. GPT へ相談する際の注意（このプロジェクトの不変条件）

1. **収益保証・元本保証・「必ず儲かる」表現をコードにも文言にも追加しないこと**（テストが検査している）
2. **秘密鍵をアプリ・DB・環境変数に置く提案をしないこと**
3. BTC 金額に JavaScript の number 演算を使わないこと（`lib/decimal.ts` 経由）
4. 残高を直接 UPDATE する実装にしないこと（必ず元帳へ追記）
5. `tenantId` をリクエストボディから受け取らないこと（Host ヘッダからサーバー側解決）
6. Next.js は 16 系（`middleware.ts` ではなく `proxy.ts`、`params`/`cookies()` は Promise、`next start` は standalone 非対応）
