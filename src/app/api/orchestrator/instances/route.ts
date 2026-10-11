import { db } from "@/lib/db";
import { json, err } from "@/lib/api";
import { sha256, newInstanceToken } from "@/lib/tokens";
import { rateLimit } from "@/lib/ratelimit";
import { verifyServiceAuth } from "@/lib/serviceauth";
import { hub } from "@/server/hub";
import type {
  ProvisionInstanceRequest,
  ProvisionInstanceResponse,
} from "@shared/orchestrator";

// POST /api/orchestrator/instances — service-authenticated (docs/08 §8.6):
// the orchestrator asks the panel to mint an Instance(kind=managed) plus its
// agent token in one step. The token is returned exactly once; the
// orchestrator writes it to the bot's Vault path. Idempotent on bot_id — a
// repeat call for a live bot binds a fresh token (the panel-side create may
// have raced ahead of this callback).

const str = (v: unknown, max = 128) =>
  typeof v === "string" ? v.slice(0, max) : "";

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`orch-provision:${ip}`, 60, 60_000);
  if (!rl.ok) return err(429, "rate limited");
  if (!verifyServiceAuth(req)) return err(401, "unauthorized");

  let body: ProvisionInstanceRequest;
  try {
    body = (await req.json()) as ProvisionInstanceRequest;
  } catch {
    return err(400, "invalid json");
  }

  const botId = str(body?.bot_id, 128).trim();
  const owner = str(body?.owner, 64).trim();
  if (!botId || !owner) return err(400, "bot_id and owner required");

  const user = await db.user.findUnique({ where: { id: owner } });
  if (!user) return err(404, "owner not found");

  const token = newInstanceToken();
  const tokenHash = sha256(token);

  const existing = await db.instance.findUnique({ where: { botId } });
  let instanceId: string;
  if (existing && !existing.revokedAt) {
    if (existing.userId !== owner) return err(409, "bot_id bound to another user");
    // Re-bind: rotate the token; any socket authed on the old one is dropped.
    instanceId = existing.id;
    await db.instance.update({
      where: { id: existing.id },
      data: { tokenHash, desiredState: str(body?.desired_state, 16) || existing.desiredState },
    });
    hub.kickAgent(instanceId);
  } else {
    const created = await db.instance.create({
      data: {
        userId: owner,
        kind: "managed",
        botId,
        server: str(body?.server),
        username: str(body?.username),
        tokenHash,
        desiredState: str(body?.desired_state, 16) || "Running",
        phase: "Provisioning",
      },
    });
    instanceId = created.id;
  }

  await db.auditLog.create({
    data: {
      userId: owner,
      instanceId,
      action: "instance.managed_provision",
      meta: { bot_id: botId, rebound: !!existing },
    },
  });

  const base = process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin;
  const res: ProvisionInstanceResponse = {
    instance_id: instanceId,
    token,
    agent_ws_url: `${base.replace(/^http/, "ws")}/api/agent/ws`,
  };
  return json(res);
}
