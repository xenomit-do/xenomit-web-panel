"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProxyResource } from "@shared/orchestrator";

// Proxy pool (docs/08 §8.5 Proxies): CRUD, health, assignments, capacity.
// Credentials typed here go to the orchestrator's Vault via the admin API —
// never echoed back or persisted in the panel.

export function AdminProxiesClient() {
  const [proxies, setProxies] = useState<ProxyResource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    scheme: "socks5",
    host: "",
    port: "",
    country: "",
    capacity: "1",
    username: "",
    password: "",
  });

  const refresh = useCallback(() => {
    fetch("/api/admin/proxies")
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (d?.proxies) {
          setProxies(d.proxies);
          setError(null);
        } else if (d?.error) setError(d.error);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const res = await fetch("/api/admin/proxies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scheme: form.scheme,
        host: form.host.trim(),
        port: Number(form.port),
        ...(form.country.trim() ? { country: form.country.trim().toUpperCase() } : {}),
        capacity: Number(form.capacity) || 1,
        ...(form.username.trim() ? { username: form.username.trim() } : {}),
        ...(form.password ? { password: form.password } : {}),
      }),
    });
    const out = await res.json().catch(() => ({}));
    setNotice(res.ok ? `added ${out.proxy?.id}` : (out.error ?? `failed (${res.status})`));
    if (res.ok) setForm((f) => ({ ...f, host: "", port: "", username: "", password: "" }));
    refresh();
  }

  async function remove(id: string) {
    if (!confirm(`Remove proxy ${id}?`)) return;
    await fetch(`/api/admin/proxies/${encodeURIComponent(id)}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="panel px-3 py-2 text-amber-400 text-sm">{error}</div>}
      {notice && <div className="panel px-3 py-2 muted text-sm">{notice}</div>}

      <section className="panel p-4">
        <h2 className="font-semibold text-sm mb-3">Add proxy</h2>
        <form onSubmit={add} className="flex flex-wrap gap-2 items-end text-sm">
          <select className="input w-28" value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value })}>
            <option value="socks5">socks5</option>
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
          <input className="input flex-1 min-w-[160px]" placeholder="host" required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          <input className="input w-24" placeholder="port" required inputMode="numeric" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          <input className="input w-24" placeholder="country" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <input className="input w-24" placeholder="capacity" inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          <input className="input w-36" placeholder="username (opt)" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="input w-36" type="password" placeholder="password (opt)" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button className="btn btn-primary">Add</button>
        </form>
      </section>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="muted text-left text-xs border-b border-[#232d47]">
              <th className="p-3">Proxy</th>
              <th className="p-3">Endpoint</th>
              <th className="p-3">Country</th>
              <th className="p-3">Tags</th>
              <th className="p-3">Capacity</th>
              <th className="p-3">Health</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {(proxies ?? []).map((p) => (
              <tr key={p.id} className="border-b border-[#1a2338]">
                <td className="p-3 font-mono text-xs">{p.id}</td>
                <td className="p-3 font-mono text-xs">
                  {p.scheme}://{p.host}:{p.port}
                </td>
                <td className="p-3 text-xs">{p.country ?? "—"}</td>
                <td className="p-3 text-xs muted">{(p.tags ?? []).join(", ") || "—"}</td>
                <td className="p-3 text-xs">
                  {p.assigned}/{p.capacity}
                </td>
                <td className="p-3">
                  <span className={`badge ${p.healthy ? "badge-on" : "badge-off"}`}>
                    {p.healthy ? "healthy" : "down"}
                  </span>
                </td>
                <td className="p-3 text-right">
                  <button className="btn btn-red text-xs" onClick={() => remove(p.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {proxies && !proxies.length && (
              <tr><td colSpan={7} className="p-8 text-center muted">No proxies in the pool.</td></tr>
            )}
            {proxies === null && (
              <tr><td colSpan={7} className="p-8 text-center muted">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
