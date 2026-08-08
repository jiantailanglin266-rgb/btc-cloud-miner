import { getSessionContext } from "@/modules/auth/session";
import { buildSeries } from "@/modules/mining/aggregate";
import { seriesRangeSchema } from "@/lib/validation";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ok, handler, unauthorized, validationError, tooManyRequests } from "@/lib/api";

export const dynamic = "force-dynamic";

const METRICS = ["hashrate", "revenue", "uptime"] as const;

export const GET = handler(async (req: Request) => {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  const rl = checkRateLimit(`api:${ctx.user.id}`, RATE_LIMITS.api);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const url = new URL(req.url);
  const parsedRange = seriesRangeSchema.safeParse(url.searchParams.get("range") ?? "24h");
  if (!parsedRange.success) {
    return validationError([{ path: "range", message: "対応していない期間です" }]);
  }

  const metricParam = url.searchParams.get("metric") ?? "hashrate";
  const metric = (METRICS as readonly string[]).includes(metricParam)
    ? (metricParam as (typeof METRICS)[number])
    : "hashrate";

  const series = await buildSeries(ctx.tenant.id, ctx.user.id, metric, parsedRange.data);
  return ok(series);
});
