import { getPrice } from "@/modules/bitcoin/service";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ok, handler, tooManyRequests, withFreshness, getClientIp } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const rl = checkRateLimit(`anon:${getClientIp(req)}`, RATE_LIMITS.anonymous);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const price = await getPrice();
  return withFreshness(ok(price), price.freshness);
});
