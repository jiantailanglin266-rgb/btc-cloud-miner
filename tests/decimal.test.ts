/**
 * BTC 金額演算のテスト。
 * 「0.1 + 0.2 問題」が起きないことを、浮動小数点では失敗する値で検証する。
 */

import { describe, it, expect } from "vitest";
import {
  toSat,
  fromSat,
  addBtc,
  subBtc,
  mulRate,
  cmpBtc,
  negateBtc,
  isNegativeBtc,
  BtcAmountError,
} from "@/lib/decimal";

describe("toSat / fromSat", () => {
  it("往復変換が完全に一致する", () => {
    for (const v of ["0.00000001", "0.10000000", "21000000.00000000", "0.00024494"]) {
      expect(fromSat(toSat(v))).toBe(padBtc(v));
    }
  });

  it("1 BTC = 100,000,000 satoshi", () => {
    expect(toSat("1")).toBe(100_000_000n);
    expect(toSat("0.00000001")).toBe(1n);
  });

  it("負数を扱える", () => {
    expect(toSat("-0.5")).toBe(-50_000_000n);
    expect(fromSat(-1n)).toBe("-0.00000001");
  });

  it("不正な形式を拒否する", () => {
    expect(() => toSat("abc")).toThrow(BtcAmountError);
    expect(() => toSat("1.123456789")).toThrow(BtcAmountError); // 9桁
    expect(() => toSat("1e8")).toThrow(BtcAmountError); // 指数表記
    expect(() => toSat("")).toThrow(BtcAmountError);
  });
});

describe("addBtc / subBtc", () => {
  it("浮動小数点では失敗する加算が正確", () => {
    // number では 0.1 + 0.2 = 0.30000000000000004
    expect(addBtc("0.10000000", "0.20000000")).toBe("0.30000000");
  });

  it("多数の小さい値の合計が正確（報酬の積み上げを模す）", () => {
    const daily = "0.00024494";
    let total = "0.00000000";
    for (let i = 0; i < 365; i++) total = addBtc(total, daily);
    // 0.00024494 × 365 = 0.08940310 ちょうど
    expect(total).toBe("0.08940310");
  });

  it("減算", () => {
    expect(subBtc("1.00000000", "0.00000001")).toBe("0.99999999");
    expect(subBtc("0.5", "0.7")).toBe("-0.20000000");
  });
});

describe("mulRate", () => {
  it("手数料計算（2%）", () => {
    expect(mulRate("1.00000000", 0.02)).toBe("0.02000000");
  });

  it("端数は切り捨て（事業者が過大に取らない方向）", () => {
    // 0.00000003 × 0.5 = 0.000000015 → 切り捨てで 0.00000001
    expect(mulRate("0.00000003", 0.5)).toBe("0.00000001");
  });

  it("率ゼロならゼロ", () => {
    expect(mulRate("123.45678901", 0)).toBe("0.00000000");
  });

  it("負の率を拒否する", () => {
    expect(() => mulRate("1", -0.1)).toThrow(BtcAmountError);
  });
});

describe("cmpBtc / negate / isNegative", () => {
  it("比較", () => {
    expect(cmpBtc("0.1", "0.2")).toBe(-1);
    expect(cmpBtc("0.2", "0.1")).toBe(1);
    expect(cmpBtc("0.10000000", "0.1")).toBe(0);
  });
  it("符号反転", () => {
    expect(negateBtc("0.5")).toBe("-0.50000000");
    expect(isNegativeBtc("-0.00000001")).toBe(true);
    expect(isNegativeBtc("0")).toBe(false);
  });
});

function padBtc(v: string): string {
  const [w, f = ""] = v.split(".");
  return `${w}.${(f + "00000000").slice(0, 8)}`;
}
