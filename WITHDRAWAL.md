# WITHDRAWAL.md — 出金

## 1. 3 モード（`WALLET_PROVIDER_MODE`）

| モード | 実送金 | 用途 | 特徴 |
|---|---|---|---|
| `mock`（既定） | しない | デモ・開発 | `demo-` txid。30秒/確認 |
| `sandbox` | しない | 本番前リハーサル | **testnet アドレスのみ受理**（mainnet を拒否＝誤送金の逆向き安全弁）。末尾 satoshi=9 で意図的失敗（補償トランザクション検証用）。10分/確認 |
| `live` | する | 本番 | 外部カストディ実装（`providers/custody.ts`）が必須。未実装なら**起動時に明示的に失敗**（黙って mock に落ちない） |

## 2. 秘密鍵の絶対規則

- 秘密鍵・Seed Phrase を DB・GitHub・.env・アプリサーバーに置くことを禁止
- 署名は外部カストディ（BitGo / Fireblocks 等）または HSM/KMS/MPC の内部でのみ実行
- 本システムが保持するのは「出金指示」と「txid」だけ
- カストディの API キーにも出金先制限（アドレス Whitelist）をカストディ側で設定すること

## 3. 出金フローの防御（実装済み）

| # | 防御 | 実装 |
|---|---|---|
| 1 | 2FA + Step-up 認証 | 申請時に直近5分以内の TOTP 検証を必須 |
| 2 | Address Whitelist | 登録済みアドレスにのみ送金可（チェックサム検証付き） |
| 3 | Address Cooldown | 登録から 24h は送金不可 |
| 4 | Amount Limit | 1回 0.5 BTC（`WITHDRAWAL_MAX_PER_TX_BTC`） |
| 5 | Daily Limit | 24h 合計 1.0 BTC（`WITHDRAWAL_DAILY_LIMIT_BTC`） |
| 6 | Risk Scoring | 新規アドレス・金額急増・新規IP・高頻度・深夜帯をスコアリング。50 以上で FLAGGED + アラート |
| 7 | 4-eyes Approval | 申請者≠承認者。閾値超・高リスクは 2 名承認。承認に admin MFA |
| 8 | 冪等キー | `Idempotency-Key` で二重申請・二重送金を防止 |
| 9 | 補償トランザクション | 却下・送金失敗時は LOCKED → AVAILABLE へ必ず返却 |
| 10 | Audit Log | 申請〜完了の全遷移を追記専用で記録 |
| 11 | Kill Switch | `FEATURE_WITHDRAWAL_ENABLED=false` で即時全停止 |

## 4. live 切替手順（段階的）

1. `sandbox` で全フロー（申請→承認→送金→失敗→返却）をリハーサル
2. カストディ契約 → `providers/custody.ts` に `WalletProvider` 実装（`send()` は冪等必須）
3. `WALLET_PROVIDER_MODE=live` + カストディ資格情報を Secrets Manager へ
4. **少額（最低出金額）での実送金テスト**を自社アカウントで実施
5. 上限（Amount/Daily Limit）を保守的な値から開始し、運用実績に応じて緩和
