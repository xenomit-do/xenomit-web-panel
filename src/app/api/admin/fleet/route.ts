import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";

// GET /api/admin/fleet — orchestrator fleet view joined with panel instance
// rows (nickname, owner username, agent presence). Admin only (docs/08 §8.5).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");

  const orch = orchestratorFor(admin);
  let bots: Awaited<ReturnType<typeof orch.listBots>>["bots"] = [];
  let summary = null;
  let orchestratorError: string | null = null;
  try {
    [bots, summary] = await Promise.all([
      orch.listBots().then((r) => r.bots),
      orch.fleetSummary().catch(() => null),
    ]);
  } catch (e) {
    orchestratorError = e instanceof Error ? e.message : "unreachable";
  }

  const instances = await db.instance.findMany({
    where: { kind: "managed", revokedAt: null },
    include: { user: { select: { id: true, username: true, discordId: true } } },
  });
  const byBotId = new Map(instances.filter((i) => i.botId).map((i) => [i.botId!, i]));

  return json({
    summary,
    orchestrator_error: orchestratorError,
    bots: bots.map((b) => {
      const inst = b.id ? byBotId.get(b.id) : undefined;
      return {
        ...b,
        instance_id: inst?.id ?? null,
        nickname: inst?.nickname ?? null,
        owner_username: inst?.user.username ?? null,
      };
    }),
  });
}
