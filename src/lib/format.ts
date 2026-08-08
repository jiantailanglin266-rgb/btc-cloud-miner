/**
 * 表示フォーマット。
 * サーバー・クライアント両方から使うため、Node 固有 API を含めない。
 */

/** TH/s を桁に応じて TH/s → PH/s → EH/s へ変換して表示する */
export function formatHashrate(ths: number, digits = 2): string {
  if (!Number.isFinite(ths)) return "—";
  const abs = Math.abs(ths);
  if (abs >= 1e6) return `${(ths / 1e6).toFixed(digits)} EH/s`;
  if (abs >= 1e3) return `${(ths / 1e3).toFixed(digits)} PH/s`;
  if (abs >= 1) return `${ths.toFixed(digits)} TH/s`;
  return `${(ths * 1e3).toFixed(digits)} GH/s`;
}

export function formatBtc(btc: string | number, digits = 8): string {
  const n = typeof btc === "string" ? Number(btc) : btc;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)} BTC`;
}

export function formatUsd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatJpy(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

export function formatPercent(rate: number, digits = 1): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatCompact(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(digits)} T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)} B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)} M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)} K`;
  return n.toFixed(digits);
}

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatRelative(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  return `${Math.floor(sec / 86400)}日前`;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}日 ${h}時間`;
  if (h > 0) return `${h}時間 ${m}分`;
  return `${m}分`;
}

/** アドレスや ID を省略表示する（bc1qxy...k8fa） */
export function truncateMiddle(s: string, head = 8, tail = 6): string {
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export const STATUS_LABEL_JA: Record<string, string> = {
  ONLINE: "稼働中",
  DEGRADED: "劣化",
  OFFLINE: "停止",
  MAINTENANCE: "メンテナンス",
  ACTIVE: "稼働中",
  UNKNOWN: "不明",
  PENDING_REVIEW: "承認待ち",
  FLAGGED: "要確認",
  APPROVED: "承認済み",
  REJECTED: "却下",
  BROADCASTING: "送信中",
  BROADCASTED: "送信済み",
  CONFIRMED: "完了",
  FAILED: "失敗",
  CANCELLED: "取消",
  NOT_SUBMITTED: "未提出",
  PENDING: "審査中",
  EXPIRED: "期限切れ",
  SUSPENDED: "停止中",
  PENDING_VERIFICATION: "確認待ち",
  PENDING_PAYMENT: "支払待ち",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL_JA[status] ?? status;
}

/**
 * freshness → データ出所種別（LIVE / STALE / MOCK）。
 * UI で必ず表示し、Mock データを実データと誤認させない（フェーズ11要件）。
 */
export function dataModeOf(freshness: {
  source: string;
  stale: boolean;
}): "LIVE" | "STALE" | "MOCK" {
  if (freshness.source.startsWith("mock")) return "MOCK";
  if (freshness.stale) return "STALE";
  return "LIVE";
}
