"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useManyInstancesLive } from "@/hooks/useViewSocket";
import { InstanceCard, type InstanceSummary } from "./InstanceCard";
import { AddInstanceDialog } from "./AddInstanceDialog";
import { CreateBotWizard } from "./CreateBotWizard";
import { fmtRate, fmtNum } from "@/lib/format";
import { signOut } from "next-auth/react";

export function DashboardClient({
  user,
  admin,
  orchestrator,
  initialInstances,
}: {
  user: string;
  admin: boolean;
  orchestrator: boolean;
  initialInstances: InstanceSummary[];
}) {
  const router = useRouter();
  const [instances, setInstances] = useState(initialInstances);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const ids = useMemo(() => instances.map((i) => i.id), [instances]);
  const live = useManyInstancesLive(ids);

  const filtered = instances.filter((i) => {
    const q = search.toLowerCase();
    return (
      !q ||
      i.username.toLowerCase().includes(q) ||
      i.server.toLowerCase().includes(q) ||
      (i.nickname ?? "").toLowerCase().includes(q)
    );
  });

  const agg = useMemo(() => {
    let online = 0, needs = 0, cre = 0, uri = 0, exp = 0, hon = 0, deaths = 0;
    for (const i of instances) {
      const l = live.get(i.id);
      if (l?.online) online++;
      if ((l?.phase ?? i.phase) === "NeedsHuman") needs++;
      const r = l?.status?.rates;
      if (r) { cre += r.cre_h; uri += r.uri_h; exp += r.exp_h; hon += r.hon_h; }
      deaths += l?.status?.deaths ?? 0;
    }
    return { online, needs, cre, uri, exp, hon, deaths };
  }, [instances, live]);

  async function rename(id: string, nickname: string) {
    await fetch(`/api/instances/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: nickname || null }),
    });
    setInstances((xs) =>
      xs.map((x) => (x.id === id ? { ...x, nickname: nickname || null } : x))
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <header className="flex flex-wrap items-center gap-3 mb-6">
        <div className="text-xl font-bold tracking-tight">
          XENOMIT<span className="text-sky-400">·PANEL</span>
        </div>
        <input
          className="input flex-1 min-w-[160px] max-w-xs"
          placeholder="Search instances…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex-1" />
        {orchestrator && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Create bot
          </button>
        )}
        <button
          className={`btn ${orchestrator ? "" : "btn-primary"}`}
          onClick={() => setShowAdd(true)}
        >
          + Add instance
        </button>
        {admin && <Link href="/admin" className="btn">Admin</Link>}
        <Link href="/account" className="btn">{user}</Link>
        <button className="btn" onClick={() => signOut({ callbackUrl: "/" })}>
          Logout
        </button>
      </header>

      <div className="panel px-4 py-3 mb-5 flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <span>
          <b className="text-green-400">{agg.online}</b>
          <span className="muted">/{instances.length} online</span>
        </span>
        {agg.needs > 0 && (
          <span className="text-[#ffab66] font-semibold">
            {agg.needs} need{agg.needs === 1 ? "s" : ""} attention
          </span>
        )}
        <span className="muted">cre/h <b className="text-[#dbe4f5]">{fmtRate(agg.cre)}</b></span>
        <span className="muted">uri/h <b className="text-[#dbe4f5]">{fmtRate(agg.uri)}</b></span>
        <span className="muted">exp/h <b className="text-[#dbe4f5]">{fmtRate(agg.exp)}</b></span>
        <span className="muted">hon/h <b className="text-[#dbe4f5]">{fmtRate(agg.hon)}</b></span>
        <span className="muted">deaths <b className="text-[#dbe4f5]">{fmtNum(agg.deaths)}</b></span>
      </div>

      {filtered.length === 0 ? (
        <div className="panel p-10 text-center muted">
          {orchestrator
            ? "No instances yet — click + Create bot to launch a managed bot, or + Add instance to pair one."
            : "No instances yet — click + Add instance and pair your first bot."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((i) => (
            <InstanceCard key={i.id} inst={i} live={live.get(i.id)} onRename={rename} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddInstanceDialog
          onClose={() => {
            setShowAdd(false);
            router.refresh();
          }}
        />
      )}
      {showCreate && (
        <CreateBotWizard
          onClose={() => {
            setShowCreate(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
