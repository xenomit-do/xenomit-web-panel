import { db } from "@/lib/db";
import { json, err } from "@/lib/api";
import { sha256, newInstanceToken } from "@/lib/tokens";
import { rateLimit } from "@/lib/ratelimit";
import { sanitizePayload, containsForbiddenKey } from "@/lib/sanitize";
import { isRecord } from "@/lib/validate";
import { hub } from "@/server/hub";
import type { PairResponse } from "@shared/protocol";

// POST /api/agent/pair — exchange a single-use pairing code for a permanent
// instance token. Called by the agent (bot GUI/CLI), not the browser.
export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`pair:${ip}`, 10, 60_000);
  if (!rl.ok) return err(429, "too many pairing attempts");

  let body: { code?: unknown; instance?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(400, "invalid json");
  }
  if (containsForbiddenKey(body)) return err(400, "forbidden key in payload");
  body = sanitizePayload(body);

  if (typeof body.code !== "string" || !body.code.trim())
    return err(400, "code required");
  const code = body.code.trim().toUpperCase();

  const pairing = await db.pairingCode.findUnique({
    where: { codeHash: sha256(code) },
  });
  if (!pairing || pairing.usedAt || pairing.expiresAt < new Date())
    return err(400, "invalid or expired code");

  const ident = isRecord(body.instance) ? body.instance : {};
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 128) : "");

  const token = newInstanceToken();
  const tokenHash = sha256(token);
  let instanceId: string;

  if (pairing.instanceId) {
    // Re-pair: rotate the token on the existing instance.
    const inst = await db.instance.findFirst({
      where: { id: pairing.instanceId, userId: pairing.userId, revokedAt: null },
    });
    if (!inst) return err(400, "instance no longer exists");
    instanceId = inst.id;
    await db.instance.update({
      where: { id: inst.id },
      data: { tokenHash },
    });
    hub.kickAgent(inst.id); // old token's live socket is dropped
  } else {
    const created = await db.instance.create({
      data: {
        userId: pairing.userId,
        server: str(ident.server),
        gameUserId: str(ident.user_id),
        username: str(ident.username),
        tokenHash,
      },
    });
    instanceId = created.id;
  }

  await db.pairingCode.update({
    where: { id: pairing.id },
    data: { usedAt: new Date() },
  });
  await db.auditLog.create({
    data: {
      userId: pairing.userId,
      instanceId,
      action: pairing.instanceId ? "instance.repair" : "instance.pair",
    },
  });

  const base =
    process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin;
  const wsBase = base.replace(/^http/, "ws");
  const res: PairResponse = {
    instance_id: instanceId,
    token,
    agent_ws_url: `${wsBase}/api/agent/ws`,
  };
  return json(res);
}
