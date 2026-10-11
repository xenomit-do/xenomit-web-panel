import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";
import type { RolloutAction } from "@shared/orchestrator";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS = new Set(["pause", "resume", "abort", "rollback"]);

// GET /api/admin/rollouts/:id — status readout.
// POST {action: pause|resume|abort|rollback} — mutate (audited, trace id).
export async function GET(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  const { id } = await ctx.params;
  try {
    return json({ rollout: await orchestratorFor(admin).getRollout(id) });
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (typeof action !== "string" || !ACTIONS.has(action))
    return err(400, "action must be pause|resume|abort|rollback");

  try {
    const rollout = await orchestratorFor(admin).rolloutAction(id, action as RolloutAction);
    await db.auditLog.create({
      data: {
        userId: admin.id,
        action: `admin.rollout.${action}`,
        meta: { rollout_id: id },
      },
    });
    return json({ ok: true, rollout });
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}
