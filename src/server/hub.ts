import type { WebSocket } from "ws";
import { Prisma } from "@prisma/client";
import type {
  AgentMessage,
  CatalogMsg,
  CommandMsg,
  FrameMessage,
  LogLine,
  MapCatalog,
  ModuleConfig,
  ModuleDescriptor,
  StatusMessage,
  ViewServerMessage,
} from "@shared/protocol";
import { db } from "@/lib/db";
import { sanitizePayload } from "@/lib/sanitize";
import {
  applyDefaults,
  validateAgentMessage,
  MAX_AGENT_MESSAGE_BYTES,
} from "@/lib/validate";

const LOG_RING_SIZE = 300;
const COMMAND_TIMEOUT_MS = 10_000;
const FRAME_PERSIST_MS = 5_000;

interface AgentConn {
  ws: WebSocket;
  instanceId: string;
  userId: string;
  helloSeen: boolean;
}

interface ViewConn {
  ws: WebSocket;
  userId: string;
  subs: Set<string>;
  ownedIds: Set<string>;
}

interface PendingCommand {
  instanceId: string;
  resolve: (r: { ok: boolean; error?: string; data?: unknown }) => void;
  timer: NodeJS.Timeout;
}

interface LiveState {
  frame?: FrameMessage;
  status?: StatusMessage;
  catalog?: MapCatalog;
  modules?: ModuleDescriptor[];
  config?: ModuleConfig;
  meta?: {
    agent_version?: string;
    os?: string;
    machine?: string;
    managed?: boolean;
    epoch?: number;
    restored?: { quality: string; downtime_ms?: number };
  };
}

// In-process pub/sub boundary. To scale past one node, swap the broadcast
// body for a Redis pub/sub adapter — viewers and agents stay identical.
class Hub {
  private agents = new Map<string, AgentConn>();
  private viewers = new Set<ViewConn>();
  private live = new Map<string, LiveState>();
  private logs = new Map<string, LogLine[]>();
  private pending = new Map<string, PendingCommand>();
  private streamHz = new Map<string, number>();
  private lastFramePersist = new Map<string, number>();

  // ------------------------------------------------------------- agents ---

  agentConnected(ws: WebSocket, instance: { id: string; userId: string }) {
    // One live connection per instance: an older socket loses to the newest.
    const prev = this.agents.get(instance.id);
    if (prev && prev.ws !== ws) {
      try { prev.ws.close(4000, "superseded"); } catch { /* ignore */ }
    }
    this.agents.set(instance.id, {
      ws,
      instanceId: instance.id,
      userId: instance.userId,
      helloSeen: false,
    });
    const hz = this.streamHz.get(instance.id);
    if (hz) this.sendToAgent(instance.id, { type: "set_stream_rate", hz });
    db.instance
      .update({ where: { id: instance.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
    this.broadcast(instance.id, {
      type: "presence",
      instance_id: instance.id,
      online: true,
    });
  }

  agentDisconnected(instanceId: string, ws: WebSocket) {
    const conn = this.agents.get(instanceId);
    if (!conn || conn.ws !== ws) return; // superseded socket
    this.agents.delete(instanceId);
    const at = new Date();
    db.instance
      .update({ where: { id: instanceId }, data: { lastSeenAt: at } })
      .catch(() => {});
    this.broadcast(instanceId, {
      type: "presence",
      instance_id: instanceId,
      online: false,
      last_seen_at: at.toISOString(),
    });
  }

  isOnline(instanceId: string): boolean {
    return this.agents.has(instanceId);
  }

  onlineIds(): Set<string> {
    return new Set(this.agents.keys());
  }

  async handleAgentMessage(instanceId: string, raw: Buffer) {
    if (raw.length > MAX_AGENT_MESSAGE_BYTES) return;
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    msg = sanitizePayload(msg);
    if (!validateAgentMessage(msg)) return;

    const state = this.stateFor(instanceId);
    switch (msg.type) {
      case "hello": {
        const conn = this.agents.get(instanceId);
        if (conn) conn.helloSeen = true;
        state.modules = msg.modules;
        state.config = msg.config;
        state.meta = {
          agent_version: msg.agent_version,
          os: msg.os,
          machine: msg.machine,
          managed: msg.managed,
          epoch: msg.epoch,
          restored: msg.restored,
        };
        await db.instance
          .update({
            where: { id: instanceId },
            data: {
              server: msg.instance.server,
              gameUserId: msg.instance.user_id,
              username: msg.instance.username,
            },
          })
          .catch(() => {});
        await db.moduleCatalog
          .upsert({
            where: { instanceId },
            create: { instanceId, descriptors: msg.modules as object },
            update: { descriptors: msg.modules as object },
          })
          .catch(() => {});
        // Seed per-module config rows (agent-provided values + defaults).
        for (const mod of msg.modules) {
          const provided = msg.config.modules?.[mod.id] ?? {};
          const merged = applyDefaults(mod, provided);
          await db.config
            .upsert({
              where: { instanceId_moduleId: { instanceId, moduleId: mod.id } },
              create: { instanceId, moduleId: mod.id, settings: merged as object },
              update: { settings: merged as object },
            })
            .catch(() => {});
        }
        // Make client/backend visible to viewers even before first status.
        state.status = {
          ...(state.status ?? { bot_running: false, uptime_s: 0 }),
          client: msg.client,
          backend: msg.backend,
          module_id: msg.config.active_module ?? state.status?.module_id,
        } as StatusMessage;
        break;
      }
      case "frame": {
        state.frame = msg;
        this.broadcast(instanceId, { ...msg, instance_id: instanceId });
        const now = Date.now();
        if (now - (this.lastFramePersist.get(instanceId) ?? 0) > FRAME_PERSIST_MS) {
          this.lastFramePersist.set(instanceId, now);
          void this.persistState(instanceId);
        }
        break;
      }
      case "status": {
        const { type: _t, ...status } = msg;
        state.status = status as StatusMessage;
        this.broadcast(instanceId, { type: "status", instance_id: instanceId, ...status });
        void this.persistState(instanceId);
        break;
      }
      case "stat_event": {
        const { type: _t, ...ev } = msg;
        // seq'd events are deduped on (instanceId, seq) so replays stay
        // idempotent; the agent still gets its ack either way (docs/08 §8.7).
        const hasSeq = typeof ev.seq === "number" && Number.isFinite(ev.seq);
        const persist = hasSeq
          ? db.statEvent
              .create({
                data: {
                  instanceId,
                  at: new Date(ev.at),
                  seq: BigInt(ev.seq!),
                  source: ev.source ?? "",
                  message: ev.message ?? null,
                  rewards: ev.rewards as object,
                  balances: ev.balances as object,
                },
              })
              .then(() => true)
              .catch(() => false) // (instanceId, seq) conflict = replay
          : db.statEvent
              .create({
                data: {
                  instanceId,
                  at: new Date(ev.at),
                  source: ev.source ?? "",
                  message: ev.message ?? null,
                  rewards: ev.rewards as object,
                  balances: ev.balances as object,
                },
              })
              .then(() => true)
              .catch(() => false);
        void persist.then((fresh) => {
          if (fresh)
            this.broadcast(instanceId, {
              type: "stat_event",
              instance_id: instanceId,
              ...ev,
            });
        });
        if (hasSeq) this.sendToAgent(instanceId, { type: "stat_ack", seq: ev.seq! });
        break;
      }
      case "catalog": {
        const { type: _t, ...cat } = msg;
        state.catalog = cat as MapCatalog;
        this.broadcast(instanceId, { type: "catalog", instance_id: instanceId, ...cat });
        db.instanceState
          .upsert({
            where: { instanceId },
            create: { instanceId, latestCatalog: cat as object },
            update: { latestCatalog: cat as object },
          })
          .catch(() => {});
        break;
      }
      case "config": {
        state.config = msg.config;
        this.broadcast(instanceId, {
          type: "config",
          instance_id: instanceId,
          config: msg.config,
        });
        for (const [moduleId, settings] of Object.entries(msg.config.modules ?? {})) {
          db.config
            .upsert({
              where: { instanceId_moduleId: { instanceId, moduleId } },
              create: { instanceId, moduleId, settings: settings as object },
              update: { settings: settings as object },
            })
            .catch(() => {});
        }
        break;
      }
      case "log": {
        const { type: _t, ...line } = msg;
        const entry = line as LogLine;
        const ring = this.logs.get(instanceId) ?? [];
        ring.push(entry);
        if (ring.length > LOG_RING_SIZE) ring.splice(0, ring.length - LOG_RING_SIZE);
        this.logs.set(instanceId, ring);
        this.broadcast(instanceId, { type: "log", instance_id: instanceId, ...entry });
        break;
      }
      case "command_result": {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve({ ok: msg.ok, error: msg.error, data: msg.data });
        }
        this.broadcast(instanceId, {
          type: "command_update",
          instance_id: instanceId,
          id: msg.id,
          ok: msg.ok,
          error: msg.error,
          data: msg.data,
        });
        db.command
          .updateMany({
            where: { id: msg.id },
            data: {
              status: msg.ok ? "ok" : "error",
              error: msg.error ?? null,
              result: msg.data === undefined ? Prisma.JsonNull : (msg.data as object),
              answeredAt: new Date(),
            },
          })
          .catch(() => {});
        break;
      }
      case "pong":
        break;
    }
  }

  // ------------------------------------------------------------ viewers ---

  addViewer(ws: WebSocket, userId: string, ownedIds: Set<string>): ViewConn {
    const conn: ViewConn = { ws, userId, subs: new Set(), ownedIds };
    this.viewers.add(conn);
    return conn;
  }

  removeViewer(conn: ViewConn) {
    this.viewers.delete(conn);
  }

  subscribe(conn: ViewConn, instanceIds: string[]) {
    for (const id of instanceIds) {
      if (!conn.ownedIds.has(id)) continue; // ACL: own instances only
      conn.subs.add(id);
      const state = this.live.get(id);
      const snapshot: ViewServerMessage = {
        type: "snapshot",
        instance_id: id,
        online: this.isOnline(id),
        frame: state?.frame ?? null,
        status: state?.status ?? null,
        catalog: state?.catalog ?? null,
        logs: this.logs.get(id) ?? [],
      };
      this.sendToViewer(conn, snapshot);
      // Hydrate from DB when the process restarted since the agent was seen,
      // and always push the orchestrator phase cache for managed instances.
      if (!state?.frame && !state?.status) void this.hydrateFromDb(conn, id);
      void this.pushPhaseCache(conn, id);
    }
  }

  unsubscribe(conn: ViewConn, instanceIds: string[]) {
    for (const id of instanceIds) conn.subs.delete(id);
  }

  /** Orchestrator lifecycle update (managed instances): fan out to viewers. */
  publishPhase(
    instanceId: string,
    ev: {
      phase: string;
      detail?: unknown;
      desired_state?: string | null;
      epoch?: number;
      version?: string | null;
      at?: string;
    }
  ) {
    this.broadcast(instanceId, {
      type: "phase",
      instance_id: instanceId,
      phase: ev.phase,
      detail: ev.detail,
      desired_state: ev.desired_state ?? null,
      epoch: ev.epoch,
      version: ev.version ?? null,
      at: ev.at,
    });
  }

  private async pushPhaseCache(conn: ViewConn, instanceId: string) {
    const inst = await db.instance
      .findUnique({
        where: { id: instanceId },
        select: { kind: true, phase: true, phaseDetail: true, desiredState: true, version: true },
      })
      .catch(() => null);
    if (!inst || inst.kind !== "managed" || !inst.phase) return;
    if (!conn.subs.has(instanceId)) return;
    this.sendToViewer(conn, {
      type: "phase",
      instance_id: instanceId,
      phase: inst.phase,
      detail: inst.phaseDetail ?? null,
      desired_state: inst.desiredState ?? null,
      version: inst.version ?? null,
    });
  }

  private async hydrateFromDb(conn: ViewConn, instanceId: string) {
    const row = await db.instanceState
      .findUnique({ where: { instanceId } })
      .catch(() => null);
    const inst = await db.instance
      .findUnique({
        where: { id: instanceId },
        select: { lastSeenAt: true, phase: true, phaseDetail: true, desiredState: true },
      })
      .catch(() => null);
    if (!conn.subs.has(instanceId)) return;
    this.sendToViewer(conn, {
      type: "snapshot",
      instance_id: instanceId,
      online: this.isOnline(instanceId),
      last_seen_at: inst?.lastSeenAt?.toISOString() ?? null,
      frame: (row?.latestFrame as FrameMessage | null) ?? null,
      status: (row?.latestStatus as StatusMessage | null) ?? null,
      catalog: (row?.latestCatalog as MapCatalog | null) ?? null,
      logs: this.logs.get(instanceId) ?? [],
      phase: inst?.phase ?? null,
      phase_detail: inst?.phaseDetail ?? null,
      desired_state: inst?.desiredState ?? null,
    });
  }

  // ----------------------------------------------------------- commands ---

  sendCommand(
    instanceId: string,
    commandId: string,
    action: string,
    payload: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string; data?: unknown }> {
    const conn = this.agents.get(instanceId);
    if (!conn) return Promise.resolve({ ok: false, error: "instance offline" });
    const msg: CommandMsg = { type: "command", id: commandId, action: action as CommandMsg["action"], payload };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({ ok: false, error: "command timed out" });
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(commandId, { instanceId, resolve, timer });
      conn.ws.send(JSON.stringify(msg));
    });
  }

  setStreamRate(instanceId: string, hz: number) {
    const clamped = Math.max(1, Math.min(10, Math.round(hz)));
    this.streamHz.set(instanceId, clamped);
    if (this.agents.has(instanceId))
      this.sendToAgent(instanceId, { type: "set_stream_rate", hz: clamped });
    return clamped;
  }

  kickAgent(instanceId: string) {
    const conn = this.agents.get(instanceId);
    if (conn) {
      try { conn.ws.close(4001, "revoked"); } catch { /* ignore */ }
      this.agents.delete(instanceId);
    }
  }

  // ------------------------------------------------------------- intern ---

  private stateFor(id: string): LiveState {
    let s = this.live.get(id);
    if (!s) {
      s = {};
      this.live.set(id, s);
    }
    return s;
  }

  private async persistState(instanceId: string) {
    const s = this.live.get(instanceId);
    if (!s) return;
    await db.instanceState
      .upsert({
        where: { instanceId },
        create: {
          instanceId,
          latestFrame: s.frame === undefined ? Prisma.JsonNull : (s.frame as object),
          latestStatus: s.status === undefined ? Prisma.JsonNull : (s.status as object),
        },
        update: {
          latestFrame: s.frame === undefined ? Prisma.JsonNull : (s.frame as object),
          latestStatus: s.status === undefined ? Prisma.JsonNull : (s.status as object),
        },
      })
      .catch(() => {});
  }

  private sendToAgent(instanceId: string, msg: unknown) {
    const conn = this.agents.get(instanceId);
    if (conn && conn.ws.readyState === conn.ws.OPEN)
      conn.ws.send(JSON.stringify(msg));
  }

  private broadcast(instanceId: string, msg: ViewServerMessage) {
    const raw = JSON.stringify(msg);
    for (const v of this.viewers) {
      if (v.subs.has(instanceId) && v.ws.readyState === v.ws.OPEN) v.ws.send(raw);
    }
  }

  private sendToViewer(conn: ViewConn, msg: ViewServerMessage) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }
}

const g = globalThis as unknown as { __xenomitHub?: Hub };
export const hub = g.__xenomitHub ?? (g.__xenomitHub = new Hub());
