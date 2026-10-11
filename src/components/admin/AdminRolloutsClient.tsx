"use client";

import { useCallback, useEffect, useState } from "react";
import type { Rollout, RolloutAction } from "@shared/orchestrator";
import { fmtTimeAgo } from "@/lib/format";

// Rollouts (docs/08 §8.5): create from an image/digest, canary list, wave
// settings, live progress, pause/resume/abort/rollback. Contract-compatible
// with the orchestrator API — degrades to an error banner when the
// orchestrator doesn't expose rollouts.

export function AdminRolloutsClient() {
  const [rollouts, setRollouts] = useState<Rollout[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [image, setImage] = useState("");
  const [canary, setCanary] = useState("");
  const [waveSize, setWaveSize] = useState("2");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/admin/rollouts")
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (d?.rollouts) {
          setRollouts(d.rollouts);
          setError(null);
        } else if (d?.error) setError(d.error);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/admin/rollouts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: image.trim(),
        ...(canary.trim()
          ? { canary: canary.split(",").map((s) => s.trim()).filter(Boolean) }
          : {}),
        wave: { size: Math.max(1, Number(waveSize) || 1) },
      }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    setNotice(res.ok ? `rollout ${out.rollout?.id} created` : (out.error ?? `failed (${res.status})`));
    if (res.ok) {
      setImage("");
      setCanary("");
    }
    refresh();
  }

  async function act(id: string, action: RolloutAction) {
    if (action === "rollback" && !confirm(`Roll back rollout ${id}?`)) return;
    await fetch(`/api/admin/rollouts/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="panel px-3 py-2 text-amber-400 text-sm">
          Orchestrator rollouts unavailable: {error}
        </div>
      )}
      {notice && <div className="panel px-3 py-2 muted text-sm">{notice}</div>}

      <section className="panel p-4">
        <h2 className="font-semibold text-sm mb-3">New rollout</h2>
        <form onSubmit={create} className="flex flex-wrap gap-2 items-center text-sm">
          <input
            className="input flex-1 min-w-[240px] font-mono text-xs"
            placeholder="image digest or tag, e.g. stable-0.7.0"
            required
            value={image}
            onChange={(e) => setImage(e.target.value)}
          />
          <input
            className="input w-56 font-mono text-xs"
            placeholder="canary bot ids (comma separated)"
            value={canary}
            onChange={(e) => setCanary(e.target.value)}
          />
          <label className="muted text-xs flex items-center gap-1">
            wave size
            <input
              className="input w-16"
              inputMode="numeric"
              value={waveSize}
              onChange={(e) => setWaveSize(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" disabled={busy || !image.trim()}>
            {busy ? "…" : "Create"}
          </button>
        </form>
      </section>

      <div className="flex flex-col gap-3">
        {(rollouts ?? []).map((r) => (
          <section key={r.id} className="panel p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-xs text-sky-300">{r.id}</span>
              <span className="font-mono text-xs">{r.image}</span>
              <StatusPill status={r.status} />
              <span className="muted text-xs">by {r.createdBy.slice(0, 8)} · {fmtTimeAgo(r.createdAt)}</span>
              <div className="flex-1" />
              {(r.status === "running" || r.status === "paused") && (
                <div className="flex gap-1">
                  {r.status === "running" ? (
                    <button className="btn text-xs" onClick={() => act(r.id, "pause")}>Pause</button>
                  ) : (
                    <button className="btn btn-green text-xs" onClick={() => act(r.id, "resume")}>Resume</button>
                  )}
                  <button className="btn text-xs" onClick={() => act(r.id, "abort")}>Abort</button>
                  <button className="btn btn-red text-xs" onClick={() => act(r.id, "rollback")}>Rollback</button>
                </div>
              )}
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-xs muted mb-1">
                <span>
                  {r.progress.done}/{r.progress.total} bots
                  {r.progress.failed ? ` · ${r.progress.failed} failed` : ""}
                </span>
                <span>wave {r.progress.currentWave}{r.wave?.size ? ` · ${r.wave.size}/wave` : ""}</span>
              </div>
              <div className="h-2 rounded bg-[#0c1220] overflow-hidden">
                <div
                  className="h-full rounded bg-sky-600 transition-all"
                  style={{ width: `${r.progress.total ? (r.progress.done / r.progress.total) * 100 : 0}%` }}
                />
              </div>
              {r.canary?.length ? (
                <div className="muted text-xs mt-1">
                  canary: {r.canary.join(", ")}
                </div>
              ) : null}
            </div>
          </section>
        ))}
        {rollouts && !rollouts.length && (
          <div className="panel p-8 text-center muted text-sm">No rollouts yet.</div>
        )}
        {rollouts === null && !error && (
          <div className="panel p-8 text-center muted text-sm">Loading…</div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Rollout["status"] }) {
  const cls =
    status === "running"
      ? "badge-on"
      : status === "done"
        ? "badge-on"
        : "badge-off";
  return <span className={`badge ${cls}`}>{status}</span>;
}
