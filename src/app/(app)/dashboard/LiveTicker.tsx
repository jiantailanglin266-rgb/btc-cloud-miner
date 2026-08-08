"use client";

/**
 * SSE によるリアルタイム更新。
 *
 * WebSocket ではなく SSE を使う理由（ARCHITECTURE.md §5）:
 *   ダッシュボードは一方向の更新しか必要としない。
 *   SSE は HTTP のままで動き、切断時の自動再接続がブラウザ標準で入っている。
 *
 * SSE がプロキシ等で遮断される環境のために、
 * 一定時間イベントが来なければポーリングへ自動的に切り替える。
 */

import { useEffect, useRef, useState } from "react";
import { Card, CardTitle, Badge } from "@/components/ui";
import { formatHashrate, formatRelative } from "@/lib/format";
import { Sparkline } from "@/components/charts/LineChart";

type Snapshot = {
  currentHashrateThs: number;
  activeMiners: number;
  offlineMiners: number;
  at: string;
};

const MAX_POINTS = 40;

export function LiveTicker({ initialHashrateThs }: { initialHashrateThs: number }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<number[]>([initialHashrateThs]);
  const [mode, setMode] = useState<"connecting" | "sse" | "polling" | "offline">(
    "connecting",
  );
  const lastEventAt = useRef(Date.now());

  useEffect(() => {
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const apply = (data: Snapshot) => {
      if (cancelled) return;
      lastEventAt.current = Date.now();
      setSnapshot(data);
      setHistory((h) => [...h, data.currentHashrateThs].slice(-MAX_POINTS));
    };

    const startPolling = () => {
      if (pollTimer) return;
      setMode("polling");
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
          const json = await res.json();
          if (json?.ok) {
            apply({
              currentHashrateThs: json.data.currentHashrateThs,
              activeMiners: json.data.activeMiners,
              offlineMiners: json.data.offlineMiners,
              at: json.data.generatedAt,
            });
          }
        } catch {
          setMode("offline");
        }
      }, 15_000);
    };

    try {
      source = new EventSource("/api/stream/dashboard");
      source.addEventListener("snapshot", (e) => {
        setMode("sse");
        apply(JSON.parse((e as MessageEvent).data) as Snapshot);
      });
      source.addEventListener("heartbeat", () => {
        lastEventAt.current = Date.now();
      });
      source.onerror = () => {
        // EventSource は自動再接続するが、長く復帰しなければポーリングへ切り替える
        if (Date.now() - lastEventAt.current > 45_000) {
          source?.close();
          startPolling();
        }
      };
    } catch {
      startPolling();
    }

    watchdog = setInterval(() => {
      if (Date.now() - lastEventAt.current > 60_000 && mode === "sse") {
        source?.close();
        startPolling();
      }
    }, 20_000);

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
      if (watchdog) clearInterval(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardTitle
        hint={
          mode === "sse"
            ? "SSE でリアルタイム受信中"
            : mode === "polling"
              ? "ポーリングで更新中（SSE 利用不可）"
              : mode === "offline"
                ? "更新を停止しています"
                : "接続中…"
        }
        action={
          <Badge
            tone={mode === "sse" ? "online" : mode === "offline" ? "offline" : "degraded"}
            dot
          >
            LIVE
          </Badge>
        }
      >
        リアルタイム
      </CardTitle>

      <div className="text-xl font-semibold text-brand">
        {formatHashrate(snapshot?.currentHashrateThs ?? initialHashrateThs)}
      </div>
      <div className="mt-1 text-[11px] text-ink-dim">
        {snapshot
          ? `更新 ${formatRelative(snapshot.at)} · 稼働 ${snapshot.activeMiners} 台 / 停止 ${snapshot.offlineMiners} 台`
          : "初期値を表示しています"}
      </div>

      {history.length > 2 && (
        <div className="mt-2">
          <Sparkline values={history} />
        </div>
      )}
    </Card>
  );
}
