import { db } from "@/lib/db";
import { requireUser, json, err } from "@/lib/api";
import { newPairingCode, newInstanceToken, sha256 } from "@/lib/tokens";
import { rateLimit } from "@/lib/ratelimit";
import { isRecord } from "@/lib/validate";
import {
  orchestratorEnabled,
  orchestratorFor,
  OrchestratorError,
} from "@/lib/orchestrator";
import { MODULE_PRESETS } from "@shared/module-presets";
import type {
  CreateBotRequest,
  ProxySpec,
  VersionSpec,
} from "@shared/orchestrator";
import { hub } from "@/server/hub";

// GET /api/instances — list the user's instances with presence + last status.
export async function GET() {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const instances = await db.instance.findMany({
    where: { userId: user.id, revokedAt: null },
    include: { state: true },
    orderBy: { createdAt: "asc" },
  });
  return json({
    instances: instances.map((i) => ({
      id: i.id,
      kind: i.kind,
      bot_id: i.botId,
      server: i.server,
      game_user_id: i.gameUserId,
      username: i.username,
      nickname: i.nickname,
      phase: i.phase,
      phase_detail: i.phaseDetail ?? null,
      desired_state: i.desiredState,
      version: i.version,
      created_at: i.createdAt,
      last_seen_at: i.lastSeenAt,
      online: hub.isOnline(i.id),
      status: i.state?.latestStatus ?? null,
      map_name: (i.state?.latestFrame as { map?: { name?: string } } | null)
        ?.map?.name ?? null,
    })),
  });
}

// POST /api/instances — two shapes:
//   {} / {instance_id}          → pairing code (paired instances, unchanged)
//   {kind:"managed", …}         → create a managed bot via the orchestrator
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const rl = rateLimit(`pair-code:${user.id}`, 10, 60_000);
  if (!rl.ok) return err(429, "too many requests, wait a minute");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body is fine */
  }

  if (body.kind === "managed") {
    if (!orchestratorEnabled())
      return err(503, "orchestrator not configured (ORCHESTRATOR_URL)");
    return createManaged(user, body);
  }
  return createPairingCode(user, body);
}

async function createPairingCode(
  user: { id: string },
  body: Record<string, unknown>
) {
  const instanceId =
    typeof body.instance_id === "string" ? body.instance_id : undefined;
  if (instanceId) {
    const inst = await db.instance.findFirst({
      where: { id: instanceId, userId: user.id, revokedAt: null },
    });
    if (!inst) return err(404, "instance not found");
    if (inst.kind !== "paired")
      return err(400, "managed instances are provisioned by the orchestrator");
  } else {
    const limit = await instanceLimitCheck(user.id);
    if (limit) return limit;
  }

  const code = newPairingCode();
  await db.pairingCode.create({
    data: {
      codeHash: sha256(code),
      userId: user.id,
      instanceId: instanceId ?? null,
      expiresAt: new Date(Date.now() + 10 * 60_000), // <= 10 min, single use
    },
  });
  return json({ code, expires_in_s: 600 });
}

async function instanceLimitCheck(userId: string) {
  const count = await db.instance.count({
    where: { userId, revokedAt: null },
  });
  const u = await db.user.findUnique({ where: { id: userId } });
  if (u && count >= u.instanceLimit)
    return err(403, `instance limit reached (${u.instanceLimit})`);
  return null;
}

const CHANNELS = new Set(["stable", "canary", "pinned"]);
const PROXY_SCHEMES = new Set(["http", "https", "socks5"]);
const str = (v: unknown, max = 256) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/**
 * "Create bot" wizard submission (docs/08 §8.4). Credentials are validated
 * for shape only, forwarded to the orchestrator in memory, and NEVER stored
 * in the panel DB, audit rows, or logs.
 */
async function createManaged(
  user: { id: string; role?: string },
  body: Record<string, unknown>
) {
  const account = isRecord(body.account) ? body.account : null;
  const server = str(account?.server, 128);
  const authMode = account?.auth_mode === "session" ? "session" : "password";

  if (!server) return err(400, "account.server required");

  let credentials: CreateBotRequest["credentials"];
  if (authMode === "session") {
    const dosid = str(account?.dosid, 512);
    if (!dosid) return err(400, "account.dosid required for session auth");
    credentials = { authMode: "session", dosid };
  } else {
    const username = str(account?.username, 128);
    const password = str(account?.password, 256);
    if (!username || !password)
      return err(400, "account.username + account.password required");
    credentials = { authMode: "password", username, password };
  }

  const preset = str(body.preset, 64) ?? "kill_collect";
  if (!MODULE_PRESETS.some((p) => p.id === preset))
    return err(400, "unknown module preset");

  const settings = isRecord(body.settings)
    ? (body.settings as Record<string, Record<string, unknown>>)
    : {};

  const version: VersionSpec = { channel: "stable" };
  if (isRecord(body.version)) {
    const ch = str(body.version.channel, 16);
    if (ch) {
      if (!CHANNELS.has(ch)) return err(400, "version.channel must be stable|canary|pinned");
      version.channel = ch as VersionSpec["channel"];
    }
    const pin = str(body.version.pinned_image, 256);
    if (version.channel === "pinned" && !pin)
      return err(400, "pinned channel requires pinned_image");
    if (pin) version.pinnedImage = pin;
  }

  let proxy: ProxySpec = { mode: "pool" };
  if (isRecord(body.proxy)) {
    if (body.proxy.mode === "fixed") {
      const host = str(body.proxy.host, 256);
      const port = Number(body.proxy.port);
      const scheme = str(body.proxy.scheme, 8) ?? "socks5";
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
        return err(400, "proxy.host + proxy.port required for fixed mode");
      if (!PROXY_SCHEMES.has(scheme))
        return err(400, "proxy.scheme must be http|https|socks5");
      const pxUser = str(body.proxy.username, 128);
      const pxPass = str(body.proxy.password, 256);
      proxy = {
        mode: "fixed",
        fixed: {
          scheme: scheme as "http" | "https" | "socks5",
          host,
          port,
          ...(pxUser ? { username: pxUser } : {}),
          ...(pxPass ? { password: pxPass } : {}),
        },
      };
    } else {
      const country = str(body.proxy.country, 8);
      proxy = {
        mode: "pool",
        selector: country ? { country: [country.toUpperCase()] } : {},
      };
    }
  }

  const limit = await instanceLimitCheck(user.id);
  if (limit) return limit;

  const createReq: CreateBotRequest = {
    owner: user.id,
    name: str(body.nickname, 64) ?? undefined,
    desiredState: "Running",
    account: { server, authMode },
    credentials,
    config: {
      clientKind: "packet",
      settings: { activeModule: preset, modules: settings },
    },
    version,
    proxy,
    restorePolicy: "best_effort",
  };

  const orch = orchestratorFor({ id: user.id, role: user.role });
  let botId: string;
  try {
    const created = await orch.createBot(createReq);
    botId = created.id;
  } catch (e) {
    if (e instanceof OrchestratorError)
      return err(e.status === 503 ? 502 : e.status, e.message);
    return err(502, "orchestrator create failed");
  }

  // The row exists so the UI can attach to it immediately; the orchestrator's
  // service callback binds the real agent token to it (docs/08 §8.6). The
  // placeholder hash is random so no token can authenticate against it.
  const inst = await db.instance.create({
    data: {
      userId: user.id,
      kind: "managed",
      botId,
      server,
      nickname: str(body.nickname, 64),
      tokenHash: sha256(newInstanceToken()),
      desiredState: "Running",
      phase: "Provisioning",
      version: version.pinnedImage ?? null,
    },
  });
  await db.auditLog.create({
    data: {
      userId: user.id,
      instanceId: inst.id,
      action: "instance.create_managed",
      meta: {
        bot_id: botId,
        server,
        auth_mode: authMode, // never the credential values
        preset,
        proxy_mode: proxy.mode,
        channel: version.channel,
      },
    },
  });

  return json(
    {
      instance: {
        id: inst.id,
        kind: inst.kind,
        bot_id: inst.botId,
        phase: inst.phase,
        desired_state: inst.desiredState,
      },
    },
    { status: 201 }
  );
}
