"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtTimeAgo } from "@/lib/format";
import { signOut } from "next-auth/react";

interface Row {
  id: string;
  server: string;
  username: string;
  nickname: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export function AccountClient({ instances }: { instances: Row[] }) {
  const router = useRouter();
  const [repairCode, setRepairCode] = useState<Record<string, string>>({});

  async function repair(id: string) {
    const res = await fetch("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instance_id: id }),
    });
    if (!res.ok) return alert("Failed to create re-pair code");
    const { code } = await res.json();
    setRepairCode((m) => ({ ...m, [id]: code }));
  }

  async function unlink(id: string) {
    if (!confirm("Unlink this instance? Its token is revoked immediately.")) return;
    await fetch(`/api/instances/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="panel p-5">
      <h2 className="font-semibold mb-3">Instances</h2>
      <div className="flex flex-col gap-2">
        {instances.length === 0 && <div className="muted text-sm">None yet.</div>}
        {instances.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 border-b border-[#232d47] pb-2">
            <div className="flex-1 min-w-[180px]">
              <div className="text-sm font-medium">
                {i.nickname || i.username || i.id.slice(0, 8)}
              </div>
              <div className="muted text-xs">
                {i.server || "—"} · last seen {fmtTimeAgo(i.last_seen_at)}
              </div>
            </div>
            {repairCode[i.id] ? (
              <code className="text-sky-300 text-sm">{repairCode[i.id]}</code>
            ) : (
              <button className="btn text-xs" onClick={() => repair(i.id)}>
                Re-pair token
              </button>
            )}
            <button className="btn btn-red text-xs" onClick={() => unlink(i.id)}>
              Unlink
            </button>
          </div>
        ))}
      </div>
      <p className="muted text-xs mt-3">
        Re-pairing issues a fresh pairing code bound to the instance — the old
        token stops working as soon as the new one is issued.
      </p>
      <div className="mt-6">
        <button className="btn" onClick={() => signOut({ callbackUrl: "/" })}>
          Logout
        </button>
      </div>
    </div>
  );
}
