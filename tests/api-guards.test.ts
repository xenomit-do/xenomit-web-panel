// requireUser / requireAdmin — role & status are read from the DB on every
// request so suspension and demotion apply immediately (docs/08 §8.3).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/api";

const authMock = vi.fn();
vi.mock("../auth", () => ({
  auth: () => authMock(),
}));

beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: "guard-user", discordId: "g1", username: "U", role: "user" },
      { id: "guard-admin", discordId: "g2", username: "A", role: "admin" },
      { id: "guard-susp", discordId: "g3", username: "S", role: "user", status: "suspended" },
    ],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

const session = (id: string | null) =>
  authMock.mockResolvedValue(id ? { user: { id } } : null);

describe("requireUser", () => {
  it("returns null when signed out", async () => {
    session(null);
    expect(await requireUser()).toBeNull();
  });
  it("returns the fresh DB row for an active user", async () => {
    session("guard-user");
    const u = await requireUser();
    expect(u).toMatchObject({ id: "guard-user", role: "user", status: "active" });
  });
  it("denies suspended users immediately", async () => {
    session("guard-susp");
    expect(await requireUser()).toBeNull();
  });
  it("reflects a status change on the next call (no token staleness)", async () => {
    session("guard-user");
    await db.user.update({
      where: { id: "guard-user" },
      data: { status: "suspended" },
    });
    expect(await requireUser()).toBeNull();
    await db.user.update({
      where: { id: "guard-user" },
      data: { status: "active" },
    });
    expect(await requireUser()).not.toBeNull();
  });
});

describe("requireAdmin", () => {
  it("denies non-admin users", async () => {
    session("guard-user");
    expect(await requireAdmin()).toBeNull();
  });
  it("allows admins", async () => {
    session("guard-admin");
    expect((await requireAdmin())?.id).toBe("guard-admin");
  });
  it("denies a demoted admin immediately", async () => {
    session("guard-admin");
    await db.user.update({
      where: { id: "guard-admin" },
      data: { role: "user" },
    });
    expect(await requireAdmin()).toBeNull();
    await db.user.update({
      where: { id: "guard-admin" },
      data: { role: "admin" },
    });
    expect(await requireAdmin()).not.toBeNull();
  });
});
