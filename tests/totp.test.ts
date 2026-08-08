/**
 * TOTP（RFC 6238）のテスト。
 * RFC 記載の公式テストベクタで実装の正しさを固定する。
 */

import { describe, it, expect } from "vitest";
import {
  generateTotp,
  verifyTotp,
  generateSecret,
  base32Encode,
  base32Decode,
  buildOtpAuthUri,
  generateRecoveryCodes,
} from "@/modules/auth/totp";

/**
 * RFC 6238 Appendix B のテストベクタ。
 * シークレットは ASCII "12345678901234567890"（SHA-1）を Base32 化したもの。
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

const RFC_VECTORS: Array<[number, string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("RFC 6238 テストベクタ", () => {
  for (const [t, expected] of RFC_VECTORS) {
    it(`T=${t}s → ${expected}`, () => {
      expect(generateTotp(RFC_SECRET, t * 1000)).toBe(expected);
    });
  }
});

describe("verifyTotp", () => {
  it("正しいコードを受理し、一致したステップを返す", () => {
    const at = 59 * 1000;
    const step = verifyTotp(RFC_SECRET, "287082", at);
    expect(step).toBe(Math.floor(59 / 30));
  });

  it("誤ったコードを拒否する", () => {
    expect(verifyTotp(RFC_SECRET, "000000", 59 * 1000)).toBeNull();
  });

  it("±1 ステップの時計ずれを許容する", () => {
    // T=59 のコードは T=59+30（次のステップ）でも window=1 なら通る
    expect(verifyTotp(RFC_SECRET, "287082", (59 + 30) * 1000)).not.toBeNull();
    // 2 ステップずれは拒否
    expect(verifyTotp(RFC_SECRET, "287082", (59 + 90) * 1000)).toBeNull();
  });

  it("形式不正を拒否する", () => {
    expect(verifyTotp(RFC_SECRET, "12345", 0)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", 0)).toBeNull();
  });
});

describe("Base32", () => {
  it("往復変換", () => {
    const buf = Buffer.from("hello world 12345", "ascii");
    expect(base32Decode(base32Encode(buf)).toString("ascii")).toBe("hello world 12345");
  });

  it("不正文字を拒否する", () => {
    expect(() => base32Decode("ABC123!@#")).toThrow();
  });
});

describe("シークレット・リカバリーコード", () => {
  it("シークレットは十分な長さの Base32", () => {
    const s = generateSecret();
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(() => base32Decode(s)).not.toThrow();
  });

  it("リカバリーコードは重複しない", () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it("otpauth URI に必要な要素が含まれる", () => {
    const uri = buildOtpAuthUri({
      secret: RFC_SECRET,
      accountName: "demo@example.com",
      issuer: "BTC CLOUD MINER",
    });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=");
    expect(uri).toContain("issuer=BTC");
  });
});
