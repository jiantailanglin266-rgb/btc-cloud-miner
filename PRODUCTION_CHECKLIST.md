# PRODUCTION_CHECKLIST.md — 本番公開前チェックリスト

上から順に確認する。1 つでも ✗ なら公開しない。

## 1. 構成

- [ ] `DATABASE_URL` 設定済み（`/api/health/ready` が `"store":"prisma"` を返す）
- [ ] `ENCRYPTION_KEY` を新規生成した（開発用固定鍵でない）
- [ ] `REDIS_URL` 設定済み（複数インスタンス構成の場合は必須）
- [ ] `/admin` の「本番構成の警告」がゼロ
- [ ] `MINING_PROVIDER_MODE` の設定が意図どおり（live なら実プロバイダーが ONLINE）
- [ ] 本番で `MOCK` バッジ・`DEMO` バッジがどの画面にも出ていない
- [ ] デモ seed を本番 DB に流していない（demo@example.com が存在しない）

## 2. マイニング統合

- [ ] 実プールの read-only キーで統計が取得できる（出金権限のないキーであること）
- [ ] payout 同期 → 配賦 → 元帳 Credit の一連が実データで動作
- [ ] 実 payout 額と `/admin/allocation` の取り込み額が一致
- [ ] Revenue Engine の推定と実 payout の乖離が説明可能な範囲（±20%目安）
- [ ] プロバイダー障害時に DEGRADED 表示となり 500 にならない（実際に止めて確認）

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

- [ ] `npm run typecheck` / `npm test`（175件）/ `npm run build` すべて成功
- [ ] 基幹フロー実機確認: 登録→2FA→ダッシュボード→出金申請→承認
- [ ] モバイル幅・ダークで表示崩れなし

## 7. 法務・表示

- [ ] 利用規約・プライバシー・リスク開示を弁護士レビュー済みの実版に差し替え
- [ ] 収益表示がすべて「推定」明示（保証・確定利回りの表現ゼロ）
- [ ] カストディ形態の適法性確認（暗号資産交換業該当性）
- [ ] 特商法表記・提供国の制限設定
