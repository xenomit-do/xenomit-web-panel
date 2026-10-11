"use client";

import { useState } from "react";

// Invite code entry on the landing page — POSTs /api/invites/claim which
// stashes a short-lived signed cookie; the subsequent Discord OAuth sign-in
// is gated on it (docs/08 §8.3a).
export function InviteForm() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setState("idle");
    try {
      const res = await fetch("/api/invites/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMsg(out.error ?? "invalid code");
      } else {
        setState("ok");
        setMsg("Invite accepted — now sign in with Discord.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={claim} className="flex gap-2 w-full max-w-sm justify-center">
      <input
        className="input flex-1 font-mono text-center uppercase tracking-widest"
        placeholder="INV-XXXXX-XXXXX"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        autoComplete="off"
      />
      <button className="btn" type="submit" disabled={busy || !code.trim()}>
        {busy ? "…" : "Redeem invite"}
      </button>
      {state !== "idle" && (
        <div
          className={`absolute -bottom-7 text-xs ${
            state === "ok" ? "text-green-400" : "text-red-400"
          }`}
        >
          {msg}
        </div>
      )}
    </form>
  );
}
