# PAPER_OPERATION.md — Paper 実運用ランブック

**目的**: 実 NiceHash 市場データ + 実 Bitcoin ネットワークデータで 24/7 スキャンを回し、
live 移行の前提条件（PRODUCTION_CHECKLIST §6.5）を満たす:

1. 30 日以上の MarketSample / DecisionSnapshot 蓄積
2. forecast error EMA の安定（Adaptive Safety Margin が収束する）
3. 実サンプルでの Backtest により Threshold/Dynamic 戦略の優位を確認

**この構成のリスク**: 資金リスクゼロ。
NiceHash API キーは使わず（公開エンドポイントのみ）、`NICEHASH_MODE=paper` では
注文メソッド自体が `MarketplaceDisabledError` で拒否されるため、実注文は構造的に不可能。

---

## A. Docker で動かす（推奨: 常時稼働マシン・VPS・自宅サーバー）

前提: Docker Desktop（Windows/Mac）または docker + compose plugin（Linux）。

```bash
cp .env.paper.example .env.paper
```

`.env.paper` を編集:
- `ENCRYPTION_KEY` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` で生成
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`（16文字以上）

起動:

```bash
docker compose -f docker-compose.paper.yml up -d --build
```

```bash
docker compose -f docker-compose.paper.yml run --rm worker npx prisma migrate deploy
```

```bash
docker compose -f docker-compose.paper.yml run --rm worker npx tsx scripts/bootstrap.ts
```

http://localhost:3000 に管理者でログイン → **すぐ 2FA を有効化**（/settings）。

## B. Docker なしで動かす（このPCで試す場合）

PostgreSQL が別途必要（例: [Neon](https://neon.tech) の無料枠、またはローカルインストール）。

```bash
# .env.local に DATABASE_URL と ENCRYPTION_KEY を設定した上で:
npx prisma migrate deploy
```

```bash
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='...' npm run bootstrap
```

2 プロセスを常駐させる（Windows はタスクスケジューラ、Linux は systemd）:

```bash
NICEHASH_MODE=paper BITCOIN_SOURCE_PRIMARY=https://mempool.space/api PRICE_SOURCE_PRIMARY=https://api.coingecko.com/api/v3 npm run start
```

```bash
NICEHASH_MODE=paper BITCOIN_SOURCE_PRIMARY=https://mempool.space/api PRICE_SOURCE_PRIMARY=https://api.coingecko.com/api/v3 npm run worker
```

※ PC のスリープ・再起動で止まるため、30 日運用には A（Docker + 常時稼働マシン）を推奨。

---

## C. 稼働開始後の設定（1回だけ）

1. `/admin/arbitrage` を開く
2. リスク上限を確認（maxOrderBtc / maxDailySpendBtc / maxDailyLossBtc など。paper でも本番想定の値にしておくと学習が現実的になる）
3. **自動売買を ON**（enabled=true）。paper なので作られるのは仮想注文のみ
4. Traffic Light と DecisionSnapshot が 60 秒ごとに更新されることを確認
5. 判定根拠の全項目が実データになっていることを確認:
   - dataMode = **LIVE_API**（MOCK が出ていたら環境変数を確認）
   - ブロック手数料の出所 = 直近ブロック実測
   - 板の総供給量（単位監査）が「正常」

## D. 日次の見方（1分でよい)

| 確認 | 場所 | 正常 |
|---|---|---|
| スキャンが動いている | /admin/arbitrage の最終スキャン時刻 | 直近 2 分以内 |
| dataMode | 同ページ | LIVE_API（STALE 連発なら mempool.space 疎通を確認） |
| Dead Letter | /admin（アラート） | 増え続けていない |
| forecast error EMA | /admin/arbitrage | 週単位で低下 or 安定（発注が無い期間は動かない） |
| paper 注文の Variance | 注文テーブル | Expected と Actual の乖離が説明可能 |

## E. 30 日後の評価（live 移行判定）

1. `/admin/backtest` で **実サンプル**（FIXTURE でない）を選んで 4 戦略 × 3 資金を実行
2. 判定基準:
   - Threshold または Dynamic が Buy&Hold 的な常時購入より明確に優位
   - forecast error EMA < 0.15 で安定（Adaptive Margin が 8〜12% 圏内）
   - paper 累積 PnL がプラス（マイナスなら live に行かない。市場にスプレッドが無いという実測結果）
3. 合格なら PRODUCTION_CHECKLIST §6.5 の残り MANUAL（NiceHash アカウント・注文権限のみの API キー・最小注文 1 サイクル）へ

**★ paper で勝てない設定は live でも勝てない。ここで妥協しない。**

## F. 停止・再開・更新

```bash
docker compose -f docker-compose.paper.yml down        # 停止（DB は volume に残る）
```

```bash
docker compose -f docker-compose.paper.yml up -d       # 再開
```

```bash
git pull; docker compose -f docker-compose.paper.yml up -d --build   # 更新反映
```

## トラブルシュート

| 症状 | 原因と対処 |
|---|---|
| 起動直後に落ちる | Deployment Safety ガード。`.env.paper` の ENCRYPTION_KEY 未設定が典型 |
| dataMode が STALE_LIVE | mempool.space / NiceHash への疎通不良。ネットワーク・レート制限を確認（stale なら判定は自動で保守化される） |
| ログインできない | bootstrap 未実行。§A の 3 コマンド目を実行 |
| 注文が一切作られない | 正常な可能性が高い（実勢が break-even 超なら WAIT が正しい）。/admin/arbitrage の margin と理由を読む |
