import { getSessionContext, verifyCsrf } from "@/modules/auth/session";
import { getStore } from "@/lib/store";
import { ok, handler, unauthorized, forbidden, validationError } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();
  const store = await getStore();
  const notifications = await store.listNotifications(ctx.tenant.id, ctx.user.id);
  return ok({ notifications, unread: notifications.filter((n) => !n.readAt).length });
});

export const POST = handler(async (req: Request) => {
  if (!(await verifyCsrf(req))) return forbidden("CSRF トークンが不正です");
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    id?: string;
  };
  const store = await getStore();

  if (body.action === "read-all") {
    await store.markAllNotificationsRead(ctx.tenant.id, ctx.user.id);
    return ok({ done: true });
  }
  if (body.action === "read" && body.id) {
    await store.markNotificationRead(ctx.tenant.id, ctx.user.id, body.id);
    return ok({ done: true });
  }
  return validationError([{ path: "action", message: "不明な操作です" }]);
});
