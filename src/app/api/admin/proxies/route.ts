import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";
import { isRecord } from "@/lib/validate";
import type { CreateProxyRequest } from "@shared/orchestrator";

const SCHEMES = new Set(["http", "https", "socks5"]);

// GET /api/admin/proxies — pool health + assignments (docs/08 §8.5).
// POST — add a proxy to the pool. Credentials are forwarded to the
// orchestrator/Vault in memory only.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  try {
    const out = await orchestratorFor(admin).listProxies();
    return json(out);
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");

  const body = await req.json().catch(() => ({}));
  if (!isRecord(body)) return err(400, "invalid body");
  const scheme = typeof body.scheme === "string" ? body.scheme : "";
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const port = Number(body.port);
  if (!SCHEMES.has(scheme)) return err(400, "scheme must be http|https|socks5");
  if (!host) return err(400, "host required");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return err(400, "port must be 1..65535");

  const createReq: CreateProxyRequest = {
    scheme: scheme as CreateProxyRequest["scheme"],
    host,
    port,
    ...(typeof body.country === "string" && body.country.trim()
      ? { country: body.country.trim().toUpperCase().slice(0, 8) }
      : {}),
    ...(Array.isArray(body.tags)
      ? { tags: body.tags.filter((t: unknown) => typeof t === "string").slice(0, 16) }
      : {}),
    ...(Number.isInteger(Number(body.capacity)) && Number(body.capacity) > 0
      ? { capacity: Number(body.capacity) }
      : {}),
    ...(typeof body.username === "string" && body.username
      ? { username: body.username }
      : {}),
    ...(typeof body.password === "string" && body.password
      ? { password: body.password }
      : {}),
  };

  try {
    const proxy = await orchestratorFor(admin).createProxy(createReq);
    await db.auditLog.create({
      data: {
        userId: admin.id,
        action: "admin.proxy.create",
        meta: { proxy_id: proxy.id, host: proxy.host, port: proxy.port },
      },
    });
    return json({ proxy }, { status: 201 });
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}
