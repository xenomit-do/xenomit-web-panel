import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { orchestratorFor, OrchestratorError } from "@/lib/orchestrator";
import { isRecord } from "@/lib/validate";
import type { CreateRolloutRequest } from "@shared/orchestrator";

// GET /api/admin/rollouts — rollout list (docs/08 §8.5 Rollouts).
// POST {image, selector?, canary?, wave?} — create a rollout.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");
  try {
    const out = await orchestratorFor(admin).listRollouts();
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
  const image = typeof body.image === "string" ? body.image.trim() : "";
  if (!image) return err(400, "image required");

  const strList = (v: unknown, max = 50): string[] | undefined =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").slice(0, max)
      : undefined;

  const createReq: CreateRolloutRequest = {
    image: image.slice(0, 256),
    ...(isRecord(body.selector)
      ? {
          selector: {
            phases: strList(body.selector.phases),
            versions: strList(body.selector.versions),
          },
        }
      : {}),
    ...(strList(body.canary)?.length ? { canary: strList(body.canary) } : {}),
    ...(isRecord(body.wave)
      ? {
          wave: {
            ...(Number.isInteger(Number(body.wave.size)) && Number(body.wave.size) > 0
              ? { size: Math.min(100, Number(body.wave.size)) }
              : {}),
            ...(Number.isInteger(Number(body.wave.wait_seconds)) &&
              Number(body.wave.wait_seconds) >= 0
              ? { waitSeconds: Math.min(3600, Number(body.wave.wait_seconds)) }
              : {}),
          },
        }
      : {}),
  };

  try {
    const rollout = await orchestratorFor(admin).createRollout(createReq);
    await db.auditLog.create({
      data: {
        userId: admin.id,
        action: "admin.rollout.create",
        meta: { rollout_id: rollout.id, image },
      },
    });
    return json({ rollout }, { status: 201 });
  } catch (e) {
    return err(
      e instanceof OrchestratorError ? e.status : 502,
      e instanceof Error ? e.message : "orchestrator request failed"
    );
  }
}
