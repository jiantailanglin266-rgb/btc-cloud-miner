# ARBITRAGE.md — NiceHash Hashrate Arbitrage

## 1. ビジネスモデルの転換

本システムの中核は「**自社で ASIC を所有しない**」こと。
NiceHash 等の Hashpower Marketplace から SHA-256 ハッシュレートを購入し、

```
期待マイニング収益 > ハッシュレート購入価格 + 手数料 + 安全マージン
```

が成立する時間帯**のみ**購入してプールへ向け、悪化したら自動停止する。

```
BTC価格 + 難易度 + NW hashrate + 補助金 + 手数料 + Pool手数料
  + NiceHash SHA-256 板価格 + NiceHash手数料 + FX + 安全マージン
        ↓ Profitability Engine（期待収益/TH/day vs コスト/TH/day）
        ↓ Decision Engine（BUY / HOLD / STOP / WAIT + Hysteresis）
        ↓ [BUY のみ] NiceHash 注文（上限価格 = break-even × 0.98）
        ↓ NiceHash Hashpower → F2Pool/Braiins → 実採掘
        ↓ Pool 実 payout − NiceHash 実コスト − 手数料 = Actual Net Profit
        ↓ Ledger（実現損益のみ）→ Performance Fee（HWM 超過分のみ）
```

## 2. モードと段階導入（フェーズ19・42）

| モード | 市場データ | 注文 | 用途 |
|---|---|---|---|
| `mock`（既定） | 決定的擬似データ | 仮想 | デモ・テスト。ネットワーク接続なし |
| `paper` | **実 NiceHash 公開 API**（read-only） | 仮想（実注文なし） | ★30日以上の検証を推奨 |
| `live` | 実 API | **実注文**（`FEATURE_NICEHASH_TRADING_ENABLED=true` 必須） | Paper/Backtest 検証後のみ |

実注文 API は **二重ゲート**（mode=live ＋ Kill Switch）を通らない限り物理的に呼ばれない
（`NiceHashAdapter.assertTradingAllowed`）。

## 3. NiceHash API（出典・推測禁止の担保）

署名・注文エンドポイントは公式デモ実装
`github.com/nicehash/rest-clients-demo`（2026-08-14 取得）で確認:
- 署名: HMAC-SHA256(secret) over `apiKey\0time\0nonce\0\0org\0\0method\0path\0query[\0body]`
- `X-Auth: apiKey:hexdigest` / `X-Time` / `X-Nonce` / `X-Organization-Id`
- `POST /main/api/v2/hashpower/order` / `.../updatePriceAndLimit` / `DELETE .../order/{id}`
- orderbook/myOrders/stats/accounts は docs.nicehash.com 記載パス。レスポンスは防御的にパースし、想定外は INVALID_RESPONSE（でっち上げない）

資格情報は環境変数（本番 Secrets Manager）のみ。**Withdrawal 権限は付与しない**。
Secret はログ・例外・ヘッダダンプに出さない（テストで検査）。

## 4. 判定の安全装置（フェーズ9〜18・38・41）

| 装置 | 内容 |
|---|---|
| 開始/停止閾値の分離（Hysteresis） | 開始 8% / 停止 3%（既定）。ON/OFF 振動を防止 |
| 安全マージン | 既定 10%。**予測誤差 EMA から 8〜20% に自動調整**（式は公開・ブラックボックスなし） |
| Max Bid | break-even × 0.98。**これを超える Bid は構造的に不可能** |
| 最小/最大稼働 | 300s / 1800s。Emergency（Kill Switch・会計エラー・リスク超過）は即時停止 |
| Position Sizing | 資金の最大 10% × マージン・信頼度・ボラ・直近PnL 係数。**全資金投入は不可能** |
| リスク上限 | 注文/日次支出/日次損失/同時数/ハッシュレート/ドローダウン。超過時は注文禁止 |
| 失敗時セーフティ | Pool/NiceHash オフライン・データ stale・Ledger 不整合・照合エラー時は新規注文禁止 |
| 説明可能性 | 全スキャンの入力・計算・判定・理由を DecisionSnapshot として保存 |

## 4.5 精密化（v2）

| # | 項目 | 内容 |
|---|---|---|
| 1 | **板 VWAP・スリッページ** | 最安値ではなく、必要量を板から実際に集めた場合の数量加重平均価格で判定（二段階評価: best価格で概算サイズ→そのサイズのVWAPで最終判定）。深さ不足・maxBid以下で9割調達できない場合は WAIT |
| 2 | **実測 Pool 効率/Reject** | 直近24hの実ワーカースナップショット（mock除外・トリム平均）から測定。12件未満は既定値へフォールバックし、出所（MEASURED/DEFAULT）を DecisionSnapshot に記録 |
| 3 | **実測ボラティリティ** | 直近24hのNH価格の変動係数（σ/μ×3、0〜1クランプ）。ポジションサイズの縮小係数に使用 |
| 4 | **信頼度の出所係数** | confidence = (1−予測誤差EMA) × 出所係数（LIVE_API 1.0 / STALE 0.6 / MOCK・FIXTURE 0.85）。式は理由文に明記 |
| 5 | **予測誤差の学習** | 注文クローズ時に \|expected−actual\|/expected を EMA(α=0.2) で更新 → Adaptive Safety Margin と信頼度に自動反映 |
| 6 | **厳密ドローダウン** | 累積実現PnL（cumulativePnlBtc）を状態に保持し、peak=max(HWM,累積) からの下落率で算出 |
| 7 | **Order-level 分散** | 注文に expectedBtc を保存し、Expected/Actual/Variance を注文テーブルに表示（どの注文の予測が外れたか追跡可能） |

## 5. 会計の絶対原則

- **Expected（期待値）を Ledger に入れない**。Ledger に入るのは実 Pool payout と実 NiceHash コストから計算した Actual Net Profit のみ
- Paper の損益は仮想値として ArbitrageState/注文レコードにのみ記録
- Performance Fee は**実現純益の HWM 超過分のみ**に課金（損失回復への二重課金なし・`fees.ts` でテスト固定）
- BTC 会計はすべて satoshi 整数（bigint）

## 6. Backtest（フェーズ21・22）

- 戦略: A. Buy&Hold / B. Always-On / C. Threshold / D. Dynamic Optimized
- 資金: ¥1M / ¥5M / ¥10M
- 指標: Final Equity・BTC Mined・NiceHash Cost・ROI・MaxDD・勝率・黒字時間率・注文数・平均スプレッド
- データ: scanner が蓄積する MarketSample（LIVE_API）。不足時は**決定的な FIXTURE**（合成・画面に明示）
- ⚠ 過去成績・シミュレーションは将来の成果を保証しない

## 7. 運用

```bash
NICEHASH_MODE=paper npm run worker   # arbitrage-scan が60秒毎に実行される
# Admin → Arbitrage: 信号機・数値・理由・履歴・Emergency Stop
# Admin → Backtest : 4戦略×3資金の比較
```

live 移行チェックリスト:
1. paper で 30 日以上運用し、forecast error EMA が安定していること
2. Backtest（実サンプル）で Threshold/Dynamic が優位であること
3. NiceHash アカウントに**注文権限のみ**の API キーを発行
4. リスク上限を最小額に設定 → `NICEHASH_MODE=live` + `FEATURE_NICEHASH_TRADING_ENABLED=true`
5. 最小注文で 1 サイクル（発注→停止→PnL照合）を確認

## 8. LIVE_API 検証記録

### 2026-08-17 paper モード実 API 疎通（認証不要の公開エンドポイントのみ）

`NICEHASH_MODE=paper` + `BITCOIN_SOURCE_PRIMARY=https://mempool.space/api` で
実 NiceHash orderbook・実難易度によるスキャンを実行し、以下を確認した。

| 項目 | 実測値 | 判定 |
|---|---|---|
| dataMode | `LIVE_API`（NH orderbook・mempool.space とも実データ） | ✓ |
| marketFactor | **1e18（EH）** — 実 API から取得。Mock の 1e15（PH）と異なるがエンジンは settings 由来の値でスケール適応 | ✓ |
| 実難易度 / subsidy | 127.48T / 3.125 BTC | ✓ |
| NH 実勢価格 | 0.5199 BTC/EH/day | — |
| break-even | 0.3902 BTC/EH/day → 期待マージン **−24.9%** | — |
| 判定 | `WAIT`「期待マージン −24.9% < 開始閾値 8.0%」・注文ゼロ | ✓ 赤字市場で買わない |
| maxBid 以下の板深さ | 0 TH/s（fillableThsAtMaxBid=0） | ✓ |
| 信頼度 | Kill Switch OFF 時 **0**（緊急経路）／ ON 時 **0.9** =(1−EMA0.1)×LIVE_API係数1.0 | ✓ |

**含意**: 実勢の hashpower 市場は break-even 近傍〜上で推移するのが常態であり、
エンジンが「利益を空想しない」ことの実証になっている。BUY が出るのは価格急落・
難易度調整直後などのスプレッド発生時のみ（それが本システムの狙い）。
