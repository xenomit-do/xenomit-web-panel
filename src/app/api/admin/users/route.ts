import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";

// GET /api/admin/users — user list with instance counts (docs/08 §8.5).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { instances: { where: { revokedAt: null } } } } },
  });
  return json({
    users: users.map((u) => ({
      id: u.id,
      discord_id: u.discordId,
      username: u.username,
      avatar: u.avatar,
      role: u.role,
      status: u.status,
      plan: u.plan,
      instance_limit: u.instanceLimit,
      instance_count: u._count.instances,
      created_at: u.createdAt,
    })),
  });
}
