import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";

type Ctx = { params: Promise<{ id: string }> };

// POST {dosid} — fresh session cookie for a managed bot in NeedsHuman
// (docs/08 §8.4). DELIBERATE exception to the panel's no-sid rule: the value
// is forwarded to the orchestrator in memory only — never stored in the DB,
// never written to audit rows, never logged.
export async function POST(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  if (inst.kind !== "managed" || !inst.botId)
    return err(400, "dosid applies to managed instances");

  const body = await req.json().catch(() => ({}));
  const dosid = typeof body?.dosid === "string" ? body.dosid.trim() : "";
  if (!dosid || dosid.length > 512) return err(400, "dosid required");

  try {
    const bot = await orchestratorFor(user).submitDosid(inst.botId, dosid);
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
        action: "lifecycle.dosid", // value never logged
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
