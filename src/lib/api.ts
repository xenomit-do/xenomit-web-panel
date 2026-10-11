import { auth } from "../../auth";
import { db } from "./db";

export interface SessionUser {
  id: string;
  role: string;
  status: string;
}

/**
 * Session + fresh DB row (role/status are read per request — never from the
 * JWT — so demotion/suspension applies immediately, docs/08 §8.3). Returns
 * null when signed out or suspended.
 */
export async function requireUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "active") return null;
  return user;
}

/** Same as requireUser, plus role === "admin". Guards /admin + /api/admin/**. */
export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await requireUser();
  return user?.role === "admin" ? user : null;
}

/** Fetch an instance only if it belongs to the user and isn't revoked. */
export async function ownedInstance(userId: string, instanceId: string) {
  return db.instance.findFirst({
    where: { id: instanceId, userId, revokedAt: null },
  });
}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function err(status: number, error: string) {
  return Response.json({ error }, { status });
}
