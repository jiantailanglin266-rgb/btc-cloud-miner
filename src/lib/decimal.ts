/**
 * BTC 金額の安全な演算。
 *
 * なぜ必要か:
 *   JavaScript の number は倍精度浮動小数点なので `0.1 + 0.2 !== 0.3` になる。
 *   金額でこれをやると、残高がじわじわ狂って監査で説明できなくなる。
 *
 * 方針:
 *   すべて satoshi（1 BTC = 100,000,000 satoshi）の bigint に変換して整数演算し、
 *   最後に BTC 文字列へ戻す。誤差はゼロ。
 */

export const SATOSHI_PER_BTC = 100_000_000n;
export const BTC_DECIMALS = 8;

const BTC_PATTERN = /^-?\d+(\.\d{1,8})?$/;

export class BtcAmountError extends Error {}

/** BTC 文字列 → satoshi (bigint) */
export function toSat(btc: string | number): bigint {
  const s = typeof btc === "number" ? formatNumberAsBtc(btc) : btc.trim();
  if (!BTC_PATTERN.test(s)) {
    throw new BtcAmountError(`不正な BTC 金額です: ${btc}`);
  }
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [whole, frac = ""] = body.split(".");
  const padded = (frac + "0".repeat(BTC_DECIMALS)).slice(0, BTC_DECIMALS);
  const value = BigInt(whole) * SATOSHI_PER_BTC + BigInt(padded);
  return negative ? -value : value;
}

/** satoshi (bigint) → BTC 文字列（常に小数点以下 8 桁） */
export function fromSat(sat: bigint): string {
  const negative = sat < 0n;
  const abs = negative ? -sat : sat;
  const whole = abs / SATOSHI_PER_BTC;
  const frac = abs % SATOSHI_PER_BTC;
  const fracStr = frac.toString().padStart(BTC_DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${fracStr}`;
}

/** number を BTC 文字列へ（外部 API や計算結果の取り込み口でのみ使う） */
export function formatNumberAsBtc(n: number): string {
  if (!Number.isFinite(n)) throw new BtcAmountError(`不正な数値です: ${n}`);
  return n.toFixed(BTC_DECIMALS);
}

export function addBtc(...values: string[]): string {
  return fromSat(values.reduce((acc, v) => acc + toSat(v), 0n));
}

export function subBtc(a: string, b: string): string {
  return fromSat(toSat(a) - toSat(b));
}

/** BTC × 料率。丸めは切り捨て（事業者が過大に取らない方向） */
export function mulRate(btc: string, rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new BtcAmountError(`不正な料率です: ${rate}`);
  }
  // 料率を 1e12 スケールの整数にしてから乗算し、精度落ちを避ける
  const scaled = BigInt(Math.round(rate * 1e12));
  return fromSat((toSat(btc) * scaled) / 1_000_000_000_000n);
}

export function cmpBtc(a: string, b: string): -1 | 0 | 1 {
  const x = toSat(a);
  const y = toSat(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isNegativeBtc(a: string): boolean {
  return toSat(a) < 0n;
}

export function negateBtc(a: string): string {
  return fromSat(-toSat(a));
}

/** 表示用。number へ落とすのは表示の直前だけにする */
export function btcToNumber(btc: string): number {
  return Number(btc);
}

/** BTC → 法定通貨（表示用。number で十分な精度） */
export function btcToFiat(btc: string, rate: number): number {
  return Number(btc) * rate;
}
