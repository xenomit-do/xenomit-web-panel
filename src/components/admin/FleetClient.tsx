"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BotSummary, FleetSummary } from "@shared/orchestrator";
import { fmtTimeAgo, fmtUptime } from "@/lib/format";
import { PhaseChip } from "../PhaseChip";

// Fleet console (docs/08 §8.5): every bot across tenants — phase/version/node/
// proxy filters, counts, availability + offline-seconds, bulk drain/restart.

interface FleetBot extends BotSummary {
  instance_id: string | null;
  nickname: string | null;
  owner_username: string | null;
}

interface FleetData {
  summary: FleetSummary | null;
  orchestrator_error: string | null;
  bots: FleetBot[];
}

export function FleetClient() {
  const [data, setData] = useState<FleetData | null>(null);
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState("");
  const [version, setVersion] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/admin/fleet")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const bots = useMemo(() => {
    const ql = q.toLowerCase();
    return (data?.bots ?? []).filter(
      (b) =>
        (!phase || b.phase === phase) &&
        (!version || (b.version ?? "") === version) &&
        (!ql ||
          b.id.toLowerCase().includes(ql) ||
          (b.owner_username ?? "").toLowerCase().includes(ql) ||
          (b.nickname ?? "").toLowerCase().includes(ql) ||
          (b.name ?? "").toLowerCase().includes(ql) ||
          (b.node ?? "").toLowerCase().includes(ql) ||
          (b.proxyRef ?? "").toLowerCase().includes(ql))
    );
  }, [data, q, phase, version]);

  const phases = Object.keys(data?.summary?.byPhase ?? {}).sort();
  const versions = Object.keys(data?.summary?.byVersion ?? {}).sort();

  async function bulk(action: "drain" | "restart") {
    const ids = [...selected].filter((id) => bots.some((b) => b.id === id));
    if (!ids.length) return;
    if (
      !confirm(
        `${action === "drain" ? "Drain" : "Restart"} ${ids.length} bot(s)? Each drains at a safe point.`
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/admin/fleet/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, bot_ids: ids }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) {
      const okCount = (out.results ?? []).filter((r: { ok: boolean }) => r.ok).length;
      setNotice(`${action}: ${okCount}/${ids.length} ok · trace ${out.trace_id?.slice(0, 8)}`);
      setSelected(new Set());
    } else {
      setNotice(out.error ?? `failed (${res.status})`);
    }
    setBusy(false);
    refresh();
  }

  function toggleAll() {
    setSelected((s) =>
      s.size === bots.length ? new Set() : new Set(bots.map((b) => b.id))
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel px-4 py-3 flex flex-wrap gap-x-8 gap-y-1 text-sm items-center">
        <span>
          <b>{data?.summary?.total ?? "—"}</b> <span className="muted">bots</span>
        </span>
        {(data?.summary ? Object.entries(data.summary.byPhase) : []).map(([p, n]) => (
          <button
            key={p}
            className={`muted hover:text-[#dbe4f5] ${phase === p ? "text-[#dbe4f5]" : ""}`}
            onClick={() => setPhase(phase === p ? "" : p)}
          >
            {p} <b>{n}</b>
          </button>
        ))}
        {data?.summary?.needsHuman ? (
          <span className="text-[#ffab66] font-semibold">
            {data.summary.needsHuman} NeedsHuman
          </span>
        ) : null}
        {data?.summary?.needsUpdate ? (
          <span className="text-[#b388ff] font-semibold">
            {data.summary.needsUpdate} NeedsUpdate
          </span>
        ) : null}
        <span className="muted ml-auto">
          offline {fmtUptime(data?.summary?.offlineSeconds)}
        </span>
      </div>

      {data?.orchestrator_error && (
        <div className="panel px-3 py-2 text-amber-400 text-sm">
          Orchestrator unreachable: {data.orchestrator_error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[200px] max-w-sm"
          placeholder="Filter by bot, owner, node, proxy…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input" value={phase} onChange={(e) => setPhase(e.target.value)}>
          <option value="">all phases</option>
          {phases.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select className="input" value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="">all versions</option>
          {versions.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <div className="flex-1" />
        {selected.size > 0 && (
          <>
            <span className="muted text-sm">{selected.size} selected</span>
            <button className="btn text-xs" disabled={busy} onClick={() => bulk("drain")}>
              Drain
            </button>
            <button className="btn text-xs" disabled={busy} onClick={() => bulk("restart")}>
              Restart
            </button>
          </>
        )}
        {notice && <span className="muted text-sm">{notice}</span>}
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="muted text-left text-xs border-b border-[#232d47]">
              <th className="p-3 w-8">
                <input type="checkbox" checked={bots.length > 0 && selected.size === bots.length} onChange={toggleAll} />
              </th>
              <th className="p-3">Bot</th>
              <th className="p-3">Owner</th>
              <th className="p-3">Phase</th>
              <th className="p-3">Desired</th>
              <th className="p-3">Version</th>
              <th className="p-3">Node</th>
              <th className="p-3">Proxy</th>
              <th className="p-3">Uptime</th>
              <th className="p-3">Offline</th>
            </tr>
          </thead>
          <tbody>
            {bots.map((b) => (
              <tr key={b.id} className="border-b border-[#1a2338] hover:bg-[#151d30]">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.has(b.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(b.id);
                        else n.delete(b.id);
                        return n;
                      })
                    }
                  />
                </td>
                <td className="p-3">
                  <Link href={`/admin/bots/${b.id}`} className="font-mono text-xs text-sky-300 hover:underline">
                    {b.id}
                  </Link>
                  {(b.nickname ?? b.name) && (
                    <div className="text-xs">{b.nickname ?? b.name}</div>
                  )}
                </td>
                <td className="p-3 text-xs">{b.owner_username ?? b.owner.slice(0, 8)}</td>
                <td className="p-3"><PhaseChip phase={b.phase} /></td>
                <td className="p-3 muted text-xs">{b.desiredState}</td>
                <td className="p-3 font-mono text-xs">{b.version ?? "—"}</td>
                <td className="p-3 font-mono text-xs">{b.node ?? "—"}</td>
                <td className="p-3 font-mono text-xs">{b.proxyRef ?? "—"}</td>
                <td className="p-3 text-xs">{fmtUptime(b.uptimeSeconds)}</td>
                <td className="p-3 text-xs">{fmtUptime(b.offlineSeconds)}</td>
              </tr>
            ))}
            {!bots.length && (
              <tr>
                <td colSpan={10} className="p-8 text-center muted">
                  {data ? "No bots match the filters." : "Loading…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
