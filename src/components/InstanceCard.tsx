"use client";

import Link from "next/link";
import type { StatusMessage } from "@shared/protocol";
import type { InstanceLive } from "@/hooks/useViewSocket";
import { fmtNum, fmtRate, fmtUptime, fmtTimeAgo, pct } from "@/lib/format";
import { PhaseChip, needsHumanKind } from "./PhaseChip";
import { NeedsHumanCard } from "./NeedsHumanCard";

export interface InstanceSummary {
  id: string;
  kind?: string; // "paired" | "managed"
  bot_id?: string | null;
  server: string;
  username: string;
  game_user_id: string;
  nickname: string | null;
  last_seen_at: string | null;
  status: StatusMessage | null;
  map_name: string | null;
  // Managed lifecycle caches (from the SSE consumer / REST list).
  phase?: string | null;
  phase_detail?: unknown;
  desired_state?: string | null;
  version?: string | null;
}

export function InstanceCard({
  inst,
  live,
  onRename,
}: {
  inst: InstanceSummary;
  live?: InstanceLive;
  onRename: (id: string, nickname: string) => void;
}) {
  const status = live?.status ?? inst.status;
  const online = live?.online ?? false;
  const mapName =
    live?.frame?.map?.name ?? inst.map_name ?? (online ? "Loading" : "—");
  const hero = live?.frame?.hero;
  const rates = status?.rates;
  const balances = status?.balances;
  const managed = inst.kind === "managed";
  const phase = live?.phase ?? inst.phase ?? null;
  const phaseDetail = live?.phaseDetail ?? inst.phase_detail ?? null;
  const needsHuman =
    managed && phase === "NeedsHuman" && !!needsHumanKind(phaseDetail);

  return (
    <div
      className={`panel p-4 flex flex-col gap-2 ${
        online || (managed && phase && phase !== "Stopped" && phase !== "Terminated")
          ? ""
          : "opacity-60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`badge ${online ? "badge-on" : "badge-off"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-green-400" : "bg-gray-500"}`} />
            {online ? "online" : managed ? "agent off" : `offline · ${fmtTimeAgo(inst.last_seen_at)}`}
          </span>
          {managed && <PhaseChip phase={phase} />}
        </div>
        <span className="text-[11px] muted uppercase">
          {managed ? `managed${inst.version ? ` · ${inst.version}` : ""}` : (status?.client ?? "paired")}
        </span>
      </div>

      <div>
        <div className="font-semibold truncate">
          {inst.nickname || inst.username || "Unnamed instance"}
          <button
            className="muted text-[11px] ml-2 hover:text-sky-400"
            title="Edit nickname"
            onClick={() => {
              const n = prompt("Nickname", inst.nickname ?? "");
              if (n !== null) onRename(inst.id, n);
            }}
          >
            ✎
          </button>
        </div>
        <div className="muted text-xs truncate">
          {inst.server || "no server"} · {inst.username || "—"} · map {mapName}
        </div>
      </div>

      {managed && (
        <NeedsHumanCard
          instanceId={inst.id}
          phase={phase}
          detail={phaseDetail}
        />
      )}

      <div className="text-sm truncate">
        {status?.bot_running ? (
          <span className="text-green-400">▶ {status.module_id ?? "running"}</span>
        ) : managed && needsHuman ? (
          <span className="text-[#ffab66]">waiting for you</span>
        ) : managed && phase && phase !== "Running" ? (
          <span className="muted">{phase}</span>
        ) : (
          <span className="muted">■ stopped</span>
        )}
        <span className="muted ml-2 text-xs">{status?.activity ?? ""}</span>
      </div>

      <div className="flex flex-col gap-1">
        <Bar label="HP" value={pct(hero?.hp, hero?.max_hp)} color="#e5534b" />
        <Bar label="SH" value={pct(hero?.shield, hero?.max_shield)} color="#4fc3f7" />
      </div>

      <div className="grid grid-cols-4 gap-1 text-center text-[11px] mt-1">
        <Stat label="cre/h" v={fmtRate(rates?.cre_h)} />
        <Stat label="uri/h" v={fmtRate(rates?.uri_h)} />
        <Stat label="exp/h" v={fmtRate(rates?.exp_h)} />
        <Stat label="hon/h" v={fmtRate(rates?.hon_h)} />
      </div>
      <div className="grid grid-cols-4 gap-1 text-center text-[11px] muted">
        <Stat label="credits" v={fmtNum(balances?.[0])} />
        <Stat label="uridium" v={fmtNum(balances?.[1])} />
        <Stat label="honor" v={fmtNum(balances?.[2])} />
        <Stat label="exp" v={fmtNum(balances?.[3])} />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="muted text-[11px]">up {fmtUptime(status?.uptime_s)}</span>
        <Link href={`/instances/${inst.id}`} className="btn text-xs px-3 py-1">
          Open
        </Link>
      </div>
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] muted w-5">{label}</span>
      <div className="flex-1 h-1.5 rounded bg-[#0c1220] overflow-hidden">
        <div className="h-full rounded" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="muted">{label}</div>
      <div className="font-mono">{v}</div>
    </div>
  );
}
