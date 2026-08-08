/**
 * 自前の SVG チャート。
 *
 * 外部チャートライブラリを使わない理由:
 *   1. 依存を増やさない（サプライチェーンリスクとバンドルサイズ）
 *   2. デザインを完全に制御できる（グロー・グラデーションを themable に）
 *   3. アクセシビリティ（代替テーブル）を自分で保証できる
 *
 * Server Component としても Client Component としても使える純粋な描画部品。
 */

import type { SeriesPoint } from "@/types";

export type LineChartProps = {
  points: SeriesPoint[];
  unit?: string;
  height?: number;
  /** 面グラフの塗り */
  fill?: boolean;
  color?: "brand" | "accent" | "pos";
  /** グラフの代替テーブルに付けるキャプション（スクリーンリーダー用） */
  caption: string;
  formatValue?: (v: number) => string;
};

const COLORS = {
  brand: "var(--brand-primary)",
  accent: "var(--brand-accent)",
  pos: "var(--pos)",
} as const;

export function LineChart({
  points,
  unit = "",
  height = 180,
  fill = true,
  color = "brand",
  caption,
  formatValue = (v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 }),
}: LineChartProps) {
  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-ink-dim"
        style={{ height }}
      >
        データがありません
      </div>
    );
  }

  const W = 1000;
  const H = 300;
  const PAD = { top: 16, right: 8, bottom: 24, left: 8 };

  const values = points.map((p) => p.v);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // 平坦なデータでも線が中央に出るように、上下に余白を作る
  const span = rawMax - rawMin || Math.max(1, rawMax * 0.1);
  const min = rawMin - span * 0.15;
  const max = rawMax + span * 0.15;

  const x = (i: number) =>
    PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.v)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1)},${H - PAD.bottom} L${x(0)},${H - PAD.bottom} Z`;

  const gradId = `grad-${color}-${points.length}-${Math.round(rawMax)}`;
  const stroke = COLORS[color];

  // X 軸ラベルは 4 点だけ（詰め込むと読めない）
  const labelIdx = [0, Math.floor(points.length / 3), Math.floor((points.length * 2) / 3), points.length - 1];

  return (
    <figure className="m-0">
      <div className="scroll-x">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height }}
          role="img"
          aria-label={caption}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 水平グリッド */}
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <line
              key={r}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + r * (H - PAD.top - PAD.bottom)}
              y2={PAD.top + r * (H - PAD.top - PAD.bottom)}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          ))}

          {fill && <path d={areaPath} fill={`url(#${gradId})`} />}
          <path
            d={linePath}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* 最終点を強調 */}
          <circle
            cx={x(points.length - 1)}
            cy={y(points[points.length - 1].v)}
            r={4}
            fill={stroke}
          />
        </svg>
      </div>

      <div className="mt-1 flex justify-between px-1 text-[10px] text-ink-dim">
        {labelIdx.map((i) => (
          <span key={i}>{shortTime(points[i]?.t ?? "")}</span>
        ))}
      </div>

      {/* アクセシビリティ: グラフの内容を表でも提供する */}
      <figcaption className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th>時刻</th>
              <th>値{unit ? `（${unit}）` : ""}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.t}>
                <td>{p.t}</td>
                <td>{formatValue(p.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// スパークライン（KPI カード内の小さなグラフ）
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  color = "brand",
  height = 32,
}: {
  values: number[];
  color?: keyof typeof COLORS;
  height?: number;
}) {
  if (values.length < 2) return null;
  const W = 200;
  const H = 60;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / span) * H * 0.9 - H * 0.05;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={COLORS[color]}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 横棒（内訳の可視化）
// ---------------------------------------------------------------------------

export function BreakdownBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const total = segments.reduce((s, x) => s + Math.abs(x.value), 0) || 1;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
        {segments.map((s) => (
          <div
            key={s.label}
            style={{
              width: `${(Math.abs(s.value) / total) * 100}%`,
              background: s.color,
            }}
            title={`${s.label}: ${s.value.toFixed(2)}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="size-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
