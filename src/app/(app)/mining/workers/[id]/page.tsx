import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/modules/auth/session";
import { getWorkersForUser } from "@/modules/mining/aggregate";
import { mockHashrateAt } from "@/modules/provider/adapters/mock";
import { getStore } from "@/lib/store";
import { Badge, Card, CardTitle, KeyValue, PageHeader, statusTone } from "@/components/ui";
import { LineChart } from "@/components/charts/LineChart";
import { formatHashrate, formatRelative, statusLabel, formatPercent, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WorkerDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  // Next.js 16 では params は Promise。必ず await する
  const { id } = await props.params;
  const ctx = await requireSession();

  const entries = await getWorkersForUser(ctx.tenant.id, ctx.user.id);
  const entry = entries.find((e) => e.worker.id === id);
  // 他人のワーカーも「存在しない」として扱う（存在を漏らさない）
  if (!entry) notFound();

  const { worker, reading } = entry;
  const store = await getStore();
  const provider = await store.getProvider(ctx.tenant.id, worker.providerId);

  // 直近 24 時間の推移
  const now = Date.now();
  const stored = await store.listSnapshots(ctx.tenant.id, {
    workerId: worker.id,
    fromMs: now - 86_400_000,
    limit: 300,
  });

  const points =
    stored.length >= 12
      ? stored
          .slice()
          .reverse()
          .map((s) => ({ t: s.bucketAt, v: s.hashrateThs }))
      : Array.from({ length: 96 }, (_, i) => {
          const t = now - 86_400_000 + (i * 86_400_000) / 95;
          return {
            t: new Date(t).toISOString(),
            v:
              Math.round(
                mockHashrateAt(
                  {
                    id: worker.id,
                    externalWorkerId: worker.externalWorkerId,
                    minerId: worker.minerId,
                    model: worker.model,
                    ratedHashrateThs: worker.ratedHashrateThs,
                    ratedEfficiencyJPerTh: worker.ratedEfficiencyJPerTh,
                    forcedOffline: worker.status === "OFFLINE",
                  },
                  t,
                ) * 100,
              ) / 100,
          };
        });

  const synthesized = stored.length < 12;
  const total = (reading?.acceptedShares ?? 0) + (reading?.rejectedShares ?? 0);
  const rejectRate = total > 0 ? (reading?.rejectedShares ?? 0) / total : 0;

  return (
    <>
      <PageHeader
        title={worker.externalWorkerId}
        description={`${worker.model} — ${provider?.name ?? "不明なプロバイダー"}`}
        action={
          <Link
            href="/mining/workers"
            className="rounded-xl border border-line-strong bg-white/5 px-4 py-2 text-sm"
          >
            一覧へ戻る
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle
            hint={
              synthesized
                ? "蓄積データが不足しているため、決定的な生成関数から合成した推移です（デモ）"
                : "保存されたスナップショットからの実測推移"
            }
          >
            ハッシュレート推移（24時間）
          </CardTitle>
          <LineChart
            points={points}
            unit="TH/s"
            caption={`${worker.externalWorkerId} の24時間ハッシュレート推移`}
            height={220}
            formatValue={(v) => `${v.toFixed(2)} TH/s`}
          />
        </Card>

        <Card>
          <CardTitle
            action={
              <Badge tone={statusTone(reading?.workerStatus ?? worker.status)} dot>
                {statusLabel(reading?.workerStatus ?? worker.status)}
              </Badge>
            }
          >
            仕様と現在値
          </CardTitle>
          <div className="divide-y divide-line">
            <KeyValue label="Miner ID" value={worker.minerId || "—"} />
            <KeyValue label="機種" value={worker.model} />
            <KeyValue
              label="定格ハッシュレート"
              value={formatHashrate(worker.ratedHashrateThs)}
            />
            <KeyValue
              label="実効ハッシュレート"
              value={reading ? formatHashrate(reading.hashrateThs) : "—"}
              tone={
                reading && reading.hashrateThs / worker.ratedHashrateThs < 0.85
                  ? "neg"
                  : "pos"
              }
            />
            <KeyValue
              label="定格効率"
              value={`${worker.ratedEfficiencyJPerTh.toFixed(1)} J/TH`}
            />
            <KeyValue
              label="消費電力"
              value={reading?.powerW ? `${reading.powerW.toLocaleString()} W` : "—"}
            />
            <KeyValue
              label="温度"
              value={
                reading?.temperatureC !== null && reading?.temperatureC !== undefined
                  ? `${reading.temperatureC}℃`
                  : "—"
              }
              tone={(reading?.temperatureC ?? 0) >= 75 ? "neg" : undefined}
            />
            <KeyValue
              label="Accepted Shares"
              value={reading ? reading.acceptedShares.toLocaleString() : "—"}
            />
            <KeyValue
              label="Rejected Shares"
              value={reading ? reading.rejectedShares.toLocaleString() : "—"}
            />
            <KeyValue
              label="Reject 率"
              value={reading ? formatPercent(rejectRate, 2) : "—"}
              tone={rejectRate > 0.03 ? "neg" : "pos"}
            />
            <KeyValue
              label="Uptime"
              value={reading ? formatDuration(reading.uptimeSec) : "—"}
            />
            <KeyValue label="プール状態" value={reading?.poolStatus ?? "—"} />
            <KeyValue
              label="最終確認"
              value={worker.lastSeenAt ? formatRelative(worker.lastSeenAt) : "—"}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
