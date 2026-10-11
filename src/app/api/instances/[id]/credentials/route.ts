import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";

type Ctx = { params: Promise<{ id: string }> };

// POST {username, password} — re-entered account credentials for a managed
// bot stuck in NeedsHuman(credentials) (docs/08 §8.4: a rejected password
// shows "Update credentials" and never retries until the user acts).
// Same in-memory forwarding rule as /dosid — nothing is persisted or logged.
export async function POST(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  if (inst.kind !== "managed" || !inst.botId)
    return err(400, "credentials apply to managed instances");

  const body = await req.json().catch(() => ({}));
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password || username.length > 128 || password.length > 256)
    return err(400, "username + password required");

  try {
    const bot = await orchestratorFor(user).submitCredentials(inst.botId, {
      username,
      password,
    });
    await db.instance
      .update({
        where: { id },
        data: {
          phase: bot.phase ?? inst.phase,
          ...(bot.phaseDetail !== undefined
            ? { phaseDetail: bot.phaseDetail === null ? Prisma.JsonNull : (bot.phaseDetail as Prisma.InputJsonValue) }
            : {}),
        },
      })
      .catch(() => {});
    await db.auditLog.create({
      data: {
        userId: user.id,
        instanceId: id,
        action: "lifecycle.credentials", // values never logged
        meta: { bot_id: inst.botId },
      },
    });
    return json({ ok: true, phase: bot.phase });
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}
