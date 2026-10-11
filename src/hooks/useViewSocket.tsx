"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type {
  FrameMessage,
  LogLine,
  MapCatalog,
  StatEvent,
  StatusMessage,
  ModuleConfig,
  ViewServerMessage,
} from "@shared/protocol";

export interface InstanceLive {
  online: boolean;
  lastSeenAt?: string | null;
  frame?: FrameMessage | null;
  status?: StatusMessage | null;
  catalog?: MapCatalog | null;
  config?: ModuleConfig | null;
  logs: LogLine[];
  events: StatEvent[];
  // Orchestrator lifecycle cache (managed instances), pushed via `phase`
  // viewer messages and hydrated on subscribe.
  phase?: string | null;
  phaseDetail?: unknown;
  desiredState?: string | null;
  version?: string | null;
  epoch?: number;
}

const EMPTY: InstanceLive = { online: false, logs: [], events: [] };

/** Shared in-browser store fed by the viewer websocket. */
export class ViewStore {
  private data = new Map<string, InstanceLive>();
  private versions = new Map<string, number>();
  private listeners = new Set<() => void>();

  get(id: string): InstanceLive {
    return this.data.get(id) ?? EMPTY;
  }

  version(id: string): number {
    return this.versions.get(id) ?? 0;
  }

  apply(id: string, patch: Partial<InstanceLive>) {
    const cur = this.data.get(id) ?? { ...EMPTY, logs: [], events: [] };
    this.data.set(id, { ...cur, ...patch });
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    for (const l of this.listeners) l();
  }

  pushLog(id: string, line: LogLine) {
    const cur = this.get(id);
    const logs = [...cur.logs, line].slice(-400);
    this.apply(id, { logs });
  }

  pushEvent(id: string, ev: StatEvent) {
    const cur = this.get(id);
    const events = [ev, ...cur.events].slice(0, 200);
    this.apply(id, { events });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

const store = new ViewStore();
export const viewStore = store;

interface ViewSocketCtx {
  setWanted(ids: string[]): void;
}

const Ctx = createContext<ViewSocketCtx>({ setWanted: () => {} });

export function useViewSocket() {
  return useContext(Ctx);
}

/**
 * Provider: mints a ticket, opens /api/view/ws, keeps subscriptions in sync
 * with the set of instance ids the mounted components asked for.
 */
export function ViewSocketProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const wantedRef = useRef<Set<string>>(new Set());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(async () => {
    try {
      const res = await fetch("/api/view/token", { method: "POST" });
      if (!res.ok) return scheduleReconnect();
      const { ticket } = await res.json();
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${proto}://${location.host}/api/view/ws?ticket=${encodeURIComponent(ticket)}`
      );
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "subscribe",
            instance_ids: [...wantedRef.current],
          })
        );
      };
      ws.onmessage = (e) => {
        let msg: ViewServerMessage;
        try { msg = JSON.parse(e.data); } catch { return; }
        handleViewMessage(store, msg);
      };
      ws.onclose = () => {
        wsRef.current = null;
        scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    } catch {
      scheduleReconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) return;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      void connect();
    }, 2000);
  }, [connect]);

  useEffect(() => {
    void connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const setWanted = useCallback((ids: string[]) => {
    const next = new Set(ids);
    const prev = wantedRef.current;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const added = ids.filter((i) => !prev.has(i));
      const removed = [...prev].filter((i) => !next.has(i));
      if (added.length)
        ws.send(JSON.stringify({ type: "subscribe", instance_ids: added }));
      if (removed.length)
        ws.send(JSON.stringify({ type: "unsubscribe", instance_ids: removed }));
    }
    wantedRef.current = next;
  }, []);

  return <Ctx.Provider value={{ setWanted }}>{children}</Ctx.Provider>;
}

function handleViewMessage(store: ViewStore, msg: ViewServerMessage) {
  if (!("instance_id" in msg)) return;
  const id = msg.instance_id;
  switch (msg.type) {
    case "snapshot":
      store.apply(id, {
        online: msg.online,
        lastSeenAt: msg.last_seen_at ?? null,
        frame: msg.frame ?? undefined,
        status: msg.status ?? undefined,
        catalog: msg.catalog ?? undefined,
        logs: msg.logs ?? [],
        ...(msg.phase !== undefined ? { phase: msg.phase } : {}),
        ...(msg.phase_detail !== undefined ? { phaseDetail: msg.phase_detail } : {}),
        ...(msg.desired_state !== undefined ? { desiredState: msg.desired_state } : {}),
      });
      break;
    case "phase":
      store.apply(id, {
        phase: msg.phase,
        phaseDetail: msg.detail,
        desiredState: msg.desired_state ?? undefined,
        version: msg.version ?? undefined,
        epoch: msg.epoch,
      });
      break;
    case "presence":
      store.apply(id, { online: msg.online, lastSeenAt: msg.last_seen_at ?? null });
      break;
    case "frame": {
      const { type: _t, instance_id: _i, ...frame } = msg;
      store.apply(id, { frame: frame as FrameMessage });
      break;
    }
    case "status": {
      const { type: _t, instance_id: _i, ...status } = msg;
      store.apply(id, { status });
      break;
    }
    case "stat_event": {
      const { type: _t, instance_id: _i, ...ev } = msg;
      store.pushEvent(id, ev);
      break;
    }
    case "log": {
      const { type: _t, instance_id: _i, ...line } = msg;
      store.pushLog(id, line);
      break;
    }
    case "catalog": {
      const { type: _t, instance_id: _i, ...cat } = msg;
      store.apply(id, { catalog: cat });
      break;
    }
    case "config":
      store.apply(id, { config: msg.config });
      break;
    default:
      break;
  }
}

/** Subscribe this component to live data for an instance. */
export function useInstanceLive(instanceId: string | null): InstanceLive {
  const { setWanted } = useViewSocket();
  useEffect(() => {
    if (!instanceId) return;
    wanted.add(instanceId);
    setWanted([...wanted]);
    return () => {
      wanted.delete(instanceId);
      setWanted([...wanted]);
    };
  }, [instanceId, setWanted]);

  useSyncExternalStore(
    useCallback((fn) => viewStore.subscribe(fn), []),
    () => viewStore.version(instanceId ?? "")
  );
  return instanceId ? viewStore.get(instanceId) : EMPTY;
}

const wanted = new Set<string>();

/** Same but for many ids (dashboard grid). */
export function useManyInstancesLive(ids: string[]): Map<string, InstanceLive> {
  const { setWanted } = useViewSocket();
  const key = ids.join(",");
  useEffect(() => {
    for (const id of ids) wanted.add(id);
    setWanted([...wanted]);
    return () => {
      for (const id of ids) wanted.delete(id);
      setWanted([...wanted]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setWanted]);

  useSyncExternalStore(
    useCallback((fn) => viewStore.subscribe(fn), []),
    () => ids.reduce((acc, id) => acc + viewStore.version(id), 0)
  );
  const out = new Map<string, InstanceLive>();
  for (const id of ids) out.set(id, viewStore.get(id));
  return out;
}
