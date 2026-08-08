/**
 * Readiness probe。
 * トラフィックを受けられる状態か（ストアへの疎通）を返す。
 */
import { getStore } from "@/lib/store";
import { cache } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    // 軽い読み取りで疎通を確認する
    await store.getDefaultTenant();
    return Response.json({
      ok: true,
      store: store.kind,
      cache: cache.kind(),
      at: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
        at: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
