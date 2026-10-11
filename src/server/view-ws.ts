import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer } from "ws";
import { db } from "@/lib/db";
import { verifyViewTicket } from "@/lib/viewticket";
import { rateLimit } from "@/lib/ratelimit";
import { hub } from "./hub";
import type { ViewClientMessage, ViewServerMessage } from "@shared/protocol";

// Viewer endpoint: wss://<host>/api/view/ws?ticket=<short-lived ticket>
// The ticket is minted by POST /api/view/token for the signed-in user; every
// subscribe is ACL-checked against instance ownership.

export const viewWss = new WebSocketServer({ noServer: true });

export async function handleViewUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
) {
  const url = new URL(req.url ?? "", "http://localhost");
  const ticket = url.searchParams.get("ticket") ?? "";
  const auth = verifyViewTicket(ticket);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const rl = rateLimit(`view-conn:${auth.userId}`, 20, 60_000);
  if (!rl.ok) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    socket.destroy();
    return;
  }

  const owned = await db.instance.findMany({
    where: { userId: auth.userId, revokedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((o) => o.id));

  viewWss.handleUpgrade(req, socket, head, (ws) => {
    const conn = hub.addViewer(ws, auth.userId, ownedIds);
    const send = (m: ViewServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    send({ type: "hello", user_id: auth.userId });

    ws.on("message", (raw) => {
      let msg: ViewClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "subscribe" && Array.isArray(msg.instance_ids)) {
        hub.subscribe(conn, msg.instance_ids.slice(0, 64));
      } else if (msg.type === "unsubscribe" && Array.isArray(msg.instance_ids)) {
        hub.unsubscribe(conn, msg.instance_ids.slice(0, 64));
      } else if (msg.type === "ping") {
        send({ type: "pong", t: msg.t ?? Date.now() });
      }
    });
    ws.on("close", () => hub.removeViewer(conn));
    ws.on("error", () => hub.removeViewer(conn));
  });
}
