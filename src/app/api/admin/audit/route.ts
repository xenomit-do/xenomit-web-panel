import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";

// GET /api/admin/audit?q=&limit= — audit log search (docs/08 §8.5).
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));

  const rows = await db.auditLog.findMany({
    where: q
      ? {
          OR: [
            { action: { contains: q } },
            { user: { username: { contains: q } } },
            { user: { discordId: { contains: q } } },
            { instanceId: { contains: q } },
          ],
        }
      : {},
    orderBy: { at: "desc" },
    take: limit,
    include: { user: { select: { username: true, discordId: true } } },
  });

  return json({
    entries: rows.map((r) => ({
      id: r.id,
      at: r.at,
      user: r.user.username,
      user_id: r.userId,
      instance_id: r.instanceId,
      action: r.action,
      meta: r.meta,
    })),
  });
}
