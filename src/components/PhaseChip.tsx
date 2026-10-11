"use client";

// Lifecycle phase chip — used on instance cards, the instance page header and
// the admin fleet table. Forward-compatible: unknown phases render neutral.
const STYLES: Record<string, string> = {
  Running: "background:rgba(46,160,67,.18);color:#5fd97f",
  Provisioning: "background:rgba(79,195,247,.15);color:#4fc3f7",
  Armed: "background:rgba(79,195,247,.12);color:#7fd2f9",
  Starting: "background:rgba(79,195,247,.15);color:#4fc3f7",
  Draining: "background:rgba(255,213,79,.15);color:#ffd54f",
  Paused: "background:rgba(255,213,79,.15);color:#ffd54f",
  Stopped: "background:rgba(255,255,255,.08);color:#93a0b8",
  NeedsHuman: "background:rgba(255,152,64,.18);color:#ffab66",
  NeedsUpdate: "background:rgba(179,136,255,.18);color:#b388ff",
  Quarantined: "background:rgba(229,83,75,.18);color:#e5534b",
  Failed: "background:rgba(229,83,75,.18);color:#e5534b",
  Terminating: "background:rgba(255,255,255,.08);color:#93a0b8",
  Terminated: "background:rgba(255,255,255,.08);color:#93a0b8",
  Pending: "background:rgba(79,195,247,.10);color:#7fd2f9",
};

export function PhaseChip({ phase }: { phase: string | null | undefined }) {
  if (!phase) return null;
  return (
    <span className="badge" style={{ ...parse(STYLES[phase] ?? STYLES.Pending) }}>
      {phase}
    </span>
  );
}

function parse(style: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const kv of style.split(";")) {
    const [k, v] = kv.split(":");
    if (k && v) out[k.trim()] = v.trim();
  }
  return out as React.CSSProperties;
}

/** NeedsHuman kind carried in phaseDetail by the orchestrator. */
export function needsHumanKind(
  detail: unknown
): "captcha" | "credentials" | "update" | null {
  if (!detail || typeof detail !== "object") return null;
  const k = (detail as { kind?: unknown }).kind;
  if (k === "captcha" || k === "dosid_expired") return "captcha";
  if (k === "credentials" || k === "password_rejected") return "credentials";
  if (k === "update") return "update";
  return null;
}
