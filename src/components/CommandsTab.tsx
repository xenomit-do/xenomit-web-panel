"use client";

import { useState } from "react";
import type { InstanceLive } from "@/hooks/useViewSocket";

export function CommandsTab({
  instanceId,
  live,
  command,
}: {
  instanceId: string;
  live: InstanceLive;
  command: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [itemId, setItemId] = useState("");
  const [itemOn, setItemOn] = useState(true);
  const portals = live.frame?.portals ?? [];
  const pet = live.frame?.hero?.pet;
  const cfg = live.frame?.hero?.configuration;

  return (
    <div className="h-full overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
      <section className="panel p-4">
        <h3 className="font-semibold mb-2">Jump portal</h3>
        {portals.length === 0 && <div className="muted text-sm">No portals on this map.</div>}
        <div className="flex flex-col gap-1">
          {portals.map((p) => (
            <button
              key={p.id}
              className="btn text-left text-sm flex justify-between"
              disabled={!live.online}
              onClick={() =>
                command("game_command", { command: "jump_portal", portal_id: p.id })
              }
            >
              <span>{p.target_name ?? `map ${p.target_map}`}</span>
              <span className="muted text-xs">({Math.round(p.x)}, {Math.round(p.y)})</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="font-semibold mb-2">P.E.T.</h3>
        <div className="muted text-xs mb-2">
          {pet?.owned
            ? `owned · ${pet.active ? "active" : "inactive"}${pet.destroyed ? " · destroyed" : ""}${pet.gear ? ` · gear ${pet.gear}` : ""}`
            : "no pet"}
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-green"
            disabled={!live.online || !!pet?.active}
            onClick={() => command("game_command", { command: "set_pet", enabled: true })}
          >
            Activate
          </button>
          <button
            className="btn btn-red"
            disabled={!live.online || !pet?.active}
            onClick={() => command("game_command", { command: "set_pet", enabled: false })}
          >
            Deactivate
          </button>
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="font-semibold mb-2">Configuration</h3>
        <div className="muted text-xs mb-2">current: {cfg ?? "—"}</div>
        <div className="flex gap-2">
          {([1, 2] as const).map((c) => (
            <button
              key={c}
              className={`btn ${cfg === c ? "btn-primary" : ""}`}
              disabled={!live.online}
              onClick={() =>
                command("game_command", { command: "select_configuration", configuration: c })
              }
            >
              Config {c}
            </button>
          ))}
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="font-semibold mb-2">Use item</h3>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            className="input flex-1 min-w-[120px]"
            placeholder="item id (e.g. ammo_rsb)"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
          />
          <select
            className="input"
            value={itemOn ? "on" : "off"}
            onChange={(e) => setItemOn(e.target.value === "on")}
          >
            <option value="on">activate</option>
            <option value="off">deactivate</option>
          </select>
          <button
            className="btn"
            disabled={!live.online || !itemId.trim()}
            onClick={() =>
              command("game_command", {
                command: "use_item",
                item_id: itemId.trim(),
                activate: itemOn,
              })
            }
          >
            Send
          </button>
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="font-semibold mb-2">Maintenance</h3>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" disabled={!live.online} onClick={() => command("refresh_stats")}>
            Refresh stats
          </button>
          <button className="btn" disabled={!live.online} onClick={() => command("reset_stats")}>
            Reset session stats
          </button>
        </div>
      </section>
    </div>
  );
}
