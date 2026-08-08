import { describe, it, expect } from "vitest";
import { parseStratumUrl } from "@/modules/provider/adapters/stratum";
import { normalizeWorkerStatus } from "@/modules/provider/interface";

describe("parseStratumUrl", () => {
  it("stratum+tcp を解析する", () => {
    expect(parseStratumUrl("stratum+tcp://pool.example.com:3333")).toEqual({
      host: "pool.example.com",
      port: 3333,
      tls: false,
    });
  });

  it("stratum+ssl / stratum+tls は TLS", () => {
    expect(parseStratumUrl("stratum+ssl://pool.example.com:443").tls).toBe(true);
    expect(parseStratumUrl("stratum+tls://pool.example.com:443").tls).toBe(true);
  });

  it("不正な URL を拒否する", () => {
    expect(() => parseStratumUrl("http://pool.example.com:3333")).toThrow();
    expect(() => parseStratumUrl("stratum+tcp://noport")).toThrow();
    expect(() => parseStratumUrl("")).toThrow();
  });
});

describe("normalizeWorkerStatus", () => {
  it("各プールの表記ゆれを吸収する", () => {
    for (const s of ["active", "ONLINE", "ok", "Running", "mining"]) {
      expect(normalizeWorkerStatus(s)).toBe("ACTIVE");
    }
    for (const s of ["offline", "DOWN", "dead", "inactive"]) {
      expect(normalizeWorkerStatus(s)).toBe("OFFLINE");
    }
    for (const s of ["maintenance", "paused"]) {
      expect(normalizeWorkerStatus(s)).toBe("MAINTENANCE");
    }
    expect(normalizeWorkerStatus("???")).toBe("UNKNOWN");
    expect(normalizeWorkerStatus(null)).toBe("UNKNOWN");
  });
});
