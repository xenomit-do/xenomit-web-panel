"use client";

import { useCallback, useEffect, useState } from "react";
import type { InstanceLive } from "@/hooks/useViewSocket";
import type { BotSnapshot, BotStatus } from "@shared/orchestrator";
import { fmtTimeAgo, fmtUptime } from "@/lib/format";
import { PhaseChip } from "./PhaseChip";
import { NeedsHumanCard } from "./NeedsHumanCard";

// Lifecycle tab (docs/08 §8.1): phase timeline, last snapshot/restore points,
// proxy, version + channel, epoch, pod/node — plus pause/resume/restart/drain
// and NeedsHuman prompts. Polls the merged panel+orchestrator view; the live
// phase also arrives over the viewer socket between polls.

interface LifecycleData {
  instance: {
    id: string;
    kind: string;
    bot_id: string | null;
    phase: string | null;
    phase_detail: unknown;
    desired_state: string | null;
    version: string | null;
    online: boolean;
    last_seen_at: string | null;
  };
  bot: BotStatus | null;
  orchestrator_error: string | null;
  trace_url: string | null;
}

export function LifecycleTab({
  instanceId,
  live,
  onLifecycle,
}: {
  instanceId: string;
  live: InstanceLive;
  onLifecycle: (action: string) => Promise<string | null>;
}) {
  const [data, setData] = useState<LifecycleData | null>(null);
  const [snapshots, setSnapshots] = useState<BotSnapshot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState("");

  const refresh = useCallback(() => {
    fetch(`/api/instances/${instanceId}/lifecycle`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
    fetch(`/api/instances/${instanceId}/snapshots`)
      .then((r) => (r.ok ? r.json() : { snapshots: [] }))
      .then((d) => setSnapshots(d.snapshots ?? []))
      .catch(() => {});
  }, [instanceId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh, live.phase]); // re-fetch on every phase transition too

  const bot = data?.bot ?? null;
  const phase = live.phase ?? data?.instance.phase ?? bot?.phase ?? null;
  const phaseDetail = live.phaseDetail ?? data?.instance.phase_detail ?? bot?.phaseDetail ?? null;
  const desired = live.desiredState ?? data?.instance.desired_state ?? bot?.desiredState ?? null;

  async function act(action: string, extra?: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    const e = await onLifecycle(action);
    if (e) setError(e);
    else if (extra?.confirmDelete) return; // page navigates away
    setBusy(null);
    refresh();
  }

  async function restore(snapshotId: string) {
    if (!confirm(`Restore this bot to snapshot ${snapshotId}?`)) return;
    setBusy(`restore-${snapshotId}`);
    setError(null);
    const res = await fetch(`/api/instances/${instanceId}/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot_id: snapshotId }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) setError(out.error ?? `restore failed (${res.status})`);
    setBusy(null);
    refresh();
  }

  async function setChannelNow() {
    if (!channel) return;
    setBusy("channel");
    setError(null);
    const res = await fetch(`/api/instances/${instanceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: { channel } }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) setError(out.error ?? `failed (${res.status})`);
    setBusy(null);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      {error && (
        <div className="text-red-400 text-sm panel px-3 py-2">{error}</div>
      )}
      {data?.orchestrator_error && (
        <div className="text-amber-400 text-sm panel px-3 py-2">
          Orchestrator unreachable — showing cached state ({data.orchestrator_error})
        </div>
      )}

      <NeedsHumanCard instanceId={instanceId} phase={phase} detail={phaseDetail} />

      <section className="panel p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <PhaseChip phase={phase} />
          <span className="muted text-sm">
            desired <b className="text-[#dbe4f5]">{desired ?? "—"}</b>
          </span>
          {bot?.epoch !== undefined && (
            <span className="muted text-sm">epoch {bot.epoch}</span>
          )}
          {bot?.version && <span className="muted text-sm">v {bot.version}</span>}
          <div className="flex-1" />
          <div className="flex gap-2">
            <button
              className="btn btn-green text-xs"
              disabled={!!busy || desired === "Running"}
              onClick={() => act("resume")}
            >
              ▶ Resume
            </button>
            <button
              className="btn text-xs"
              disabled={!!busy || desired === "Paused"}
              onClick={() => act("pause")}
            >
              ⏸ Pause
            </button>
            <button
              className="btn text-xs"
              disabled={!!busy}
              onClick={() => act("restart")}
            >
              ⟳ Restart
            </button>
            <button
              className="btn btn-red text-xs"
              disabled={!!busy || desired === "Stopped"}
              onClick={() => confirm("Drain to a clean snapshot and stop?") && act("drain")}
            >
              ■ Drain
            </button>
            <button
              className="btn btn-red text-xs"
              disabled={!!busy}
              onClick={() =>
                confirm("Delete this bot? It drains, then its credentials are destroyed in Vault.") &&
                act("delete", { confirmDelete: true })
              }
            >
              Delete
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-sm">
          <Meta k="Pod" v={bot?.podName ?? "—"} mono />
          <Meta k="Node" v={bot?.node ?? "—"} mono />
          <Meta k="Proxy" v={bot?.proxyRef ?? "—"} mono />
          <Meta k="Exit IP" v={bot?.proxyExitIp ?? "—"} mono />
          <Meta k="Uptime" v={fmtUptime(bot?.uptimeSeconds)} />
          <Meta k="Offline" v={fmtUptime(bot?.offlineSeconds)} />
          <Meta
            k="Last exit"
            v={
              bot?.lastExit
                ? `code ${bot.lastExit.code} · ${fmtTimeAgo(bot.lastExit.at)}${bot.lastExit.reason ? ` · ${bot.lastExit.reason}` : ""}`
                : "—"
            }
          />
          <Meta k="Agent" v={live.online ? "connected" : "not connected"} />
        </div>

        <div className="flex items-center gap-2 mt-3 text-sm">
          <span className="muted">Version channel</span>
          <select
            className="input"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">keep ({bot?.version ?? data?.instance.version ?? "current"})</option>
            <option value="stable">stable</option>
            <option value="canary">canary</option>
          </select>
          <button
            className="btn text-xs"
            disabled={!channel || !!busy}
            onClick={setChannelNow}
          >
            Apply
          </button>
          {data?.trace_url && (
            <a className="btn text-xs ml-auto" href={data.trace_url} target="_blank" rel="noreferrer">
              Traces ↗
            </a>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="panel p-4">
          <h3 className="font-semibold text-sm mb-2">Conditions</h3>
          <div className="flex flex-col gap-1 text-sm">
            {(bot?.conditions ?? []).map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={c.status ? "text-green-400" : "text-red-400"}>
                  {c.status ? "✓" : "✕"}
                </span>
                <span>{c.type}</span>
                {c.detail && <span className="muted text-xs truncate">{c.detail}</span>}
                {c.since && <span className="muted text-xs ml-auto">{fmtTimeAgo(c.since)}</span>}
              </div>
            ))}
            {!bot?.conditions?.length && <span className="muted text-sm">No conditions reported.</span>}
          </div>
        </section>

        <section className="panel p-4">
          <h3 className="font-semibold text-sm mb-2">Snapshots</h3>
          <div className="flex flex-col gap-1 text-sm max-h-48 overflow-y-auto">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className={`badge ${s.kind === "clean" ? "badge-on" : "badge-off"}`}>{s.kind}</span>
                <span className="muted text-xs">{fmtTimeAgo(s.at)}</span>
                <span className="muted text-xs font-mono truncate">{s.id}</span>
                {s.sizeBytes !== undefined && (
                  <span className="muted text-xs">{Math.round(s.sizeBytes / 1024)} KiB</span>
                )}
                <button
                  className="btn text-xs ml-auto"
                  disabled={!!busy}
                  onClick={() => restore(s.id)}
                >
                  {busy === `restore-${s.id}` ? "…" : "Restore"}
                </button>
              </div>
            ))}
            {!snapshots.length && (
              <span className="muted text-sm">No restore points yet — one is taken on each clean drain.</span>
            )}
          </div>
        </section>
      </div>

      <section className="panel p-4">
        <h3 className="font-semibold text-sm mb-2">Timeline</h3>
        <div className="flex flex-col gap-1 text-sm max-h-56 overflow-y-auto">
          {[...(bot?.timeline ?? [])].reverse().map((t, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="muted text-xs whitespace-nowrap">
                {new Date(t.at).toLocaleTimeString()}
              </span>
              <PhaseChip phase={t.phase} />
              {t.detail !== undefined && t.detail !== null && (
                <span className="muted text-xs truncate font-mono">
                  {safeDetail(t.detail)}
                </span>
              )}
            </div>
          ))}
          {!bot?.timeline?.length && <span className="muted text-sm">No transitions yet.</span>}
        </div>
      </section>
    </div>
  );
}

function Meta({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#1a2338] py-1">
      <span className="muted">{k}</span>
      <span className={`truncate ${mono ? "font-mono text-xs" : ""}`}>{v}</span>
    </div>
  );
}

function safeDetail(d: unknown): string {
  try {
    const s = JSON.stringify(d);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return String(d);
  }
}
