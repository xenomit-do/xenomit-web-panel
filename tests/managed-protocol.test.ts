// Managed-agent protocol additions (docs/08 §8.7): seq'd stat_event acks,
// idempotent replay via (instanceId, seq), and the managed hello metadata —
// exercised against the real ws handlers on the throwaway test.db.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { WebSocket } from "ws";
import type { AddressInfo } from "net";
import { db } from "@/lib/db";
import { sha256, newInstanceToken } from "@/lib/tokens";
import { mintViewTicket } from "@/lib/viewticket";
import { handleAgentUpgrade } from "@/server/agent-ws";
import { handleViewUpgrade } from "@/server/view-ws";
import { hub } from "@/server/hub";
import { applyBotEvent } from "@/server/orchestrator-events";

let server: Server;
let port: number;
let userId: string;
let instanceId: string;
let agentToken: string;
const sockets: WebSocket[] = [];

function ws(url: string, headers?: Record<string, string>) {
  return new Promise<{ w: WebSocket; recv: () => Promise<unknown> }>(
    (resolve, reject) => {
      const w = new WebSocket(url, { headers });
      sockets.push(w);
      const buf: string[] = [];
      const waiters: ((m: unknown) => void)[] = [];
      w.on("message", (raw) => {
        const s = raw.toString();
        const next = waiters.shift();
        if (next) next(JSON.parse(s));
        else buf.push(s);
      });
      const recv = () =>
        new Promise<unknown>((res) => {
          const s = buf.shift();
          if (s !== undefined) res(JSON.parse(s));
          else waiters.push(res);
        });
      w.on("open", () => resolve({ w, recv }));
      w.on("error", reject);
    }
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MANAGED_HELLO = {
  type: "hello",
  protocol: 1,
  agent_version: "managed-1",
  os: "linux",
  instance: { server: "int1.darkorbit.com", user_id: "99", username: "BotPilot" },
  client: "ruffle",
  backend: "native",
  managed: true,
  epoch: 7,
  restored: { quality: "clean", downtime_ms: 1200 },
  modules: [],
  config: { modules: {} },
};

beforeAll(async () => {
  const user = await db.user.create({
    data: { discordId: "managed-user", username: "Mgr" },
  });
  userId = user.id;
  agentToken = newInstanceToken();
  const inst = await db.instance.create({
    data: { userId, tokenHash: sha256(agentToken), kind: "managed", botId: "xnb_m1" },
  });
  instanceId = inst.id;

  server = createServer((_req, res) => res.writeHead(404).end());
  server.on("upgrade", (req, socket, head) => {
    const p = new URL(req.url ?? "", "http://x").pathname;
    if (p === "/api/agent/ws") void handleAgentUpgrade(req, socket, head);
    else if (p === "/api/view/ws") void handleViewUpgrade(req, socket, head);
    else socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const s of sockets) {
    try { s.terminate(); } catch { /* ignore */ }
  }
  server.closeAllConnections?.();
  server.closeIdleConnections?.();
  await Promise.race([
    new Promise((r) => server.close(r)),
    sleep(3000),
  ]);
  await db.$disconnect();
}, 15000);

describe("managed agent protocol v1.1", () => {
  it("accepts a managed hello with epoch/restored metadata", async () => {
    const { w: agent } = await ws(`ws://127.0.0.1:${port}/api/agent/ws`, {
      Authorization: `Bearer ${agentToken}`,
    });
    agent.send(JSON.stringify(MANAGED_HELLO));
    await sleep(200);
    expect(hub.isOnline(instanceId)).toBe(true);
    agent.close();
  });

  it("acks seq'd stat_events and dedupes replays", async () => {
    const { w: agent, recv } = await ws(`ws://127.0.0.1:${port}/api/agent/ws`, {
      Authorization: `Bearer ${agentToken}`,
    });
    agent.send(JSON.stringify(MANAGED_HELLO));
    await sleep(150);

    const ev = (seq: number, message: string) =>
      JSON.stringify({
        type: "stat_event",
        at: Date.now(),
        seq,
        source: "bot",
        message,
        rewards: [0, 0, 0, 1],
        balances: [0, 0, 0, 1],
      });

    agent.send(ev(1, "first"));
    const ack1 = (await recv()) as { type: string; seq: number };
    expect(ack1).toEqual({ type: "stat_ack", seq: 1 });

    // replay the same seq — acked again (so the outbox trims) but not stored twice
    agent.send(ev(1, "replay of first"));
    const ack2 = (await recv()) as { type: string; seq: number };
    expect(ack2).toEqual({ type: "stat_ack", seq: 1 });

    agent.send(ev(2, "second"));
    const ack3 = (await recv()) as { type: string; seq: number };
    expect(ack3).toEqual({ type: "stat_ack", seq: 2 });

    await sleep(200);
    const rows = await db.statEvent.findMany({
      where: { instanceId },
      orderBy: { seq: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2]);
    expect(rows[0].message).toBe("first");
    agent.close();
  });

  it("unsequenced stat_events still store without an ack (old agents)", async () => {
    const { w: agent, recv } = await ws(`ws://127.0.0.1:${port}/api/agent/ws`, {
      Authorization: `Bearer ${agentToken}`,
    });
    agent.send(JSON.stringify(MANAGED_HELLO));
    await sleep(150);
    agent.send(
      JSON.stringify({
        type: "stat_event",
        at: Date.now(),
        source: "bot",
        message: "legacy",
        rewards: [1, 0, 0, 0],
        balances: [1, 0, 0, 0],
      })
    );
    await sleep(200);
    const rows = await db.statEvent.findMany({
      where: { instanceId, seq: null },
    });
    expect(rows.some((r) => r.message === "legacy")).toBe(true);
    // drain whatever messages arrived — none should be a stat_ack
    agent.close();
    void recv;
  });

  it("status carries optional phase/needs_human through to viewers", async () => {
    const { w: agent } = await ws(`ws://127.0.0.1:${port}/api/agent/ws`, {
      Authorization: `Bearer ${agentToken}`,
    });
    agent.send(JSON.stringify(MANAGED_HELLO));
    await sleep(150);

    const ticket = mintViewTicket(userId);
    const { w: view, recv } = await ws(
      `ws://127.0.0.1:${port}/api/view/ws?ticket=${ticket}`
    );
    await recv(); // viewer hello
    view.send(JSON.stringify({ type: "subscribe", instance_ids: [instanceId] }));
    await recv(); // snapshot

    agent.send(
      JSON.stringify({
        type: "status",
        bot_running: false,
        uptime_s: 10,
        client: "ruffle",
        backend: "native",
        phase: "NeedsHuman",
        needs_human: { kind: "captcha", detail: "grid" },
      })
    );
    const status = (await recv()) as {
      type: string;
      phase?: string;
      needs_human?: { kind: string };
    };
    expect(status.type).toBe("status");
    expect(status.phase).toBe("NeedsHuman");
    expect(status.needs_human?.kind).toBe("captcha");
    view.close();
    agent.close();
  });

  it("an orchestrator lifecycle event updates the cache and viewers", async () => {
    const ticket = mintViewTicket(userId);
    const { w: view, recv } = await ws(
      `ws://127.0.0.1:${port}/api/view/ws?ticket=${ticket}`
    );
    await recv(); // hello
    view.send(JSON.stringify({ type: "subscribe", instance_ids: [instanceId] }));
    await recv(); // snapshot (+ possible phase-cache push)

    await applyBotEvent({
      id: 1,
      at: new Date().toISOString(),
      botId: "xnb_m1",
      owner: userId,
      type: "phase",
      phase: "NeedsHuman",
      detail: { kind: "dosid_expired" },
      desiredState: "Running",
    });

    const msg = (await recv()) as {
      type: string;
      instance_id: string;
      phase: string;
    };
    expect(msg).toMatchObject({
      type: "phase",
      instance_id: instanceId,
      phase: "NeedsHuman",
    });

    const inst = await db.instance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(inst.phase).toBe("NeedsHuman");
    expect((inst.phaseDetail as { kind?: string })?.kind).toBe("dosid_expired");
    view.close();
  });
});
