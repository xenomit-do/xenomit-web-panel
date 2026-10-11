import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/tokens";
import { rateLimit } from "@/lib/ratelimit";
import { hub } from "./hub";

// Agent endpoint: wss://<host>/api/agent/ws
// Auth: per-instance Bearer token in Authorization header or
// Sec-WebSocket-Protocol ("bearer.<token>"). The panel NEVER dials out to
// agents — this is the only agent channel and it is outbound-only from them.

export const agentWss = new WebSocketServer({
  noServer: true,
  // Accept the "bearer" subprotocol so clients that authenticated via
  // Sec-WebSocket-Protocol complete the handshake.
  handleProtocols: (protocols) => (protocols.has("bearer") ? "bearer" : false),
});

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const proto = req.headers["sec-websocket-protocol"];
  if (proto) {
    for (const p of proto.split(",").map((s) => s.trim())) {
      if (p.startsWith("bearer.")) return p.slice(7);
      if (p.startsWith("xnt_")) return p;
    }
  }
  return null;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export async function handleAgentUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
) {
  const ip = clientIp(req);
  const rl = rateLimit(`agent-conn:${ip}`, 30, 60_000);
  if (!rl.ok) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    socket.destroy();
    return;
  }

  const token = extractToken(req);
  if (!token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const instance = await db.instance.findFirst({
    where: { tokenHash: sha256(token), revokedAt: null },
    select: { id: true, userId: true },
  });
  if (!instance) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  agentWss.handleUpgrade(req, socket, head, (ws) =>
    onAgentSocket(ws, instance)
  );
}

function onAgentSocket(
  ws: WebSocket,
  instance: { id: string; userId: string }
) {
  hub.agentConnected(ws, instance);

  const pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN)
      ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
  }, 30_000);

  ws.on("message", (raw) => {
    void hub.handleAgentMessage(instance.id, raw as Buffer);
  });
  ws.on("close", () => {
    clearInterval(pingTimer);
    hub.agentDisconnected(instance.id, ws);
  });
  ws.on("error", () => {
    clearInterval(pingTimer);
    hub.agentDisconnected(instance.id, ws);
  });
}
