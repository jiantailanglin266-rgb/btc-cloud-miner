import { calculateRevenue, calculateSensitivity, RevenueInputError } from "@/modules/revenue/engine";
import { getNetworkAndPrice } from "@/modules/bitcoin/service";
import { simulatorSchema, formatZodError } from "@/lib/validation";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ok, handler, validationError, unprocessable, tooManyRequests, getClientIp } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const rl = checkRateLimit(`sim:${getClientIp(req)}`, RATE_LIMITS.simulator);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const body = await req.json().catch(() => null);
  const parsed = simulatorSchema.safeParse(body);
  if (!parsed.success) return validationError(formatZodError(parsed.error));

  // difficulty / networkHashrate / blockReward が未指定なら現在値を補完する
  const { network } = await getNetworkAndPrice();
  const input = {
    ...parsed.data,
    difficulty: parsed.data.difficulty ?? network.difficulty,
    networkHashrateThs: parsed.data.networkHashrateThs ?? network.networkHashrateThs,
    blockRewardBtc: parsed.data.blockRewardBtc ?? network.blockRewardBtc,
  };

  try {
    const result = calculateRevenue(input);
    const sensitivity = calculateSensitivity(input);
    // isEstimate と disclaimer は RevenueResult に構造上含まれる（API.md §2.4 の要件）
    return ok({ result, sensitivity });
  } catch (err) {
    if (err instanceof RevenueInputError) return unprocessable(err.message);
    throw err;
  }
});
