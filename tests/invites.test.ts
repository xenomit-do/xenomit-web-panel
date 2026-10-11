// Invite-gate tests — claim cookie integrity + resolveInviteForSignIn paths
// against the throwaway test.db (docs/08 §8.3a).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/tokens";
import {
  mintInviteClaim,
  verifyInviteClaim,
  resolveInviteForSignIn,
  consumeInvite,
  newInviteCode,
} from "@/lib/invites";

const SECRET = process.env.AUTH_SECRET!;

function signedClaim(ch: string, exp: number): string {
  const payload = Buffer.from(JSON.stringify({ ch, exp })).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

let creator: { id: string };
const mkInvite = async (data: {
  codeHash?: string;
  discordId?: string;
  expiresAt?: Date;
  usedAt?: Date;
}) =>
  db.invite.create({
    data: {
      createdById: creator.id,
      expiresAt: data.expiresAt ?? new Date(Date.now() + 86_400_000),
      codeHash: data.codeHash ?? null,
      discordId: data.discordId ?? null,
      usedAt: data.usedAt ?? null,
    },
  });

beforeAll(async () => {
  creator = await db.user.create({
    data: { discordId: "inv-admin", username: "Inviter", role: "admin" },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("invite claim cookie", () => {
  it("round-trips a minted claim", () => {
    const hash = sha256("INV-AAAA-BBBBB");
    expect(verifyInviteClaim(mintInviteClaim(hash))).toBe(hash);
  });
  it("rejects tampered and unsigned values", () => {
    const good = mintInviteClaim(sha256("code"));
    const [payload] = good.split(".");
    expect(verifyInviteClaim(`${payload}.forged`)).toBeNull();
    expect(verifyInviteClaim("garbage")).toBeNull();
    expect(verifyInviteClaim(undefined)).toBeNull();
  });
  it("rejects expired claims even with a valid signature", () => {
    const expired = signedClaim(sha256("old"), Date.now() - 1000);
    expect(verifyInviteClaim(expired)).toBeNull();
    const fresh = signedClaim(sha256("new"), Date.now() + 60_000);
    expect(verifyInviteClaim(fresh)).toBe(sha256("new"));
  });
  it("newInviteCode is human-typable and unique", () => {
    const a = newInviteCode();
    const b = newInviteCode();
    expect(a).toMatch(/^INV-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(a).not.toBe(b);
  });
});

describe("resolveInviteForSignIn — the signup gate", () => {
  it("always lets existing users in (no invite needed)", async () => {
    const u = await db.user.create({
      data: { discordId: "inv-existing", username: "Old" },
    });
    const r = await resolveInviteForSignIn(u.discordId, null);
    expect(r).toEqual({ ok: true, inviteId: null });
  });

  it("admits a new user via a pre-approved discordId invite", async () => {
    const inv = await mkInvite({ discordId: "inv-did" });
    const r = await resolveInviteForSignIn("inv-did", null);
    expect(r).toEqual({ ok: true, inviteId: inv.id });
  });

  it("admits a new user via a redeemed code claim", async () => {
    const code = "INV-TEST1-AAAAA";
    const inv = await mkInvite({ codeHash: sha256(code) });
    const r = await resolveInviteForSignIn("inv-coder", sha256(code));
    expect(r).toEqual({ ok: true, inviteId: inv.id });
  });

  it("enforces a discordId bound to a code invite", async () => {
    const code = "INV-BOUND-XXXXX";
    await mkInvite({ codeHash: sha256(code), discordId: "inv-bound-did" });
    const wrong = await resolveInviteForSignIn("inv-other", sha256(code));
    expect(wrong.ok).toBe(false);
    const right = await resolveInviteForSignIn("inv-bound-did", sha256(code));
    expect(right.ok).toBe(true);
  });

  it("rejects used and expired invites", async () => {
    const used = await mkInvite({
      codeHash: sha256("INV-USED-11111"),
      usedAt: new Date(),
    });
    expect(await resolveInviteForSignIn("inv-u1", used.codeHash!)).toMatchObject({
      ok: false,
    });
    const exp = await mkInvite({
      codeHash: sha256("INV-EXP-22222"),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await resolveInviteForSignIn("inv-u2", exp.codeHash!)).toMatchObject({
      ok: false,
    });
    // strangers with no invite at all
    expect(await resolveInviteForSignIn("inv-stranger", null)).toMatchObject({
      ok: false,
      error: "invite required",
    });
  });
});

describe("consumeInvite", () => {
  it("marks the invite used so it can't be redeemed twice", async () => {
    const code = "INV-ONCE-33333";
    const inv = await mkInvite({ codeHash: sha256(code) });
    await consumeInvite(inv.id, "did-once");
    const after = await db.invite.findUnique({ where: { id: inv.id } });
    expect(after?.usedAt).toBeTruthy();
    expect(after?.usedByDiscordId).toBe("did-once");
    expect(
      (await resolveInviteForSignIn("inv-u3", sha256(code))).ok
    ).toBe(false);
  });
});
