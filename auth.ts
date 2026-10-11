import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  CLAIM_COOKIE,
  resolveInviteForSignIn,
  verifyInviteClaim,
} from "@/lib/invites";

// Discord OAuth is the real provider. A credentials "Dev Login" provider is
// enabled automatically when Discord creds are absent (or DEV_LOGIN=true) so
// the panel stays demoable without a Discord app. Set DEV_LOGIN=false to
// disable it explicitly. Dev Login is open access — for local development
// only (docs/08 §8.3a); it must never exist in production.
const devLoginEnabled =
  process.env.DEV_LOGIN === "true" ||
  (process.env.DEV_LOGIN !== "false" && !process.env.AUTH_DISCORD_ID);

if (devLoginEnabled && process.env.NODE_ENV === "production") {
  throw new Error(
    "Dev Login is enabled in production — set DEV_LOGIN=false or remove it before deploying"
  );
}

// Bootstrap admins: these Discord ids are promoted to role=admin on every
// login. Further promotions happen via the admin console (audited).
const ADMIN_DISCORD_IDS = new Set(
  (process.env.ADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// Dev Login may only mint admins when explicitly asked (never reachable in
// production because of the boot guard above).
const devAdmin = process.env.DEV_ADMIN === "true";

const providers = [
  ...(process.env.AUTH_DISCORD_ID ? [Discord] : []),
  ...(devLoginEnabled
    ? [
        Credentials({
          id: "dev",
          name: "Dev Login",
          credentials: { username: { label: "Username", type: "text" } },
          authorize: async (creds) => {
            const username =
              typeof creds?.username === "string" && creds.username.trim()
                ? creds.username.trim().slice(0, 32)
                : "Dev User";
            return {
              id: `dev-${username.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
              name: username,
            };
          },
        }),
      ]
    : []),
];

/** Invite code redeemed on the landing page is carried into the OAuth
 *  round-trip via a signed, short-lived cookie (docs/08 §8.3a path B). */
async function inviteClaimCodeHash(): Promise<string | null> {
  try {
    const jar = await cookies();
    return verifyInviteClaim(jar.get(CLAIM_COOKIE)?.value);
  } catch {
    return null; // outside a request context (e.g. tests)
  }
}

async function upsertPanelUser(identity: {
  discordId: string;
  username: string;
  avatar?: string | null;
  admin: boolean;
}) {
  return db.user.upsert({
    where: { discordId: identity.discordId },
    create: {
      discordId: identity.discordId,
      username: identity.username,
      avatar: identity.avatar ?? null,
      role: identity.admin ? "admin" : "user",
      status: "active",
    },
    update: {
      username: identity.username,
      avatar: identity.avatar ?? null,
      // Bootstrap/dev promotions re-apply on every login (docs/08 §8.3).
      ...(identity.admin ? { role: "admin" } : {}),
    },
  });
}

/** Consume the invite this login was gated on, and link it to the user row. */
async function claimPendingInvite(discordId: string, userId: string) {
  const claimCodeHash = await inviteClaimCodeHash();
  const now = new Date();
  const invite =
    (await db.invite.findFirst({
      where: { discordId, usedAt: null, expiresAt: { gt: now } },
    })) ??
    (claimCodeHash
      ? await db.invite.findUnique({ where: { codeHash: claimCodeHash } })
      : null);
  if (!invite || invite.usedAt || invite.expiresAt <= now) return;
  if (invite.discordId && invite.discordId !== discordId) return;
  const consumed = await db.invite.updateMany({
    where: { id: invite.id, usedAt: null },
    data: { usedAt: now, usedByDiscordId: discordId, usedById: userId },
  });
  if (consumed.count) {
    await db.auditLog
      .create({
        data: { userId, action: "invite.redeemed", meta: { inviteId: invite.id } },
      })
      .catch(() => {});
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    async signIn({ account }) {
      // Invite gate applies to Discord logins for accounts the panel has never
      // seen — rejected before any User row is created (docs/08 §8.3a).
      if (account?.provider !== "discord") return true;
      const discordId = account.providerAccountId ?? "";
      if (!discordId) return false;
      const claim = await inviteClaimCodeHash();
      const lookup = await resolveInviteForSignIn(discordId, claim);
      return lookup.ok;
    },
    async jwt({ token, account, profile, user }) {
      if (account && user) {
        const isDiscord = account.provider === "discord";
        const discordId = isDiscord
          ? (account.providerAccountId ?? user.id ?? "")
          : (user.id ?? "dev-user");
        const panelUser = await upsertPanelUser({
          discordId,
          username:
            (isDiscord
              ? ((profile as { username?: string; global_name?: string } | null)
                  ?.global_name ??
                (profile as { username?: string } | null)?.username)
              : user.name) ?? "user",
          avatar: isDiscord
            ? ((profile as { avatar?: string } | null)?.avatar ?? null)
            : null,
          admin:
            (isDiscord && ADMIN_DISCORD_IDS.has(discordId)) ||
            (!isDiscord && devAdmin),
        });
        if (isDiscord) await claimPendingInvite(discordId, panelUser.id);
        token.uid = panelUser.id;
        token.name = panelUser.username;
        token.picture = panelUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordId}/${panelUser.avatar}.png`
          : null;
        token.provider = account.provider;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) (session.user as { id?: string }).id = token.uid as string;
      (session.user as { provider?: string }).provider = token.provider as string;
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      image?: string | null;
      provider?: string;
    };
  }
}
