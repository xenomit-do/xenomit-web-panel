import { createServer } from "http";
import next from "next";
import { handleAgentUpgrade } from "./src/server/agent-ws";
import { handleViewUpgrade } from "./src/server/view-ws";
import { startOrchestratorEvents } from "./src/server/orchestrator-events";
import { orchestratorEnabled } from "./src/lib/orchestrator";

// Single-process custom server: Next.js handles HTTP + REST, this file owns
// the two websocket upgrade paths (/api/agent/ws, /api/view/ws). Keeping them
// in-process lets REST routes dispatch commands to live agent sockets via the
// shared hub. Split into a dedicated gateway service when scaling out.

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "", "http://localhost").pathname;
    if (pathname === "/api/agent/ws") {
      void handleAgentUpgrade(req, socket, head);
    } else if (pathname === "/api/view/ws") {
      void handleViewUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    console.log(`xenomit-panel ready on http://${hostname}:${port}`);
    if (orchestratorEnabled()) startOrchestratorEvents();
  });
});
