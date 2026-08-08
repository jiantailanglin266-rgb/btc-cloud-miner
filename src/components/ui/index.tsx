/**
 * 共通 UI 部品。
 * ロジックは持たず、表示だけを担当する（画面設計書 §3 の状態設計に対応）。
 */

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  children,
  className = "",
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div className={`card p-4 sm:p-5 ${glow ? "card-glow" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium text-ink">{children}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-dim">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat（KPI カード）
// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  sub,
  delta,
  tone = "default",
  estimate = false,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  tone?: "default" | "brand" | "accent" | "pos" | "neg";
  estimate?: boolean;
  children?: ReactNode;
}) {
  const toneClass =
    tone === "brand"
      ? "text-brand"
      : tone === "accent"
        ? "text-accent"
        : tone === "pos"
          ? "text-pos"
          : tone === "neg"
            ? "text-neg"
            : "text-ink";

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-ink-muted">{label}</span>
        {estimate && <EstimateChip />}
      </div>
      <div className={`mt-1.5 text-xl font-semibold sm:text-2xl ${toneClass}`}>
        {value}
      </div>
      {(sub || delta !== undefined) && (
        <div className="mt-1 flex items-center gap-2 text-xs text-ink-dim">
          {sub}
          {delta !== undefined && delta !== null && (
            <span className={delta >= 0 ? "text-pos" : "text-neg"}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1)}%
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * 「推定値」チップ。
 * ★ 収益に関する数値には必ず付ける（法規制・コンプライアンス.md §3.2）。
 */
export function EstimateChip({ label = "推定" }: { label?: string }) {
  return (
    <span
      className="rounded-full border border-line-strong px-1.5 py-0.5 text-[10px] leading-none text-ink-dim"
      title="この値は推定であり、収益を保証するものではありません"
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const BADGE_TONES = {
  online: "border-pos/40 bg-pos/10 text-pos",
  degraded: "border-warn/40 bg-warn/10 text-warn",
  offline: "border-neg/40 bg-neg/10 text-neg",
  neutral: "border-line-strong bg-white/5 text-ink-muted",
  brand: "border-brand/40 bg-brand/10 text-brand",
  accent: "border-accent/40 bg-accent/10 text-accent",
  demo: "border-purple-400/40 bg-purple-400/10 text-purple-300",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${BADGE_TONES[tone]}`}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** ステータス文字列 → バッジのトーン */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "ONLINE":
    case "ACTIVE":
    case "APPROVED":
    case "CONFIRMED":
      return "online";
    case "DEGRADED":
    case "PENDING":
    case "PENDING_REVIEW":
    case "FLAGGED":
    case "BROADCASTING":
    case "BROADCASTED":
      return "degraded";
    case "OFFLINE":
    case "REJECTED":
    case "FAILED":
    case "SUSPENDED":
      return "offline";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// 状態表示
// ---------------------------------------------------------------------------

export function Skeleton({ className = "h-4 w-24" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({
  icon = "◌",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div className="text-3xl text-ink-dim">{icon}</div>
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="max-w-sm text-xs text-ink-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-neg/40 bg-neg/10 px-4 py-3 text-sm text-neg">
      {message}
    </div>
  );
}

/** 外部データが古い場合の注意表示。値を隠さず、古いことだけを伝える */
export function StaleNotice({
  ageSec,
  source,
}: {
  ageSec: number;
  source: string;
}) {
  const minutes = Math.floor(ageSec / 60);
  return (
    <div className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
      外部データの取得に失敗しているため、{minutes > 0 ? `約 ${minutes} 分前` : `${ageSec} 秒前`}
      の値を表示しています（取得元: {source}）。
    </div>
  );
}

/** デモデータであることの明示。本番で出てはいけない */
export function DemoNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-purple-400/40 bg-purple-400/10 px-3 py-2 text-xs text-purple-200">
      {children ??
        "デモ環境です。表示されているマイニング統計は実際の設備の値ではなく、動作確認用に生成された擬似データです。"}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button / Link
// ---------------------------------------------------------------------------

const BUTTON_VARIANTS = {
  primary:
    "bg-gradient-to-br from-[var(--brand-primary)] to-[var(--gold)] text-black font-medium hover:opacity-90",
  secondary: "border border-line-strong bg-white/5 text-ink hover:bg-white/10",
  ghost: "text-ink-muted hover:text-ink hover:bg-white/5",
  danger: "border border-neg/50 bg-neg/10 text-neg hover:bg-neg/20",
} as const;

export function Button({
  children,
  variant = "primary",
  type = "button",
  disabled,
  onClick,
  className = "",
}: {
  children: ReactNode;
  variant?: keyof typeof BUTTON_VARIANTS;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// レイアウト補助
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-ink sm:text-xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function KeyValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "pos" | "neg" | "muted";
}) {
  const cls =
    tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "muted" ? "text-ink-muted" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className={`text-sm ${cls}`}>{value}</span>
    </div>
  );
}
