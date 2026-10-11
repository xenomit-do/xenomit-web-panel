import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";
import { sanitizePayload } from "@/lib/sanitize";
import { isRecord } from "@/lib/validate";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";
import { hub } from "@/server/hub";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");
  const state = await db.instanceState.findUnique({ where: { instanceId: id } });
  return json({
    instance: {
      id: inst.id,
      kind: inst.kind,
      bot_id: inst.botId,
      server: inst.server,
      game_user_id: inst.gameUserId,
      username: inst.username,
      nickname: inst.nickname,
      phase: inst.phase,
      phase_detail: inst.phaseDetail ?? null,
      desired_state: inst.desiredState,
      version: inst.version,
      created_at: inst.createdAt,
      last_seen_at: inst.lastSeenAt,
      online: hub.isOnline(id),
      status: state?.latestStatus ?? null,
      catalog: state?.latestCatalog ?? null,
    },
  });
}

// PATCH — rename/nickname, adjust stream rate (1-10 Hz), and for managed
// instances change the version channel (forwarded to the orchestrator).
export async function PATCH(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");

  const body = sanitizePayload(await req.json().catch(() => ({})));
  const data: { nickname?: string | null } = {};
  if ("nickname" in body) {
    if (body.nickname !== null && typeof body.nickname !== "string")
      return err(400, "nickname must be a string or null");
    data.nickname =
      typeof body.nickname === "string" ? body.nickname.slice(0, 64) : null;
  }
  if (Object.keys(data).length)
    await db.instance.update({ where: { id }, data });

  let stream_hz: number | undefined;
  if (typeof body.stream_hz === "number")
    stream_hz = hub.setStreamRate(id, body.stream_hz);

  let version: string | null | undefined;
  if (inst.kind === "managed" && inst.botId && isRecord(body.version)) {
    const channel = body.version.channel;
    const pinned = body.version.pinned_image;
    if (channel !== "stable" && channel !== "canary" && channel !== "pinned")
      return err(400, "version.channel must be stable|canary|pinned");
    if (channel === "pinned" && typeof pinned !== "string")
      return err(400, "pinned channel requires pinned_image");
    try {
      const orch = orchestratorFor(user);
      const bot = await orch.patchBot(inst.botId, {
        version: {
          channel,
          pinnedImage: typeof pinned === "string" ? pinned : null,
        },
      });
      version = bot.version ?? channel;
      await db.instance.update({
        where: { id },
        data: { version },
      });
      await db.auditLog.create({
        data: {
          userId: user.id,
          instanceId: id,
          action: "instance.version_change",
          meta: { channel },
        },
      });
    } catch (e) {
      return err(
        e instanceof OrchestratorError ? e.status : 502,
        e instanceof Error ? e.message : "orchestrator patch failed"
      );
    }
  }

  return json({ ok: true, stream_hz, version });
}

// DELETE — paired: unlink + revoke token. managed: orchestrator delete first
// (drain → credentials destroyed in Vault → soft-delete), then revoke + kick.
export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");

  if (inst.kind === "managed" && inst.botId) {
    try {
      await orchestratorFor(user).deleteBot(inst.botId);
    } catch (e) {
      // Already gone upstream → still release the panel binding.
      if (!(e instanceof OrchestratorError && e.status === 404))
        return err(
          e instanceof OrchestratorError ? e.status : 502,
          e instanceof Error ? e.message : "orchestrator delete failed"
        );
    }
  }

  await db.instance.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  hub.kickAgent(id);
  await db.auditLog.create({
    data: {
      userId: user.id,
      instanceId: id,
      action: inst.kind === "managed" ? "instance.delete_managed" : "instance.unlink",
    },
  });
  return json({ ok: true });
}
