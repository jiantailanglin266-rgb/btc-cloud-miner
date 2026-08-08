import { getSessionContext, destroyCurrentSession, verifyCsrf } from "@/modules/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { ok, handler, forbidden } from "@/lib/api";

export const POST = handler(async (req: Request) => {
  if (!(await verifyCsrf(req))) return forbidden("CSRF トークンが不正です");

  const ctx = await getSessionContext();
  if (ctx) {
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.user.role,
      action: AUDIT_ACTIONS.LOGOUT,
      targetType: "session",
      targetId: ctx.session.id,
    });
  }
  await destroyCurrentSession();
  return ok({ loggedOut: true });
});
