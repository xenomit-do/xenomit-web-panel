import { db } from "@/lib/db";
import { json, err } from "@/lib/api";
import { sha256 } from "@/lib/tokens";
import { rateLimit } from "@/lib/ratelimit";
import { CLAIM_COOKIE, mintInviteClaim } from "@/lib/invites";

// POST /api/invites/claim {code} — verify a single-use invite code and stash
// it in a short-lived signed cookie so the Discord OAuth round-trip can pick
// it up in the signIn callback (docs/08 §8.3a). The invite itself is only
// consumed on a successful gated login.
export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`invite-claim:${ip}`, 10, 60_000);
  if (!rl.ok) return err(429, "too many attempts");

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(400, "invalid json");
  }
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) return err(400, "code required");

  const invite = await db.invite.findUnique({ where: { codeHash: sha256(code) } });
  if (!invite || invite.usedAt || invite.expiresAt <= new Date())
    return err(400, "invalid or expired invite code");

  const res = json({ ok: true });
  res.headers.append(
    "set-cookie",
    `${CLAIM_COOKIE}=${mintInviteClaim(invite.codeHash!)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
  );
  return res;
}
