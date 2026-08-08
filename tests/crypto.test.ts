import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  encryptField,
  decryptField,
  isEncrypted,
  generateToken,
  hashToken,
} from "@/lib/crypto";

describe("パスワードハッシュ（scrypt）", () => {
  it("正しいパスワードを受理する", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("誤ったパスワードを拒否する", () => {
    const hash = hashPassword("password-one");
    expect(verifyPassword("password-two", hash)).toBe(false);
  });

  it("同じパスワードでもソルトによりハッシュが毎回異なる", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("形式は scrypt$salt$hash", () => {
    const hash = hashPassword("x".repeat(10));
    expect(hash.split("$")).toHaveLength(3);
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("壊れた保存形式を拒否する（例外を投げない）", () => {
    expect(verifyPassword("any", "not-a-hash")).toBe(false);
    expect(verifyPassword("any", "scrypt$zz$zz")).toBe(false);
    expect(verifyPassword("any", "")).toBe(false);
  });
});

describe("フィールド暗号化（AES-256-GCM）", () => {
  it("往復で元に戻る", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(decryptField(encryptField(secret))).toBe(secret);
  });

  it("enc:v1: プレフィックスが付く", () => {
    expect(encryptField("data").startsWith("enc:v1:")).toBe(true);
    expect(isEncrypted(encryptField("data"))).toBe(true);
  });

  it("平文が渡された場合はそのまま返す（暗号化導入前データとの共存）", () => {
    expect(decryptField("plain-legacy-value")).toBe("plain-legacy-value");
    expect(isEncrypted("plain-legacy-value")).toBe(false);
  });

  it("暗号文の改ざんを検知する（GCM の認証タグ）", () => {
    const enc = encryptField("secret");
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(() => decryptField(tampered)).toThrow();
  });

  it("日本語・絵文字も往復できる", () => {
    const s = "秘密のシークレット🔑";
    expect(decryptField(encryptField(s))).toBe(s);
  });
});

describe("トークン", () => {
  it("十分な長さでランダム", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(40);
  });

  it("ハッシュは決定的", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toHaveLength(64);
  });
});
