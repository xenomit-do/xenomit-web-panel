import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { sanitizePayload, containsForbiddenKey } from "@/lib/sanitize";
import { validateCommand, validateSettings } from "@/lib/validate";
import { hub } from "@/server/hub";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";
import type { ModuleDescriptor } from "@shared/protocol";

type Ctx = { params: Promise<{ id: string }> };

// GET — recent command history for the instance.
export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  const commands = await db.command.findMany({
    where: { instanceId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return json({ commands });
}

// POST {action, payload} — queue to agent, await command_result (~10s timeout).
export async function POST(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");

  const rl = rateLimit(`cmd:${user.id}`, 60, 60_000);
  if (!rl.ok) return err(429, "command rate limit exceeded");

  let body: { action?: unknown; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(400, "invalid json");
  }

  // Never let session-cookie-shaped keys reach the agent or the DB.
  if (containsForbiddenKey(body)) return err(400, "forbidden key in payload");

  const v = validateCommand(body.action, body.payload);
  if (!v.ok) return err(400, v.error);

  const payload = sanitizePayload(v.payload);

  // Server-side settings validation against the agent's own descriptors.
  if (v.action === "update_config") {
    const catalog = await db.moduleCatalog.findUnique({ where: { instanceId: id } });
    const modules = (catalog?.descriptors as ModuleDescriptor[] | null) ?? [];
    const desc = modules.find((m) => m.id === (payload.module_id as string));
    if (desc) {
      const check = validateSettings(desc, payload.settings as Record<string, unknown>);
      if (!check.ok)
        return err(400, `invalid settings: ${JSON.stringify(check.errors)}`);
    }
  }

  // Managed instances: start/stop/shutdown are desired-state changes owned by
  // the orchestrator (docs/08 §8.6; shutdown maps to Drain(manual)). Ephemeral
  // commands keep going to the live agent socket via the hub.
  if (inst.kind === "managed" && inst.botId &&
      (v.action === "start" || v.action === "stop" || v.action === "shutdown")) {
    const orch = orchestratorFor(user);
    try {
      const bot =
        v.action === "start"
          ? await orch.setDesiredState(inst.botId, "Running")
          : v.action === "stop"
            ? await orch.setDesiredState(inst.botId, "Stopped")
            : await orch.drainBot(inst.botId);
      await db.instance
        .update({
          where: { id },
          data: { desiredState: bot.desiredState ?? inst.desiredState, phase: bot.phase ?? inst.phase },
        })
        .catch(() => {});
      await db.auditLog.create({
        data: {
          userId: user.id,
          instanceId: id,
          action: `command.${v.action}`,
          meta: { via: "orchestrator" },
        },
      });
      return json({ ok: true, phase: bot.phase, desired_state: bot.desiredState });
    } catch (e) {
      return err(
        e instanceof OrchestratorError ? e.status : 502,
        e instanceof Error ? e.message : "orchestrator request failed"
      );
    }
  }

  if (!hub.isOnline(id)) return err(409, "instance offline");

  const commandId = randomUUID();
  await db.command.create({
    data: {
      id: commandId,
      instanceId: id,
      userId: user.id,
      action: v.action,
      payload: payload as object,
      status: "pending",
    },
  });
  await db.auditLog.create({
    data: {
      userId: user.id,
      instanceId: id,
      action: `command.${v.action}`,
      meta: payload as object,
    },
  });

  const result = await hub.sendCommand(id, commandId, v.action, payload);
  await db.command
    .update({
      where: { id: commandId },
      data: {
        status: result.ok ? "ok" : "error",
        error: result.error ?? null,
        answeredAt: new Date(),
      },
    })
    .catch(() => {});

  return json({ id: commandId, ...result }, { status: result.ok ? 200 : 502 });
}
