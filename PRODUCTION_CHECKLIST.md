# PRODUCTION_CHECKLIST.md — 本番公開前チェックリスト

各項目に実装状況を付す: **PASS**（コードで担保済み）/ **FAIL**（未実装）/ **MANUAL**（運用・契約で人が実施）。

## Production Readiness Score: 85 / 100

| カテゴリ | 配点 | 実点 | 根拠 |
|---|---:|---:|---|
| Architecture | 10 | 10 | Modular Monolith・アダプタ方式・Store 抽象・境界の明確さ |
| Database | 10 | 9 | 36テーブル・初期マイグレーションSQL生成・exact Decimal・索引。PITR等は運用 |
| Provider Integration | 20 | 16 | F2Pool 本番アダプタ完成・TEST CONNECTION・資格情報暗号化・接続モデル3種。**実キーでの疎通は未（MANUAL）** |
| Accounting | 15 | 14 | satoshi 整数会計・複式元帳・配賦冪等3層・Reconciliation（1sat検知）。実 payout 実測突合は未 |
| Security | 15 | 12 | 2FA/step-up/RBAC/CSRF/AES暗号化/秘密鍵ゼロ/マスク/sandbox。外部ペンテスト・共有レート制限は未 |
| Monitoring | 10 | 9 | アラート11種・Metrics・Health・Reconciliation。通知先連携は運用 |
| Testing | 10 | 9 | 189 ユニット + E2E fixture フロー。実 API smoke は opt-in |
| Operations | 10 | 6 | doctor・worker・ロック・Rawスナップショット・ドキュメント。常駐cron/queue・リストア訓練は未 |
| **合計** | **100** | **85** | |

上から順に確認する。FAIL が残る項目は公開前に解消すること。

## 1. 構成

- [ ] `DATABASE_URL` 設定済み（`/api/health/ready` が `"store":"prisma"` を返す）
- [ ] `ENCRYPTION_KEY` を新規生成した（開発用固定鍵でない）
- [ ] `REDIS_URL` 設定済み（複数インスタンス構成の場合は必須）
- [ ] `/admin` の「本番構成の警告」がゼロ
- [ ] `MINING_PROVIDER_MODE` の設定が意図どおり（live なら実プロバイダーが ONLINE）
- [ ] 本番で `MOCK` バッジ・`DEMO` バッジがどの画面にも出ていない
- [ ] デモ seed を本番 DB に流していない（demo@example.com が存在しない）

## 2. マイニング統合

- [ ] **MANUAL** 実プールの read-only キーで統計が取得できる（出金権限のないキーであること）→ `LIVE_PROVIDER_TEST=true` で smoke 実行
- [x] **PASS** payout 同期 → 配賦 → 元帳 Credit の一連が動作（fixture E2E + HTTP smoke 済み）
- [x] **PASS** 実 payout 額と配賦取り込み額が satoshi 一致（`/admin/reconciliation`・reconciliation.test）
- [ ] **MANUAL** Revenue Engine の推定と実 payout の乖離が説明可能な範囲（±20%目安）
- [x] **PASS** プロバイダー障害時に DEGRADED 表示となり 500 にならない（circuit breaker・fetchAllProviders）
- [x] **PASS** TEST CONNECTION が結果を分類（CONNECTED/AUTH_FAILED/RATE_LIMITED/TIMEOUT/INVALID/OFFLINE）
- [x] **PASS** 資格情報は AES-256-GCM で暗号化保存・UI は末尾4桁マスク・ログ非出力
- [x] **PASS** 二重同期防止の同期ロック（sync-lock.test）

## 3. 出金

- [ ] `sandbox` モードで全フロー（申請→承認→送金→意図的失敗→残高返却）をリハーサル済み
- [ ] カストディ実装のレビュー完了（`send()` の冪等性を確認）
- [ ] 秘密鍵・Seed がアプリ・DB・リポジトリのどこにも存在しない
- [ ] 少額の実送金テスト完了（自社アカウント宛て）
- [ ] Amount Limit / Daily Limit が保守的な値に設定されている
- [ ] Kill Switch（`FEATURE_WITHDRAWAL_ENABLED=false`）の発動手順を運用者が知っている
- [ ] 全承認者の 2FA が有効

## 4. セキュリティ

- [ ] `npm audit --audit-level=high` がゼロ
- [ ] GitHub Secret Scanning + Push Protection 有効
- [ ] `ADMIN_IP_ALLOWLIST` 設定済み
- [ ] セキュリティヘッダ確認（`curl -I` で CSP / HSTS / nosniff / DENY）
- [ ] レート制限の動作確認（ログイン 6 回目で 429）
- [ ] テナント越境テスト（他テナント ID 指定で 404）
- [ ] 資格情報のローテーション手順が文書化済み（OPERATIONS.md R6）

## 5. 監視・運用

- [ ] `/admin/alerts` の全検知ルールが有効（LEDGER_IMBALANCE の通知先が決まっている）
- [ ] 外形監視（/api/health/ready）+ 通知先設定
- [ ] payout 同期・配賦・確認数更新の定期実行が設定済み（cron / Actions / EventBridge）
- [ ] DB バックアップ + リストア訓練を 1 回実施
- [ ] 元帳整合性検査の日次実行
- [ ] インシデント対応ランブック（OPERATIONS.md）を運用者が読了

## 6. 品質

- [x] **PASS** `npm run typecheck` / `npm test`（189件）/ `npm run build` すべて成功
- [x] **PASS** `npm run doctor` が FAIL ゼロ
- [x] **PASS** payout→配賦→Ledger→reconcile を HTTP で実機確認
- [ ] **MANUAL** 基幹フロー実機確認: 登録→2FA→ダッシュボード→出金申請→承認
- [ ] **MANUAL** モバイル幅・ダークで表示崩れなし

## 7. LIVE 切替（フェーズ18・20）

- [x] **PASS** `MINING_PROVIDER_MODE=live` で実プロバイダー未接続時に「LIVE CONNECTION FAILED」表示（無言 Mock フォールバックしない）
- [x] **PASS** LIVE/STALE/MOCK バッジで出所を常時明示
- [ ] **MANUAL** `LIVE_PROVIDER_TEST=true` で自社アカウントの read-only smoke を実行（CI では絶対に実行しない）

## 7. 法務・表示

- [ ] 利用規約・プライバシー・リスク開示を弁護士レビュー済みの実版に差し替え
- [ ] 収益表示がすべて「推定」明示（保証・確定利回りの表現ゼロ）
- [ ] カストディ形態の適法性確認（暗号資産交換業該当性）
- [ ] 特商法表記・提供国の制限設定
