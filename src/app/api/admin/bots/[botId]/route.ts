import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";
import { hub } from "@/server/hub";

type Ctx = { params: Promise<{ botId: string }> };

// GET /api/admin/bots/:botId — full orchestrator status + the linked panel
// instance for the admin bot-detail page (docs/08 §8.5).
export async function GET(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  const { botId } = await ctx.params;

  const orch = orchestratorFor(admin);
  let bot = null;
  let snapshots = null;
  let orchestratorError: string | null = null;
  try {
    [bot, snapshots] = await Promise.all([
      orch.getBot(botId),
      orch.listSnapshots(botId).then((r) => r.snapshots).catch(() => []),
    ]);
  } catch (e) {
    orchestratorError = e instanceof Error ? e.message : "unreachable";
    if (e instanceof OrchestratorError && e.status === 404)
      return err(404, "bot not found");
  }

  const inst = await db.instance.findFirst({
    where: { botId, revokedAt: null },
    include: { user: { select: { id: true, username: true, discordId: true } } },
  });

  return json({
    bot,
    snapshots: snapshots ?? [],
    orchestrator_error: orchestratorError,
    instance: inst
      ? {
          id: inst.id,
          kind: inst.kind,
          nickname: inst.nickname,
          username: inst.username,
          server: inst.server,
          online: hub.isOnline(inst.id),
          last_seen_at: inst.lastSeenAt,
          phase: inst.phase,
          desired_state: inst.desiredState,
          owner: inst.user,
        }
      : null,
  });
}
