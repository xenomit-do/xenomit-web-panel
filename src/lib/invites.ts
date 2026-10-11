// Invite-only access (docs/08 §8.3a, docs/12 §12.2).
// An Invite row is either a single-use code (codeHash) or a pre-approved
// Discord ID (discordId). Discord OAuth cannot carry an arbitrary code through
// the provider round-trip, so a redeemed code is stashed in a short-lived
// HMAC cookie (same pattern as the viewer ticket) which the signIn callback
// reads once.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "./db";
import { sha256 } from "./tokens";

const CLAIM_COOKIE = "xn_invite";
const CLAIM_TTL_MS = 10 * 60_000;

export function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let code = "";
  for (let i = 0; i < 10; i++) code += alphabet[bytes[i] % alphabet.length];
  return `INV-${code.slice(0, 5)}-${code.slice(5)}`;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

/** Sign a redeemed invite code into a cookie value consumed by signIn. */
export function mintInviteClaim(codeHash: string): string {
  const payload = Buffer.from(
    JSON.stringify({ ch: codeHash, exp: Date.now() + CLAIM_TTL_MS })
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyInviteClaim(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expect = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof parsed.ch !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Date.now()) return null;
    return parsed.ch as string;
  } catch {
    return null;
  }
}

export { CLAIM_COOKIE };

export type InviteLookup =
  | { ok: true; inviteId: string | null }
  | { ok: false; error: string };

/**
 * Resolve whether a Discord sign-in may proceed, and which invite (if any) it
 * consumes. Existing users always pass — the gate only applies before a User
 * row exists (docs/08 §8.3a).
 */
export async function resolveInviteForSignIn(
  discordId: string,
  claimCodeHash: string | null
): Promise<InviteLookup> {
  const existing = await db.user.findUnique({ where: { discordId } });
  if (existing) return { ok: true, inviteId: null };

  const now = new Date();
  // Path A: pre-approved Discord ID invite.
  const byId = await db.invite.findFirst({
    where: { discordId, usedAt: null, expiresAt: { gt: now } },
  });
  if (byId) return { ok: true, inviteId: byId.id };

  // Path B: a single-use code redeemed into the claim cookie.
  if (claimCodeHash) {
    const byCode = await db.invite.findUnique({
      where: { codeHash: claimCodeHash },
    });
    if (
      byCode &&
      !byCode.usedAt &&
      byCode.expiresAt > now &&
      (!byCode.discordId || byCode.discordId === discordId)
    )
      return { ok: true, inviteId: byCode.id };
  }
  return { ok: false, error: "invite required" };
}

/** Mark an invite consumed at successful login. */
export async function consumeInvite(inviteId: string | null, discordId: string) {
  if (!inviteId) return;
  await db.invite
    .update({
      where: { id: inviteId },
      data: { usedAt: new Date(), usedByDiscordId: discordId },
    })
    .catch(() => {});
}
