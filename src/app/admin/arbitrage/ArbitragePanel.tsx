"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/client";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  DataModeBadge,
  EmptyState,
  ErrorState,
  KeyValue,
} from "@/components/ui";
import { formatRelative, formatUsd } from "@/lib/format";
import type { ArbitrageState, DecisionSnapshot, HashpowerOrder } from "@/types";
import type { ScanResult } from "@/modules/arbitrage/scanner";

/** snapshot outputs へのアクセサ（板 walker の結果） */
function scanOutputs(scan: ScanResult): {
  slippageRate: number | null;
  fillableThsAtMaxBid: number;
} {
  return {
    slippageRate: scan.outputs?.slippageRate ?? null,
    fillableThsAtMaxBid: scan.outputs?.fillableThsAtMaxBid ?? 0,
  };
}

/** Traffic Light（フェーズ33）: 色 + 必ず数値と理由を併記する */
const LIGHT: Record<string, { color: string; bg: string; label: string }> = {
  BUY: { color: "text-pos", bg: "border-pos/50 bg-pos/10", label: "GREEN — 購入候補" },
  HOLD: { color: "text-pos", bg: "border-pos/40 bg-pos/5", label: "GREEN — 稼働継続" },
  WAIT: { color: "text-warn", bg: "border-warn/50 bg-warn/10", label: "YELLOW — 待機" },
  STOP: { color: "text-neg", bg: "border-neg/50 bg-neg/10", label: "RED — 停止" },
};

export function ArbitragePanel({
  scan,
  state,
  orders,
  history,
  readOnly,
  mode,
}: {
  scan: ScanResult;
  state: ArbitrageState;
  orders: HashpowerOrder[];
  history: DecisionSnapshot[];
  readOnly: boolean;
  mode: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const p = scan.profitability;
  const light = LIGHT[scan.decision.action] ?? LIGHT.WAIT;

  async function act(label: string, json: Record<string, unknown>) {
    setError(null);
    setBusy(label);
    try {
      await apiFetch("/api/admin", { json });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}

      {/* Traffic Light + Decision */}
      <Card className={light.bg}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-xl font-bold ${light.color}`}>{light.label}</span>
          <Badge tone="neutral">{scan.decision.action}</Badge>
          <DataModeBadge mode={scan.dataMode === "STALE_LIVE" ? "STALE" : scan.dataMode === "LIVE_API" ? "LIVE" : "MOCK"} />
          <span className="text-xs text-ink-dim">
            信頼度 {(scan.decision.confidence * 100).toFixed(0)}% · {formatRelative(scan.at)}
          </span>
          {!readOnly && (
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" disabled={busy !== null}
                onClick={() => act("scan", { action: "run-arbitrage-scan" })}>
                {busy === "scan" ? "スキャン中…" : "再スキャン"}
              </Button>
              {state.enabled ? (
                <Button variant="danger" disabled={busy !== null}
                  onClick={() => act("stop", { action: "arbitrage-emergency-stop" })}>
                  EMERGENCY STOP
                </Button>
              ) : (
                <Button disabled={busy !== null}
                  onClick={() => act("enable", { action: "set-arbitrage-config", enabled: true })}>
                  自動売買を有効化（{mode}）
                </Button>
              )}
            </span>
          )}
        </div>
        <ul className="mt-2 space-y-0.5 text-xs leading-relaxed text-ink-muted">
          {scan.decision.reasons.map((r, i) => (
            <li key={i}>・{r}</li>
          ))}
        </ul>
      </Card>

      {/* 主要数値（フェーズ32） */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="収益は期待値であり保証ではありません">収益性（Explainability）</CardTitle>
          <div className="divide-y divide-line">
            <KeyValue label="BTC Price" value={formatUsd(scan.inputs.btcPriceUsd, 0)} />
            <KeyValue label="Network Difficulty" value={scan.inputs.difficulty.toExponential(3)} />
            <KeyValue label="期待収益（BTC/PH/day）"
              value={(p.expectedRevenueBtcPerThDay * 1000).toFixed(6)} />
            <KeyValue label="NiceHash 実効価格（VWAP・BTC/PH/day）"
              value={scan.inputs.nicehashPriceBtcPerFactorDay?.toFixed(6) ?? "取得不可"} />
            <KeyValue label="スリッページ（最安値→VWAP）"
              value={
                scanOutputs(scan).slippageRate !== null
                  ? `${((scanOutputs(scan).slippageRate ?? 0) * 100).toFixed(2)}%`
                  : "—"
              } />
            <KeyValue label="maxBid以下の板の深さ"
              value={`${scanOutputs(scan).fillableThsAtMaxBid.toFixed(0)} TH/s`} />
            <KeyValue label="Pool効率/Reject（出所）"
              value={`${(scan.inputs.expectedPoolEfficiency * 100).toFixed(1)}% / ${(scan.inputs.expectedRejectRate * 100).toFixed(2)}%（${scan.inputs.poolPerformanceSource === "MEASURED" ? "実測" : "既定値"}）`} />
            <KeyValue label="ボラティリティ（出所）"
              value={`${(scan.inputs.volatility * 100).toFixed(1)}%（${scan.inputs.volatilitySource === "MEASURED" ? "実測CoV" : "既定値"}）`} />
            <KeyValue label="ブロック手数料（出所）"
              value={`${scan.inputs.avgTxFeesBtcPerBlock.toFixed(4)} BTC/block（${scan.inputs.avgTxFeesSource === "MEASURED_BLOCKS" ? "直近ブロック実測" : "推奨fee近似"}）`} />
            <KeyValue label="実効難易度（リターゲット考慮）"
              value={
                scan.inputs.retargetWeight > 0
                  ? `${scan.inputs.effectiveDifficulty.toExponential(3)}（調整 ${(scan.inputs.difficultyAdjustmentRate * 100).toFixed(1)}% を期間の ${(scan.inputs.retargetWeight * 100).toFixed(0)}% に加重）`
                  : "調整は注文期間外（現在難易度を使用）"
              } />
            <KeyValue label="板の総供給量（単位監査）"
              value={
                scan.outputs?.orderbookTotalThs != null
                  ? `${scan.outputs.orderbookTotalThs.toExponential(2)} TH/s（網 ${scan.inputs.networkHashrateThs.toExponential(2)} 以下で正常）`
                  : "—"
              } />
            <KeyValue label="Break-even 価格（BTC/PH/day）"
              value={p.breakEvenPriceBtcPerFactorDay.toFixed(6)} />
            <KeyValue label="発注上限価格（Max Bid）"
              value={p.maxBidPriceBtcPerFactorDay.toFixed(6)} tone="muted" />
            <KeyValue label="Spread（BTC/TH/day）"
              value={p.spreadBtcPerThDay !== null ? p.spreadBtcPerThDay.toFixed(8) : "—"}
              tone={p.spreadBtcPerThDay !== null && p.spreadBtcPerThDay > 0 ? "pos" : "neg"} />
            <KeyValue label="期待マージン"
              value={p.expectedMarginRate !== null ? `${(p.expectedMarginRate * 100).toFixed(1)}%` : "—"}
              tone={p.expectedMarginRate !== null && p.expectedMarginRate > 0 ? "pos" : "neg"} />
            <KeyValue label="期待利益（1PH/s 稼働時）"
              value={
                p.spreadUsdPerHourAt1Ph !== null
                  ? `${formatUsd(p.spreadUsdPerHourAt1Ph)}/h（¥${Math.round(p.spreadJpyPerHourAt1Ph ?? 0).toLocaleString()}/h）`
                  : "—"
              } />
            <KeyValue label="安全マージン（adaptive）"
              value={`${(scan.inputs.safetyMarginRate * 100).toFixed(1)}%（予測誤差EMA ${(state.forecastErrorEma * 100).toFixed(1)}% から算出）`} />
            <KeyValue label="推奨ハッシュレート"
              value={scan.recommendedThs > 0 ? `${scan.recommendedThs.toFixed(0)} TH/s / 上限支出 ${scan.maxSpendBtc} BTC` : "—"} />
          </div>
        </Card>

        <Card>
          <CardTitle
            hint={`Paper/Live 注文。今日: 支出 ${state.daySpentBtc} / PnL ${state.dayPnlBtc} BTC`}
            action={<Badge tone={state.enabled ? "online" : "neutral"} dot>{state.enabled ? "AUTO ON" : "AUTO OFF"}</Badge>}
          >
            注文（{orders.filter((o) => ["ACTIVE", "SUBMITTED", "PARTIALLY_FILLED"].includes(o.status)).length} 稼働中）
          </CardTitle>
          {orders.length === 0 ? (
            <EmptyState title="注文履歴がありません"
              description="自動売買を有効化すると、BUY 判定時に paper 注文が作成されます。" />
          ) : (
            <div className="scroll-x">
              <table>
                <thead>
                  <tr><th>Mode</th><th>状態</th><th>TH/s</th><th>価格</th><th>支出</th><th>Expected</th><th>Actual</th><th>Variance</th><th>PnL</th><th>期間</th></tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const pnl = Number(o.minedBtc) - Number(o.spentBtc);
                    const expected = Number(o.expectedBtc);
                    const variance =
                      expected > 0 ? (Number(o.minedBtc) - expected) / expected : null;
                    return (
                      <tr key={o.id}>
                        <td><Badge tone={o.mode === "live" ? "offline" : "demo"}>{o.mode.toUpperCase()}</Badge></td>
                        <td className="text-xs">{o.status}</td>
                        <td>{o.requestedThs.toFixed(0)}</td>
                        <td className="text-[11px]">{o.priceBtcPerFactorDay.toFixed(6)}</td>
                        <td className="text-neg text-[11px]">{o.spentBtc}</td>
                        <td className="text-[11px] text-ink-dim">{o.expectedBtc}</td>
                        <td className="text-[11px]">{o.minedBtc}</td>
                        <td
                          className={
                            variance === null
                              ? "text-ink-dim"
                              : Math.abs(variance) < 0.15
                                ? "text-pos"
                                : "text-warn"
                          }
                          title="（実績−期待）/期待。予測誤差EMAの学習に使われる"
                        >
                          {variance !== null ? `${(variance * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className={pnl >= 0 ? "text-pos" : "text-neg"}>{pnl.toFixed(8)}</td>
                        <td className="text-[11px] text-ink-dim">
                          {o.startedAt ? formatRelative(o.startedAt) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">
            paper 注文の「採掘」は期待値ベースの仮想値です。実採掘・実コストではなく、Ledger には記帳されません。
          </p>
        </Card>
      </div>

      {/* Decision History（フェーズ30・31） */}
      <Card>
        <CardTitle hint="全スキャンの入力・計算・判定を保存（なぜ注文した/しなかったの記録）">
          Decision History
        </CardTitle>
        <div className="scroll-x">
          <table>
            <thead>
              <tr><th>時刻</th><th>判定</th><th>マージン</th><th>NH価格</th><th>Break-even</th><th>信頼度</th><th>Mode</th><th>理由</th></tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap text-[11px] text-ink-dim">{formatRelative(s.at)}</td>
                  <td>
                    <Badge tone={s.action === "BUY" || s.action === "HOLD" ? "online" : s.action === "WAIT" ? "degraded" : "offline"}>
                      {s.action}
                    </Badge>
                  </td>
                  <td className={s.outputs.expectedMarginRate !== null && s.outputs.expectedMarginRate > 0 ? "text-pos" : "text-neg"}>
                    {s.outputs.expectedMarginRate !== null ? `${(s.outputs.expectedMarginRate * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="text-[11px]">{s.inputs.nicehashPriceBtcPerFactorDay?.toFixed(6) ?? "—"}</td>
                  <td className="text-[11px]">{s.outputs.breakEvenPriceBtcPerFactorDay.toFixed(6)}</td>
                  <td className="text-[11px]">{(s.confidence * 100).toFixed(0)}%</td>
                  <td className="text-[10px] text-ink-dim">{s.inputs.dataMode}</td>
                  <td className="max-w-[22rem] truncate text-[11px] text-ink-muted" title={s.reasons.join(" / ")}>
                    {s.reasons[0] ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
