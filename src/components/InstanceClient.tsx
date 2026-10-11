"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInstanceLive } from "@/hooks/useViewSocket";
import type { ModuleDescriptor } from "@shared/protocol";
import { StatusStrip } from "./StatusStrip";
import { MapCanvas } from "./MapCanvas";
import { StatsTab } from "./StatsTab";
import { ConfigTab } from "./ConfigTab";
import { CommandsTab } from "./CommandsTab";
import { LogTab } from "./LogTab";
import { LifecycleTab } from "./LifecycleTab";
import { PhaseChip } from "./PhaseChip";
import { NeedsHumanCard } from "./NeedsHumanCard";

interface InstanceInfo {
  id: string;
  kind?: string;
  bot_id?: string | null;
  server: string;
  username: string;
  nickname: string | null;
  last_seen_at: string | null;
  phase?: string | null;
  phase_detail?: unknown;
  desired_state?: string | null;
  version?: string | null;
}

const PAIRED_TABS = ["map", "stats", "config", "commands", "log"] as const;
const MANAGED_TABS = ["map", "stats", "config", "commands", "lifecycle", "log"] as const;

export function InstanceClient({ instance }: { instance: InstanceInfo }) {
  const router = useRouter();
  const live = useInstanceLive(instance.id);
  const managed = instance.kind === "managed";
  const tabs = managed ? MANAGED_TABS : PAIRED_TABS;
  const [tab, setTab] = useState<string>("map");
  const [pending, setPending] = useState<string | null>(null);
  const [cmdError, setCmdError] = useState<string | null>(null);
  const status = live.status;
  const running = !!status?.bot_running;

  const phase = live.phase ?? instance.phase ?? null;
  const phaseDetail = live.phaseDetail ?? instance.phase_detail ?? null;
  const desired = live.desiredState ?? instance.desired_state ?? null;

  async function command(action: string, payload: Record<string, unknown> = {}) {
    setPending(action);
    setCmdError(null);
    try {
      const res = await fetch(`/api/instances/${instance.id}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false)
        setCmdError(body.error ?? `command failed (${res.status})`);
    } finally {
      setPending(null);
    }
  }

  /** Managed lifecycle actions — returns an error string or null. */
  async function lifecycle(action: string): Promise<string | null> {
    if (action === "delete") {
      const res = await fetch(`/api/instances/${instance.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/dashboard");
        return null;
      }
      const out = await res.json().catch(() => ({}));
      return out.error ?? `delete failed (${res.status})`;
    }
    const res = await fetch(`/api/instances/${instance.id}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const out = await res.json().catch(() => ({}));
    return res.ok ? null : (out.error ?? `${action} failed (${res.status})`);
  }

  const moduleIds = useModuleList(instance.id);

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[#232d47]">
        <Link href="/dashboard" className="btn text-xs px-2 py-1">←</Link>
        <div>
          <div className="font-semibold leading-tight">
            {instance.nickname || instance.username || instance.id.slice(0, 8)}
          </div>
          <div className="muted text-[11px]">{instance.server} · {instance.username}</div>
        </div>
        <span className={`badge ${live.online ? "badge-on" : "badge-off"}`}>
          {live.online ? "online" : "offline"}
        </span>
        {managed && <PhaseChip phase={phase} />}
        <div className="flex-1" />
        {moduleIds.length > 0 && (
          <select
            className="input"
            value={status?.module_id ?? ""}
            disabled={running || !!pending || !live.online}
            title={running ? "Stop the bot to switch modules" : "Select module"}
            onChange={(e) => command("set_module", { module_id: e.target.value })}
          >
            <option value="" disabled>module…</option>
            {moduleIds.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}
        {managed ? (
          <>
            <button
              className="btn btn-green"
              disabled={!!pending || desired === "Running"}
              title="desired state Running"
              onClick={() => lifecycle("resume")}
            >
              ▶ Resume
            </button>
            <button
              className="btn"
              disabled={!!pending || desired === "Paused" || desired === "Stopped"}
              onClick={() => lifecycle("pause")}
            >
              ⏸ Pause
            </button>
            <button
              className="btn"
              disabled={!!pending}
              onClick={() => lifecycle("restart")}
            >
              ⟳ Restart
            </button>
          </>
        ) : running ? (
          <button
            className="btn btn-red"
            disabled={!!pending || !live.online}
            onClick={() => command("stop")}
          >
            {pending === "stop" ? "…" : "■ Stop"}
          </button>
        ) : (
          <button
            className="btn btn-green"
            disabled={!!pending || !live.online}
            onClick={() => command("start")}
          >
            {pending === "start" ? "…" : "▶ Start"}
          </button>
        )}
      </header>

      {cmdError && (
        <div className="px-4 py-2 bg-red-950/60 border-b border-red-900 text-red-300 text-sm flex justify-between">
          <span>{cmdError}</span>
          <button onClick={() => setCmdError(null)}>✕</button>
        </div>
      )}

      {managed && (
        <div className="px-4 pt-3">
          <NeedsHumanCard instanceId={instance.id} phase={phase} detail={phaseDetail} />
        </div>
      )}

      <div className="px-4 pt-3">
        <StatusStrip status={status} online={live.online} />
      </div>

      <nav className="flex gap-1 px-4 pt-3">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-t-lg text-sm capitalize ${
              tab === t
                ? "bg-[#101624] border border-b-0 border-[#232d47] text-sky-300"
                : "muted hover:text-[#dbe4f5]"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-h-0 px-4 pb-4">
        <div className="panel w-full h-full overflow-hidden">
          {tab === "map" && <MapCanvas instanceId={instance.id} />}
          {tab === "stats" && <StatsTab instanceId={instance.id} live={live} />}
          {tab === "config" && <ConfigTab instanceId={instance.id} live={live} />}
          {tab === "commands" && (
            <CommandsTab instanceId={instance.id} live={live} command={command} />
          )}
          {tab === "lifecycle" && managed && (
            <LifecycleTab
              instanceId={instance.id}
              live={live}
              onLifecycle={lifecycle}
            />
          )}
          {tab === "log" && <LogTab live={live} />}
        </div>
      </div>
    </div>
  );
}

function useModuleList(instanceId: string): ModuleDescriptor[] {
  const [mods, setMods] = useState<ModuleDescriptor[]>([]);
  useEffect(() => {
    fetch(`/api/instances/${instanceId}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMods(d.modules ?? []))
      .catch(() => {});
  }, [instanceId]);
  return mods;
}
