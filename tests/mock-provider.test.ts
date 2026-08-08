/**
 * MockMiningProvider のテスト。
 * 「時間とともに変化する・決定的・現実的な範囲」という性質を固定する。
 */

import { describe, it, expect } from "vitest";
import {
  mockHashrateAt,
  mockTemperatureAt,
  mockUptimeRate,
  type MockWorkerSpec,
} from "@/modules/provider/adapters/mock";

const SPEC: MockWorkerSpec = {
  id: "worker-001",
  externalWorkerId: "w1",
  minerId: "MIN-1",
  model: "Antminer S21 Hydro (1/10)",
  ratedHashrateThs: 33.5,
  ratedEfficiencyJPerTh: 16,
};

const T0 = Date.UTC(2026, 7, 8, 0, 0, 0);

describe("mockHashrateAt", () => {
  it("決定的（同じ時刻なら同じ値）", () => {
    expect(mockHashrateAt(SPEC, T0)).toBe(mockHashrateAt(SPEC, T0));
  });

  it("時間とともに変化する", () => {
    const values = new Set(
      Array.from({ length: 24 }, (_, h) => mockHashrateAt(SPEC, T0 + h * 3600_000).toFixed(4)),
    );
    expect(values.size).toBeGreaterThan(12);
  });

  it("定格の現実的な範囲に収まる（瞬断を除き 85%〜105%）", () => {
    let inRange = 0;
    const samples = 500;
    for (let i = 0; i < samples; i++) {
      const v = mockHashrateAt(SPEC, T0 + i * 600_000);
      const ratio = v / SPEC.ratedHashrateThs;
      expect(ratio).toBeGreaterThanOrEqual(0); // 負にならない
      expect(ratio).toBeLessThanOrEqual(1.1);
      if (ratio >= 0.85) inRange++;
    }
    // 瞬断（約1%）を除き大半は正常範囲
    expect(inRange / samples).toBeGreaterThan(0.9);
  });

  it("ワーカーごとに異なる系列になる", () => {
    const other: MockWorkerSpec = { ...SPEC, id: "worker-002" };
    const same = Array.from({ length: 20 }, (_, i) => {
      const t = T0 + i * 3600_000;
      return mockHashrateAt(SPEC, t) === mockHashrateAt(other, t);
    }).filter(Boolean).length;
    expect(same).toBeLessThan(5);
  });

  it("停止中のワーカーは常にゼロ", () => {
    const offline: MockWorkerSpec = { ...SPEC, forcedOffline: true };
    for (let i = 0; i < 10; i++) {
      expect(mockHashrateAt(offline, T0 + i * 3600_000)).toBe(0);
    }
  });

  it("隣接する5分間で値が飛ばない（滑らかさ）", () => {
    for (let i = 0; i < 50; i++) {
      const a = mockHashrateAt(SPEC, T0 + i * 300_000);
      const b = mockHashrateAt(SPEC, T0 + (i + 1) * 300_000);
      // 瞬断の境界を除き、5分での変化は定格の 90% 以内
      if (a > SPEC.ratedHashrateThs * 0.5 && b > SPEC.ratedHashrateThs * 0.5) {
        expect(Math.abs(a - b)).toBeLessThan(SPEC.ratedHashrateThs * 0.15);
      }
    }
  });
});

describe("mockTemperatureAt", () => {
  it("現実的な範囲（15〜90℃）", () => {
    for (let i = 0; i < 100; i++) {
      const t = mockTemperatureAt(SPEC, T0 + i * 3600_000);
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThan(15);
      expect(t!).toBeLessThan(90);
    }
  });

  it("停止中は null", () => {
    expect(mockTemperatureAt({ ...SPEC, forcedOffline: true }, T0)).toBeNull();
  });
});

describe("mockUptimeRate", () => {
  it("96.5%〜99.7% の範囲で固定", () => {
    const u = mockUptimeRate(SPEC);
    expect(u).toBeGreaterThanOrEqual(0.965);
    expect(u).toBeLessThanOrEqual(0.997);
    expect(mockUptimeRate(SPEC)).toBe(u); // 決定的
  });
});
