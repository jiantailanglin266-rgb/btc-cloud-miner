/**
 * SSE（Server-Sent Events）によるダッシュボードのリアルタイム配信
 *
 * 仕様は API.md §3 と対応する。
 *   - snapshot: 10 秒ごと
 *   - heartbeat: 25 秒ごと（プロキシのアイドルタイムアウト対策）
 *   - 認証は Cookie セッション。未認証は接続時に 401
 *
 * ★ 接続数の制限 ★
 *   SSE は接続を保持し続けるため、無制限に張られるとサーバーのリソースを食う。
 *   ユーザーあたりの同時接続数を制限する。
 */

import { getSessionContext } from "@/modules/auth/session";
import { buildDashboardSummary } from "@/modules/mining/aggregate";
import { unauthorized, tooManyRequests } from "@/lib/api";

export const dynamic = "force-dynamic";
/** Node ランタイムでのみ動作させる（インメモリ状態を共有するため） */
export const runtime = "nodejs";

const SNAPSHOT_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_CONNECTIONS_PER_USER = 3;
/** 接続の最大寿命。長時間張りっぱなしを防ぐ（クライアントは自動再接続する） */
const MAX_LIFETIME_MS = 30 * 60_000;

const g = globalThis as unknown as { __btcSseCount?: Map<string, number> };
const connections = g.__btcSseCount ?? new Map<string, number>();
g.__btcSseCount = connections;

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  const current = connections.get(ctx.user.id) ?? 0;
  if (current >= MAX_CONNECTIONS_PER_USER) {
    return tooManyRequests(30);
  }
  connections.set(ctx.user.id, current + 1);

  const encoder = new TextEncoder();
  const tenantId = ctx.tenant.id;
  const userId = ctx.user.id;

  let snapshotTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (snapshotTimer) clearInterval(snapshotTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        const n = (connections.get(userId) ?? 1) - 1;
        if (n <= 0) connections.delete(userId);
        else connections.set(userId, n);
        try {
          controller.close();
        } catch {
          /* 既に閉じている */
        }
      };

      const pushSnapshot = async () => {
        try {
          const summary = await buildDashboardSummary(tenantId, userId);
          send("snapshot", {
            currentHashrateThs: summary.currentHashrateThs,
            averageHashrateThs: summary.averageHashrateThs,
            activeMiners: summary.activeMiners,
            offlineMiners: summary.offlineMiners,
            estimatedBtcPerDay: summary.revenue.estimatedBtcPerDay,
            netRevenueUsdPerDay: summary.revenue.netRevenueUsdPerDay,
            at: summary.generatedAt,
          });
        } catch (err) {
          // 集約に失敗しても接続は維持する（次の周期で回復する可能性があるため）
          console.error("[sse] snapshot の生成に失敗しました", err);
          send("error", { message: "一時的にデータを取得できませんでした" });
        }
      };

      await pushSnapshot();
      snapshotTimer = setInterval(pushSnapshot, SNAPSHOT_INTERVAL_MS);
      heartbeatTimer = setInterval(
        () => send("heartbeat", { t: Date.now() }),
        HEARTBEAT_INTERVAL_MS,
      );
      lifetimeTimer = setTimeout(cleanup, MAX_LIFETIME_MS);
    },

    cancel() {
      closed = true;
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
      const n = (connections.get(userId) ?? 1) - 1;
      if (n <= 0) connections.delete(userId);
      else connections.set(userId, n);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx がバッファリングして SSE が届かなくなるのを防ぐ
      "X-Accel-Buffering": "no",
    },
  });
}
