import { db } from "@/lib/db";
import { requireAdmin, json, err } from "@/lib/api";
import { sha256 } from "@/lib/tokens";
import { newInviteCode } from "@/lib/invites";

// GET /api/admin/invites — invite list (docs/08 §8.5 Users & invites).
// POST {discord_id?, note?, expires_in_days?} → mints an invite: a single-use
// code, optionally bound to a specific Discord account.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");

  const invites = await db.invite.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      createdBy: { select: { username: true } },
      usedBy: { select: { username: true } },
    },
  });
  return json({
    invites: invites.map((i) => ({
      id: i.id,
      has_code: !!i.codeHash,
      discord_id: i.discordId,
      note: i.note,
      created_by: i.createdBy.username,
      used_by: i.usedBy?.username ?? i.usedByDiscordId ?? null,
      used_at: i.usedAt,
      expires_at: i.expiresAt,
      created_at: i.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return err(403, "admin required");

  const body = await req.json().catch(() => ({}));
  const discordId =
    typeof body?.discord_id === "string" && body.discord_id.trim()
      ? body.discord_id.trim().slice(0, 64)
      : null;
  const note =
    typeof body?.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 200)
      : null;
  const days = Number(body?.expires_in_days ?? 7);
  const expiresInDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;

  // No code requested → pure Discord-ID pre-approval invite.
  const code = body?.code === false ? null : newInviteCode();
  if (!code && !discordId) return err(400, "discord_id required for codeless invites");

  const invite = await db.invite.create({
    data: {
      codeHash: code ? sha256(code) : null,
      discordId,
      note,
      createdById: admin.id,
      expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
    },
  });
  await db.auditLog.create({
    data: {
      userId: admin.id,
      action: "admin.invite.create",
      meta: { inviteId: invite.id, discord_id: discordId, codeless: !code },
    },
  });
  return json(
    { invite: { id: invite.id, code, discord_id: discordId, expires_at: invite.expiresAt } },
    { status: 201 }
  );
}
