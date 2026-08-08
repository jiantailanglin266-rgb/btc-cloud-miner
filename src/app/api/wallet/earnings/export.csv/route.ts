import { getSessionContext } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { toCsv, csvResponse } from "@/lib/csv";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  const store = await getStore();
  const earnings = await store.listEarnings(ctx.tenant.id, ctx.user.id);

  const csv = toCsv(
    [
      "日付",
      "契約ID",
      "ハッシュレート(TH/s)",
      "稼働率",
      "総収益(BTC)",
      "プール手数料(BTC)",
      "プラットフォーム手数料(BTC)",
      "電力費(BTC)",
      "純収益(BTC)",
    ],
    earnings.map((e) => [
      e.earnedAt.slice(0, 10),
      e.contractId,
      e.hashrateThs.toFixed(4),
      e.uptimeRate.toFixed(5),
      e.grossBtc,
      e.poolFeeBtc,
      e.platformFeeBtc,
      e.electricityFeeBtc,
      e.netBtc,
    ]),
  );

  // エクスポートは監査対象（データの持ち出しを追跡できるようにする）
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    actorRole: ctx.user.role,
    action: AUDIT_ACTIONS.EXPORT_CSV,
    targetType: "earnings",
    targetId: ctx.user.id,
    detail: { rows: earnings.length },
  });

  return csvResponse(
    `earnings-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
  );
}
