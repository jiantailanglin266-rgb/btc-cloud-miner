/**
 * Bitcoin アドレス検証のテスト。
 * 実在する既知のアドレス（公開されている有名なもの）で検証する。
 */

import { describe, it, expect } from "vitest";
import {
  validateBitcoinAddress,
  isValidBitcoinAddress,
  assertMainnetAddress,
  demoAddress,
} from "@/modules/wallet/address";

describe("Base58Check（レガシーアドレス）", () => {
  it("genesis ブロックの P2PKH アドレスを受理する", () => {
    // Satoshi の genesis アドレス（公知）
    const r = validateBitcoinAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("P2PKH");
    expect(r.network).toBe("mainnet");
  });

  it("P2SH アドレス（3...）を受理する", () => {
    const r = validateBitcoinAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy");
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("P2SH");
  });

  it("1文字変えるとチェックサムで拒否される（打ち間違い検出）", () => {
    const r = validateBitcoinAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("チェックサム");
  });
});

describe("Bech32（SegWit アドレス）", () => {
  it("BIP-173 の公式テストベクタ（P2WPKH）を受理する", () => {
    const r = validateBitcoinAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("P2WPKH");
    expect(r.network).toBe("mainnet");
  });

  it("BIP-350 の Taproot アドレス（bech32m）を受理する", () => {
    const r = validateBitcoinAddress(
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    );
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("P2TR");
  });

  it("1文字変えるとチェックサムで拒否される", () => {
    const r = validateBitcoinAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("チェックサム");
  });

  it("testnet アドレスは network=testnet と判定する", () => {
    const r = validateBitcoinAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
    expect(r.valid).toBe(true);
    expect(r.network).toBe("testnet");
  });

  it("大文字小文字の混在を拒否する（BIP-173）", () => {
    const r = validateBitcoinAddress("bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(r.valid).toBe(false);
  });
});

describe("assertMainnetAddress", () => {
  it("mainnet アドレスは通す", () => {
    expect(() =>
      assertMainnetAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"),
    ).not.toThrow();
  });

  it("testnet アドレスへの送金を拒否する（資産喪失の防止）", () => {
    expect(() =>
      assertMainnetAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"),
    ).toThrow(/テストネット/);
  });

  it("不正なアドレスを拒否する", () => {
    expect(() => assertMainnetAddress("not-an-address")).toThrow();
  });
});

describe("その他の不正入力", () => {
  it.each(["", " ", "0x1234abcd", "bc2qqqqq", "1", "ltc1qxxxx"])(
    "「%s」を拒否する",
    (input) => {
      expect(isValidBitcoinAddress(input)).toBe(false);
    },
  );
});

describe("demoAddress（デモ用アドレス生成）", () => {
  it("生成したアドレスは自前の検証を通過する", () => {
    for (const seed of ["main", "sub", "flagged"]) {
      const addr = demoAddress(seed);
      const r = validateBitcoinAddress(addr);
      expect(r.valid).toBe(true);
      expect(r.kind).toBe("P2WPKH");
      expect(r.network).toBe("mainnet");
    }
  });

  it("同じシードなら同じアドレス（決定的）", () => {
    expect(demoAddress("x")).toBe(demoAddress("x"));
    expect(demoAddress("x")).not.toBe(demoAddress("y"));
  });
});
