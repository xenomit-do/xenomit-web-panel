"use client";

import { useState } from "react";

export function AddInstanceDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function create() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    setLoading(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "failed");
      return;
    }
    setCode((await res.json()).code);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div className="panel p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-3">Add instance</h2>
        {!code ? (
          <>
            <p className="muted text-sm mb-4">
              Generate a single-use pairing code (valid for 10 minutes), then
              paste it into the bot&apos;s “Link to panel” dialog — or run:
            </p>
            <pre className="bg-[#0c1220] rounded p-3 text-xs mb-4 overflow-x-auto">
              xenomit --pair &lt;code&gt;
            </pre>
            {error && <div className="text-red-400 text-sm mb-3">{error}</div>}
            <div className="flex gap-2 justify-end">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={create} disabled={loading}>
                {loading ? "…" : "Generate code"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted text-sm mb-2">Your pairing code (single use):</p>
            <div className="text-3xl font-mono font-bold tracking-widest text-center my-5 text-sky-300">
              {code}
            </div>
            <p className="muted text-xs mb-4">
              Expires in 10 minutes. The bot will appear here as soon as it
              connects. A new instance token is issued automatically.
            </p>
            <div className="flex justify-end">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
