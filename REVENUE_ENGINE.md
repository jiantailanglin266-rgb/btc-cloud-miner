# REVENUE_ENGINE.md — 収益計算と配賦

## 1. 二本立ての原則: Estimated と Actual を絶対に混同しない

| | Estimated（推定） | Actual（実績） |
|---|---|---|
| 源泉 | `MiningRevenueEngine`（純関数）の計算 | プールの実払い出し（`PoolPayout`） |
| 型 | `RevenueResult.isEstimate: true`（型で強制） | `Earning.kind = "ACTUAL"` + `payoutId` |
| UI | 「推定」チップ + 免責文（必ず表示） | 「実績」ラベル。payout が無ければ「—」（0 を装わない） |
| 用途 | シミュレーション・損益分岐の提示 | 元帳への Credit・残高・出金 |

**Actual が取得できる場合は Actual を優先**して表示・記帳する。
Estimated を元帳に入れることはない（デモ seed の疑似履歴も `kind: "ESTIMATED"` として区別）。

## 2. MiningRevenueEngine（`src/modules/revenue/engine.ts`）

入力: Network Difficulty / Network Hashrate / Block Subsidy / BTC Price /
User Hashrate / Pool Fee / Platform Fee / Electricity Cost（+ Hosting・Maintenance は
electricityPriceKwh に含めるか手数料率に織り込む）/ Uptime / 初期費用

計算根拠: `BTC/day = 86400 × hashrate / (difficulty × 2^32) × blockReward × uptime`

出力: Est. BTC/day・month / Gross Revenue(BTC・Fiat) / Pool Fee / Platform Fee /
Operating Cost / Net Revenue(BTC・Fiat) / **Break-even BTC Price** / Break-even 電力単価 /
ROI 日数（回収不能なら null — 「いつか回収できる」と誤認させない）/ 感度分析（価格±50%・難易度±30%）

基準値（テストで固定）: 500 TH/s・難易度126.4T・$95,000・17.5J/TH・$0.06/kWh・手数料2%+2%・稼働98.5%
→ 0.00024494 BTC/day・純収益 $9.93/day・損益分岐 $52,780

## 3. Revenue Allocation（`src/modules/revenue/allocation.ts`）

実 payout をユーザーへ配賦するパイプライン:

```
Pool Actual Payout（100%）
  → payout 期間（paidAt から遡り24h）の実測ハッシュレート比で按分
     （実測が無い契約は契約ハッシュレートへフォールバック）
  → Pool Fee 控除    ※既定はスキップ（下記）
  → Platform Fee 控除（契約の platformFeeRate）
  → Revenue Share 控除（契約の revenueShareRate）
  → Hosting Fee 控除（PASS_THROUGH 契約のみ）
  → User Net Revenue → 元帳へ Credit（MINING_REWARD + 各手数料の負エントリ）
  → Earning（kind=ACTUAL, payoutId 付き）を記録
```

### Pool Fee の二重控除防止（会計上の重要事実）

実在のプールは**手数料控除後**の金額を払い出す。したがって既定
（`payoutIsNetOfPoolFee: true`）では配賦時に Pool Fee を再控除しない。
gross 払い出しの特殊契約でのみ false にする。

### satoshi 保存則

按分は satoshi 整数（bigint）で行い、端数は最大重みのユーザーへ決定的に割り当てる。
`Σ gross = payout 金額` が 1 satoshi 単位で常に成立する（違反したら例外＝自己検証）。

### 冪等性（同一 payout の二重計上防止）3 層

1. `UNIQUE(providerId, externalPayoutId)` — 取り込みの重複を DB 制約で排除
2. `payout.allocationStatus = ALLOCATED` — 配賦済みの再実行は no-op
3. 元帳の `UNIQUE(tenantId, idempotencyKey)`（`payout:{payoutId}:{userId}:gross` 等）—
   1・2 を突破しても書き込み自体が失敗し、`DUPLICATE_PAYOUT` の CRITICAL アラートが上がる

テスト: `tests/allocation.test.ts`（保存則・冪等 3 層・状態偽装攻撃シナリオを含む）
