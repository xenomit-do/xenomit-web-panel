import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/instances/:id/snapshots — restore points held by the orchestrator
// (docs/08 §8.1 Lifecycle tab). Snapshots live upstream, never in the panel DB.
export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  if (inst.kind !== "managed" || !inst.botId)
    return err(400, "snapshots apply to managed instances");

  try {
    const out = await orchestratorFor(user).listSnapshots(inst.botId);
    return json(out);
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}

// POST {snapshot_id} — restore a managed bot to a snapshot.
export async function POST(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  if (inst.kind !== "managed" || !inst.botId)
    return err(400, "snapshots apply to managed instances");

  const body = await req.json().catch(() => ({}));
  const snapshotId = typeof body?.snapshot_id === "string" ? body.snapshot_id : "";
  if (!snapshotId) return err(400, "snapshot_id required");

  try {
    const bot = await orchestratorFor(user).restoreSnapshot(inst.botId, snapshotId);
    await db.auditLog.create({
      data: {
        userId: user.id,
        instanceId: id,
        action: "lifecycle.restore",
        meta: { bot_id: inst.botId, snapshot_id: snapshotId },
      },
    });
    return json({ ok: true, bot });
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}
