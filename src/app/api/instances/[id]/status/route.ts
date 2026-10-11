import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";
import { hub } from "@/server/hub";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/instances/:id/status — latest status snapshot.
export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  const state = await db.instanceState.findUnique({ where: { instanceId: id } });
  return json({
    online: hub.isOnline(id),
    last_seen_at: inst.lastSeenAt,
    status: state?.latestStatus ?? null,
  });
}
