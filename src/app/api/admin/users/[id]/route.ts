import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor } from "@/lib/orchestrator";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/users/:id {role?, status?, instanceLimit?}
// Promotions/demotions and suspensions (docs/08 §8.3, §8.5). Suspending a
// user drains their managed bots to Paused — nothing is deleted (docs/12 §12.1).
export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  const { id } = await ctx.params;
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return err(404, "user not found");

  const body = await req.json().catch(() => ({}));
  const traceId = randomUUID();
  const data: { role?: string; status?: string; instanceLimit?: number } = {};
  const changes: Record<string, string | number> = {};

  if (body.role !== undefined) {
    if (body.role !== "user" && body.role !== "admin")
      return err(400, "role must be user|admin");
    if (target.id === admin.id && body.role !== "admin")
      return err(400, "cannot demote yourself");
    data.role = body.role;
    changes.role = body.role;
  }
  if (body.status !== undefined) {
    if (!["active", "suspended", "invited"].includes(body.status))
      return err(400, "status must be active|suspended|invited");
    if (target.id === admin.id && body.status === "suspended")
      return err(400, "cannot suspend yourself");
    data.status = body.status;
    changes.status = body.status;
  }
  if (body.instance_limit !== undefined) {
    const n = Number(body.instance_limit);
    if (!Number.isInteger(n) || n < 0 || n > 1000)
      return err(400, "instance_limit must be an integer 0..1000");
    data.instanceLimit = n;
    changes.instance_limit = n;
  }
  if (!Object.keys(data).length) return err(400, "nothing to change");

  const updated = await db.user.update({ where: { id }, data });

  // Suspending drains the user's managed bots to Paused (best effort —
  // nothing is deleted, docs/12 §12.1).
  let drained = 0;
  if (data.status === "suspended") {
    const bots = await db.instance.findMany({
      where: { userId: id, kind: "managed", revokedAt: null, botId: { not: null } },
      select: { botId: true },
    });
    const orch = orchestratorFor(admin);
    for (const b of bots) {
      try {
        await orch.setDesiredState(b.botId!, "Paused");
        drained++;
      } catch {
        /* best effort — orchestrator enforces suspension independently */
      }
    }
  }

  await db.auditLog.create({
    data: {
      userId: admin.id,
      action: "admin.user.update",
      meta: { trace_id: traceId, target_user: id, changes, drained },
    },
  });

  return json({
    ok: true,
    user: {
      id: updated.id,
      role: updated.role,
      status: updated.status,
      instance_limit: updated.instanceLimit,
    },
    drained,
  });
}
