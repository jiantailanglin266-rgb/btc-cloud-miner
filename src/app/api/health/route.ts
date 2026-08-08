/**
 * Liveness probe。
 * プロセスが生きているかだけを返す（依存を見ない）。
 * 依存を見ると「DB が落ちただけでコンテナが再起動され続ける」事故になるため。
 */
export async function GET() {
  return Response.json({ ok: true, at: new Date().toISOString() });
}
