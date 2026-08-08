import { describe, it, expect } from "vitest";
import { escapeCsvCell, toCsv, UTF8_BOM } from "@/lib/csv";

describe("escapeCsvCell", () => {
  it("通常の値はそのまま", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
    expect(escapeCsvCell(123)).toBe("123");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("カンマ・改行・引用符を含む値をクォートする（RFC 4180）", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("CSV インジェクションを無害化する（Excel の数式実行を防ぐ）", () => {
    expect(escapeCsvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(escapeCsvCell("+1234")).toBe("'+1234");
    expect(escapeCsvCell("-cmd")).toBe("'-cmd");
    expect(escapeCsvCell("@import")).toBe("'@import");
  });

  it("日本語はそのまま", () => {
    expect(escapeCsvCell("日次マイニング報酬")).toBe("日次マイニング報酬");
  });
});

describe("toCsv", () => {
  it("BOM 付きで CRLF 区切り", () => {
    const csv = toCsv(["a", "b"], [["1", "2"]]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain("a,b\r\n1,2\r\n");
  });

  it("行数が正しい", () => {
    const csv = toCsv(["h"], [["r1"], ["r2"], ["r3"]]);
    expect(csv.trim().split("\r\n")).toHaveLength(4);
  });
});
