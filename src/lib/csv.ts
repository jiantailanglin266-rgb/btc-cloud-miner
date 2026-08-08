/**
 * CSV 出力（RFC 4180 準拠 + UTF-8 BOM）
 *
 * BOM を付ける理由: Excel が UTF-8 と認識せず日本語が文字化けするため。
 * これは日本の業務システムでは事実上の必須要件。
 */

export const UTF8_BOM = "﻿";

/**
 * 1 セルをエスケープする。
 * ダブルクォート・カンマ・改行を含む場合は全体をクォートし、" は "" にする。
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // 先頭が = + - @ の場合は Excel が数式として解釈する（CSV インジェクション）。
  // シングルクォートを前置して無害化する。
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (/["\n\r,]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
