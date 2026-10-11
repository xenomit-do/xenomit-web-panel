import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";
import { hub } from "@/server/hub";
import type { DesiredState } from "@shared/orchestrator";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS = new Set(["pause", "resume", "restart", "drain"]);
const DESIRED: Record<string, DesiredState> = {
  pause: "Paused",
  resume: "Running",
};

// GET /api/instances/:id/lifecycle — merged view: panel caches + the
// orchestrator's authoritative status (phase timeline, conditions, proxy,
// epoch, uptime). Degrades to cache-only when the orchestrator is down.
export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  if (inst.kind !== "managed" || !inst.botId)
    return err(400, "lifecycle applies to managed instances");

  let bot = null;
  let orchestratorError: string | null = null;
  try {
    bot = await orchestratorFor(user).getBot(inst.botId);
  } catch (e) {
    orchestratorError = e instanceof Error ? e.message : "unreachable";
  }

  const tracesBase = process.env.TRACES_BASE_URL;
  return json({
    instance: {
      id: inst.id,
      kind: inst.kind,
      bot_id: inst.botId,
      phase: inst.phase,
      phase_detail: inst.phaseDetail ?? null,
      desired_state: inst.desiredState,
      version: inst.version,
      online: hub.isOnline(id),
      last_seen_at: inst.lastSeenAt,
    },
    bot,
    orchestrator_error: orchestratorError,
    trace_url: tracesBase
      ? `${tracesBase.replace(/\/$/, "")}/explore?query=bot_id%3D%22${encodeURIComponent(inst.botId)}%22`
      : null,
  });
}

// POST {action: pause|resume|restart|drain} — desired-state changes go to the
// orchestrator; the SSE stream then updates the phase cache (docs/08 §8.6).
export async function POST(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  if (inst.kind !== "managed" || !inst.botId)
    return err(400, "lifecycle applies to managed instances");

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) return err(400, "action must be pause|resume|restart|drain");

  const orch = orchestratorFor(user);
  try {
    let bot;
    if (action === "restart") bot = await orch.restartBot(inst.botId);
    else if (action === "drain") bot = await orch.drainBot(inst.botId);
    else bot = await orch.setDesiredState(inst.botId, DESIRED[action]);

    await db.instance
      .update({
        where: { id },
        data: {
          desiredState: bot.desiredState ?? inst.desiredState,
          phase: bot.phase ?? inst.phase,
        },
      })
      .catch(() => {});
    await db.auditLog.create({
      data: {
        userId: user.id,
        instanceId: id,
        action: `lifecycle.${action}`,
        meta: { bot_id: inst.botId },
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
