import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";
import type { DesiredState } from "@shared/orchestrator";

type Ctx = { params: Promise<{ botId: string }> };

const DESIRED = new Set(["Running", "Paused", "Stopped"]);
const ACTIONS = new Set(["desired", "restart", "drain", "restore", "delete"]);

// POST /api/admin/bots/:botId/actions — fleet ops on a single bot from the
// admin bot-detail page (docs/08 §8.5). Audited with a trace id; the SSE
// stream propagates the resulting phase changes to the owner's panel.
export async function POST(req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  const { botId } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (typeof action !== "string" || !ACTIONS.has(action))
    return err(400, `action must be ${[...ACTIONS].join("|")}`);

  const orch = orchestratorFor(admin);
  const traceId = randomUUID();
  try {
    let result: unknown;
    if (action === "desired") {
      const desired = body?.desired_state;
      if (typeof desired !== "string" || !DESIRED.has(desired))
        return err(400, "desired_state must be Running|Paused|Stopped");
      result = await orch.setDesiredState(botId, desired as DesiredState);
    } else if (action === "restart") {
      result = await orch.restartBot(botId);
    } else if (action === "drain") {
      result = await orch.drainBot(botId);
    } else if (action === "restore") {
      const snapshotId = body?.snapshot_id;
      if (typeof snapshotId !== "string" || !snapshotId)
        return err(400, "snapshot_id required");
      result = await orch.restoreSnapshot(botId, snapshotId);
    } else {
      result = await orch.deleteBot(botId);
      // Also release the panel binding — keeps dashboards consistent even if
      // the SSE event hasn't arrived yet.
      const inst = await db.instance.findFirst({
        where: { botId, revokedAt: null },
      });
      if (inst) {
        await db.instance.update({
          where: { id: inst.id },
          data: { revokedAt: new Date(), phase: "Terminating" },
        });
      }
    }

    const inst = await db.instance.findFirst({
      where: { botId, revokedAt: null },
      select: { id: true },
    });
    await db.auditLog.create({
      data: {
        userId: admin.id,
        instanceId: inst?.id ?? null,
        action: `admin.bot.${action}`,
        meta: {
          trace_id: traceId,
          bot_id: botId,
          ...(action === "desired" ? { desired_state: body.desired_state } : {}),
          ...(action === "restore" ? { snapshot_id: body.snapshot_id } : {}),
        },
      },
    });
    return json({ ok: true, trace_id: traceId, result });
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}
