/**
 * Hashpower 価格の単位変換モジュール（フェーズ4）
 *
 * ★ 単位変換ミスは即・金銭損失になるため、変換はこのモジュールに完全隔離し、
 *   大量のユニットテスト（tests/hashpower-units.test.ts）で固定する。
 *
 * NiceHash の価格表現:
 *   price = BTC / marketFactor / day
 *   marketFactor は algorithm 設定から取得する（SHA256ASICBOOST では PH = 1e15 H/s）。
 *   ★ marketFactor をハードコードせず、必ず API の algorithm settings から渡す。
 *
 * 本システムの内部標準単位:
 *   ハッシュレート: TH/s（= 1e12 H/s）
 *   収益・コスト密度: BTC / TH / day
 */

export const HS_PER_THS = 1e12;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86_400;
export const HOURS_PER_DAY = 24;

export class UnitConversionError extends Error {}

function assertFinite(name: string, v: number, min = 0): void {
  if (!Number.isFinite(v) || v < min) {
    throw new UnitConversionError(`${name} が不正です: ${v}`);
  }
}

/** marketFactor（H/s 基準。例 PH=1e15）→ その factor が何 TH/s か */
export function factorToThs(marketFactor: number): number {
  assertFinite("marketFactor", marketFactor, 1);
  return marketFactor / HS_PER_THS;
}

/**
 * NiceHash 価格（BTC/factor/day）→ BTC/TH/day
 * 例: 0.05 BTC/PH/day, factor=1e15 → 0.05 / 1000 = 0.00005 BTC/TH/day
 */
export function priceFactorDayToBtcPerThDay(
  priceBtcPerFactorDay: number,
  marketFactor: number,
): number {
  assertFinite("price", priceBtcPerFactorDay);
  return priceBtcPerFactorDay / factorToThs(marketFactor);
}

/** BTC/TH/day → NiceHash 価格（BTC/factor/day）。maxBid の逆変換に使う */
export function btcPerThDayToPriceFactorDay(
  btcPerThDay: number,
  marketFactor: number,
): number {
  assertFinite("btcPerThDay", btcPerThDay);
  return btcPerThDay * factorToThs(marketFactor);
}

/** BTC/TH/day → BTC/TH/hour（スプレッドは負になり得るため負値を許容） */
export function perDayToPerHour(v: number): number {
  assertFinite("v", v, -1e12);
  return v / HOURS_PER_DAY;
}

/** BTC/TH/day → BTC/TH/sec（負値許容） */
export function perDayToPerSec(v: number): number {
  assertFinite("v", v, -1e12);
  return v / SECONDS_PER_DAY;
}

/** 密度（BTC/TH/day）× ハッシュレート（TH/s）→ BTC/day（負値許容） */
export function densityToBtcPerDay(btcPerThDay: number, hashrateThs: number): number {
  assertFinite("btcPerThDay", btcPerThDay, -1e12);
  assertFinite("hashrateThs", hashrateThs);
  return btcPerThDay * hashrateThs;
}

/** BTC → USD / JPY（表示・比較用。会計には使わない） */
export function btcToUsd(btc: number, btcPriceUsd: number): number {
  assertFinite("btc", btc, -1e12);
  assertFinite("btcPriceUsd", btcPriceUsd);
  return btc * btcPriceUsd;
}

export function usdToJpy(usd: number, usdJpy: number): number {
  assertFinite("usd", usd, -1e15);
  assertFinite("usdJpy", usdJpy);
  return usd * usdJpy;
}

/** speed（factor単位/s）→ TH/s。orderbook の残量表示に使う */
export function speedFactorToThs(speedFactor: number, marketFactor: number): number {
  assertFinite("speedFactor", speedFactor);
  return speedFactor * factorToThs(marketFactor);
}

/** TH/s → speed（factor単位/s）。注文 limit の指定に使う */
export function thsToSpeedFactor(ths: number, marketFactor: number): number {
  assertFinite("ths", ths);
  const factorThs = factorToThs(marketFactor);
  if (factorThs <= 0) throw new UnitConversionError("marketFactor が不正です");
  return ths / factorThs;
}
