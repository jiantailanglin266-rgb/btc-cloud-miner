/**
 * 単位変換のテスト（フェーズ4）。変換ミスは即・金銭損失のため大量に固定する。
 */

import { describe, it, expect } from "vitest";
import {
  factorToThs,
  priceFactorDayToBtcPerThDay,
  btcPerThDayToPriceFactorDay,
  perDayToPerHour,
  perDayToPerSec,
  densityToBtcPerDay,
  speedFactorToThs,
  thsToSpeedFactor,
  btcToUsd,
  usdToJpy,
  UnitConversionError,
} from "@/modules/hashpower/units";

const PH = 1e15;
const TH = 1e12;

describe("factorToThs", () => {
  it("PH factor → 1000 TH", () => expect(factorToThs(PH)).toBe(1000));
  it("TH factor → 1 TH", () => expect(factorToThs(TH)).toBe(1));
  it("不正値を拒否", () => {
    expect(() => factorToThs(0)).toThrow(UnitConversionError);
    expect(() => factorToThs(NaN)).toThrow(UnitConversionError);
    expect(() => factorToThs(-1)).toThrow(UnitConversionError);
  });
});

describe("価格変換（BTC/PH/day ⇄ BTC/TH/day）", () => {
  it("0.05 BTC/PH/day = 0.00005 BTC/TH/day", () => {
    expect(priceFactorDayToBtcPerThDay(0.05, PH)).toBeCloseTo(0.00005, 12);
  });
  it("往復変換が一致する", () => {
    const price = 0.2345;
    const density = priceFactorDayToBtcPerThDay(price, PH);
    expect(btcPerThDayToPriceFactorDay(density, PH)).toBeCloseTo(price, 10);
  });
  it("marketFactor=TH なら変換は恒等", () => {
    expect(priceFactorDayToBtcPerThDay(0.0001, TH)).toBeCloseTo(0.0001, 12);
  });
});

describe("時間変換", () => {
  it("day → hour → sec の整合", () => {
    const perDay = 0.00024;
    expect(perDayToPerHour(perDay) * 24).toBeCloseTo(perDay, 12);
    expect(perDayToPerSec(perDay) * 86400).toBeCloseTo(perDay, 12);
  });
});

describe("密度×ハッシュレート", () => {
  it("0.00005 BTC/TH/day × 1000 TH = 0.05 BTC/day", () => {
    expect(densityToBtcPerDay(0.00005, 1000)).toBeCloseTo(0.05, 10);
  });
});

describe("speed factor ⇄ TH/s", () => {
  it("2.5 PH-speed = 2500 TH/s", () => {
    expect(speedFactorToThs(2.5, PH)).toBe(2500);
  });
  it("往復一致", () => {
    expect(thsToSpeedFactor(speedFactorToThs(3.7, PH), PH)).toBeCloseTo(3.7, 10);
  });
});

describe("法定通貨換算", () => {
  it("BTC→USD→JPY", () => {
    expect(btcToUsd(0.01, 95000)).toBeCloseTo(950, 6);
    expect(usdToJpy(950, 150)).toBeCloseTo(142500, 6);
  });
});
