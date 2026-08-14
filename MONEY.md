# MONEY.md — Bitcoin 金額の会計方針（フェーズ12 監査）

## 1. 原則: float を一切使わない

Bitcoin 金額の計算・比較・按分は **すべて satoshi 整数（JavaScript の bigint）** で行う。
`0.001 BTC` を `number`（IEEE754 double）で保持・加減算することを禁止する。

理由: `0.1 + 0.2 !== 0.3` に代表される浮動小数点誤差が、報酬の積み上げや按分で
じわじわ蓄積し、監査で説明できない残高ズレを生むため。

## 2. レイヤーごとの表現

| レイヤー | 表現 | 根拠 |
|---|---|---|
| 計算（配賦・手数料・元帳・reconciliation） | **bigint satoshi**（`lib/decimal.ts` の `toSat`/`fromSat`） | 誤差ゼロ |
| ドメイン型・API 受け渡し | **文字列**（`"0.00120000"`, 小数点以下8桁固定） | JSON 安全・精度保持 |
| DB 保存 | **`Decimal(18,8)`**（PostgreSQL の exact numeric） | 10進の厳密表現。float ではない |
| UI 表示 | 表示直前に `Number()` で BTC へ変換 | 表示のみ。計算に使わない |

> 補足: PostgreSQL の `Decimal(18,8)` は「BIGINT SATOSHI」と数学的に等価な**厳密10進**であり、
> float ではない。satoshi への相互変換は `lib/decimal.ts` が担保する（`Decimal → toSat` で bigint 化）。
> これにより「BIGINT SATOSHI で会計する」という要件を、既存スキーマを壊さず満たしている。

## 3. 監査結果（float 混入がないことの確認）

| 箇所 | 方式 | 判定 |
|---|---|---|
| `revenue/allocation.ts` 按分 | bigint satoshi。端数は最大重みユーザーへ決定的配分。`Σgross === payout` を自己検証 | ✅ float 不使用 |
| `wallet/ledger.ts` 残高導出 | `toSat` 合計 | ✅ |
| `revenue/reconciliation.ts` | bigint 差分（1 satoshi ズレで CRITICAL） | ✅ |
| `wallet/index.ts` 上限判定 | `cmpBtc`（satoshi 比較）・`addBtc`（satoshi 加算） | ✅ |
| `revenue/engine.ts` 推定 | number（推定値のみ。Ledger へ入らない・実収益と混同しない） | ✅ 許容 |
| アダプタ（F2Pool 等） | プール応答の number → `formatNumberAsBtc` で即文字列化 → 以降 satoshi | ✅ 取り込み口のみ |

推定エンジン（`engine.ts`）だけは number を使うが、その出力は **Ledger に入れない**（`kind=ESTIMATED`）。
Ledger に Credit されるのは実 payout 由来（`kind=ACTUAL`）のみで、これは satoshi 整数で処理される。

## 4. 端数処理

- 手数料の丸めは**切り捨て**（ユーザーから過大に取らない方向）
- 按分の端数 satoshi は**最大ハッシュレートのユーザー**へ決定的に割り当て、合計を payout に厳密一致させる
