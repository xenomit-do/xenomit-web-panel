import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";

// POST /api/admin/fleet/bulk {action:"drain"|"restart", bot_ids:[]}
// Bulk lifecycle ops from the fleet console (docs/08 §8.5). Every mutation is
// audit-logged with the trace id.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const ids: string[] = Array.isArray(body?.bot_ids)
    ? body.bot_ids.filter((x: unknown) => typeof x === "string").slice(0, 200)
    : [];
  if (action !== "drain" && action !== "restart")
    return err(400, "action must be drain|restart");
  if (!ids.length) return err(400, "bot_ids required");

  const traceId = randomUUID();
  const orch = orchestratorFor(admin);
  const results: { bot_id: string; ok: boolean; error?: string }[] = [];
  for (const botId of ids) {
    try {
      if (action === "drain") await orch.drainBot(botId);
      else await orch.restartBot(botId);
      results.push({ bot_id: botId, ok: true });
    } catch (e) {
      results.push({
        bot_id: botId,
        ok: false,
        error: e instanceof OrchestratorError ? e.message : "failed",
      });
    }
  }

  const inst = await db.instance.findFirst({ where: { botId: ids[0] } });
  await db.auditLog.create({
    data: {
      userId: admin.id,
      instanceId: inst?.id ?? null,
      action: `admin.fleet.${action}`,
      meta: { trace_id: traceId, bot_ids: ids, ok: results.filter((r) => r.ok).length },
    },
  });

  return json({ ok: true, trace_id: traceId, results });
}
