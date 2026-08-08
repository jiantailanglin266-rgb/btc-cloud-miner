# API.md — API 設計書

Base: `/api` / 形式: JSON / 認証: httpOnly Cookie セッション（+ B2B は API Key）

---

## 1. 共通仕様

### 1.1 レスポンス形式

成功:
```json
{ "ok": true, "data": { }, "meta": { "requestId": "...", "generatedAt": "2026-08-08T00:00:00Z" } }
```

失敗:
```json
{
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "入力内容を確認してください", "details": [ { "path": "amountBtc", "message": "最低出金額を下回っています" } ] },
  "meta": { "requestId": "..." }
}
```

### 1.2 エラーコード

| HTTP | code | 意味 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | zod バリデーション失敗 |
| 401 | `UNAUTHORIZED` | 未認証・セッション失効 |
| 401 | `TWO_FACTOR_REQUIRED` | 2FA 再認証が必要（step-up） |
| 403 | `FORBIDDEN` | 権限不足 |
| 403 | `KYC_REQUIRED` | 本人確認未完了 |
| 404 | `NOT_FOUND` | 対象なし（他テナントのリソースも 404 で返す） |
| 409 | `CONFLICT` | 状態遷移不正・重複 |
| 422 | `UNPROCESSABLE` | 業務ルール違反（残高不足など） |
| 429 | `RATE_LIMITED` | レート制限（`Retry-After` ヘッダ付き） |
| 503 | `DEPENDENCY_UNAVAILABLE` | 外部依存が停止（degraded） |
| 500 | `INTERNAL_ERROR` | 想定外（詳細はクライアントに返さない） |

**他テナントのリソースは 403 ではなく 404 を返す**（存在の有無を漏らさない）。

### 1.3 共通ヘッダ

| ヘッダ | 方向 | 用途 |
|---|---|---|
| `X-Request-Id` | 両方 | トレース相関 |
| `Idempotency-Key` | req | POST の二重実行防止（出金・契約作成で必須） |
| `X-CSRF-Token` | req | Cookie セッション時の状態変更で必須 |
| `Retry-After` | res | 429 / 503 時 |
| `X-Data-Freshness` | res | `fresh` / `stale:<秒>` — 外部データの鮮度 |

### 1.4 認可の原則

- すべてのルートで最初に `getSessionUser()` を呼ぶ
- テナントは **サーバー側で解決**（Host ヘッダ）。リクエストボディの `tenantId` は無視する
- 一般ユーザーは自分のデータのみ。`ORG_ADMIN` は自組織。`TENANT_ADMIN` は自テナント
- `/api/admin/**` は `requireAdmin()` + admin MFA 必須
- 出金・アドレス変更・2FA 無効化は **step-up 認証**（直近5分以内の 2FA 検証）が必要

### 1.5 バリデーション

- すべての入力は `zod` スキーマで検証（`src/lib/validation.ts` に集約、フォームと共用）
- BTC 金額は文字列で受け取り、`/^\d+(\.\d{1,8})?$/` で検証してから decimal 処理

### 1.6 レート制限

| 対象 | 制限 |
|---|---|
| ログイン | 5回 / 15分 / IP + アカウント |
| 登録 | 3回 / 時 / IP |
| 2FA 検証 | 5回 / 5分 / ユーザー |
| 出金申請 | 5回 / 時 / ユーザー |
| シミュレーター | 60回 / 分 / ユーザー |
| 一般 API | 300回 / 分 / ユーザー |
| 未認証 API | 60回 / 分 / IP |

### 1.7 監査

`audit()` は以下の操作で必ず呼ぶ（失敗しても業務は止めない `try-catch`）:
ログイン成否 / 2FA 変更 / パスワード変更 / アドレス登録・変更 / 出金申請・承認・却下 /
プラン変更 / 権限変更 / プロバイダー設定変更 / テナント設定変更 / 管理者によるユーザー操作

---

## 2. エンドポイント一覧

### 2.1 認証（`/api/auth`）

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| POST | `/api/auth/register` | GUEST | ユーザー登録 |
| POST | `/api/auth/login` | GUEST | ログイン（2FA 有効なら `TWO_FACTOR_REQUIRED` を返す） |
| POST | `/api/auth/login/2fa` | GUEST | TOTP コード検証してセッション確立 |
| POST | `/api/auth/logout` | USER | ログアウト |
| GET | `/api/auth/me` | USER | 自分の情報・テナントブランディング |
| POST | `/api/auth/2fa/setup` | USER | TOTP シークレット発行（otpauth URI 返却） |
| POST | `/api/auth/2fa/enable` | USER | コード検証して有効化。リカバリーコード返却 |
| POST | `/api/auth/2fa/disable` | USER | step-up 必須 |
| POST | `/api/auth/2fa/verify` | USER | step-up 認証（5分間有効） |
| GET | `/api/auth/sessions` | USER | セッション一覧 |
| DELETE | `/api/auth/sessions/:id` | USER | 他端末を強制ログアウト |

### 2.2 ダッシュボード・マイニング

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| GET | `/api/dashboard/summary` | USER | ダッシュボードの全カード値 |
| GET | `/api/dashboard/series?range=1h\|24h\|7d\|30d\|90d\|1y&metric=hashrate\|revenue\|uptime` | USER | グラフ用時系列 |
| GET | `/api/stream/dashboard` | USER | **SSE** リアルタイム更新 |
| GET | `/api/mining/workers?status=&page=` | USER | ワーカー一覧（自分の割当分） |
| GET | `/api/mining/workers/:id` | USER | ワーカー詳細＋直近スナップショット |
| GET | `/api/mining/allocations` | USER | 契約 → 割当の内訳 |
| GET | `/api/mining/providers/status` | USER | プロバイダー状態（ONLINE/DEGRADED/...） |

### 2.3 Bitcoin ネットワーク

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| GET | `/api/bitcoin/network` | GUEST | difficulty / hashrate / height / reward / 次回調整予測 |
| GET | `/api/bitcoin/price?vs=usd,jpy` | GUEST | BTC 価格 |
| GET | `/api/bitcoin/mempool` | USER | mempool サイズ・推奨手数料 |

いずれも `X-Data-Freshness` を返す。全ソース停止時は 200 + `stale` または 503 + 最終値。

### 2.4 収益・シミュレーター

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| GET | `/api/revenue/estimate` | USER | 自分の契約に基づく推定収益（内訳付き） |
| GET | `/api/revenue/history?range=` | USER | 確定収益の履歴 |
| POST | `/api/simulator/calculate` | GUEST | 任意パラメータでシミュレーション |
| POST | `/api/simulator/sensitivity` | GUEST | 感度分析（価格±50% / 難易度±30%） |

`POST /api/simulator/calculate` リクエスト例:
```json
{
  "hashrateThs": 500,
  "efficiencyJPerTh": 17.5,
  "electricityPriceKwh": 0.06,
  "btcPrice": 95000,
  "networkHashrateThs": 780000000,
  "blockRewardBtc": 3.125,
  "poolFeeRate": 0.02,
  "platformFeeRate": 0.02,
  "uptimeRate": 0.985,
  "contractDays": 365,
  "upfrontCostUsd": 12000
}
```
レスポンスには必ず `"disclaimer": "これは推定値です。実際の採掘量は..."` と `"isEstimate": true` を含める。

### 2.5 ウォレット

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| GET | `/api/wallet/balance` | USER | available / locked / 累計獲得 |
| GET | `/api/wallet/addresses` | USER | 登録アドレス一覧 |
| POST | `/api/wallet/addresses` | USER | アドレス登録（step-up 必須・24h クールダウン開始） |
| DELETE | `/api/wallet/addresses/:id` | USER | 削除（step-up 必須） |
| POST | `/api/wallet/withdrawals` | USER | 出金申請（step-up + `Idempotency-Key` 必須） |
| GET | `/api/wallet/withdrawals?status=&page=` | USER | 出金履歴 |
| POST | `/api/wallet/withdrawals/:id/cancel` | USER | `PENDING_REVIEW` のみ取消可 |
| GET | `/api/wallet/earnings?range=` | USER | 報酬履歴 |
| GET | `/api/wallet/earnings/export.csv` | USER | CSV（UTF-8 BOM 付き） |

### 2.6 契約・プラン

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| GET | `/api/plans` | GUEST | プラン一覧（テナントの料金設定を反映） |
| GET | `/api/contracts` | USER | 自分の契約一覧 |
| POST | `/api/contracts` | USER | 契約作成（`Idempotency-Key` 必須。MVP は申請扱い） |
| POST | `/api/contracts/:id/cancel` | USER | 解約申請 |
| PATCH | `/api/contracts/:id/auto-renew` | USER | 自動更新の ON/OFF |

### 2.7 通知・サポート・KYC

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| GET | `/api/notifications?unread=true` | USER | 通知一覧 |
| POST | `/api/notifications/:id/read` | USER | 既読化 |
| POST | `/api/notifications/read-all` | USER | 全既読 |
| GET | `/api/support/tickets` | USER | チケット一覧 |
| POST | `/api/support/tickets` | USER | 新規作成 |
| POST | `/api/support/tickets/:id/messages` | USER | 返信 |
| GET | `/api/kyc/status` | USER | KYC ステータス |
| POST | `/api/kyc/submit` | USER | 提出（MVP はステータス遷移のみ） |

### 2.8 管理者（`/api/admin`）

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| GET | `/api/admin/overview` | ADMIN | 全体 KPI |
| GET | `/api/admin/users?q=&role=&status=&page=` | ADMIN | ユーザー一覧 |
| GET | `/api/admin/users/:id` | ADMIN | ユーザー詳細（契約・残高・KYC・監査） |
| PATCH | `/api/admin/users/:id` | ADMIN | ステータス・ロール変更（監査必須） |
| PATCH | `/api/admin/users/:id/kyc` | ADMIN | KYC ステータス更新 |
| GET | `/api/admin/withdrawals?status=` | ADMIN | 出金承認キュー |
| POST | `/api/admin/withdrawals/:id/approve` | ADMIN | 承認（申請者本人は不可・admin MFA 必須） |
| POST | `/api/admin/withdrawals/:id/reject` | ADMIN | 却下（locked を戻す） |
| GET | `/api/admin/providers` | ADMIN | プロバイダー一覧・状態 |
| POST | `/api/admin/providers` | ADMIN | 追加（認証情報は Secrets 参照名のみ） |
| PATCH | `/api/admin/providers/:id` | ADMIN | 有効/無効・優先度・メンテ切替 |
| POST | `/api/admin/providers/:id/sync` | ADMIN | 手動同期 |
| GET | `/api/admin/workers?providerId=&status=` | ADMIN | 全ワーカー |
| POST | `/api/admin/allocations` | ADMIN | ハッシュレート割当 |
| GET | `/api/admin/plans` / POST / PATCH | ADMIN | プラン管理 |
| GET | `/api/admin/tenant-settings` / PATCH | TENANT_ADMIN | ブランディング・手数料設定 |
| GET | `/api/admin/incidents` / POST / PATCH | ADMIN | 障害情報 |
| GET | `/api/admin/audit-logs?actor=&action=&from=&to=` | ADMIN/AUDITOR | 監査ログ |
| GET | `/api/admin/health` | ADMIN | 外部 API 稼働状況・プール状態 |
| GET | `/api/admin/ai/insights` | ADMIN | AI 検知結果・推奨アクション |

### 2.9 システム

| Method | Path | 権限 | 説明 |
|---|---|---|---|
| GET | `/api/health` | GUEST | Liveness（プロセス生存のみ・依存を見ない） |
| GET | `/api/health/ready` | GUEST | Readiness（DB・Redis 疎通） |
| GET | `/api/health/dependencies` | ADMIN | 全外部依存の詳細状態 |

---

## 3. SSE の仕様（`/api/stream/dashboard`）

```
event: snapshot
data: {"currentHashrateThs":"498.2","activeMiners":42,"offlineMiners":1,...}

event: network
data: {"difficulty":"...","networkHashrateThs":"...","stale":false}

event: heartbeat
data: {"t":1754611200}
```

- 送信間隔: 10秒（`heartbeat` は 25秒。プロキシのタイムアウト対策）
- 認証: Cookie セッション。未認証は接続時に 401
- 再接続: `Last-Event-ID` で差分再送。クライアントは指数バックオフ
- 同時接続数はユーザーあたり 3 に制限

---

## 4. B2B 向け API Key（商用版）

| 項目 | 仕様 |
|---|---|
| 発行 | `TENANT_ADMIN` が発行。表示は発行時1回のみ |
| 保存 | DB にはハッシュ（SHA-256）のみ |
| 送信 | `Authorization: Bearer <key>` |
| スコープ | `read:mining` / `read:revenue` / `read:wallet` の最小権限 |
| 制限 | キー単位のレート制限・IP 許可リスト |
| 失効 | 即時失効・ローテーション（旧キーは 24h 猶予） |

出金 API は API Key では**実行できない**（人間の 2FA を必須とする）。

---

## 5. Webhook（商用版）

テナントへ送るイベント: `worker.offline` / `worker.recovered` / `withdrawal.confirmed` /
`provider.degraded` / `difficulty.adjusted` / `contract.expiring`

- 署名: `X-Signature: sha256=<HMAC>`（タイムスタンプ込みで再送攻撃を防ぐ）
- 再送: 指数バックオフで最大 24 時間、その後 DLQ
- 冪等: `X-Event-Id` を受信側で重複排除
