// SSE lifecycle consumer (docs/08 §8.6): subscribes to the orchestrator's
// /v1/events stream, mirrors phase/desiredState/version into the Instance
// cache columns so list pages never fan out, and re-broadcasts to viewers
// through the hub. Reconnects with Last-Event-ID and resyncs on connect.

import { db } from "@/lib/db";
import {
  orchestratorService,
  orchestratorBaseUrl,
  OrchestratorClient,
} from "@/lib/orchestrator";
import type { BotEvent } from "@shared/orchestrator";
import { hub } from "./hub";

const RECONNECT_MS = 2_000;
const RECONNECT_MAX_MS = 15_000;

export interface OrchestratorEventsHandle {
  stop: () => void;
}

/**
 * Apply one lifecycle event to the Instance cache + live viewers. Exported so
 * tests can drive it directly without a socket.
 */
export async function applyBotEvent(ev: BotEvent) {
  const inst = await db.instance
    .findFirst({ where: { botId: ev.botId, revokedAt: null } })
    .catch(() => null);
  if (!inst) return;

  const phase =
    ev.phase ??
    (ev.type === "deleted" ? "Terminated" : undefined) ??
    inst.phase ??
    undefined;
  await db.instance
    .update({
      where: { id: inst.id },
      data: {
        ...(phase !== undefined ? { phase } : {}),
        ...(ev.desiredState !== undefined ? { desiredState: ev.desiredState } : {}),
        ...(ev.version !== undefined ? { version: ev.version } : {}),
        ...(ev.detail !== undefined ? { phaseDetail: ev.detail as object } : {}),
      },
    })
    .catch(() => {});

  hub.publishPhase(inst.id, {
    phase: phase ?? "Unknown",
    detail: ev.detail,
    desired_state: ev.desiredState ?? inst.desiredState,
    epoch: ev.epoch,
    version: ev.version ?? inst.version,
    at: ev.at,
  });
}

/** Pull the authoritative list once per (re)connect — heals anything the
 *  stream dropped while we were away. */
export async function resyncManagedInstances(client: OrchestratorClient) {
  const { bots } = await client.listBots();
  const managed = await db.instance.findMany({
    where: { kind: "managed", revokedAt: null },
    select: { id: true, botId: true },
  });
  const byBotId = new Map(bots.map((b) => [b.id, b]));
  for (const inst of managed) {
    const b = inst.botId ? byBotId.get(inst.botId) : undefined;
    if (!b) continue;
    await db.instance
      .update({
        where: { id: inst.id },
        data: {
          phase: b.phase,
          desiredState: b.desiredState,
          version: b.version ?? null,
        },
      })
      .catch(() => {});
    hub.publishPhase(inst.id, {
      phase: b.phase,
      desired_state: b.desiredState,
      version: b.version ?? null,
    });
  }
}

/** Parse one SSE stream and dispatch each event. Resolves when the stream
 *  ends or `signal` aborts; throws on transport errors. */
export async function consumeEventStream(
  res: Response,
  onEvent: (ev: BotEvent) => void | Promise<void>,
  onId?: (id: string) => void
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let id: string | null = null;
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        // ":" comments (heartbeats) are ignored
      }
      if (id) onId?.(id);
      if (!dataLines.length) continue;
      try {
        const ev = JSON.parse(dataLines.join("\n")) as BotEvent;
        await onEvent(ev);
      } catch {
        /* malformed event — skip */
      }
    }
  }
}

export function startOrchestratorEvents(opts?: {
  baseUrl?: string;
  client?: OrchestratorClient;
  log?: (msg: string) => void;
}): OrchestratorEventsHandle {
  const client =
    opts?.client ??
    new OrchestratorClient({
      baseUrl: opts?.baseUrl ?? orchestratorBaseUrl(),
      sub: "panel-service",
      role: "admin",
      act: "*",
    });
  const log = opts?.log ?? ((m: string) => console.log(`[orch-events] ${m}`));
  let stopped = false;
  let lastEventId: string | null = null;
  let attempt = 0;

  const loop = async () => {
    while (!stopped) {
      try {
        await resyncManagedInstances(client).catch(() => {});
        const res = await client.openEventStream(lastEventId ?? undefined);
        attempt = 0;
        log("connected to orchestrator event stream");
        await consumeEventStream(
          res,
          (ev) => applyBotEvent(ev),
          (id) => {
            lastEventId = id;
          }
        );
        throw new Error("event stream ended");
      } catch (e) {
        if (stopped) return;
        attempt++;
        const wait = Math.min(RECONNECT_MS * attempt, RECONNECT_MAX_MS);
        log(`reconnecting in ${wait}ms (${e instanceof Error ? e.message : e})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };
  void loop();

  return {
    stop: () => {
      stopped = true;
    },
  };
}
