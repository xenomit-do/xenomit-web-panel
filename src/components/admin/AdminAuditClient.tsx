"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtTimeAgo } from "@/lib/format";

// AuditLog search (docs/08 §8.5 Audit). Metadata is rendered truncated and
// never includes credential values (they're never written to audit rows).

interface Entry {
  id: string;
  at: string;
  user: string;
  user_id: string;
  instance_id: string | null;
  action: string;
  meta: unknown;
}

export function AdminAuditClient() {
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const search = useCallback((query: string) => {
    fetch(`/api/admin/audit?q=${encodeURIComponent(query)}&limit=200`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEntries(d.entries))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), 250);
    return () => clearTimeout(t);
  }, [q, search]);

  return (
    <div className="flex flex-col gap-4">
      <input
        className="input max-w-md"
        placeholder="Search actions, users, instance ids…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="muted text-left text-xs border-b border-[#232d47]">
              <th className="p-3">When</th>
              <th className="p-3">User</th>
              <th className="p-3">Action</th>
              <th className="p-3">Instance</th>
              <th className="p-3">Meta</th>
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((e) => (
              <tr
                key={e.id}
                className="border-b border-[#1a2338] cursor-pointer hover:bg-[#151d30]"
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              >
                <td className="p-3 muted text-xs whitespace-nowrap">{fmtTimeAgo(e.at)}</td>
                <td className="p-3 text-xs">{e.user}</td>
                <td className="p-3 font-mono text-xs">{e.action}</td>
                <td className="p-3 font-mono text-xs">{e.instance_id?.slice(0, 8) ?? "—"}</td>
                <td className="p-3 font-mono text-xs muted max-w-md truncate">
                  {expanded === e.id
                    ? <pre className="whitespace-pre-wrap">{JSON.stringify(e.meta, null, 2)}</pre>
                    : e.meta ? JSON.stringify(e.meta) : "—"}
                </td>
              </tr>
            ))}
            {entries && !entries.length && (
              <tr><td colSpan={5} className="p-8 text-center muted">No audit entries.</td></tr>
            )}
            {entries === null && (
              <tr><td colSpan={5} className="p-8 text-center muted">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
