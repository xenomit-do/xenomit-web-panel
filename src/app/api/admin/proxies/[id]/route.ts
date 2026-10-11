import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/admin/proxies/:id — remove a proxy from the pool.
export async function DELETE(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  const { id } = await ctx.params;
  try {
    await orchestratorFor(admin).deleteProxy(id);
    await db.auditLog.create({
      data: { userId: admin.id, action: "admin.proxy.delete", meta: { proxy_id: id } },
    });
    return json({ ok: true });
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}
