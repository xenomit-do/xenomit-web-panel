"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtTimeAgo } from "@/lib/format";

// Users & invites (docs/08 §8.5): list, role promote/demote, suspend (drains
// their bots), instanceLimit, invite code/Discord-ID management.

interface AdminUser {
  id: string;
  discord_id: string;
  username: string;
  avatar: string | null;
  role: string;
  status: string;
  plan: string;
  instance_limit: number;
  instance_count: number;
  created_at: string;
}

interface Invite {
  id: string;
  has_code: boolean;
  discord_id: string | null;
  note: string | null;
  created_by: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

export function AdminUsersClient() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [inviteDiscord, setInviteDiscord] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteCode, setInviteCode] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUsers(d.users))
      .catch(() => {});
    fetch("/api/admin/invites")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInvites(d.invites))
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  async function patchUser(id: string, body: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setNotice(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    setNotice(
      res.ok
        ? `user updated${out.drained ? ` · drained ${out.drained} bot(s)` : ""}`
        : (out.error ?? `failed (${res.status})`)
    );
    refresh();
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNewCode(null);
    setNotice(null);
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: inviteCode,
        discord_id: inviteDiscord.trim() || undefined,
        note: inviteNote.trim() || undefined,
      }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setNewCode(out.invite.code ?? null);
      setNotice("invite created");
      setInviteDiscord("");
      setInviteNote("");
    } else {
      setNotice(out.error ?? `failed (${res.status})`);
    }
    refresh();
  }

  async function revokeInvite(id: string) {
    await fetch(`/api/admin/invites/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && <div className="panel px-3 py-2 muted text-sm">{notice}</div>}

      <section className="panel p-4">
        <h2 className="font-semibold text-sm mb-3">Create invite</h2>
        <form onSubmit={createInvite} className="flex flex-wrap gap-2 items-center text-sm">
          <label className="flex items-center gap-2 muted text-xs">
            <input type="checkbox" checked={inviteCode} onChange={(e) => setInviteCode(e.target.checked)} />
            single-use code
          </label>
          <input
            className="input flex-1 min-w-[180px]"
            placeholder="Discord id to pre-approve (optional)"
            value={inviteDiscord}
            onChange={(e) => setInviteDiscord(e.target.value)}
          />
          <input
            className="input w-48"
            placeholder="note (optional)"
            value={inviteNote}
            onChange={(e) => setInviteNote(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy || (!inviteCode && !inviteDiscord.trim())}>
            {busy ? "…" : "Create"}
          </button>
        </form>
        {newCode && (
          <div className="mt-3 panel px-3 py-2 font-mono text-sky-300 text-center tracking-widest">
            {newCode}
            <div className="muted text-[11px] font-sans tracking-normal mt-1">
              single-use — share it; the invitee redeems it on the landing page
            </div>
          </div>
        )}
      </section>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="muted text-left text-xs border-b border-[#232d47]">
              <th className="p-3">User</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
              <th className="p-3">Instances</th>
              <th className="p-3">Joined</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id} className="border-b border-[#1a2338]">
                <td className="p-3">
                  <div className="font-medium">{u.username}</div>
                  <div className="muted text-[11px] font-mono">{u.discord_id}</div>
                </td>
                <td className="p-3">
                  <span className={`badge ${u.role === "admin" ? "badge-on" : "badge-off"}`}>{u.role}</span>
                </td>
                <td className="p-3">
                  <span className={`badge ${u.status === "active" ? "badge-on" : "badge-off"}`}>{u.status}</span>
                </td>
                <td className="p-3 text-xs">
                  {u.instance_count}/{u.instance_limit}
                  <button
                    className="muted text-[11px] ml-2 hover:text-sky-400"
                    title="Edit limit"
                    onClick={() => {
                      const v = prompt("Instance limit", String(u.instance_limit));
                      if (v !== null && Number.isInteger(Number(v)))
                        void patchUser(u.id, { instance_limit: Number(v) });
                    }}
                  >
                    ✎
                  </button>
                </td>
                <td className="p-3 muted text-xs">{fmtTimeAgo(u.created_at)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button
                    className="btn text-xs mr-1"
                    onClick={() =>
                      patchUser(
                        u.id,
                        { role: u.role === "admin" ? "user" : "admin" },
                        u.role === "admin" ? `Demote ${u.username} to user?` : `Promote ${u.username} to admin?`
                      )
                    }
                  >
                    {u.role === "admin" ? "Demote" : "Make admin"}
                  </button>
                  <button
                    className={`btn text-xs ${u.status === "suspended" ? "btn-green" : "btn-red"}`}
                    onClick={() =>
                      patchUser(
                        u.id,
                        { status: u.status === "suspended" ? "active" : "suspended" },
                        u.status === "suspended"
                          ? `Reactivate ${u.username}?`
                          : `Suspend ${u.username}? Their managed bots will be drained to Paused.`
                      )
                    }
                  >
                    {u.status === "suspended" ? "Reactivate" : "Suspend"}
                  </button>
                </td>
              </tr>
            ))}
            {users && !users.length && (
              <tr><td colSpan={6} className="p-8 text-center muted">No users.</td></tr>
            )}
            {users === null && (
              <tr><td colSpan={6} className="p-8 text-center muted">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="muted text-left text-xs border-b border-[#232d47]">
              <th className="p-3">Invite</th>
              <th className="p-3">For</th>
              <th className="p-3">Created by</th>
              <th className="p-3">Status</th>
              <th className="p-3">Expires</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {(invites ?? []).map((i) => {
              const expired = new Date(i.expires_at) < new Date();
              const used = !!i.used_at;
              return (
                <tr key={i.id} className="border-b border-[#1a2338]">
                  <td className="p-3 text-xs">
                    {i.has_code ? "code invite" : "pre-approval"}
                    {i.note && <div className="muted text-[11px]">{i.note}</div>}
                  </td>
                  <td className="p-3 font-mono text-xs">{i.discord_id ?? "anyone"}</td>
                  <td className="p-3 text-xs">{i.created_by}</td>
                  <td className="p-3">
                    <span className={`badge ${used ? "badge-off" : expired ? "badge-off" : "badge-on"}`}>
                      {used ? `used by ${i.used_by ?? "?"}` : expired ? "expired" : "open"}
                    </span>
                  </td>
                  <td className="p-3 muted text-xs">{fmtTimeAgo(i.expires_at)}</td>
                  <td className="p-3 text-right">
                    {!used && (
                      <button className="btn btn-red text-xs" onClick={() => revokeInvite(i.id)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {invites && !invites.length && (
              <tr><td colSpan={6} className="p-8 text-center muted">No invites.</td></tr>
            )}
            {invites === null && (
              <tr><td colSpan={6} className="p-8 text-center muted">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
