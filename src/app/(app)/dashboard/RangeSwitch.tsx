"use client";

import Link from "next/link";
import type { SeriesRange } from "@/types";

const RANGES: SeriesRange[] = ["1h", "24h", "7d", "30d", "90d", "1y"];

export function RangeSwitch({ current }: { current: SeriesRange }) {
  return (
    <div
      className="flex overflow-hidden rounded-xl border border-line-strong"
      role="group"
      aria-label="表示期間"
    >
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`/dashboard?range=${r}`}
          aria-current={r === current ? "true" : undefined}
          className={`px-3 py-1.5 text-xs transition ${
            r === current ? "bg-white/10 text-ink" : "text-ink-muted hover:bg-white/5"
          }`}
        >
          {r}
        </Link>
      ))}
    </div>
  );
}
