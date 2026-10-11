import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/admin/invites/:id — revoke an unused invite.
export async function DELETE(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  const { id } = await ctx.params;
  const invite = await db.invite.findUnique({ where: { id } });
  if (!invite) return err(404, "invite not found");

  await db.invite.delete({ where: { id } });
  await db.auditLog.create({
    data: { userId: admin.id, action: "admin.invite.revoke", meta: { inviteId: id } },
  });
  return json({ ok: true });
}
