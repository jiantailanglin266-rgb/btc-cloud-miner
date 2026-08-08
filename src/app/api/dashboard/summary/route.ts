import { getSessionContext } from "@/modules/auth/session";
import { buildDashboardSummary } from "@/modules/mining/aggregate";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ok, handler, unauthorized, tooManyRequests, withFreshness } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  const rl = checkRateLimit(`api:${ctx.user.id}`, RATE_LIMITS.api);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const summary = await buildDashboardSummary(ctx.tenant.id, ctx.user.id);
  return withFreshness(ok(summary), summary.network.freshness);
});
