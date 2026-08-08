# REQUIREMENTS.md — 要件定義書

サービス名（仮称）: **BTC CLOUD MINER**
文書バージョン: 1.0 / 対象: MVP 〜 商用版

---

## 0. このシステムが「やること」と「やらないこと」

### 前提となる技術的事実

Bitcoin の採掘（マイニング）は **SHA-256 のハッシュ計算を実際に大量に実行する**ことでしか成立しません。
ソフトウェアの工夫で計算量を減らしたり、計算せずに BTC を生成したりすることは **原理的に不可能**です。

> 補足：**PoW（Proof of Work）** = 「仕事の証明」。膨大な試行計算を行った証拠をブロックに付けることで、
> ネットワークの改ざんを困難にする仕組み。計算そのものがコストであり、そこを省略する手段は存在しない。

### したがって本システムの価値は「抽象化」と「統合管理」にある

| ユーザーが本来やること | 本システムでの扱い |
|---|---|
| ASIC マイナーの購入 | **不要**（提携ファーム／プロバイダーの実機を契約ハッシュレート単位で利用） |
| 設置場所・電力契約・冷却 | **不要**（プロバイダー側の設備を利用） |
| ハードウェア保守・故障対応 | **不要**（プロバイダー SLA に委譲。稼働率は本システムが可視化） |
| マイニングプール設定・Stratum 接続 | **不要**（Backend Mining Gateway が代行） |
| 収益計算・電気代按分・手数料計算 | **自動**（Revenue Engine が算出） |
| 複数プロバイダーの管理画面を行き来 | **不要**（1画面に統合） |

> 補足：**ASIC** = Bitcoin 採掘専用チップを積んだ機械。GPU の数百〜数千倍効率が良いため、
> 現在の Bitcoin 採掘は事実上 ASIC 専用。本システムでは GPU マイニングを Bitcoin の主方式として扱わない。

### 本システムが絶対にやらないこと（レッドライン）

1. 「計算資源なしで BTC が増える」という表現・機能を作らない
2. 将来収益を **保証**する表示をしない（すべて「推定（estimated）」と明示）
3. 元本保証・確定利回りの提示をしない（＝金融商品的な勧誘表現をしない）
4. ユーザーの BTC 秘密鍵を平文で DB に保存しない
5. 実データが取得できない項目を「それらしい数値」で埋めて本物のように見せない
   （デモ環境は必ず `DEMO` バッジと Mock 表示を出す）

---

## 1. サービス概要

### 1.1 提供形態

| 形態 | 内容 |
|---|---|
| **B2C** | 個人が契約ハッシュレート（TH/s）を購入し、収益をブラウザで確認・出金 |
| **B2B** | 法人が大口ハッシュレートを契約し、部門別・拠点別に配分して管理 |
| **ホワイトラベル（OEM）** | 他社が自社ブランドで同サービスを提供。ロゴ／ドメイン／料金／手数料をテナント単位で変更 |

上記すべてを **1つのマルチテナント SaaS** で提供する。

> 補足：**マルチテナント** = 1つのシステムを複数の顧客企業（テナント）で共有しつつ、
> データは相互に完全分離する方式。テナントごとにサーバーを建てるより運用コストが低い。

### 1.2 レイヤー構成（責務の分離）

```
ユーザー（ブラウザ）
   ↓ HTTPS / WebSocket
Webアプリ（Next.js）
   ↓
Cloud Mining Management Layer  ← 本システムの本体
   ↓ HTTP API / Stratum
Mining Provider / ASIC Farm / Mining Pool  ← 外部（実機・実計算）
   ↓
Bitcoin Network
```

本システムは第3層のみを実装する。第4層は外部との契約・API 統合であり、
**アダプタ方式**で差し替え可能にする（特定企業へのロックインを避ける）。

---

## 2. アクター（登場人物）と権限

| ロール | 説明 | 主な操作 |
|---|---|---|
| `GUEST` | 未ログイン | LP 閲覧、収益シミュレーター（保存なし） |
| `USER` | 一般契約者（B2C／B2B メンバー） | ダッシュボード閲覧、シミュレーター、出金申請、プラン変更申請 |
| `ORG_ADMIN` | B2B 契約企業の管理者 | 自組織のメンバー招待・ハッシュレート配分・組織全体の収益確認 |
| `TENANT_ADMIN` | ホワイトラベル提供先の運営者 | 自テナントのユーザー管理・料金設定・ブランディング・出金一次承認 |
| `PLATFORM_ADMIN` | 本サービス運営（自社） | 全テナント管理、プロバイダー接続、出金最終承認、監査ログ閲覧 |
| `SUPPORT` | サポート担当 | ユーザー閲覧（読み取り専用）、チケット対応。出金操作は不可 |
| `AUDITOR` | 監査担当 | 監査ログ・取引履歴の読み取り専用 |

原則：**最小権限（least privilege）**。出金は「申請者 ≠ 承認者」を必ず担保する。

---

## 3. 機能要件

### 3.1 認証・アカウント（FR-AUTH）

| ID | 要件 | MVP | 商用 |
|---|---|:--:|:--:|
| FR-AUTH-01 | メール＋パスワードで登録（scrypt ハッシュ、平文保存禁止） | ✅ | ✅ |
| FR-AUTH-02 | ログイン・ログアウト（httpOnly Cookie セッション） | ✅ | ✅ |
| FR-AUTH-03 | TOTP による2段階認証（RFC 6238） | ✅ | ✅ |
| FR-AUTH-04 | 出金・重要操作時の 2FA 再認証（step-up authentication） | ✅ | ✅ |
| FR-AUTH-05 | パスワードリセット（メール） | – | ✅ |
| FR-AUTH-06 | リカバリーコード発行・再発行 | – | ✅ |
| FR-AUTH-07 | セッション一覧・他端末強制ログアウト | ✅ | ✅ |
| FR-AUTH-08 | ログイン試行のレート制限・IP／デバイス記録 | ✅ | ✅ |
| FR-AUTH-09 | メールアドレス確認（verification） | – | ✅ |
| FR-AUTH-10 | SSO（SAML / OIDC）— B2B 向け | – | ✅ |

### 3.2 本人確認（FR-KYC）

| ID | 要件 | MVP | 商用 |
|---|---|:--:|:--:|
| FR-KYC-01 | KYC ステータス管理（`NOT_SUBMITTED` / `PENDING` / `APPROVED` / `REJECTED` / `EXPIRED`） | ✅ | ✅ |
| FR-KYC-02 | 出金可否を KYC ステータスで制御 | ✅ | ✅ |
| FR-KYC-03 | 外部 KYC ベンダー連携（本人確認書類・eKYC） | – | ✅ |
| FR-KYC-04 | 制裁リスト／PEP スクリーニング | – | ✅ |

> 本システム自体は身分証画像を保持しない設計を推奨（外部 KYC ベンダーに委譲し、結果ステータスのみ保持）。

### 3.3 ダッシュボード（FR-DASH）

リアルタイム表示項目（全て MVP 対象）:

| 表示名 | 意味 | 出所 |
|---|---|---|
| Current Hashrate | 直近の実効ハッシュレート | Provider |
| Average Hashrate | 期間平均ハッシュレート | 集計 |
| Purchased / Allocated Hashrate | 契約量 / 実際に割り当てられた量 | 契約 DB |
| Active Miners / Offline Miners | 稼働中／停止中のワーカー台数 | Provider |
| Bitcoin Network Difficulty | ネットワーク難易度 | BitcoinNetworkService |
| Bitcoin Network Hashrate | ネットワーク全体のハッシュレート | BitcoinNetworkService |
| Current BTC Price | BTC 価格（USD / JPY） | Price source |
| Estimated BTC / Day・/ Month | 推定採掘量 | Revenue Engine |
| Electricity Cost | 電力コスト | Revenue Engine |
| Pool Fee / Infrastructure Fee | プール手数料 / インフラ手数料 | Revenue Engine |
| Net Mining Revenue | 純収益（推定） | Revenue Engine |
| Mining Efficiency | J/TH（消費電力効率） | Provider |
| Uptime | 稼働率 | 集計 |
| Block Reward | 現在のブロック報酬 | BitcoinNetworkService |
| Estimated Profit Margin | 推定利益率 | Revenue Engine |

- グラフ期間切替: **1時間 / 24時間 / 7日 / 30日 / 90日 / 1年**
- リアルタイム更新: SSE（Server-Sent Events）。フォールバックはポーリング
- すべての推定値に `推定` バッジと算出根拠のツールチップを付与

### 3.4 マイニング統合レイヤー（FR-MINING）

| ID | 要件 | MVP | 商用 |
|---|---|:--:|:--:|
| FR-MINING-01 | `MiningProviderInterface` を定義し、全プロバイダーをアダプタで実装 | ✅ | ✅ |
| FR-MINING-02 | `MockMiningProvider`（デモ用・時間変化する擬似データ） | ✅ | ✅ |
| FR-MINING-03 | `MiningPoolAdapter`（プール REST API からワーカー統計取得） | ✅ | ✅ |
| FR-MINING-04 | `StratumAdapter`（Stratum V1 でプールへ接続・購読） | 骨格 | ✅ |
| FR-MINING-05 | プロバイダー状態管理（`ONLINE` / `DEGRADED` / `OFFLINE` / `MAINTENANCE`） | ✅ | ✅ |
| FR-MINING-06 | retry / timeout / circuit breaker / fallback | ✅ | ✅ |
| FR-MINING-07 | 定期同期ジョブ（ワーカー統計を N 分ごとに取り込み） | ✅ | ✅ |
| FR-MINING-08 | Stratum V2 対応 | – | ✅ |

取得データ項目: `workerId` / `minerId` / `hashrate` / `acceptedShares` / `rejectedShares` /
`temperature` / `powerConsumption` / `uptime` / `poolStatus` / `workerStatus` / `estimatedEarnings`

### 3.5 Bitcoin ネットワーク情報（FR-BTC）

| ID | 要件 | MVP | 商用 |
|---|---|:--:|:--:|
| FR-BTC-01 | difficulty / network hashrate / block height / block reward の取得 | ✅ | ✅ |
| FR-BTC-02 | mempool サイズ・推奨手数料の取得 | ✅ | ✅ |
| FR-BTC-03 | 次回難易度調整の推定（残ブロック数・推定変化率） | ✅ | ✅ |
| FR-BTC-04 | **複数データソース**（primary / secondary / tertiary）＋自動フェイルオーバー | ✅ | ✅ |
| FR-BTC-05 | キャッシュ（Redis / インメモリ）と stale-while-error（取得失敗時は古い値を返す） | ✅ | ✅ |
| FR-BTC-06 | 全ソース停止時もサービスは停止せず、`degraded` 表示で継続 | ✅ | ✅ |

### 3.6 収益計算エンジン（FR-REV）

`MiningRevenueEngine` は **純関数**として実装し、ユニットテスト可能にする。

入力: `hashrateThs` / `networkHashrateThs` / `difficulty` / `blockRewardBtc` / `btcPrice` /
`electricityPriceKwh` / `efficiencyJPerTh` / `poolFeeRate` / `platformFeeRate` / `uptimeRate`

出力: `estimatedBtcPerDay` / `estimatedBtcPerMonth` / `grossRevenue` / `electricityCost` /
`poolFee` / `platformFee` / `netRevenue` / `breakEvenBtcPrice` / `breakEvenElectricityPrice` / `roiDays` / `profitMargin`

制約:
- 出力は必ず「推定値」ラベル付きで返し、UI でも明示
- 難易度・価格変動の影響を明示する注記を必ず併記
- 保証・確定利回りの語を UI・API レスポンスに含めない

### 3.7 収益シミュレーター（FR-SIM）

ユーザーが以下を変更すると即時に再計算（サーバー往復なしのクライアント計算＋サーバー検証）:
`Hashrate (TH/s)` / `ASIC efficiency (J/TH)` / `Electricity price` / `BTC price` /
`Network difficulty` / `Pool fee` / `Uptime` / `契約期間`

出力: 日次・月次・年次の推定収益、損益分岐点、ROI、感度分析（価格 ±50%、難易度 ±30%）

### 3.8 ウォレット・出金（FR-WALLET）

| ID | 要件 | MVP | 商用 |
|---|---|:--:|:--:|
| FR-WALLET-01 | `WalletProviderInterface` による抽象化 | ✅ | ✅ |
| FR-WALLET-02 | BTC 出金先アドレス登録（形式検証・アドレス変更後クールダウン24h） | ✅ | ✅ |
| FR-WALLET-03 | 残高管理（`available` / `pending` / `locked`） | ✅ | ✅ |
| FR-WALLET-04 | 出金申請（最低出金額・手数料の明示） | ✅ | ✅ |
| FR-WALLET-05 | 出金の管理者承認フロー（申請者 ≠ 承認者、金額により2名承認） | ✅ | ✅ |
| FR-WALLET-06 | 異常出金検知（頻度・金額・新規アドレス・IP 変化） | ✅ | ✅ |
| FR-WALLET-07 | 出金履歴・報酬履歴（CSV エクスポート） | ✅ | ✅ |
| FR-WALLET-08 | HSM / KMS / MPC / 外部カストディ連携 | 設計のみ | ✅ |
| FR-WALLET-09 | 二重支払い防止（冪等キー・楽観ロック・残高原子減算） | ✅ | ✅ |

**秘密鍵の扱い（絶対要件）**: 本システムのアプリケーション DB に秘密鍵・シードを保存しない。
署名は外部カストディ／HSM／KMS 側で行い、本システムは「出金指示」と「トランザクションID」のみを保持する。

### 3.9 契約・課金（FR-BILLING）

| ID | 要件 | MVP | 商用 |
|---|---|:--:|:--:|
| FR-BILLING-01 | プラン定義（ハッシュレート量・期間・単価・手数料率） | ✅ | ✅ |
| FR-BILLING-02 | 契約の作成・更新・解約・自動更新設定 | ✅ | ✅ |
| FR-BILLING-03 | 契約ごとのハッシュレート割当 | ✅ | ✅ |
| FR-BILLING-04 | 決済（Stripe 等）連携 | – | ✅ |
| FR-BILLING-05 | 請求書発行・領収書 | – | ✅ |

### 3.10 通知・サポート（FR-NOTIFY）

- アプリ内通知（ワーカー停止・難易度調整・出金ステータス・障害情報）
- メール通知（商用版。出金・セキュリティイベントは必須）
- サポートチケット（作成・返信・ステータス）

### 3.11 管理者コンソール（FR-ADMIN）

ユーザー一覧／詳細、KYC、契約、ハッシュレート割当、設備・プロバイダー、ASIC ワーカー、
収益、送金、出金承認、プラン管理、料金・手数料設定、障害情報、通知、ログ、監査ログ、
API 稼働状況、マイニングプール状態。

### 3.12 マルチテナント（FR-TENANT）

テナント単位で変更可能: ロゴ / サービス名 / ドメイン / カラーテーマ / 料金 / 手数料 /
ユーザー / ウォレット設定 / 利用するマイニングプロバイダー。

全テーブルに `tenantId` を持たせ、**アプリ層とDB層（RLS）の二重で分離**する。

### 3.13 AI Mining Optimizer（FR-AI）

MVP は**ルールベース＋統計**で実装（説明可能性を優先）。商用版で ML モデルを追加。

- ハッシュレート異常検知（移動平均からの乖離・Z スコア）
- ワーカー停止検知（最終レポート時刻からの経過）
- 温度・効率劣化検知（メンテナンス予測）
- 収益性分析（難易度・価格トレンドに対する感度）
- 推奨アクション生成（例:「Worker-014 の rejected share 率が 8.2% で異常。プール切替を推奨」）

AI は**運用最適化・監視・予測分析**にのみ使用し、採掘アルゴリズムそのものには関与しない。

---

## 4. 非機能要件

| 分類 | 要件 |
|---|---|
| 可用性 | サービス全体 99.9%（月間ダウンタイム 43分以内）。外部 API 停止時も degraded で継続 |
| 性能 | ダッシュボード初期表示 P95 < 1.5s、API P95 < 300ms、SSE 更新間隔 5〜15s |
| スケーラビリティ | 10万ユーザー / 100万ワーカーレコード / 時系列データ 1年保持 |
| データ保持 | ワーカー統計は5分粒度で30日、1時間粒度で1年、日次で永年 |
| セキュリティ | 別紙 SECURITY.md。OWASP ASVS L2 相当を目標 |
| 監査 | 全ての金銭・権限操作を追記専用の監査ログに記録（最低7年保持） |
| 国際化 | 日本語 / 英語（i18n 構造を最初から用意）。通貨は BTC / USD / JPY |
| アクセシビリティ | WCAG 2.1 AA を目標（コントラスト比・キーボード操作・aria） |
| ブラウザ | Chrome 111+ / Edge 111+ / Firefox 111+ / Safari 16.4+ |
| デバイス | PC / タブレット / スマートフォン すべて最適化 |
| バックアップ | DB 日次フルバックアップ＋ PITR（Point-In-Time Recovery）、リストア訓練を四半期毎 |
| 監視 | メトリクス・ログ・トレース・アラート（Prometheus / OpenTelemetry 互換） |

---

## 5. 制約・前提

1. 実運用には **外部マイニングプロバイダー／ファームとの契約**が必須。契約前は Mock で全機能を確認できる。
2. BTC の実出金には **カストディ事業者またはHSM** が必須。MVP は「出金申請〜承認」までを実装し、
   実送金はカストディ API を差し込む口（`WalletProviderInterface`）として提供する。
3. 暗号資産を扱うため、提供国の**規制対応が前提**（別紙 `docs/法規制・コンプライアンス.md`）。
4. 本リポジトリには秘密鍵・API キー・シードを一切コミットしない（`.env.example` のみ）。

---

## 6. 受け入れ基準（MVP 完了条件）

- [ ] `npm install && npm run dev` のみで、環境変数ゼロでも全画面がデモ動作する
- [ ] デモアカウントでログイン → 2FA 設定 → ダッシュボード → シミュレーター → 出金申請 → 管理者承認 が一気通貫で動く
- [ ] Mock プロバイダーが時間経過でハッシュレート・shares・uptime を変化させる
- [ ] Revenue Engine のユニットテストが全て緑（既知値との照合を含む）
- [ ] 外部 API を全て落としても 500 にならず degraded 表示になる
- [ ] `npm run build` がエラーゼロ
- [ ] 納品ドキュメント一式が揃っている
