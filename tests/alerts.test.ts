import { describe, it, expect } from "vitest";
import {
  detectHashrateDrop,
  detectRejectSpike,
  detectRevenueAnomaly,
  detectWithdrawalAnomaly,
  ALERT_THRESHOLDS,
} from "@/modules/monitoring/alerts";
import type { Withdrawal } from "@/types";

describe("detectHashrateDrop", () => {
  it("平均の 60% 未満で発報する", () => {
    expect(detectHashrateDrop(500, 500)).toBeNull();
    expect(detectHashrateDrop(350, 500)).toBeNull(); // 70%
    const alert = detectHashrateDrop(250, 500); // 50%
    expect(alert).not.toBeNull();
    expect(alert!.kind).toBe("HASHRATE_SUDDEN_DROP");
    expect(alert!.severity).toBe("WARNING");
  });

  it("30% 未満は CRITICAL", () => {
    expect(detectHashrateDrop(100, 500)!.severity).toBe("CRITICAL");
  });

  it("平均ゼロ（データなし）では発報しない", () => {
    expect(detectHashrateDrop(0, 0)).toBeNull();
  });
});

describe("detectRejectSpike", () => {
  it("5% 以上で発報、10% 以上で CRITICAL", () => {
    expect(detectRejectSpike(10000, 100)).toBeNull(); // 1%
    expect(detectRejectSpike(9500, 500)!.severity).toBe("WARNING"); // 5%
    expect(detectRejectSpike(9000, 1000)!.severity).toBe("CRITICAL"); // 10%
  });

  it("サンプル不足（1000未満）では発報しない", () => {
    expect(detectRejectSpike(500, 100)).toBeNull();
  });
});

describe("detectRevenueAnomaly", () => {
  it("実収益が推定の 3 倍超 → UNEXPECTED_PAYOUT", () => {
    const alert = detectRevenueAnomaly("0.01000000", 0.002);
    expect(alert!.kind).toBe("UNEXPECTED_PAYOUT");
    expect(alert!.severity).toBe("CRITICAL");
  });

  it("実収益が推定の 50% 未満 → REVENUE_ANOMALY", () => {
    const alert = detectRevenueAnomaly("0.00080000", 0.002);
    expect(alert!.kind).toBe("REVENUE_ANOMALY");
  });

  it("正常範囲（±50%以内・3倍以内）では発報しない", () => {
    expect(detectRevenueAnomaly("0.00200000", 0.002)).toBeNull();
    expect(detectRevenueAnomaly("0.00150000", 0.002)).toBeNull();
  });

  it("推定ゼロ・実績ゼロでは発報しない", () => {
    expect(detectRevenueAnomaly("0.00100000", 0)).toBeNull();
    expect(detectRevenueAnomaly("0.00000000", 0.002)).toBeNull();
  });
});

describe("detectWithdrawalAnomaly", () => {
  const base: Withdrawal = {
    id: "wd-1",
    tenantId: "t1",
    userId: "u1",
    userEmail: "u@example.com",
    addressId: "a1",
    address: "bc1qxxxxxxxxxxxxxxxxxxxx",
    amountBtc: "0.05000000",
    feeBtc: "0.00015000",
    netBtc: "0.04985000",
    status: "FLAGGED",
    riskScore: 0,
    riskReasons: [],
    requiredApprovals: 2,
    approvals: [],
    requestedIp: null,
    txId: null,
    confirmations: 0,
    idempotencyKey: "k",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("リスクスコア閾値未満では発報しない", () => {
    expect(detectWithdrawalAnomaly({ ...base, riskScore: 30 })).toBeNull();
  });

  it("閾値以上で発報、75 以上で CRITICAL", () => {
    expect(
      detectWithdrawalAnomaly({ ...base, riskScore: ALERT_THRESHOLDS.withdrawalRiskScore })!
        .severity,
    ).toBe("WARNING");
    expect(detectWithdrawalAnomaly({ ...base, riskScore: 80 })!.severity).toBe("CRITICAL");
  });

  it("evidence に根拠数値が含まれる", () => {
    const alert = detectWithdrawalAnomaly({
      ...base,
      riskScore: 72,
      riskReasons: ["新規アドレス", "金額急増"],
    })!;
    expect(alert.evidence.riskScore).toBe(72);
    expect(String(alert.evidence.reasons)).toContain("新規アドレス");
  });
});
