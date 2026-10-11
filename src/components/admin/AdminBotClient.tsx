"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { BotSnapshot, BotStatus } from "@shared/orchestrator";
import { fmtTimeAgo, fmtUptime } from "@/lib/format";
import { PhaseChip } from "../PhaseChip";

// Admin bot detail (docs/08 §8.5): lifecycle timeline, conditions, snapshots
// (list/restore), pod/node, proxy + exit IP, owner — plus ops actions and a
// trace deep-link when TRACES_BASE_URL is configured upstream.

interface BotData {
  bot: BotStatus | null;
  snapshots: BotSnapshot[];
  orchestrator_error: string | null;
  instance: {
    id: string;
    kind: string;
    nickname: string | null;
    username: string;
    server: string;
    online: boolean;
    last_seen_at: string | null;
    phase: string | null;
    desired_state: string | null;
    owner: { id: string; username: string; discordId: string };
  } | null;
}

export function AdminBotClient({ botId }: { botId: string }) {
  const [data, setData] = useState<BotData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`/api/admin/bots/${encodeURIComponent(botId)}`)
      .then((r) => {
        if (r.status === 404) setNotFound(true);
        return r.ok ? r.json() : null;
      })
      .then((d) => d && setData(d))
      .catch(() => {});
  }, [botId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function act(body: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(String(body.action));
    setNotice(null);
    const res = await fetch(`/api/admin/bots/${encodeURIComponent(botId)}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    setNotice(
      res.ok
        ? `${body.action} ok · trace ${out.trace_id?.slice(0, 8)}`
        : (out.error ?? `failed (${res.status})`)
    );
    setBusy(null);
    refresh();
  }

  const bot = data?.bot ?? null;
  const tracesBase = process.env.NEXT_PUBLIC_TRACES_BASE_URL;

  if (notFound)
    return <div className="muted">Bot not found (or already terminated).</div>;
  if (!data) return <div className="muted">Loading…</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/admin/fleet" className="btn text-xs px-2 py-1">← Fleet</Link>
        <h1 className="font-mono text-sm">{botId}</h1>
        <PhaseChip phase={bot?.phase ?? data.instance?.phase} />
        {data.instance?.online && <span className="badge badge-on">agent online</span>}
        <div className="flex-1" />
        {tracesBase && (
          <a
            className="btn text-xs"
            href={`${tracesBase}/explore?query=bot_id%3D%22${encodeURIComponent(botId)}%22`}
            target="_blank"
            rel="noreferrer"
          >
            Traces ↗
          </a>
        )}
      </div>

      {data.orchestrator_error && (
        <div className="panel px-3 py-2 text-amber-400 text-sm">
          Orchestrator unreachable: {data.orchestrator_error}
        </div>
      )}
      {notice && <div className="panel px-3 py-2 muted text-sm">{notice}</div>}

      <section className="panel p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-sm mb-4">
          <Meta k="Owner" v={data.instance?.owner.username ?? bot?.owner ?? "—"} />
          <Meta k="Nickname" v={data.instance?.nickname ?? bot?.name ?? "—"} />
          <Meta k="Server" v={bot?.account?.server ?? data.instance?.server ?? "—"} />
          <Meta k="Auth mode" v={bot?.account?.authMode ?? "—"} />
          <Meta k="Desired" v={bot?.desiredState ?? data.instance?.desired_state ?? "—"} />
          <Meta k="Version" v={bot?.version ?? "—"} mono />
          <Meta k="Epoch" v={bot?.epoch !== undefined ? String(bot.epoch) : "—"} />
          <Meta k="Config rev" v={bot?.configRevision !== undefined ? String(bot.configRevision) : "—"} />
          <Meta k="Pod" v={bot?.podName ?? "—"} mono />
          <Meta k="Node" v={bot?.node ?? "—"} mono />
          <Meta k="Image" v={bot?.image ?? "—"} mono />
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
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-green text-xs" disabled={!!busy} onClick={() => act({ action: "desired", desired_state: "Running" })}>
            ▶ Resume
          </button>
          <button className="btn text-xs" disabled={!!busy} onClick={() => act({ action: "desired", desired_state: "Paused" })}>
            ⏸ Pause
          </button>
          <button className="btn text-xs" disabled={!!busy} onClick={() => act({ action: "restart" })}>
            ⟳ Restart
          </button>
          <button className="btn text-xs" disabled={!!busy} onClick={() => act({ action: "drain" }, `Drain ${botId} to a clean snapshot?`)}>
            ■ Drain
          </button>
          <button
            className="btn btn-red text-xs ml-auto"
            disabled={!!busy}
            onClick={() => act({ action: "delete" }, `Delete ${botId}? Drains, destroys Vault credentials, soft-deletes.`)}
          >
            Delete bot
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="panel p-4">
          <h2 className="font-semibold text-sm mb-2">Conditions</h2>
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
            {!bot?.conditions?.length && <span className="muted text-sm">No conditions.</span>}
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="font-semibold text-sm mb-2">Snapshots</h2>
          <div className="flex flex-col gap-1 text-sm max-h-56 overflow-y-auto">
            {data.snapshots.map((s) => (
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
                  onClick={() => act({ action: "restore", snapshot_id: s.id }, `Restore ${botId} to ${s.id}?`)}
                >
                  Restore
                </button>
              </div>
            ))}
            {!data.snapshots.length && <span className="muted text-sm">No snapshots.</span>}
          </div>
        </section>
      </div>

      <section className="panel p-4">
        <h2 className="font-semibold text-sm mb-2">Timeline</h2>
        <div className="flex flex-col gap-1 text-sm max-h-72 overflow-y-auto">
          {[...(bot?.timeline ?? [])].reverse().map((t, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="muted text-xs whitespace-nowrap">
                {new Date(t.at).toLocaleString()}
              </span>
              <PhaseChip phase={t.phase} />
              {t.detail !== undefined && t.detail !== null && (
                <span className="muted text-xs truncate font-mono">{JSON.stringify(t.detail)}</span>
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
