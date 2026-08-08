# STRATUM.md — Stratum 接続

## 1. 役割の正確な定義（重要）

Stratum は「プールが job を配り、マイナーが share を返す」プロトコルである。
**本システムはハッシュ計算装置ではないため、share を提出することはできない。**
share の提出は接続先の実 ASIC が行う。本システムの Stratum 実装（Backend Mining Gateway）の役割は:

| 取得・管理項目 | 実装 |
|---|---|
| mining.subscribe / mining.authorize | 接続確立時に送信。authorize 結果で認証状態を管理 |
| mining.notify（job 配信） | 受信カウント・最終受信時刻を記録。5分以上 job が来なければ DEGRADED |
| mining.set_difficulty（vardiff） | 現在の difficulty を保持 |
| share submit 結果 / accepted / rejected | **Stratum 単体では取得不能**（プロトコルに集計の概念がない）。Pool REST API（Braiins/F2Pool 等）から取得する |
| connection status / reconnect | 指数バックオフ（1s→最大60s＋ジッタ）で自動再接続。回数を記録 |

## 2. セキュリティ境界

**ブラウザから Stratum へ直接接続してはならない。**
Stratum は TCP 永続接続で worker/password を平文で送るため、フロントに置けば資格情報が露出する。
必ずサーバー側の `StratumV1Session`（Backend Mining Gateway）を経由する。
サーバーレス環境では常時 TCP を維持できないため、Gateway は VM / コンテナ（Fargate 等）で動かす。

## 3. 障害分離

- ソケット timeout 120s / keep-alive 30s
- 受信バッファ上限 1MB（不正データによるメモリ枯渇の防止）
- 壊れた JSON 行は捨てて接続維持
- 再接続は指数バックオフ + ジッタ。成功でリセット
- healthCheck: 未接続=OFFLINE / 未認証=DEGRADED / job 5分欠落=DEGRADED
- セッション障害はサービス全体に波及しない（circuit breaker + 状態表示のみ）

## 4. Stratum V2 への拡張点

V1 のメッセージ処理は `StratumV1Session.handleMessage()` に隔離されている。
V2 対応時は `StratumV2Session` を追加し、`StratumAdapter.start()` の
`config.stratum.version` 分岐で生成を切り替える（現状 v2 指定は明示的にエラーを返す =
「対応しているふり」をしない）。V2 で追加されるのは暗号化チャネル・バイナリフレーミング・
ジョブ宣言（Job Negotiation）で、セッション層の差し替えだけで対応できる構造にしてある。

## 5. 設定

```
STRATUM_URL=stratum+tcp://pool.example.com:3333   # stratum+ssl:// で TLS
STRATUM_WORKER=account.worker1
STRATUM_PASSWORD=x
STRATUM_VERSION=v1
```
