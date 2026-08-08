import { describe, it, expect } from "vitest";
import {
  assessWithdrawalRisk,
  requiredApprovals,
  RISK_FLAG_THRESHOLD,
  type RiskInput,
} from "@/modules/wallet/risk";
import type { WalletAddress } from "@/types";

const NOW = Date.UTC(2026, 7, 8, 12, 0, 0); // 昼間（深夜シグナルを避ける）

function addr(createdHoursAgo: number): WalletAddress {
  return {
    id: "addr-1",
    tenantId: "t1",
    userId: "u1",
    address: "bc1qtest",
    label: "test",
    createdAt: new Date(NOW - createdHoursAgo * 3600_000).toISOString(),
    usableAt: new Date(NOW - 1).toISOString(),
  };
}

function base(over: Partial<RiskInput> = {}): RiskInput {
  return {
    amountBtc: "0.00500000",
    address: addr(24 * 30), // 30日前に登録
    history: [
      {
        amountBtc: "0.00500000",
        createdAt: new Date(NOW - 30 * 86_400_000).toISOString(),
        address: "bc1qtest",
        requestedIp: "203.0.113.20",
        status: "CONFIRMED",
      },
      {
        amountBtc: "0.00400000",
        createdAt: new Date(NOW - 60 * 86_400_000).toISOString(),
        address: "bc1qtest",
        requestedIp: "203.0.113.20",
        status: "CONFIRMED",
      },
      {
        amountBtc: "0.00600000",
        createdAt: new Date(NOW - 90 * 86_400_000).toISOString(),
        address: "bc1qtest",
        requestedIp: "203.0.113.20",
        status: "CONFIRMED",
      },
    ],
    requestedIp: "203.0.113.20",
    knownIps: ["203.0.113.20"],
    now: NOW,
    availableBtc: "0.10000000",
    ...over,
  };
}

describe("assessWithdrawalRisk", () => {
  it("通常パターンは低リスク・フラグなし", () => {
    const r = assessWithdrawalRisk(base());
    expect(r.score).toBeLessThan(RISK_FLAG_THRESHOLD);
    expect(r.flagged).toBe(false);
  });

  it("新規アドレス + 金額急増 + 新規 IP でフラグが立つ（デモシナリオの再現）", () => {
    const r = assessWithdrawalRisk(
      base({
        amountBtc: "0.03100000", // 平均 0.005 の 6.2 倍
        address: addr(2), // 2時間前に登録
        requestedIp: "198.51.100.77", // 初めての IP
      }),
    );
    expect(r.flagged).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(RISK_FLAG_THRESHOLD);
    const codes = r.signals.map((s) => s.code);
    expect(codes).toContain("NEW_ADDRESS");
    expect(codes).toContain("AMOUNT_SPIKE");
    expect(codes).toContain("NEW_IP");
  });

  it("残高のほぼ全額を検出する", () => {
    const r = assessWithdrawalRisk(base({ amountBtc: "0.09800000" }));
    expect(r.signals.map((s) => s.code)).toContain("FULL_BALANCE");
  });

  it("高頻度出金を検出する", () => {
    const recent = Array.from({ length: 3 }, (_, i) => ({
      amountBtc: "0.00500000",
      createdAt: new Date(NOW - (i + 1) * 3600_000).toISOString(),
      address: "bc1qtest",
      requestedIp: "203.0.113.20",
      status: "CONFIRMED" as const,
    }));
    const r = assessWithdrawalRisk(base({ history: [...recent, ...base().history] }));
    expect(r.signals.map((s) => s.code)).toContain("HIGH_FREQUENCY");
  });

  it("すべての検知に人が読める理由が付く", () => {
    const r = assessWithdrawalRisk(base({ address: addr(1) }));
    for (const s of r.signals) {
      expect(s.reason.length).toBeGreaterThan(3);
      expect(s.score).toBeGreaterThan(0);
    }
  });

  it("スコアは 100 を超えない", () => {
    const r = assessWithdrawalRisk(
      base({
        amountBtc: "0.09900000",
        address: addr(0.5),
        requestedIp: "198.51.100.1",
        history: Array.from({ length: 6 }, (_, i) => ({
          amountBtc: "0.00100000",
          createdAt: new Date(NOW - (i + 1) * 3600_000).toISOString(),
          address: "bc1qother",
          requestedIp: "203.0.113.20",
          status: "CONFIRMED" as const,
        })),
      }),
    );
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("requiredApprovals", () => {
  it("閾値以下・低リスクは 1 名承認", () => {
    expect(
      requiredApprovals({ amountBtc: "0.005", thresholdBtc: "0.01", riskScore: 10 }),
    ).toBe(1);
  });

  it("閾値超は 2 名承認（4-eyes）", () => {
    expect(
      requiredApprovals({ amountBtc: "0.02", thresholdBtc: "0.01", riskScore: 0 }),
    ).toBe(2);
  });

  it("高リスクは金額に関わらず 2 名承認", () => {
    expect(
      requiredApprovals({ amountBtc: "0.001", thresholdBtc: "0.01", riskScore: 70 }),
    ).toBe(2);
  });

  it("閾値ちょうどは 1 名（境界値）", () => {
    expect(
      requiredApprovals({ amountBtc: "0.01", thresholdBtc: "0.01", riskScore: 0 }),
    ).toBe(1);
  });
});
