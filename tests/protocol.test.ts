// Protocol contract test — exercises the real ws handlers (agent + viewer)
// against a throwaway SQLite db, the same way the mock agent would.

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
import type { ViewServerMessage } from "@shared/protocol";

let server: Server;
let port: number;
let userId: string;
let instanceId: string;
let agentToken: string;
const clientSockets: WebSocket[] = [];

const HELLO = {
  type: "hello",
  protocol: 1,
  agent_version: "test",
  os: "test",
  instance: { server: "test.darkorbit.com", user_id: "42", username: "TestPilot" },
  client: "ruffle",
  backend: "native",
  modules: [
    {
      id: "kill_collect",
      name: "Kill & Collect",
      settings: [
        { key: "targets.npcs", label: "NPCs", kind: { type: "boolean_map", discover: "npc" } },
      ],
    },
  ],
  config: { active_module: "kill_collect", modules: { kill_collect: { "targets.npcs": {} } } },
};

/**
 * Open a socket with a message recorder attached at construction — messages
 * received in the same flush as the handshake (e.g. the viewer `hello`) are
 * buffered, so waiters can never race the wire.
 */
function ws(url: string, headers?: Record<string, string>): Promise<{
  w: WebSocket;
  wait: (pred: (m: ViewServerMessage) => boolean, ms?: number) => Promise<ViewServerMessage>;
}> {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(url, { headers });
    clientSockets.push(w);
    const buf: ViewServerMessage[] = [];
    const waiters: {
      pred: (m: ViewServerMessage) => boolean;
      resolve: (m: ViewServerMessage) => void;
      timer: NodeJS.Timeout;
    }[] = [];
    w.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as ViewServerMessage;
      const i = waiters.findIndex((x) => x.pred(m));
      if (i >= 0) {
        const [x] = waiters.splice(i, 1);
        clearTimeout(x.timer);
        x.resolve(m);
      } else {
        buf.push(m);
      }
    });
    const wait = (pred: (m: ViewServerMessage) => boolean, ms = 5000) => {
      const i = buf.findIndex(pred);
      if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]);
      return new Promise<ViewServerMessage>((res, rej) => {
        const timer = setTimeout(
          () => rej(new Error(`timeout waiting for message; got ${JSON.stringify(buf)}`)),
          ms
        );
        waiters.push({ pred, resolve: res, timer });
      });
    };
    w.on("open", () => resolve({ w, wait }));
    w.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const user = await db.user.create({
    data: { discordId: "test-user", username: "Tester" },
  });
  userId = user.id;
  agentToken = newInstanceToken();
  const inst = await db.instance.create({
    data: { userId, tokenHash: sha256(agentToken) },
  });
  instanceId = inst.id;

  server = createServer((_req, res) => {
    res.writeHead(404).end();
  });
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
  for (const s of clientSockets) {
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

describe("agent protocol v1", () => {
  it("rejects a bad token", async () => {
    await expect(
      ws(`ws://127.0.0.1:${port}/api/agent/ws`, {
        Authorization: "Bearer xnt_wrong",
      })
    ).rejects.toThrow();
  });

  it("accepts hello, streams frames, relays to authorized viewers", async () => {
    const { w: agent } = await ws(`ws://127.0.0.1:${port}/api/agent/ws`, {
      Authorization: `Bearer ${agentToken}`,
    });
    agent.send(JSON.stringify(HELLO));
    await sleep(150);
    expect(hub.isOnline(instanceId)).toBe(true);

    // viewer
    const ticket = mintViewTicket(userId);
    const { w: view, wait } = await ws(
      `ws://127.0.0.1:${port}/api/view/ws?ticket=${ticket}`
    );
    const helloMsg = wait((m) => m.type === "hello");
    view.send(JSON.stringify({ type: "subscribe", instance_ids: [instanceId] }));
    expect((await helloMsg).type).toBe("hello");
    const snap = await wait((m) => m.type === "snapshot");
    expect(snap.type === "snapshot" && snap.online).toBe(true);

    const frameP = wait((m) => m.type === "frame");
    agent.send(
      JSON.stringify({
        type: "frame",
        seq: 1,
        map: { id: 1, name: "1-1", width: 21000, height: 13100 },
        hero: { id: 1, x: 100, y: 200, hp: 1, max_hp: 1, shield: 0, max_shield: 0, nanohull: 0, nanohull_max: 0, configuration: 1, killed: false },
        entities: [],
      })
    );
    const frame = await frameP;
    expect(frame.type === "frame" && frame.instance_id).toBe(instanceId);
    expect(frame.type === "frame" && frame.map?.name).toBe("1-1");

    const statusP = wait((m) => m.type === "status");
    agent.send(
      JSON.stringify({ type: "status", bot_running: true, module_id: "kill_collect", uptime_s: 5, client: "ruffle", backend: "native" })
    );
    const st = await statusP;
    expect(st.type === "status" && st.bot_running).toBe(true);

    const evP = wait((m) => m.type === "stat_event");
    agent.send(
      JSON.stringify({ type: "stat_event", at: Date.now(), source: "test", message: "You received 42 Uridium", rewards: [0, 42, 0, 0], balances: [0, 42, 0, 0] })
    );
    await evP;
    await sleep(150);
    const stored = await db.statEvent.findFirst({ where: { instanceId } });
    expect(stored?.message).toBe("You received 42 Uridium");

    // command round-trip
    const cmdRaw = new Promise<string>((resolve) =>
      agent.on("message", (d) => resolve(d.toString()))
    );
    const cmdP = hub.sendCommand(instanceId, "cmd-test-1", "start", {});
    const cmd = JSON.parse(await cmdRaw);
    expect(cmd.type).toBe("command");
    expect(cmd.id).toBe("cmd-test-1");
    agent.send(JSON.stringify({ type: "command_result", id: "cmd-test-1", ok: true }));
    const res = await cmdP;
    expect(res.ok).toBe(true);

    // sid payloads are stripped before relay/persist
    agent.send(
      JSON.stringify({
        type: "status", bot_running: true, uptime_s: 6, client: "ruffle",
        backend: "native", sid: "SHOULD-NOT-SURVIVE", dosid: "X",
      })
    );
    await sleep(150);
    const persisted = await db.instanceState.findUnique({ where: { instanceId } });
    expect(JSON.stringify(persisted)).not.toContain("SHOULD-NOT-SURVIVE");

    // disconnect → offline + last seen
    const offP = wait((m) => m.type === "presence" && !m.online);
    agent.close();
    const offMsg = await offP;
    expect(offMsg.type === "presence" && offMsg.last_seen_at).toBeTruthy();
    expect(hub.isOnline(instanceId)).toBe(false);
    view.close();
  });
});
