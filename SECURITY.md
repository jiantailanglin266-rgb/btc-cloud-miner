# SECURITY.md — セキュリティ設計書

暗号資産と金銭を扱うため、**OWASP ASVS Level 2 相当**を目標とする。
本書は「何を・なぜ・どこで」実装しているかを、監査人が追跡できる形で記述する。

---

## 0. 脅威モデル（何から守るのか）

| # | 脅威 | 影響 | 主な対策 |
|---|---|---|---|
| T1 | 認証情報の漏洩・総当たり | アカウント乗っ取り → 出金 | scrypt、レート制限、ロックアウト、2FA、step-up |
| T2 | セッション窃取（XSS / CSRF） | なりすまし | httpOnly+SameSite、CSP、CSRF トークン |
| T3 | **不正出金** | 直接的な金銭損失 | 4-eyes 承認、アドレスクールダウン、異常検知、冪等キー |
| T4 | 秘密鍵の窃取 | 全資産喪失 | **鍵をシステムに置かない**（外部カストディ / HSM / KMS） |
| T5 | テナント越境 | 情報漏洩・信用失墜 | サーバー側テナント解決、RLS、アプリ層フィルタの二重防御 |
| T6 | 権限昇格 | 管理機能の悪用 | RBAC、ロール変更の監査、admin MFA |
| T7 | SQL/コマンドインジェクション | データ改ざん・漏洩 | Prisma パラメータ化、raw SQL 原則禁止 |
| T8 | 内部不正（管理者の悪用） | 出金・データ改ざん | 追記専用監査ログ、最小権限、承認分離、アラート |
| T9 | 外部 API のなりすまし・改ざん | 誤った収益表示 | TLS 検証、署名検証、複数ソース照合、異常値棄却 |
| T10 | 依存パッケージのサプライチェーン | 任意コード実行 | lockfile 固定、`npm audit`、Dependabot、SBOM |
| T11 | DoS | サービス停止 | WAF、レート制限、circuit breaker、SSE 接続数制限 |
| T12 | 秘密情報のリポジトリ混入 | 全面的な侵害 | `.gitignore`、secret scanning、pre-commit フック |

---

## 1. 認証

### 1.1 パスワード

- ハッシュ: **scrypt**（`N=16384, r=8, p=1, keylen=64`）。保存形式 `scrypt$<salt(hex)>$<hash(hex)>`
- 検証は `crypto.timingSafeEqual`（タイミング攻撃対策）
- 最低 10 文字。よくあるパスワードのブロックリストで拒否
- 変更時は全セッションを無効化し、メール通知（商用版）
- 平文・可逆暗号での保存は禁止

### 1.2 セッション

| 項目 | 仕様 |
|---|---|
| トークン | 32 バイト暗号学的乱数（`crypto.randomBytes`） |
| DB 保存 | **SHA-256 ハッシュのみ**（DB が漏れてもセッションを復元できない） |
| Cookie | `httpOnly` / `Secure`（本番） / `SameSite=Lax` / `Path=/` |
| 有効期限 | 絶対 30日 / アイドル 12時間 |
| ローテーション | ログイン時・権限変更時に再発行（セッション固定化攻撃対策） |
| 失効 | ログアウト・パスワード変更・管理者による停止で即時 |

JWT ではなく **サーバー側セッション**を採用する理由: 即時失効ができるため。
金銭を扱うシステムで「失効できないトークン」は許容しない。

### 1.3 2要素認証（TOTP）

- RFC 6238 準拠（SHA-1 / 6桁 / 30秒）。前後1ステップの許容（時計ずれ対策）
- シークレットは **AES-256-GCM で暗号化**して保存（`enc:v1:<iv>:<tag>:<ct>`）
- 使用済みコードの再利用を拒否（リプレイ対策）
- リカバリーコード: 10個、**ハッシュ化して保存**、1回使い切り
- 検証は 5回/5分でレート制限

### 1.4 step-up 認証（重要操作の再認証）

以下の操作は、直近 **5分以内** に 2FA を通過していることを必須とする:
出金申請 / 出金先アドレスの登録・削除 / 2FA 無効化 / パスワード変更 / API Key 発行

### 1.5 管理者

- `PLATFORM_ADMIN` / `TENANT_ADMIN` は **2FA 必須**（未設定ではログインできない）
- 管理画面は IP 許可リストを設定可能（環境変数 `ADMIN_IP_ALLOWLIST`）
- 管理者操作はすべて監査ログへ

---

## 2. 認可（RBAC）

```
GUEST < USER < ORG_ADMIN < TENANT_ADMIN < PLATFORM_ADMIN
                              SUPPORT (読取のみ)   AUDITOR (監査ログのみ)
```

- 権限判定は **サーバー側でのみ**行う。UI の出し分けはセキュリティ境界ではない
- リソースごとに「所有者チェック」を実施（`resource.userId === session.userId`）
- 他テナント・他ユーザーのリソースは **404** を返す（存在を漏らさない）
- `SUPPORT` は出金の承認・却下ができない（機能的に不可能にする）
- 権限は毎リクエストで DB から取得（セッションにキャッシュしない）

---

## 3. 出金セキュリティ（最重要）

| # | 対策 | 内容 |
|---|---|---|
| W1 | step-up 2FA | 申請時に再認証 |
| W2 | アドレスクールダウン | 新規登録アドレスへは **24時間**送金不可 |
| W3 | 4-eyes 承認 | 申請者と承認者は必ず別人。閾値超は **2名承認** |
| W4 | 冪等キー | `Idempotency-Key` 必須。同一キーは1回だけ処理 |
| W5 | 残高の原子操作 | `available → locked` を単一トランザクションで移動。元帳（複式）で管理 |
| W6 | 補償トランザクション | 却下・送金失敗時は `locked → available` へ確実に戻す |
| W7 | 異常検知 | 金額・頻度・新規アドレス・IP/デバイス変化・深夜帯をスコアリング。閾値超は `FLAGGED` |
| W8 | 上限 | 1回あたり・1日あたりの上限（テナント設定） |
| W9 | 通知 | 申請・承認・送金完了をメール＋アプリ内で通知（本人が気付ける） |
| W10 | アドレス検証 | Base58Check / Bech32 のチェックサム検証。自社アドレスへの送金を拒否 |
| W11 | 監査 | 申請〜完了の全遷移を追記専用ログに記録 |

### 秘密鍵の扱い（絶対規則）

```
❌ アプリケーション DB に秘密鍵・シードを保存する
❌ 環境変数に秘密鍵を直接書く
❌ アプリケーションプロセス内で署名する

✅ WalletProviderInterface 経由で外部に委譲する
   - 外部カストディ事業者（BitGo / Fireblocks 等）
   - HSM（AWS CloudHSM 等）
   - KMS（署名鍵をエクスポート不可能な状態で保持）
   - MPC（鍵を分割して単一障害点をなくす）
✅ 本システムが保持するのは「出金指示」と「トランザクションID」のみ
```

MVP の `MockWalletProvider` は**実際の署名を一切行わない**（デモ専用であることを UI に明示）。

---

## 4. データ保護

### 4.1 保管時の暗号化（Encryption at Rest）

| 対象 | 方式 |
|---|---|
| DB 全体 | ストレージレベル暗号化（RDS 暗号化 / KMS） |
| TOTP シークレット | アプリ層 AES-256-GCM（`ENCRYPTION_KEY`） |
| リカバリーコード | ハッシュ化 |
| API Key | SHA-256 ハッシュ |
| 外部認証情報 | **DB に置かず** Secrets Manager 参照名のみ保持 |
| バックアップ | 暗号化＋別リージョン |

アプリ層暗号化は `enc:v1:` プレフィックス方式で、
**平文との共存**と**鍵ローテーション（v1 → v2）**を可能にする。

### 4.2 通信時の暗号化（Encryption in Transit）

- 外部通信は TLS 1.2 以上（1.3 推奨）。HTTP は 301 で HTTPS へ
- HSTS: `max-age=63072000; includeSubDomains; preload`
- DB / Redis への接続も TLS
- Stratum は可能ならば TLS ラップ。不可の場合は VPC 内に閉じる

### 4.3 PII（個人情報）

- ログに PII・トークン・金額を出さない（構造化ログでフィールドをマスク）
- エラーメッセージにスタックトレースや SQL を含めない
- CSV エクスポートは監査ログに記録
- 削除要求時は論理削除＋PII 匿名化（監査記録は法定保存期間まで保持）

---

## 5. Web アプリのセキュリティ

### 5.1 セキュリティヘッダ（`next.config.ts` で全ルートに付与）

| ヘッダ | 値 |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

### 5.2 XSS

- React の自動エスケープに依拠。`dangerouslySetInnerHTML` は原則禁止（使用時は PR でレビュー必須）
- ユーザー入力を CSS / URL に直接埋め込まない（テナントのカラー設定は `#RRGGBB` 形式を厳格検証）
- CSP で `unsafe-eval` を禁止

### 5.3 CSRF

- Cookie セッション + `SameSite=Lax`
- 加えて、状態変更（POST/PATCH/DELETE）には **double-submit トークン**（`X-CSRF-Token`）を要求
- `Origin` / `Sec-Fetch-Site` ヘッダの検証

### 5.4 SQL インジェクション

- Prisma のパラメータ化クエリのみ使用
- `$queryRaw` はタグ付きテンプレート（自動パラメータ化）でのみ許可。文字列連結は禁止
- 動的なテーブル名・カラム名を受け付けない

### 5.5 入力検証

- すべての API 入力を `zod` で検証（型・範囲・形式・最大長）
- 数値は上下限を明示（ハッシュレート ≤ 10,000,000 TH/s など。DoS と表示崩れの防止）
- ファイルアップロードは MIME・サイズ・拡張子を検証し、アプリと別オリジンで配信

### 5.6 SSRF

- 外部 API の URL は**許可リスト**方式（ユーザー入力の URL を fetch しない）
- プロバイダーのエンドポイントは管理者のみ設定可能。プライベート IP レンジを拒否

---

## 6. マルチテナント分離

| 層 | 対策 |
|---|---|
| 入口 | `proxy.ts` が Host から `tenantId` を解決。**リクエストボディの tenantId は常に無視** |
| アプリ | すべてのクエリに `tenantId` を必須引数として渡す（Store インターフェースで強制） |
| DB | Row Level Security（`app.tenant_id` セッション変数） |
| キャッシュ | Redis キーに `tenant:<id>:` プレフィックスを必須化 |
| ファイル | オブジェクトストレージのキーに tenantId を含める |
| テスト | 「他テナントのIDを指定しても 404 になる」テストを必須で書く |

---

## 7. シークレット管理

```
本番: AWS Secrets Manager / GCP Secret Manager / Azure Key Vault
起動時に読み込み、プロセスメモリ内のみで保持。ログ出力しない。
```

- リポジトリには `.env.example` のみ（実値ゼロ）
- `.gitignore` に `.env*`（`.env.example` を除く）を明記
- GitHub の **Secret Scanning + Push Protection** を有効化
- pre-commit フックで秘密らしき文字列を検出
- 鍵のローテーション: `ENCRYPTION_KEY` は年1回、API 認証情報は四半期ごと
- 万一コミットした場合の手順は `OPERATIONS.md` のインシデント対応に記載（**まず失効、次に履歴削除**）

---

## 8. 監査ログ

- 追記専用（アプリ用 DB ロールから `UPDATE` / `DELETE` を REVOKE）
- 記録項目: 実行者・ロール・操作・対象・変更前後（マスク済み）・IP・UA・結果・時刻・requestId
- 保持: 7年（暗号資産関連の記録保存要件を想定した余裕値）
- 改ざん検知: 日次でハッシュチェーン（前レコードのハッシュを含める）を計算し、外部ストレージへ保存
- 監査ログの閲覧自体も監査対象

---

## 9. 監視・検知

| 検知対象 | 閾値の例 | アクション |
|---|---|---|
| ログイン失敗の急増 | 同一 IP から 20回/5分 | IP を一時ブロック＋アラート |
| 新しい国からのログイン | 過去90日に無い国 | 本人へ通知＋step-up 要求 |
| 出金の急増 | 通常の 5倍 | 自動的に `FLAGGED`＋管理者へ即時通知 |
| 管理者操作の異常 | 深夜帯の大量操作 | アラート |
| プロバイダー障害 | 連続5回失敗 | circuit breaker + 状態を `OFFLINE` |
| 元帳の不整合 | 残高合計 ≠ 元帳合計 | **即時アラート・出金停止** |
| 依存パッケージの脆弱性 | Critical / High | CI を失敗させる |

---

## 10. 依存関係とサプライチェーン

- `package-lock.json` をコミットし、CI では `npm ci`
- Dependabot / Renovate による定期更新
- `npm audit --audit-level=high` を CI で実行
- 本番イメージは distroless / alpine + 非 root ユーザー
- SBOM（CycloneDX）を CI で生成し、リリースに添付

---

## 11. セキュリティテスト（CI で自動実行）

| 種類 | 内容 |
|---|---|
| 認証テスト | 未認証で保護 API を叩くと 401 |
| 認可テスト | 一般ユーザーが admin API を叩くと 403 |
| テナント分離テスト | 他テナントの ID を指定すると 404 |
| 出金テスト | 残高超過・重複キー・自己承認が拒否される |
| 入力検証テスト | 不正な BTC アドレス・負の金額・巨大数値が拒否される |
| レート制限テスト | 閾値超で 429 |
| ヘッダテスト | セキュリティヘッダが全て付与されている |
| 依存脆弱性 | `npm audit` |
| シークレット検出 | gitleaks 等 |

---

## 12. インシデント対応（概要。詳細は OPERATIONS.md）

1. **検知** → 2. **封じ込め**（該当機能の停止・アカウント凍結・鍵失効） → 3. **調査**（監査ログ・アクセスログ）
→ 4. **復旧** → 5. **報告**（利用者・規制当局・テナント） → 6. **再発防止**

金銭被害が疑われる場合は、まず **出金機能を全停止**（`FEATURE_WITHDRAWAL_ENABLED=false`）してから調査する。

---

## 13. リポジトリに絶対に含めないもの

```
秘密鍵 / ウォレットシード / ニーモニック
API キー・シークレット（プロバイダー・プール・価格 API・カストディ）
本番の DATABASE_URL / REDIS_URL
ENCRYPTION_KEY / SESSION_SECRET の実値
KYC 書類・個人情報を含むデータ
本番のバックアップファイル
```

`.env.example` にはキー名と「未設定ならどうなるか」の説明のみを書く。
