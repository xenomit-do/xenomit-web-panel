"use client";

import { useState } from "react";
import { needsHumanKind } from "./PhaseChip";

// NeedsHuman banner + inline action form (docs/08 §8.4):
//   captcha/dosid_expired → "paste a fresh session cookie" → POST …/dosid
//   credentials           → "update credentials"           → POST …/credentials
//   update                → hint to restart to apply the new image
// Values go browser → panel → orchestrator in memory; nothing is stored.
export function NeedsHumanCard({
  instanceId,
  phase,
  detail,
}: {
  instanceId: string;
  phase: string | null | undefined;
  detail: unknown;
}) {
  const kind = phase === "NeedsHuman" ? needsHumanKind(detail) : null;
  const message =
    detail && typeof detail === "object"
      ? (detail as { message?: unknown }).message
      : null;

  const [dosid, setDosid] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (phase !== "NeedsHuman" || !kind) {
    if (phase !== "NeedsUpdate") return null;
    return (
      <div className="panel px-3 py-2 border-[#b388ff]/40 text-sm flex items-center gap-2">
        <span className="text-[#b388ff]">Update available</span>
        <span className="muted text-xs">
          restart the bot to apply the new image
        </span>
      </div>
    );
  }

  async function submit(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback(out.error ?? `failed (${res.status})`);
      } else {
        setFeedback("Submitted — the bot is resuming.");
        setDosid("");
        setPassword("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel px-3 py-2.5 border-[#ffab66]/40 text-sm">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[#ffab66] font-semibold">Needs attention</span>
        <span className="muted text-xs">
          {typeof message === "string"
            ? message
            : kind === "captcha"
              ? "Backpage needs a CAPTCHA — paste a fresh session cookie."
              : kind === "credentials"
                ? "Backpage rejected the password — update credentials."
                : "The bot needs your input."}
        </span>
      </div>
      {kind === "captcha" && (
        <form
          className="flex gap-2 mt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (dosid.trim())
              void submit(`/api/instances/${instanceId}/dosid`, {
                dosid: dosid.trim(),
              });
          }}
        >
          <input
            className="input flex-1 font-mono text-xs"
            placeholder="fresh session cookie (dosid)…"
            value={dosid}
            onChange={(e) => setDosid(e.target.value)}
            autoComplete="off"
          />
          <button className="btn btn-primary" disabled={busy || !dosid.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </form>
      )}
      {kind === "credentials" && (
        <form
          className="flex gap-2 mt-1 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim() && password)
              void submit(`/api/instances/${instanceId}/credentials`, {
                username: username.trim(),
                password,
              });
          }}
        >
          <input
            className="input flex-1 min-w-[120px]"
            placeholder="Backpage username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
          />
          <input
            className="input flex-1 min-w-[120px]"
            type="password"
            placeholder="Backpage password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <button
            className="btn btn-primary"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? "…" : "Update credentials"}
          </button>
        </form>
      )}
      {kind === "update" && (
        <div className="muted text-xs">
          An update is waiting — restart the bot to apply it.
        </div>
      )}
      {feedback && <div className="muted text-xs mt-1">{feedback}</div>}
    </div>
  );
}
