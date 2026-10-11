// POST /api/orchestrator/instances — the service-authenticated provisioning
// callback (docs/08 §8.6): token issuance, rotation-on-rebind, idempotency.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/tokens";
import { POST } from "@/app/api/orchestrator/instances/route";

// The route imports @/lib/api which pulls next-auth; it isn't used by the
// service-auth path, so stub it to keep the test environment Next-free.
vi.mock("../auth", () => ({ auth: vi.fn() }));

const TOKEN = process.env.ORCHESTRATOR_SERVICE_TOKEN!;
let ipCounter = 0;

function provision(body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // unique IP per call so the rate limiter can't conflate test cases
    "x-forwarded-for": `10.0.0.${++ipCounter}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return POST(
    new Request("http://panel.test/api/orchestrator/instances", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

let ownerId: string;

beforeAll(async () => {
  const u = await db.user.create({
    data: { discordId: "prov-owner", username: "ProvOwner" },
  });
  ownerId = u.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("orchestrator provisioning callback", () => {
  it("rejects missing/wrong service auth", async () => {
    expect((await provision({ bot_id: "b", owner: ownerId }, null)).status).toBe(401);
    expect(
      (await provision({ bot_id: "b", owner: ownerId }, "wrong")).status
    ).toBe(401);
  });

  it("requires bot_id and a known owner", async () => {
    expect((await provision({ owner: ownerId })).status).toBe(400);
    expect((await provision({ bot_id: "xnb_x", owner: "no-such-user" })).status).toBe(404);
  });

  it("creates a managed instance and returns the token once", async () => {
    const res = await provision({
      bot_id: "xnb_prov1",
      owner: ownerId,
      server: "int1.darkorbit.com",
      username: "PilotOne",
      desired_state: "Running",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      instance_id: string;
      token: string;
      agent_ws_url: string;
    };
    expect(body.token).toMatch(/^xnt_/);
    expect(body.agent_ws_url).toContain("/api/agent/ws");

    const inst = await db.instance.findUnique({ where: { id: body.instance_id } });
    expect(inst).toMatchObject({
      userId: ownerId,
      kind: "managed",
      botId: "xnb_prov1",
      phase: "Provisioning",
      server: "int1.darkorbit.com",
    });
    // the panel stores only the hash — never the raw token
    expect(inst?.tokenHash).toBe(sha256(body.token));
    expect(JSON.stringify(inst)).not.toContain(body.token);

    const audit = await db.auditLog.findFirst({
      where: { instanceId: body.instance_id, action: "instance.managed_provision" },
    });
    expect(audit).toBeTruthy();
  });

  it("re-bind rotates the token (same instance, new hash)", async () => {
    const first = (await (
      await provision({ bot_id: "xnb_prov2", owner: ownerId })
    ).json()) as { instance_id: string; token: string };
    const hashBefore = (await db.instance.findUniqueOrThrow({
      where: { id: first.instance_id },
    })).tokenHash;

    const res = await provision({ bot_id: "xnb_prov2", owner: ownerId });
    expect(res.status).toBe(200);
    const second = (await res.json()) as { instance_id: string; token: string };
    expect(second.instance_id).toBe(first.instance_id);
    expect(second.token).not.toBe(first.token);
    const inst = await db.instance.findUniqueOrThrow({
      where: { id: first.instance_id },
    });
    expect(inst.tokenHash).toBe(sha256(second.token));
    expect(inst.tokenHash).not.toBe(hashBefore);
  });

  it("refuses to re-bind a bot to a different owner", async () => {
    const other = await db.user.create({
      data: { discordId: "prov-other", username: "Other" },
    });
    await provision({ bot_id: "xnb_prov3", owner: ownerId });
    const res = await provision({ bot_id: "xnb_prov3", owner: other.id });
    expect(res.status).toBe(409);
  });
});
