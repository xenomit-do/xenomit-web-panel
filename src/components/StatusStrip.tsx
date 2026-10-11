"use client";

import type { StatusMessage } from "@shared/protocol";
import { fmtUptime } from "@/lib/format";

export function StatusStrip({
  status,
  online,
}: {
  status: StatusMessage | null | undefined;
  online: boolean;
}) {
  const sidMs = sidRemainingMs(status?.sid_expires_at);
  const sidWarn = sidMs !== null && sidMs < 15 * 60_000;

  return (
    <div className="panel px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <span className={online ? "text-green-400" : "muted"}>
        {online ? (status?.activity ?? "online") : "offline"}
      </span>
      <span className="muted">up {fmtUptime(status?.uptime_s)}</span>
      {sidMs !== null && (
        <span className={sidWarn ? "text-amber-400 font-semibold" : "muted"}>
          SID {fmtUptime(Math.floor(sidMs / 1000))}
          {sidWarn ? " ⚠" : ""}
        </span>
      )}
      {status?.bridge_ping_ms !== undefined && (
        <span className="muted">ping {status.bridge_ping_ms}ms</span>
      )}
      {status?.cpu_pct !== undefined && (
        <span className="muted">cpu {status.cpu_pct.toFixed(0)}%</span>
      )}
      {status?.ram_mb !== undefined && (
        <span className="muted">ram {status.ram_mb.toFixed(0)}MB</span>
      )}
      {status?.client && (
        <span className="muted uppercase text-[11px]">
          {status.client}/{status.backend}
        </span>
      )}
    </div>
  );
}

function sidRemainingMs(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, t - Date.now());
}
