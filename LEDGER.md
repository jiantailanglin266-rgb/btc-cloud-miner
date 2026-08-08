# LEDGER.md — 内部元帳

## 1. 設計原則

BTC 残高は **balance カラムを持たない**。残高は `ledger_entries` の合計として常に再計算可能:

```
available = SUM(amountBtc) WHERE accountId=? AND bucket='AVAILABLE'
locked    = SUM(amountBtc) WHERE accountId=? AND bucket='LOCKED'
```

理由: 残高カラムは更新途中の障害・二重更新で「なぜその値になったか」を説明できなくなる。
元帳方式なら全履歴から必ず再構築でき、監査に耐える。

## 2. Entry 区分

| entryType | 符号 | 発生元 |
|---|---|---|
| `MINING_REWARD` | + | payout 配賦（gross）。デモ seed の疑似報酬も同区分（Earning.kind で区別） |
| `POOL_FEE` | − | 配賦時（gross 払い出し契約のみ。既定はプール側控除済みのため発生しない） |
| `PLATFORM_FEE` | − | 配賦時（platformFeeRate + revenueShareRate） |
| `HOSTING_FEE` | − | 配賦時（PASS_THROUGH 契約のみ） |
| `WITHDRAWAL_LOCK` | ± | 出金申請（AVAILABLE − / LOCKED + の 2 行。合計ゼロ） |
| `WITHDRAWAL_SETTLE` | − | 送金完了（LOCKED から net 分） |
| `WITHDRAWAL_FEE` | − | 送金完了（LOCKED から fee 分） |
| `WITHDRAWAL_REVERSE` | ± | 却下・失敗・取消の補償（LOCKED − / AVAILABLE + で完全に戻る） |
| `ADJUSTMENT` | ± | 管理者の手動調整（監査ログ必須） |
| `FEE` | − | 旧汎用区分（後方互換のみ。新規では使わない） |

## 3. 不変条件（`verifyInvariants` が検証）

1. `available >= 0` かつ `locked >= 0`（負残高は即 CRITICAL アラート）
2. 冪等キーの重複なし（`UNIQUE(tenantId, idempotencyKey)` + アプリ層の二重検査）
3. 出金の LOCK と SETTLE+FEE は金額が一致する（net + fee = lock 額）

違反検出時は `LEDGER_IMBALANCE` アラート（CRITICAL）→ まず出金を停止
（`FEATURE_WITHDRAWAL_ENABLED=false`）してから調査する。

## 4. 金額の表現

- DB: `Decimal(18,8)` / アプリ: 文字列 + `lib/decimal.ts`（satoshi 整数 bigint 演算）
- **JavaScript の number で BTC を加減算しない**（丸め誤差で元帳が狂う）
- 手数料の丸めは切り捨て（ユーザーから過大に取らない方向）

## 5. 閲覧

管理画面 `/admin/ledger` で全仕訳・導出残高・不変条件の検証結果をユーザー別に閲覧できる。
元帳は追記専用であり、管理者にも UPDATE/DELETE の手段を提供しない。
